import { randomUUID } from 'node:crypto'
import { PokerGame } from '../poker/PokerGame.js'
import {
  POKER_CONFIG,
  MESSAGE_TYPES,
  GAME_PHASES,
  BLIND_LEVELS,
  BLIND_APPROVALS_NEEDED,
  BLIND_PROPOSAL_TIMEOUT_MS,
  CONTEST_MODE_HANDS_PER_LEVEL
} from '../config/constants.js'
import { BotPlayer } from '../bots/runtime/BotPlayer.js'
import { recordHandResult } from '../bots/botRepository.js'

const HUMAN_DEFAULT_RATING = 1200
const ELO_K = 24

function eloDelta(botRating, opponentRatings, won) {
  if (opponentRatings.length === 0) return 0
  const avg = opponentRatings.reduce((a, b) => a + b, 0) / opponentRatings.length
  const expected = 1 / (1 + Math.pow(10, (avg - botRating) / 400))
  const actual = won ? 1 : 0
  return Math.round(ELO_K * (actual - expected))
}

const TABLE_EMOTES = new Set(['angry', 'laugh', 'sad', 'shush', 'sunglasses', 'eggplant'])
const BIG_YAHU_EMOTES = new Set(['star_of_david', 'israel_flag'])
const MAX_BOTS_PER_PLAYER = 3

export class PokerRoom {
  constructor(roomId, isPrivate = false, options = {}) {
    this.roomId = roomId
    this.roomType = 'poker'
    this.isPrivate = isPrivate
    this.inviteCode = null
    this.players = new Map()    // playerId -> player (seated)
    this.spectators = new Map() // playerId -> player (watching)
    this.emoteSequence = 0
    this.yellSequence = 0
    this.startHandTimeout = null

    // Bot Arena: spectator-driven room where humans never sit; only bots
    // play, and a spectator explicitly starts/stops the match.
    this.isArena = !!options.isArena
    this.arenaRunning = false
    this.arenaStartingChips = POKER_CONFIG.STARTING_CHIPS
    // Userid of the signed-in account that created this arena. Anonymous users
    // can never own arenas — RoomManager rejects creation upstream.
    this.ownerUserId = options.ownerUserId || null
    // RoomManager hands us a callback so the arena-empty timer can ask the
    // manager to fully tear down this room (release private code, etc.).
    this._onArenaExpire = typeof options.onArenaExpire === 'function' ? options.onArenaExpire : null

    // 30s grace timer that fires when the last human leaves a non-arena room
    // and bots are still seated. Bots get cleared on expiry; cancelled if any
    // human (player or spectator) returns first.
    this.emptyRoomCleanupTimer = null
    // 30s timer that fires when the last spectator leaves an arena. The arena
    // is destroyed entirely on expiry.
    this.arenaEmptyTimer = null
    this.game = new PokerGame(
      (msg) => {
        this.broadcast(msg)
        // Intercept hand resolutions to update each seated bot's ELO + DB
        // counters. Fired exactly once per hand (showdown OR fold-out both
        // emit a `showdown` broadcast).
        if (msg?.type === 'showdown') {
          this._recordBotHandResults(msg.data).catch(err =>
            console.error('[bot-elo] hand result update failed:', err.message)
          )
        }
      },
      () => this.broadcastGameState()
    )
    this._lastBroadcastPhase = GAME_PHASES.WAITING
    this._cleanupGuard = false
    this.blindsProposal = null
    this.contestMode = {
      enabled: false,
      startingLevelIndex: 0,
      currentLevelIndex: 0,
      nextEscalateAtHand: 0,
      proposerId: null,
      proposerName: null
    }
  }

  // --- Contest mode -------------------------------------------------------

  contestModeSummary() {
    return {
      enabled: this.contestMode.enabled,
      startingLevelIndex: this.contestMode.startingLevelIndex,
      currentLevelIndex: this.contestMode.currentLevelIndex,
      nextEscalateAtHand: this.contestMode.nextEscalateAtHand,
      handsUntilNextLevel: this.contestMode.enabled
        ? Math.max(0, this.contestMode.nextEscalateAtHand - this.game.handIndex)
        : null,
      handsPerLevel: CONTEST_MODE_HANDS_PER_LEVEL,
      proposerId: this.contestMode.proposerId,
      proposerName: this.contestMode.proposerName,
      currentLevel: BLIND_LEVELS[this.contestMode.currentLevelIndex] || null,
      nextLevel: BLIND_LEVELS[this.contestMode.currentLevelIndex + 1] || null
    }
  }

  broadcastContestModeUpdate() {
    this.broadcastToHumans({
      type: MESSAGE_TYPES.POKER_CONTEST_MODE_UPDATE,
      data: this.contestModeSummary()
    })
  }

  toggleContestMode(playerId, { enabled, startingLevelId }) {
    // Arenas: any spectator at the arena can toggle contest mode.
    const player = this.isArena
      ? (this.spectators.get(playerId) || this.players.get(playerId))
      : this.players.get(playerId)
    if (!player || player.isBot) {
      return { success: false, error: this.isArena
        ? 'You must be in the arena to toggle contest mode.'
        : 'You must be seated to toggle contest mode.'
      }
    }
    if (enabled) {
      const level = startingLevelId
        ? BLIND_LEVELS.find(l => l.id === startingLevelId)
        : BLIND_LEVELS.find(l => l.small === this.game.smallBlind && l.big === this.game.bigBlind) || BLIND_LEVELS[0]
      if (!level) return { success: false, error: 'Unsupported starting level.' }
      const idx = BLIND_LEVELS.indexOf(level)

      this.contestMode = {
        enabled: true,
        startingLevelIndex: idx,
        currentLevelIndex: idx,
        nextEscalateAtHand: this.game.handIndex + CONTEST_MODE_HANDS_PER_LEVEL,
        proposerId: playerId,
        proposerName: player.username
      }

      // Apply the chosen starting level if it's not already in effect. Re-uses
      // the regular proposal flow — auto-applies for solo play, gets votes when
      // multiple humans are at the table.
      if (this.game.smallBlind !== level.small || this.game.bigBlind !== level.big) {
        const result = this.proposeBlinds(playerId, level.small, level.big)
        if (!result.success && result.error !== 'A blinds proposal is already pending — wait for it to resolve.') {
          // Roll back enable on hard error.
          this.contestMode.enabled = false
          return result
        }
      }

      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} started contest mode at $${level.small}/$${level.big}. Blinds bump every ${CONTEST_MODE_HANDS_PER_LEVEL} hands.` }
      })
      this.broadcastContestModeUpdate()
      return { success: true }
    }

    // Disable
    if (this.contestMode.enabled) {
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} stopped contest mode.` }
      })
    }
    this.contestMode = {
      enabled: false,
      startingLevelIndex: 0,
      currentLevelIndex: 0,
      nextEscalateAtHand: 0,
      proposerId: null,
      proposerName: null
    }
    this.broadcastContestModeUpdate()
    return { success: true }
  }

  _maybeEscalateContestBlinds() {
    if (!this.contestMode.enabled) return
    if (this.game.handIndex < this.contestMode.nextEscalateAtHand) return

    // Pick a current proposer. If the original enabler left the room, fall
    // back to any seated human.
    let proposerId = this.contestMode.proposerId
    if (!proposerId || !this.players.has(proposerId) || this.players.get(proposerId)?.isBot) {
      const fallback = [...this.players.values()].find(p => !p.isBot)
      if (!fallback) {
        // No humans left — disable contest mode.
        this.contestMode.enabled = false
        this.broadcastContestModeUpdate()
        return
      }
      proposerId = fallback.id
      this.contestMode.proposerId = fallback.id
      this.contestMode.proposerName = fallback.username
    }

    const nextIdx = this.contestMode.currentLevelIndex + 1
    if (nextIdx >= BLIND_LEVELS.length) {
      // Capped — leave it on but stop trying to escalate.
      this.contestMode.nextEscalateAtHand = this.game.handIndex + CONTEST_MODE_HANDS_PER_LEVEL
      this.broadcastContestModeUpdate()
      return
    }

    const next = BLIND_LEVELS[nextIdx]
    const result = this.proposeBlinds(proposerId, next.small, next.big)
    // Whether the vote succeeds or not, schedule the next attempt.
    this.contestMode.currentLevelIndex = result.applied ? nextIdx : this.contestMode.currentLevelIndex
    this.contestMode.nextEscalateAtHand = this.game.handIndex + CONTEST_MODE_HANDS_PER_LEVEL
    this.broadcastContestModeUpdate()
  }

  // --- Blinds change & approval flow --------------------------------------

  countSeatedHumans() {
    let n = 0
    for (const p of this.players.values()) {
      if (!p.isBot) n += 1
    }
    return n
  }

  proposeBlinds(playerId, small, big) {
    // Arena spectators can change blinds directly without the proposal/vote
    // dance — the arena is theirs to configure.
    if (this.isArena) {
      const proposer = this.spectators.get(playerId) || this.players.get(playerId)
      if (!proposer) return { success: false, error: 'You must be in the arena to change blinds.' }
      const level = BLIND_LEVELS.find(l => l.small === small && l.big === big)
      if (!level) return { success: false, error: 'Unsupported blind level.' }
      if (this.game.smallBlind === small && this.game.bigBlind === big) {
        return { success: false, error: 'Those are already the current blinds.' }
      }
      this.applyBlinds(small, big, proposer.username, false)
      return { success: true, applied: true }
    }

    const proposer = this.players.get(playerId)
    if (!proposer || proposer.isBot) {
      return { success: false, error: 'You must be seated to change the blinds.' }
    }
    const level = BLIND_LEVELS.find(l => l.small === small && l.big === big)
    if (!level) return { success: false, error: 'Unsupported blind level.' }

    if (this.game.smallBlind === small && this.game.bigBlind === big) {
      return { success: false, error: 'Those are already the current blinds.' }
    }
    if (this.blindsProposal) {
      return { success: false, error: 'A blinds proposal is already pending — wait for it to resolve.' }
    }

    const humanCount = this.countSeatedHumans()
    const needed = BLIND_APPROVALS_NEEDED[Math.min(humanCount, 5)] || 1

    // Solo human (with or without bots) → just apply.
    if (humanCount <= 1) {
      this.applyBlinds(small, big, proposer.username, false)
      return { success: true, applied: true }
    }

    const proposal = {
      id: `blinds-${randomUUID()}`,
      small,
      big,
      proposerId: playerId,
      proposerName: proposer.username,
      approvals: new Set([playerId]),
      rejections: new Set(),
      needed,
      expiresAt: Date.now() + BLIND_PROPOSAL_TIMEOUT_MS,
      timer: null
    }
    proposal.timer = setTimeout(() => {
      if (this.blindsProposal && this.blindsProposal.id === proposal.id) {
        this.resolveBlindsProposal('expired')
      }
    }, BLIND_PROPOSAL_TIMEOUT_MS)
    this.blindsProposal = proposal

    this.broadcastToHumans({
      type: MESSAGE_TYPES.POKER_BLINDS_PROPOSAL,
      data: {
        proposalId: proposal.id,
        small, big,
        proposerId: playerId,
        proposerName: proposer.username,
        approvalsNeeded: needed,
        approvalsCount: proposal.approvals.size,
        humanCount,
        expiresAt: proposal.expiresAt
      }
    })
    return { success: true, applied: false, proposalId: proposal.id, needed }
  }

  voteBlinds(playerId, proposalId, vote) {
    const proposal = this.blindsProposal
    if (!proposal || proposal.id !== proposalId) {
      return { success: false, error: 'No active proposal.' }
    }
    const player = this.players.get(playerId)
    if (!player || player.isBot) {
      return { success: false, error: 'Only seated humans can vote.' }
    }
    if (proposal.approvals.has(playerId) || proposal.rejections.has(playerId)) {
      return { success: false, error: 'You already voted.' }
    }

    if (vote === 'reject') {
      proposal.rejections.add(playerId)
      this.resolveBlindsProposal('rejected', { byName: player.username })
      return { success: true }
    }

    proposal.approvals.add(playerId)
    if (proposal.approvals.size >= proposal.needed) {
      this.applyBlinds(proposal.small, proposal.big, proposal.proposerName, true)
      this.resolveBlindsProposal('applied')
    } else {
      // Partial — refresh the proposal state for everyone.
      this.broadcastToHumans({
        type: MESSAGE_TYPES.POKER_BLINDS_PROPOSAL,
        data: {
          proposalId: proposal.id,
          small: proposal.small,
          big: proposal.big,
          proposerId: proposal.proposerId,
          proposerName: proposal.proposerName,
          approvalsNeeded: proposal.needed,
          approvalsCount: proposal.approvals.size,
          humanCount: this.countSeatedHumans(),
          expiresAt: proposal.expiresAt
        }
      })
    }
    return { success: true }
  }

  resolveBlindsProposal(outcome, extras = {}) {
    const proposal = this.blindsProposal
    if (!proposal) return
    if (proposal.timer) clearTimeout(proposal.timer)
    this.blindsProposal = null

    this.broadcastToHumans({
      type: MESSAGE_TYPES.POKER_BLINDS_RESOLVED,
      data: { proposalId: proposal.id, outcome, small: proposal.small, big: proposal.big, ...extras }
    })

    if (outcome === 'rejected') {
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `Blinds proposal $${proposal.small}/$${proposal.big} rejected${extras.byName ? ' by ' + extras.byName : ''}.` }
      })
    } else if (outcome === 'expired') {
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `Blinds proposal $${proposal.small}/$${proposal.big} expired.` }
      })
    }
  }

  applyBlinds(small, big, byName, viaVote) {
    this.game.setBlinds(small, big)
    // Keep contest mode's currentLevelIndex in sync with the actual table
    // level — covers both initial-start applies and voted escalations.
    const idx = BLIND_LEVELS.findIndex(l => l.small === small && l.big === big)
    if (idx !== -1 && this.contestMode.enabled) {
      this.contestMode.currentLevelIndex = idx
      this.broadcastContestModeUpdate()
    }
    this.broadcast({
      type: MESSAGE_TYPES.POKER_BLINDS_CHANGED,
      data: { small, big, byName, viaVote }
    })
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: {
        message: `Blinds set to $${small}/$${big}${viaVote ? ` (proposed by ${byName})` : ` by ${byName}`}. Takes effect next hand.`
      }
    })
    this.broadcastGameState()
  }

  broadcastToHumans(message) {
    for (const p of this.players.values()) {
      if (!p.isBot) p.send(message)
    }
    for (const s of this.spectators.values()) {
      s.send(message)
    }
  }

  isBotSeat(playerId) {
    const p = this.players.get(playerId)
    return Boolean(p?.isBot)
  }

  countBotsAddedBy(playerId) {
    let n = 0
    for (const p of this.players.values()) {
      if (p.isBot && p.addedByPlayerId === playerId) n++
    }
    return n
  }

  // Adder must be a seated human; bot inherits their stack with a 1000-chip floor.
  addBotForPlayer(addingPlayerId, bot) {
    const adder = this.players.get(addingPlayerId)
    if (!adder || adder.isBot) {
      return { success: false, error: 'Only a seated player can add a bot' }
    }
    if (this.players.size >= POKER_CONFIG.MAX_PLAYERS) {
      return { success: false, error: 'Table is full' }
    }
    if (this.countBotsAddedBy(addingPlayerId) >= MAX_BOTS_PER_PLAYER) {
      return { success: false, error: `You can only add ${MAX_BOTS_PER_PLAYER} bots at a time` }
    }
    if (this.game.phase !== GAME_PHASES.WAITING && this.game.hasPlayerActionStarted()) {
      return { success: false, error: 'Wait for the current hand to finish' }
    }

    const startingChips = Math.max(POKER_CONFIG.STARTING_CHIPS, adder.chips)
    const seatId = `bot-${randomUUID()}`
    const botPlayer = new BotPlayer({
      id: seatId,
      bot,
      addedByPlayerId: addingPlayerId,
      room: this,
      ownerDisplayName: bot.ownerDisplayName,
      startingChips
    })

    const seated = this.game.addPlayer(botPlayer)
    if (!seated) {
      botPlayer.destroy()
      return { success: false, error: 'Could not seat bot' }
    }

    this.players.set(seatId, botPlayer)
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `${adder.username} added bot ${bot.name}.` }
    })
    botPlayer.emitPhrase('joined_table')
    this.broadcastRoomUpdate()
    this.scheduleStartHand()
    return { success: true, bot: botPlayer.toJSON() }
  }

  removeBotForPlayer(requestingPlayerId, botSeatId) {
    const bot = this.players.get(botSeatId)
    if (!bot || !bot.isBot) return { success: false, error: 'Not a bot' }
    if (bot.addedByPlayerId !== requestingPlayerId) {
      return { success: false, error: 'Only the player who added this bot can remove it' }
    }
    bot.emitPhrase('left_table')
    bot.destroy()
    this.removePlayer(botSeatId)
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `Bot ${bot.username} left the table.` }
    })
    return { success: true }
  }

  broadcastBotYell(bot, message) {
    if (!bot || !message) return
    const text = String(message).slice(0, 80)
    this.yellSequence += 1
    const timestamp = Date.now()
    this.broadcast({
      type: MESSAGE_TYPES.PLAYER_YELL,
      data: {
        playerId: bot.id,
        username: bot.username,
        message: text,
        yellId: `${timestamp}-${this.yellSequence}`,
        timestamp,
        isBot: true,
        botColor: bot.botColor
      }
    })
  }

  async _recordBotHandResults(broadcastData) {
    const handSummary = this.game.handHistory[this.game.handHistory.length - 1]
    if (!handSummary) return
    const winnerIds = new Set((broadcastData?.winners || []).map(w => w.playerId))
    const allSeats = [...this.players.values()]
    const ratingFor = (p) => p.isBot ? (p.bot?.elo ?? HUMAN_DEFAULT_RATING) : HUMAN_DEFAULT_RATING

    for (const seat of allSeats) {
      if (!seat.isBot || !seat.bot?.id) continue

      const opponents = allSeats.filter(s => s.id !== seat.id).map(ratingFor)
      const won = winnerIds.has(seat.id)
      const change = eloDelta(seat.bot.elo ?? HUMAN_DEFAULT_RATING, opponents, won)

      const chipsDelta = handSummary.profitsByPlayer?.[seat.id] ?? 0
      const seatActions = handSummary.actionsByPlayer?.[seat.id] ?? []
      const preflop = seatActions.filter(a => a.phase === 'preflop')
      const foldedPreflop = preflop.some(a => a.action === 'fold')
      const voluntarilyIn = preflop.some(a => a.action === 'call' || a.action === 'raise' || a.action === 'all_in')
      const wentToShowdown = handSummary.type === 'showdown' && Array.isArray(handSummary.cards?.[seat.id])

      // Update in-memory rating immediately so subsequent hands at this same
      // table compute against the bot's new strength.
      if (typeof seat.bot.elo === 'number') seat.bot.elo = Math.max(100, seat.bot.elo + change)

      try {
        await recordHandResult({
          botId: seat.bot.id,
          tableId: this.roomId,
          chipsDelta,
          wentToShowdown,
          won,
          foldedPreflop,
          voluntarilyIn,
          eloChange: change
        })
      } catch (err) {
        console.error(`[bot-elo] persist failed for ${seat.bot.name}:`, err.message)
      }
    }
  }

  _cleanupBrokeBots() {
    if (this._cleanupGuard) return
    this._cleanupGuard = true
    try {
      for (const p of [...this.players.values()]) {
        if (p.isBot && p.chips === 0) {
          this.broadcast({
            type: MESSAGE_TYPES.SYSTEM_MESSAGE,
            data: { message: `${p.username} is out of chips and left the table.` }
          })
          p.emitPhrase('lose')
          p.destroy()
          this.removePlayer(p.id)
        }
      }
    } finally {
      this._cleanupGuard = false
    }
  }

  addPlayer(player) {
    if (this.players.has(player.id)) {
      return { success: true, isSpectator: false }
    }
    if (this.spectators.has(player.id)) {
      return { success: true, isSpectator: true }
    }

    // Arenas are spectator-only — humans never seat at one. Drop them in as a
    // spectator instead so they can manage bots.
    if (this.isArena) {
      return this.addSpectator(player, { voluntary: true, message: 'Joined arena as spectator.' })
    }

    // Only force spectator if the physical seats are full
    if (this.players.size >= POKER_CONFIG.MAX_PLAYERS) {
      return this.addSpectator(player)
    }

    const addedToGame = this.game.addPlayer(player)
    if (!addedToGame) {
      return this.addSpectator(player)
    }

    this.players.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = false
    this._cancelEmptyRoomCleanup()
    this.broadcastRoomUpdate()

    // Auto-start when we have enough players
    this.scheduleStartHand()

    return { success: true, isSpectator: false }
  }

  addSpectator(player, options = {}) {
    if (this.spectators.has(player.id)) {
      return { success: true, isSpectator: true }
    }

    const isVoluntary = Boolean(options.voluntary)
    this.spectators.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = true
    player.isVoluntarySpectator = isVoluntary
    this._cancelEmptyRoomCleanup()
    this._cancelArenaEmptyTimer()

    player.send({
      type: MESSAGE_TYPES.SPECTATOR_UPDATE,
      data: {
        roomId: this.roomId,
        gameState: this.game.getGameState(null, { revealAllCards: true }),
        message: options.message || 'Table is full. Watching as spectator until a seat opens.'
      }
    })

    this.broadcastRoomUpdate()

    return { success: true, isSpectator: true }
  }

  removePlayer(playerId) {
    const wasPlayer = this.players.has(playerId)
    const wasSpectator = this.spectators.has(playerId)
    const player = this.players.get(playerId)
    const spectatorPlayer = this.spectators.get(playerId)

    if (wasPlayer) {
      this.players.delete(playerId)
      if (player) player.isSpectator = false
      this.game.removePlayer(playerId)
      // Drop the proposer or kill the proposal if everyone needed to vote left.
      if (this.blindsProposal) {
        if (this.blindsProposal.proposerId === playerId) {
          this.resolveBlindsProposal('expired')
        } else if (this.countSeatedHumans() < this.blindsProposal.needed) {
          this.resolveBlindsProposal('expired')
        }
      }
    }

    if (wasSpectator) {
      this.spectators.delete(playerId)
      if (spectatorPlayer) spectatorPlayer.isSpectator = false
      if (spectatorPlayer) spectatorPlayer.isVoluntarySpectator = false
    }

    // Promote a spectator to player if there's room
    if (wasPlayer && this.spectators.size > 0) {
      const promotable = [...this.spectators.entries()].find(([, spectator]) => !spectator.isVoluntarySpectator)
      if (!promotable) {
        this.broadcastRoomUpdate()
        this.scheduleStartHand()
        return
      }

      const [specId, spectator] = promotable
      this.spectators.delete(specId)
      spectator.isSpectator = false
      spectator.isVoluntarySpectator = false
      const addedToGame = this.game.addPlayer(spectator)

      if (addedToGame) {
        this.players.set(specId, spectator)

        spectator.send({
          type: MESSAGE_TYPES.ROOM_UPDATE,
          data: { ...this.getRoomData(specId), message: 'You have been seated at the table!' }
        })
      } else {
        spectator.isSpectator = true
        spectator.isVoluntarySpectator = false
        this.spectators.set(specId, spectator)
      }
    }

    this.broadcastRoomUpdate()
    this.scheduleStartHand()
    // After everything settles, schedule a 30s cleanup if all humans are gone
    // and bots are still seated. The countSeatedHumansAndSpectators check
    // accepts spectators as "humans here" so a watcher keeps the room alive.
    this._scheduleEmptyRoomCleanupIfNeeded()
    // Arenas: when the last spectator leaves, start the 30s teardown timer.
    this._scheduleArenaEmptyTimerIfNeeded()
  }

  handlePlayerAction(playerId, actionType, data) {
    const actionMap = {
      [MESSAGE_TYPES.POKER_FOLD]: 'fold',
      [MESSAGE_TYPES.POKER_CHECK]: 'check',
      [MESSAGE_TYPES.POKER_CALL]: 'call',
      [MESSAGE_TYPES.POKER_RAISE]: 'raise',
      [MESSAGE_TYPES.POKER_ALL_IN]: 'all_in',
    }

    const action = actionMap[actionType]
    if (!action) return { success: false, error: 'Unknown action' }

    return this.game.handleAction(playerId, action, data?.amount || 0)
  }

  handlePlayerEmote(playerId, data) {
    if (!this.players.has(playerId)) {
      return { success: false, error: 'Only seated players can emote' }
    }

    const emote = String(data?.emote || '')
    const timestamp = Date.now()

    const player = this.players.get(playerId)
    const isBaseEmote = TABLE_EMOTES.has(emote)
    const isUnlocked = BIG_YAHU_EMOTES.has(emote) && (player?.bigYahuCalls || 0) > 0
    if (!isBaseEmote && !isUnlocked) {
      return { success: false, error: 'Unknown emote' }
    }

    this.emoteSequence += 1
    this.broadcast({
      type: MESSAGE_TYPES.PLAYER_EMOTE,
      data: {
        playerId,
        emote,
        emoteId: `${timestamp}-${this.emoteSequence}`,
        timestamp
      }
    })

    return { success: true }
  }

  handlePlayerYell(playerId, data) {
    const player = this.players.get(playerId)
    if (!player) {
      return { success: false, error: 'Only seated players can yell' }
    }

    const message = String(data?.message || '').trim().substring(0, 80)
    const timestamp = Date.now()

    if (!message) {
      return { success: false, error: 'Yell cannot be empty' }
    }

    this.yellSequence += 1
    this.broadcast({
      type: MESSAGE_TYPES.PLAYER_YELL,
      data: {
        playerId,
        username: player.username,
        message,
        yellId: `${timestamp}-${this.yellSequence}`,
        timestamp
      }
    })

    return { success: true }
  }

  broadcast(message) {
    for (const player of this.players.values()) {
      player.send(message)
    }
    for (const spectator of this.spectators.values()) {
      spectator.send(message)
    }
  }

  scheduleStartHand(delay = 2000) {
    if (this.startHandTimeout || !this.game.canStart()) return
    // Arena rooms only deal hands when a spectator has explicitly started the
    // match. This is what lets people add/remove bots and tweak settings
    // between hands without the engine racing ahead.
    if (this.isArena && !this.arenaRunning) return

    this.startHandTimeout = setTimeout(() => {
      this.startHandTimeout = null
      this.game.startHand()
    }, delay)
  }

  // --- Bot Arena: spectator controls ---------------------------------------

  setArenaRunning(playerId, running) {
    if (!this.isArena) return { success: false, error: 'Not an arena' }
    if (!this.spectators.has(playerId) && !this.players.has(playerId)) {
      return { success: false, error: 'Only people at the arena can start/stop' }
    }
    const wasRunning = this.arenaRunning
    this.arenaRunning = !!running
    if (running) {
      // Lift the engine pause first so the deferred runout / next-hand /
      // post-showdown callbacks fire immediately and the game catches up to
      // wherever it was when paused.
      this.game.setPaused(false)
      // Resume mid-hand: clear each bot's last-turn-key and re-broadcast so the
      // active bot sees the prompt again and schedules a fresh decision. Without
      // this, the active bot remembers it already "decided" the current turn
      // (from before the pause) and won't act.
      if (!wasRunning) {
        for (const p of this.players.values()) {
          if (p.isBot && typeof p.pauseImmediate === 'function') p.pauseImmediate()
        }
        this.broadcastGameState()
      }
      this.scheduleStartHand(1500)
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: 'Arena match started.' }
      })
    } else {
      // Hard stop: freeze the engine (no runout deals, no post-showdown reset,
      // no next-hand schedule), cancel queued next hand AND every bot's
      // pending decision. The game stays exactly where it is until resume.
      this.game.setPaused(true)
      if (this.startHandTimeout) clearTimeout(this.startHandTimeout)
      this.startHandTimeout = null
      for (const p of this.players.values()) {
        if (p.isBot && typeof p.pauseImmediate === 'function') p.pauseImmediate()
      }
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: 'Arena match paused — modify the lineup, then start again.' }
      })
    }
    this.broadcastRoomUpdate()
    return { success: true }
  }

  setArenaStartingChips(playerId, chips) {
    if (!this.isArena) return { success: false, error: 'Not an arena' }
    if (!this.spectators.has(playerId) && !this.players.has(playerId)) {
      return { success: false, error: 'Only people at the arena can change settings' }
    }
    const n = Math.max(100, Math.min(1_000_000, Math.floor(Number(chips) || 0)))
    this.arenaStartingChips = n
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `Arena starting chips set to $${n.toLocaleString()}.` }
    })
    this.broadcastRoomUpdate()
    return { success: true, chips: n }
  }

  // Arena spectators can add bots even though they're not seated. Mirrors
  // addBotForPlayer but with arena-aware sourcing of the starting stack.
  addBotForArenaSpectator(spectatorId, bot) {
    if (!this.isArena) return { success: false, error: 'Not an arena' }
    const spectator = this.spectators.get(spectatorId)
    if (!spectator) return { success: false, error: 'You must be in the arena to add a bot' }
    if (this.players.size >= POKER_CONFIG.MAX_PLAYERS) {
      return { success: false, error: 'Arena is full' }
    }
    // Mid-hand additions are queued to the next hand by PokerGame.addPlayer
    // (waitingNextHand). No need to reject here — the user explicitly wants
    // to be able to queue bots from a running arena.

    const seatId = `bot-${randomUUID()}`
    const botPlayer = new BotPlayer({
      id: seatId,
      bot,
      addedByPlayerId: spectatorId,
      room: this,
      ownerDisplayName: bot.ownerDisplayName,
      startingChips: this.arenaStartingChips
    })

    const seated = this.game.addPlayer(botPlayer)
    if (!seated) {
      botPlayer.destroy()
      return { success: false, error: 'Could not seat bot' }
    }

    this.players.set(seatId, botPlayer)
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `${spectator.username} added bot ${bot.name} to the arena.` }
    })
    botPlayer.emitPhrase('joined_table')
    this.broadcastRoomUpdate()
    if (this.arenaRunning) this.scheduleStartHand()
    return { success: true, bot: botPlayer.toJSON() }
  }

  removeBotForArenaSpectator(spectatorId, botSeatId) {
    if (!this.isArena) return { success: false, error: 'Not an arena' }
    if (!this.spectators.has(spectatorId)) {
      return { success: false, error: 'You must be in the arena to remove a bot' }
    }
    const bot = this.players.get(botSeatId)
    if (!bot || !bot.isBot) return { success: false, error: 'Not a bot' }
    bot.destroy()
    this.removePlayer(botSeatId)
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `Bot ${bot.username} was removed from the arena.` }
    })
    return { success: true }
  }

  // --- Empty-table 30s cleanup -------------------------------------------

  countSeatedHumansAndSpectators() {
    let n = 0
    for (const p of this.players.values()) if (!p.isBot) n += 1
    n += this.spectators.size
    return n
  }

  _cancelEmptyRoomCleanup() {
    if (this.emptyRoomCleanupTimer) {
      clearTimeout(this.emptyRoomCleanupTimer)
      this.emptyRoomCleanupTimer = null
    }
  }

  _scheduleEmptyRoomCleanupIfNeeded() {
    if (this.isArena) return
    if (this.emptyRoomCleanupTimer) return

    // No need to schedule if there are humans (players or spectators) around.
    if (this.countSeatedHumansAndSpectators() > 0) return
    // No need to schedule if there are no bots either — RoomManager.leaveGame
    // tears down truly empty rooms separately.
    const hasBots = [...this.players.values()].some(p => p.isBot)
    if (!hasBots) return

    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: 'Last human left — clearing bots in 30s if nobody returns.' }
    })

    this.emptyRoomCleanupTimer = setTimeout(() => {
      this.emptyRoomCleanupTimer = null
      // Re-check: someone might have come back during the timer.
      if (this.countSeatedHumansAndSpectators() > 0) return
      // Yank every bot out of the room.
      for (const [id, p] of [...this.players.entries()]) {
        if (p.isBot) {
          p.destroy?.()
          this.removePlayer(id)
        }
      }
    }, 30_000)
  }

  // --- Arena 30s empty cleanup -------------------------------------------
  // Arenas have no human players (only bots + spectators). When the last
  // spectator leaves, give them 30s to come back; otherwise tear down.

  _cancelArenaEmptyTimer() {
    if (this.arenaEmptyTimer) {
      clearTimeout(this.arenaEmptyTimer)
      this.arenaEmptyTimer = null
    }
  }

  _scheduleArenaEmptyTimerIfNeeded() {
    if (!this.isArena) return
    if (this.arenaEmptyTimer) return
    if (this.spectators.size > 0) return

    this.arenaEmptyTimer = setTimeout(() => {
      this.arenaEmptyTimer = null
      if (this.spectators.size > 0) return
      // Pause the match (no one's watching) and ask RoomManager to destroy us.
      this.arenaRunning = false
      if (this.startHandTimeout) {
        clearTimeout(this.startHandTimeout)
        this.startHandTimeout = null
      }
      for (const [id, p] of [...this.players.entries()]) {
        if (p.isBot) {
          p.destroy?.()
          this.removePlayer(id)
        }
      }
      this._onArenaExpire?.(this)
    }, 30_000)
  }

  // Called by RoomManager._destroyRoom — clear timers so we don't tick after
  // being removed from the room map.
  shutdown() {
    this._cancelEmptyRoomCleanup()
    this._cancelArenaEmptyTimer()
    if (this.startHandTimeout) {
      clearTimeout(this.startHandTimeout)
      this.startHandTimeout = null
    }
  }

  getRoomData(forPlayerId = null) {
    const isSpectator = forPlayerId ? this.spectators.has(forPlayerId) : false

    return {
      roomId: this.roomId,
      isPrivate: this.isPrivate,
      inviteCode: this.inviteCode,
      isSpectator,
      isArena: this.isArena,
      arenaRunning: this.arenaRunning,
      arenaStartingChips: this.arenaStartingChips,
      players: this.getPlayerList(),
      spectators: this.getSpectatorList(),
      gameState: this.game.getGameState(isSpectator ? null : forPlayerId, { revealAllCards: isSpectator }),
      contestMode: this.contestModeSummary()
    }
  }

  broadcastGameState() {
    const previousPhase = this._lastBroadcastPhase
    const currentPhase = this.game.phase

    // PREFLOP transition = "a new hand just started" — tick each seated human's
    // session counter and apply per-turn loan interest + auto-pay.
    let anyTickHadLoans = false
    if (currentPhase === GAME_PHASES.PREFLOP && previousPhase !== GAME_PHASES.PREFLOP) {
      // Contest mode: escalate blinds every N hands.
      this._maybeEscalateContestBlinds()
      for (const p of this.players.values()) {
        if (p.isBot || typeof p.tickHandCounter !== 'function') continue
        const events = p.tickHandCounter()
        if (events.length > 0) anyTickHadLoans = true
        // Interest fires every hand for every loan — too spammy to broadcast
        // each one. Only surface noisy events: cleared loans + auto-pay receipts.
        for (const e of events) {
          if (e.kind === 'cleared') {
            this.broadcast({
              type: MESSAGE_TYPES.SYSTEM_MESSAGE,
              data: { message: `${p.username} cleared their ${e.bankName} loan.` }
            })
          } else if (e.kind === 'autopay' && e.amount > 0) {
            this.broadcast({
              type: MESSAGE_TYPES.SYSTEM_MESSAGE,
              data: { message: `${p.username} auto-paid $${e.amount.toLocaleString()} to ${e.bankName} (still owes $${e.owedAfter.toLocaleString()}).` }
            })
          }
        }
      }
    }

    for (const player of this.players.values()) {
      player.send({
        type: MESSAGE_TYPES.GAME_STATE,
        data: this.game.getGameState(player.id)
      })
    }
    for (const spectator of this.spectators.values()) {
      spectator.send({
        type: MESSAGE_TYPES.GAME_STATE,
        data: this.game.getGameState(null, { revealAllCards: true })
      })
    }

    this._lastBroadcastPhase = currentPhase
    if (currentPhase === GAME_PHASES.WAITING && previousPhase !== GAME_PHASES.WAITING) {
      this._cleanupBrokeBots()
    }
    // After per-turn loan tick, push an extra room_update so the bank panel
    // sees the new owed/principal/credit numbers without waiting on another
    // explicit action.
    if (anyTickHadLoans) this.broadcastRoomUpdate()
  }

  broadcastRoomUpdate() {
    for (const player of this.players.values()) {
      player.send({
        type: MESSAGE_TYPES.ROOM_UPDATE,
        data: this.getRoomData(player.id)
      })
    }
    for (const spectator of this.spectators.values()) {
      spectator.send({
        type: MESSAGE_TYPES.ROOM_UPDATE,
        data: this.getRoomData(spectator.id)
      })
    }
  }

  getPlayerList() {
    return [...this.players.values()].map(p => p.toJSON())
  }

  getSpectatorList() {
    return [...this.spectators.values()].map(p => p.toJSON())
  }

  getTableSummary() {
    const state = this.game.getGameState()
    const activePlayer = state.players.find(p => p.id === state.activePlayerId)

    return {
      roomId: this.roomId,
      isPrivate: this.isPrivate,
      isArena: this.isArena,
      arenaRunning: this.arenaRunning,
      phase: state.phase,
      pot: state.pot,
      currentBet: state.currentBet,
      playerCount: this.players.size,
      spectatorCount: this.spectators.size,
      maxPlayers: POKER_CONFIG.MAX_PLAYERS,
      activePlayer: activePlayer ? { id: activePlayer.id, username: activePlayer.username } : null,
      communityCards: state.communityCards,
      players: state.players.map(p => ({
        id: p.id,
        username: p.username,
        avatarId: p.avatarId || null,
        avatarUrl: p.avatarUrl || null,
        chips: p.chips,
        folded: p.folded,
        allIn: p.allIn,
        waitingNextHand: p.waitingNextHand,
        lastAction: p.lastAction
      }))
    }
  }

  isFull() {
    return this.players.size >= POKER_CONFIG.MAX_PLAYERS
  }

  isEmpty() {
    return this.players.size === 0 && this.spectators.size === 0
  }

  getTotalOccupants() {
    return this.players.size + this.spectators.size
  }
}

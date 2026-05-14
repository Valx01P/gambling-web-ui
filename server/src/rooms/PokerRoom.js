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
import { recordHandResult, updateNeuralState, updateSuperState, getBotById } from '../bots/botRepository.js'
import { applyReinforceUpdate } from '../bots/neuralPolicy.js'
import { applyHandResult as applySuperHandResult } from '../bots/super/transitions.js'
import {
  recordHumanHand,
  archiveAnonHand,
  markBotUnlocked,
  tierCrossedByHand,
  applyRivalryDeltas
} from '../users/playHistoryRepository.js'
import {
  performanceScore,
  eloDelta,
  isBluffWin,
  STARTING_RATING,
  RATING_FLOOR,
  computeRatingUpdatesForTable
} from '../bots/runtime/eloEngine.js'
import { preflopHandScore } from '../bots/runtime/equity.js'
import { sanitizeDisplayString } from '../utils/sanitize.js'
import { SideBetEngine } from '../sidebets/sideBetEngine.js'
import { scoreHandForPlayer } from '../dailies/dailyEngine.js'
import { PeerLoanEngine } from '../peerLoans/peerLoanEngine.js'
import { CryptoMarketEngine } from '../crypto/cryptoEngine.js'

// Default rating to assume for any seat that isn't a bot when calculating
// per-hand ELO updates. Aligned with the new STARTING_RATING so a bot
// playing humans isn't matched against a phantom 1200 elo.
const HUMAN_DEFAULT_RATING = STARTING_RATING

const TABLE_EMOTES = new Set(['angry', 'laugh', 'sad', 'shush', 'sunglasses', 'eggplant'])
const BIG_YAHU_EMOTES = new Set(['star_of_david', 'israel_flag'])
// Tables seat 5. With one human there's room for 4 bots before the table is
// full. Anything tighter just gates a feature for no reason.
const MAX_BOTS_PER_PLAYER = 4

// --- Helpers used by _recordHumanHandResults ------------------------------

// Coarse positional label from the seat order. Six-handed positions are an
// abstraction; with 2-5 seats we map down to btn / sb / bb / mp / utg-ish.
function positionLabel(room, playerId) {
  const players = room.game.players
  const idx = players.findIndex(p => p.id === playerId)
  if (idx === -1) return 'middle'
  const total = players.length
  const dealer = room.game.dealerIndex
  if (total === 2) return idx === dealer ? 'btn' : 'bb'
  const offset = (idx - dealer + total) % total
  if (offset === 0) return 'btn'
  if (offset === 1) return 'sb'
  if (offset === 2) return 'bb'
  if (offset === total - 1) return 'co'
  return 'mp'
}

// Compact picture of how aggressive the opponents were across the hand.
// We don't store per-opponent action history — the generator only needs an
// aggregate "did we face heat" signal.
function summarizeOpponentAggression(allActions, selfId) {
  let pfRaises = 0
  let postRaises = 0
  let maxBet = 0
  for (const a of allActions) {
    if (a.playerId === selfId) continue
    if (a.action === 'raise' || a.action === 'all_in') {
      if (a.phase === 'preflop') pfRaises += 1
      else postRaises += 1
      if (a.amount > maxBet) maxBet = a.amount
    }
  }
  return { pfR: pfRaises, plR: postRaises, mxB: maxBet }
}

// A reduced form of eloEngine.performanceScore — we don't have all the
// signals (no bot stats, no vpipRate yet), so we keep just the outcome +
// chip-magnitude + bluff axes. Used to seed the player-clone bot's ELO.
function computeHumanPerformanceScore({ won, chipsDelta, bigBlind, foldedPreflop, voluntarilyIn, wentToShowdown }) {
  let s
  if (foldedPreflop && !voluntarilyIn) s = 0.50
  else if (won) s = wentToShowdown ? 1.0 : 0.85
  else if (voluntarilyIn) s = 0.30
  else s = 0.45
  const bb = Math.max(1, bigBlind || 10)
  const norm = Math.max(-1, Math.min(1, (chipsDelta || 0) / (50 * bb)))
  s += 0.20 * norm
  return Math.max(0, Math.min(1, s))
}

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
    // Spectator-controlled think-delay for arena bots (ms). Default sits in
    // the middle of the legacy 1800-3800 jitter band; the slider in the
    // arena UI lets viewers drop it to 200ms for fast-forward viewing or
    // raise it to 2000ms for follow-along. Read by BotPlayer per turn.
    this.arenaThinkDelayMs = 1200
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
    // Bot Arenas are spectator-controlled and shouldn't auto-fold seats — the
    // callback no-ops for arenas so a paused arena doesn't penalize bots.
    const onTurnTimeout = this.isArena
      ? null
      : (typeof options.onTurnTimeout === 'function'
          ? (playerId) => options.onTurnTimeout(this, playerId)
          : null)

    this.game = new PokerGame(
      (msg) => {
        this.broadcast(msg)
        // Intercept hand resolutions to update each seated bot's ELO + DB
        // counters. Fired exactly once per hand (showdown OR fold-out both
        // emit a `showdown` broadcast).
        if (msg?.type === 'showdown') {
          // Side bets resolve here: card-runout props that haven't decided
          // yet (typically because a fold-out left the board short) refund
          // as VOID; action props (anyone_all_in, goes_to_showdown) finalize
          // to YES/NO. Real showdown carries hands; fold-out sends an empty
          // hands object — that's how we distinguish for the showdown flag.
          try {
            this.sideBetEngine?.onHandEnd({
              reachedShowdown: Object.keys(msg.data?.hands || {}).length > 0
            })
          } catch (err) {
            console.error('[sidebets] hand-end hook failed:', err.message)
          }
          this._recordBotHandResults(msg.data).catch(err =>
            console.error('[bot-elo] hand result update failed:', err.message)
          )
          // Mirror for signed-in humans — drives the player-clone bot
          // generator and the 12-hand achievement toast.
          this._recordHumanHandResults(msg.data).catch(err =>
            console.error('[user-play] hand result update failed:', err.message)
          )
          // Daily-challenge + achievement engines. Both share the same
          // per-hand event extractor (built from the latest handHistory
          // entry, not the broadcast payload — the broadcast omits the
          // action log we need for vpip / raisesThisHand / etc.).
          this._scoreDailiesAndAchievements()
        }
      },
      () => this.broadcastGameState(),
      onTurnTimeout
    )
    // Polymarket-style in-hand prop bets. Engine owns its own per-hand state
    // and mutates player.chips directly during buys, sells, and payouts —
    // same server-authoritative trust model as the main betting engine.
    this.sideBetEngine = new SideBetEngine({
      room: this,
      game: this.game,
      broadcast: (msg) => this.broadcast(msg)
    })
    // Peer loans between human players at this table. Engine handles
    // open/counter/accept/decline plus per-hand interest accrual via the
    // existing broadcastGameState tick, and on-leave settlement (lender
    // collects from borrower's chips, capped at what borrower has).
    this.peerLoanEngine = new PeerLoanEngine({ room: this })
    // Crypto market — independent of the hand cadence. Ticks on a wall
    // clock so charts move even while the table is idle. One market per
    // room, synced to every player + spectator. Bots can't trade.
    this.cryptoEngine = new CryptoMarketEngine({
      room: this,
      broadcast: (msg) => this.broadcast(msg)
    })
    this.cryptoEngine.start()
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
    // No mid-hand gate. PokerGame.addPlayer parks mid-hand additions in
    // waitingNextHand and they get dealt in on the next preflop. Users
    // don't have to time the click to a hand boundary.

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
    // Tell the table whether the bot is in the current hand or has to wait
    // for the next one. waitingNextHand is set by game.addPlayer when the
    // bot couldn't join mid-action.
    const queued = this.game.waitingNextHand?.has?.(seatId)
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: {
        message: queued
          ? `${adder.username} added bot ${bot.name}. Sitting in next hand.`
          : `${adder.username} added bot ${bot.name}.`
      }
    })
    botPlayer.emitPhrase('joined_table')
    this.broadcastRoomUpdate()
    this.scheduleStartHand()
    return { success: true, bot: botPlayer.toJSON(), queuedForNextHand: queued }
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

  // Daily challenge + achievement scoring. Reads the latest hand summary
  // out of the engine's handHistory (which has the action log we need —
  // the broadcast payload doesn't). Fires once per seated human and once
  // per spectator (so spectators' side-bet-based dailies still tick).
  _scoreDailiesAndAchievements() {
    const summary = this.game.handHistory[this.game.handHistory.length - 1]
    if (!summary) return
    // Side-bet outcomes per player live on the side-bet engine in its
    // positions map — but those clear at resolve time. The cleanest hook
    // is to read straight from the engine's most recent payouts queue;
    // for now, leave sideBetOutcomes empty and only count card-based
    // dailies. (Side-bet-specific dailies still unlock via the luckStats
    // path which writes the per-user counters.)
    const audience = [...this.players.values(), ...this.spectators.values()]
    for (const p of audience) {
      if (p.isBot) continue
      scoreHandForPlayer(p, summary, {}).catch(err =>
        console.warn('[dailies] score failed for', p.username, err.message)
      )
    }
  }

  async _recordBotHandResults(broadcastData) {
    const handSummary = this.game.handHistory[this.game.handHistory.length - 1]
    if (!handSummary) return
    const winnerIds = new Set((broadcastData?.winners || []).map(w => w.playerId))
    const allSeats = [...this.players.values()]
    // Rating pool participation: bots always carry their rating, signed-in
    // humans only contribute their real rating when they're playing as
    // themselves. Anonymous seats (signed-in or not) count as the
    // baseline so a hidden account doesn't leak its rating signal to
    // opponents' ELO math.
    const ratingFor = (p) => p.isBot
      ? (p.bot?.elo ?? STARTING_RATING)
      : (p.playingAsSelf && typeof p.elo === 'number' ? p.elo : STARTING_RATING)
    const bigBlind = this.game.bigBlind || 10

    // Build per-bot persistence work in memory first, then fan the DB writes out
    // in parallel. Previously this was an await-inside-for loop, so 4 bots at a
    // table = 4 sequential transactions even on a fast DB.
    const writes = []

    // PASS 1: gather per-bot outcomes for every seated bot. We need
    // every bot's outcome BEFORE we can call computeRatingUpdatesForTable,
    // because that helper normalizes the scores across the whole table
    // to keep ELO zero-sum (no closed-pool drift). The old code computed
    // each delta in isolation and the score's asymmetric bonuses caused
    // every bot to slowly inflate together.
    const botRows = []
    for (const seat of allSeats) {
      if (!seat.isBot || !seat.bot?.id) continue

      const won = winnerIds.has(seat.id)
      const chipsDelta = handSummary.profitsByPlayer?.[seat.id] ?? 0
      const seatActions = handSummary.actionsByPlayer?.[seat.id] ?? []
      const preflopActions = seatActions.filter(a => a.phase === GAME_PHASES.PREFLOP)
      const postflopActions = seatActions.filter(a => a.phase !== GAME_PHASES.PREFLOP)
      const foldedPreflop = preflopActions.some(a => a.action === 'fold')
      const voluntarilyIn = seatActions.some(a => a.action === 'call' || a.action === 'raise' || a.action === 'all_in')
      const postflopRaises = postflopActions.filter(a => a.action === 'raise' || a.action === 'all_in').length
      const wentToShowdown = handSummary.type === 'showdown' &&
        !this.game.foldedPlayers.has(seat.id) &&
        !this.game.removedPlayers.has(seat.id)

      const holeCards = (this.game.playerHands.get(seat.id) || []).map(c => ({ ...c }))
      const preflopScore = holeCards.length === 2
        ? preflopHandScore(holeCards[0], holeCards[1])
        : null
      const bluffWin = isBluffWin({ won, wentToShowdown, voluntarilyIn, postflopRaises, holeCards })

      const stats = seat.bot.stats || {}
      const liveHandsPlayed = (stats.handsPlayed || 0) + 1
      const liveHandsVoluntary = (stats.handsVoluntary || 0) + (voluntarilyIn ? 1 : 0)
      const liveBluffWins = (stats.bluffWins || 0) + (bluffWin ? 1 : 0)
      const liveFoldOutWins = liveBluffWins + ((stats.handsWon || 0) - (stats.showdownsWon || 0))
      const vpipRate = liveHandsPlayed > 0 ? liveHandsVoluntary / liveHandsPlayed : 0
      const bluffSuccessRate = liveFoldOutWins > 0 ? liveBluffWins / liveFoldOutWins : 0

      // Drain the per-action quality log captured during this hand.
      // Every bot type (rule / clone / neural / super) populates this,
      // so the skill-based score works uniformly.
      const actionQualities = typeof seat.drainActionQualityLog === 'function'
        ? seat.drainActionQualityLog()
        : []

      botRows.push({
        seat,
        won, chipsDelta, foldedPreflop, voluntarilyIn, wentToShowdown,
        postflopRaises, bluffWin, preflopScore,
        liveHandsPlayed, liveHandsVoluntary, liveBluffWins,
        outcome: {
          actionQualities,
          won, chipsDelta, bigBlind, foldedPreflop, voluntarilyIn,
          wentToShowdown, bluffWin
        }
      })
    }

    if (botRows.length === 0) return

    // PASS 2: batch ELO update. Pool consists of every bot AT the table
    // (humans are excluded since their ratings live in a separate table
    // and aren't bot-vs-bot competitive). For mixed tables this means
    // bot-vs-bot ELO redistributes among the bots; the small bias from
    // not seeing humans' ratings here is the same bias the old code had.
    const ratingUpdates = computeRatingUpdatesForTable(botRows.map(r => ({
      rating: r.seat.bot.elo ?? HUMAN_DEFAULT_RATING,
      handsPlayed: r.liveHandsPlayed,
      outcome: r.outcome
    })))

    for (let i = 0; i < botRows.length; i++) {
      const r = botRows[i]
      const update = ratingUpdates[i]
      const seat = r.seat
      const change = update.delta
      const score = update.normalizedScore

      // Update in-memory rating + stats immediately so subsequent hands
      // at this same table compute against the bot's new strength.
      if (typeof seat.bot.elo === 'number') {
        seat.bot.elo = update.nextRating
      } else {
        seat.bot.elo = update.nextRating
      }
      seat.bot.stats = {
        ...(seat.bot.stats || {}),
        handsPlayed: r.liveHandsPlayed,
        handsVoluntary: r.liveHandsVoluntary,
        handsWon: ((seat.bot.stats || {}).handsWon || 0) + (r.won ? 1 : 0),
        showdownsPlayed: ((seat.bot.stats || {}).showdownsPlayed || 0) + (r.wentToShowdown ? 1 : 0),
        showdownsWon: ((seat.bot.stats || {}).showdownsWon || 0) + (r.wentToShowdown && r.won ? 1 : 0),
        bluffWins: r.liveBluffWins
      }
      // Mirror onto BotPlayer's seat-facing fields so the next
      // broadcastGameState carries fresh values to the click-the-seat
      // popover. Without this the popover would stay frozen at the
      // sit-down snapshot.
      seat.botElo = seat.bot.elo
      seat.botHandsPlayed = seat.bot.stats.handsPlayed
      seat.botHandsWon = seat.bot.stats.handsWon
      seat.botShowdownsPlayed = seat.bot.stats.showdownsPlayed
      seat.botShowdownsWon = seat.bot.stats.showdownsWon

      writes.push(
        recordHandResult({
          botId: seat.bot.id,
          tableId: this.roomId,
          chipsDelta: r.chipsDelta,
          wentToShowdown: r.wentToShowdown,
          won: r.won,
          foldedPreflop: r.foldedPreflop,
          voluntarilyIn: r.voluntarilyIn,
          eloChange: change,
          bluffWin: r.bluffWin,
          preflopScore: r.preflopScore,
          performanceScore: score
        }).catch(err => {
          console.error(`[bot-elo] persist failed for ${seat.bot.name}:`, err.message)
        })
      )

      // Neural-net training step. Reward is chipsDelta scaled by the bot's
      // starting stack for this hand — wins and losses are bounded to
      // [-1, +1] inside the policy update so a cooler doesn't dominate.
      // Trajectory comes from BotPlayer.drainNeuralTrajectory(); persisting
      // the new state is fire-and-forget on the same parallel-writes batch
      // as the ELO persist, so neural updates don't add wall-clock to the
      // hand transition.
      if (seat.isNeural && seat.neuralState && typeof seat.drainNeuralTrajectory === 'function') {
        const trajectory = seat.drainNeuralTrajectory()
        if (trajectory && trajectory.length > 0) {
          const baseline = Math.max(1, seat.handStartChips || seat.pokerBuyIn || 1)
          const rawReward = r.chipsDelta / baseline
          applyReinforceUpdate(seat.neuralState, trajectory, rawReward)
          writes.push(
            updateNeuralState({
              botId: seat.bot.id,
              ownerUserId: seat.bot.ownerUserId,
              state: seat.neuralState
            }).catch(err => {
              console.error(`[neural] persist failed for ${seat.bot.name}:`, err.message)
            })
          )
        }
      }

      // Super bots: bandit / markov state update. Mirrors the neural
      // path. `participation` is the ordered list of member ids that
      // acted this hand; applySuperHandResult bumps each member's stats
      // + the transition matrix where appropriate.
      if (seat.isSuper && seat.superState && typeof seat.drainSuperTrajectory === 'function') {
        const participation = seat.drainSuperTrajectory()
        if (participation && participation.length > 0) {
          const baseline = Math.max(1, seat.handStartChips || seat.pokerBuyIn || 1)
          const rawReward = r.chipsDelta / baseline
          applySuperHandResult(seat.superState, participation, rawReward)
          writes.push(
            updateSuperState({
              botId: seat.bot.id,
              ownerUserId: seat.bot.ownerUserId,
              state: seat.superState
            }).catch(err => {
              console.error(`[super] persist failed for ${seat.bot.name}:`, err.message)
            })
          )
        }
      }
    }

    if (writes.length > 0) await Promise.all(writes)
  }

  // Same idea as _recordBotHandResults but for signed-in humans. Captures a
  // compressed hand record + bumps user_play_stats so the player-clone bot
  // generator has data to learn from. Crossing the BOT_UNLOCK_THRESHOLD
  // emits a one-shot ACHIEVEMENT message to that user's WS.
  async _recordHumanHandResults(broadcastData) {
    const handSummary = this.game.handHistory[this.game.handHistory.length - 1]
    if (!handSummary) return
    const winnerIds = new Set((broadcastData?.winners || []).map(w => w.playerId))
    const bigBlind = this.game.bigBlind || 10
    const allSeats = [...this.players.values()]
    // Mirrors _recordBotHandResults: anonymous opponents count as the
    // baseline so a hidden account never influences your ELO math.
    const ratingFor = (p) => p.isBot
      ? (p.bot?.elo ?? STARTING_RATING)
      : (p.playingAsSelf && typeof p.elo === 'number' ? p.elo : STARTING_RATING)

    for (const seat of this.players.values()) {
      // Bots have their own recording path; only signed-in humans who
      // explicitly opted into "Play as YOU" get recorded. Joining
      // anonymously keeps a seat off the record entirely — no ELO, no
      // archive, no rivalries — even if the WS itself is authenticated.
      if (seat.isBot) continue
      // Signed-out players are skipped — nothing stable to key on. Anon
      // signed-in players (`!seat.playingAsSelf`) still get processed
      // below: they share the action-analysis + compressed-hand build
      // with public plays, but branch into archiveAnonHand for storage
      // (no ELO update, no rivalry attribution, is_anonymous = TRUE so
      // non-self viewers can't see the row).
      if (!seat.userId) continue
      const isAnonPlay = !seat.playingAsSelf

      const seatActions = handSummary.actionsByPlayer?.[seat.id] ?? []
      const preflopActions = seatActions.filter(a => a.phase === GAME_PHASES.PREFLOP)
      const postflopActions = seatActions.filter(a => a.phase !== GAME_PHASES.PREFLOP)
      const foldedPreflop = preflopActions.some(a => a.action === 'fold')
      const voluntarilyIn = seatActions.some(a => a.action === 'call' || a.action === 'raise' || a.action === 'all_in')
      const won = winnerIds.has(seat.id)
      const wentToShowdown = handSummary.type === 'showdown' &&
        !this.game.foldedPlayers.has(seat.id) &&
        !this.game.removedPlayers.has(seat.id)
      const chipsDelta = handSummary.profitsByPlayer?.[seat.id] ?? 0

      // --- Action-derived counters ----------------------------------------
      const preflopRaises = preflopActions.filter(a => a.action === 'raise' || a.action === 'all_in')
      const isOpen = preflopRaises.length > 0 && (handSummary.actions || [])
        .filter(a => a.phase === GAME_PHASES.PREFLOP && (a.action === 'raise' || a.action === 'all_in'))
        .findIndex(a => a.playerId === seat.id) === 0
      const isThreeBet = preflopRaises.length > 0 && !isOpen
      const preflopCalls = preflopActions.filter(a => a.action === 'call').length
      const postflopRaises = postflopActions.filter(a => a.action === 'raise' || a.action === 'all_in').length
      const postflopBetsCount = postflopActions.filter(a => a.action === 'raise' || a.action === 'all_in').length
      const postflopCallsCount = postflopActions.filter(a => a.action === 'call').length

      // c-bet detection: was the preflop aggressor and bet/raised on the flop.
      const myFirstFlopAction = postflopActions.find(a => a.phase === GAME_PHASES.FLOP)
      const wasPreflopAggressor = preflopRaises.length > 0
      const cBetAttempted = wasPreflopAggressor &&
        (myFirstFlopAction?.action === 'raise' || myFirstFlopAction?.action === 'all_in')
      const cBetWon = cBetAttempted && won

      // Average open size in big blinds — used so the generated bot's open
      // size matches the user's tendency.
      const firstOpen = preflopRaises[0]
      const openSizeBB = firstOpen ? Math.max(2, firstOpen.amount / bigBlind) : 0

      // --- Hand snapshot (compressed) -------------------------------------
      // We deliberately strip suit information for non-showdown opponents
      // and don't store anyone else's hole cards. The user's own cards are
      // included so the generator has hand-strength context.
      const compressed = {
        v: 1,
        bb: bigBlind,
        pos: positionLabel(this, seat.id),
        pot: handSummary.pot,
        d: chipsDelta,
        w: won ? 1 : 0,
        sd: wentToShowdown ? 1 : 0,
        vp: voluntarilyIn ? 1 : 0,
        o: this.game.players.length - 1,
        hc: (this.game.playerHands.get(seat.id) || []).map(c => `${c.rank}${c.suit?.[0] || ''}`),
        bd: (handSummary.communityCards || []).map(c => `${c.rank}${c.suit?.[0] || ''}`),
        a: seatActions.map(a => [a.phase[0], a.action[0], a.amount || 0]),
        oa: summarizeOpponentAggression(handSummary.actions || [], seat.id)
      }

      // Anonymous play — archive the hand tagged is_anonymous = TRUE
      // (visible to the user only), bump the daily anon counter, and
      // skip everything that touches public stats (ELO, user_play_stats,
      // rivalries, achievement-tier checks). Fire-and-forget: a flaky
      // archive write shouldn't stall the rest of the per-seat loop.
      if (isAnonPlay) {
        archiveAnonHand({
          userId: seat.userId,
          tableId: this.roomId,
          compressed,
          chipsDelta,
          elo: seat.elo ?? STARTING_RATING,
          outcome: { won, wentToShowdown, voluntarilyIn, foldedPreflop }
        }).catch(err =>
          console.warn('[anon-archive] persist failed:', err.message)
        )
        continue
      }

      // --- Performance score for ELO seeding ------------------------------
      // Ratings get derived from rolling avg of this number — same engine
      // the bot-rating system uses. Imported lazily inside the function so
      // the file doesn't pull eloEngine at module top.
      const perfScore = computeHumanPerformanceScore({
        won,
        chipsDelta,
        bigBlind,
        foldedPreflop,
        voluntarilyIn,
        wentToShowdown
      })

      // ELO update — same engine the bots use. Humans now play rated by
      // default; rating delta + new rating get persisted by the v2 stored
      // procedure in one round trip below.
      const opponentRatings = allSeats
        .filter(s => s.id !== seat.id)
        .map(ratingFor)
      const currentElo = seat.elo ?? STARTING_RATING
      const eloChangeDelta = eloDelta({
        rating: currentElo,
        opponentRatings,
        score: perfScore,
        handsPlayed: seat.userHandsPlayed ?? 0
      })

      try {
        const stats = await recordHumanHand({
          userId: seat.userId,
          tableId: this.roomId,
          delta: {
            handsVoluntary: voluntarilyIn ? 1 : 0,
            handsWon: won ? 1 : 0,
            showdownsSeen: wentToShowdown ? 1 : 0,
            showdownsWon: (wentToShowdown && won) ? 1 : 0,
            bluffWins: (won && !wentToShowdown && voluntarilyIn && postflopRaises >= 1) ? 1 : 0,
            preflopOpens: isOpen ? 1 : 0,
            preflopThreeBets: isThreeBet ? 1 : 0,
            preflopCalls: preflopCalls > 0 ? 1 : 0,
            postflopBets: postflopBetsCount > 0 ? 1 : 0,
            postflopRaises,
            postflopCalls: postflopCallsCount,
            cBetsAttempted: cBetAttempted ? 1 : 0,
            cBetsWon: cBetWon ? 1 : 0,
            chipsDelta,
            bigBlindsPlayed: bigBlind > 0 ? Math.round(handSummary.pot / bigBlind) : 0,
            openSizeBB,
            performanceScore: perfScore
          },
          compressed,
          eloDelta: eloChangeDelta,
          outcome: { won, wentToShowdown, voluntarilyIn, foldedPreflop }
        })

        // Push the new rating + bumped hand count into the in-memory seat
        // so subsequent hands at this table read the updated values
        // (no DB re-fetch). v2 SP already floored at 300 — trust whatever
        // it returned.
        if (stats?.newElo !== undefined) {
          seat.elo = stats.newElo
        }
        seat.userHandsPlayed = (seat.userHandsPlayed ?? 0) + 1

        // Rivalry update — attribute this user's chip flow to each opponent
        // proportionally to their gain (when we lost) or loss (when we won).
        // Bots and humans both count; opponent_kind splits them so the same
        // user has separate rows for the same id reused across kinds.
        const rivalryEntries = []
        if (chipsDelta !== 0) {
          // Opponents at the table this hand. Don't count seats that
          // weren't dealt in (e.g. waitingNextHand).
          const others = allSeats.filter(s => s.id !== seat.id)
          // Total chips moved by opponents in the *opposite* direction of
          // our flow. When we lost, sum of opponent gains; when we won,
          // sum of opponent losses. Used as the denominator for prorating.
          const opponentFlows = others.map(o => ({
            seat: o,
            delta: handSummary.profitsByPlayer?.[o.id] ?? 0
          }))
          const oppositeSign = chipsDelta < 0 ? 1 : -1
          const denom = opponentFlows.reduce((acc, x) =>
            acc + (Math.sign(x.delta) === oppositeSign ? Math.abs(x.delta) : 0), 0)
          const myMagnitude = Math.abs(chipsDelta)
          for (const { seat: opp, delta: oppDelta } of opponentFlows) {
            // Identity key: bots key off bot.id, humans off userId. Skip
            // anonymous human seats — we have nothing stable to key on.
            let kind, id, name
            if (opp.isBot) {
              kind = 'bot'; id = String(opp.bot?.id || opp.id); name = opp.username || 'Bot'
            } else if (opp.userId && opp.playingAsSelf) {
              // Anonymous-but-signed-in seats are intentionally excluded —
              // their userId is private to that seat and shouldn't end
              // up keyed in someone else's rivalry list.
              kind = 'user'; id = String(opp.userId); name = opp.username || 'Player'
            } else {
              continue
            }
            // Allocate this user's loss/win against opponents flowing in
            // the opposite direction. Opponents who moved the same way as
            // us this hand still get hands_vs++ but no chip attribution.
            let chipsNet = 0
            let didLose = false
            let didBeat = false
            if (denom > 0 && Math.sign(oppDelta) === oppositeSign) {
              const share = Math.abs(oppDelta) / denom
              const allocated = Math.round(myMagnitude * share)
              chipsNet = chipsDelta < 0 ? -allocated : +allocated
              if (chipsDelta < 0) didLose = true
              else didBeat = true
            }
            rivalryEntries.push({ kind, id, name, chipsNet, didLoseToThem: didLose, didBeatThem: didBeat })
          }
        } else {
          // Even on chip-neutral hands, bump hands_vs so we know we faced
          // each opponent. allocate zero chips.
          for (const opp of allSeats) {
            if (opp.id === seat.id) continue
            let kind, id, name
            if (opp.isBot) {
              kind = 'bot'; id = String(opp.bot?.id || opp.id); name = opp.username || 'Bot'
            } else if (opp.userId && opp.playingAsSelf) {
              // Anonymous-but-signed-in seats are intentionally excluded —
              // their userId is private to that seat and shouldn't end
              // up keyed in someone else's rivalry list.
              kind = 'user'; id = String(opp.userId); name = opp.username || 'Player'
            } else {
              continue
            }
            rivalryEntries.push({ kind, id, name, chipsNet: 0, didLoseToThem: false, didBeatThem: false })
          }
        }
        if (rivalryEntries.length > 0) {
          applyRivalryDeltas(seat.userId, rivalryEntries).catch(err =>
            console.warn('[rivalries] update failed:', err.message)
          )
        }

        // Tier crossover detection — fires exactly when *this hand* pushed
        // the user from below the tier's hand-count threshold to at-or-above.
        // The 5 tiers (12 / 25 / 50 / 75 / 100) each get their own one-shot
        // toast. The first time also stamps `bot_unlocked_at` so legacy
        // checks still work.
        if (stats) {
          const previousHandsSeated = stats.handsSeated - 1
          const tierJustCrossed = tierCrossedByHand(previousHandsSeated, stats.handsSeated)
          if (tierJustCrossed && typeof seat.send === 'function') {
            // First crossover ever: stamp the unlock timestamp.
            if (tierJustCrossed === 1 && !stats.botUnlockedAt) {
              await markBotUnlocked(seat.userId)
            }
            const handsAtThisTier = [12, 25, 50, 75, 100][tierJustCrossed - 1]
            const firstName = (seat.username || 'Your').split(/\s+/)[0]
            seat.send({
              type: MESSAGE_TYPES.ACHIEVEMENT,
              data: {
                key: `player_clone_tier_${tierJustCrossed}`,
                tier: tierJustCrossed,
                title: `${firstName} v${tierJustCrossed} unlocked`,
                body: `${handsAtThisTier} hands of your play data is enough to build a more accurate version of your clone bot. Build it now or play more for the next tier.`,
                cta: `Build v${tierJustCrossed}`,
                ctaHref: `/poker/bots?build=tier${tierJustCrossed}`
              }
            })
          }
        }
      } catch (err) {
        console.error(`[user-play] persist failed for ${seat.username}:`, err.message)
      }
    }
  }

  _cleanupBrokeBots() {
    if (this._cleanupGuard) return
    this._cleanupGuard = true
    try {
      for (const p of [...this.players.values()]) {
        if (!(p.isBot && p.chips === 0)) continue
        // Arena: rebuy back to the arena's configured starting stack so
        // bot battles run indefinitely without spectators having to
        // re-seat bots every time one busts. Mirrors the human rebuy
        // path in PokerGame.rebuyIfNeeded — bumps pokerBuyIn so ROI math
        // stays correct. Regular tables keep the old behavior (busted
        // bot leaves; owner can re-add if they want).
        if (this.isArena) {
          const rebuyAmount = this.arenaStartingChips || POKER_CONFIG.STARTING_CHIPS
          p.chips = rebuyAmount
          p.pokerBuyIn = (p.pokerBuyIn || 0) + rebuyAmount
          this.broadcast({
            type: MESSAGE_TYPES.SYSTEM_MESSAGE,
            data: { message: `${p.username} busted and auto-rebought for ${rebuyAmount} chips.` }
          })
          continue
        }
        this.broadcast({
          type: MESSAGE_TYPES.SYSTEM_MESSAGE,
          data: { message: `${p.username} is out of chips and left the table.` }
        })
        p.emitPhrase('lose')
        p.destroy()
        this.removePlayer(p.id)
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
      // Settle peer loans BEFORE deleting the seat. Engine needs the
      // leaver still in this.players to read their chips for transfer.
      try { this.peerLoanEngine?.handlePlayerLeave(playerId) }
      catch (err) { console.error('[peer-loan] leave settle failed:', err.message) }
      // Liquidate crypto holdings at market — same constraint, engine
      // reads chips from the seated player object.
      try { this.cryptoEngine?.handlePlayerLeave(playerId) }
      catch (err) { console.error('[crypto] leave settle failed:', err.message) }
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
      // Spectators can hold crypto too — same settlement on leave.
      try { this.cryptoEngine?.handlePlayerLeave(playerId) }
      catch (err) { console.error('[crypto] spectator leave settle failed:', err.message) }
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

    const message = sanitizeDisplayString(data?.message || '', { maxLength: 80 })
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
      // Snapshot each neural bot's starting chips for this hand BEFORE the
      // engine deals — reward at hand-end is computed against this baseline
      // so antes/blinds are part of the reward signal, not deducted from
      // the "starting stack."
      for (const p of this.players.values()) {
        if (p?.isBot && (p.isNeural || p.isSuper) && typeof p.onHandStart === 'function') {
          p.onHandStart(p.chips)
        }
      }
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

  // Adjust the think-delay used by every bot at this arena. Clamped to
  // [200, 4000] ms — below 200 the table is too fast for spectators to
  // follow active-seat / last-action UI; above 4000 the arena feels stalled.
  // No system message: the slider is high-frequency input, the chat would
  // get spammy. Room state still broadcasts so all viewers see the new value.
  setArenaThinkDelay(playerId, ms) {
    if (!this.isArena) return { success: false, error: 'Not an arena' }
    if (!this.spectators.has(playerId) && !this.players.has(playerId)) {
      return { success: false, error: 'Only people at the arena can change settings' }
    }
    const n = Math.max(200, Math.min(4000, Math.floor(Number(ms) || 0)))
    const changed = n !== this.arenaThinkDelayMs
    this.arenaThinkDelayMs = n
    // Apply the new pace to bots already mid-think. Without this, dropping
    // the slider from 4000ms → 200ms still waits the old 4s before the
    // current bot acts — the slider feels broken at long delays.
    if (changed) {
      for (const player of this.players.values()) {
        if (player?.isBot && typeof player.rescheduleArenaThinkDelay === 'function') {
          player.rescheduleArenaThinkDelay()
        }
      }
    }
    this.broadcastRoomUpdate()
    return { success: true, delayMs: n }
  }

  // Auto-fill — seat the top N bots (one per ELO tier) into every empty
  // seat. Works at both arenas (caller is a spectator) AND regular tables
  // (caller is a seated player). Batched: every bot is created + seated
  // in one pass and we broadcast ONCE at the end. Skips bots already at
  // the table (by botId) so re-running the command tops up empty seats
  // instead of adding duplicates.
  async autoFillWithTopBots(callerId, bots) {
    // Caller eligibility:
    //   • Arena → must be a spectator (mirrors addBotForArenaSpectator).
    //   • Regular table → must be a seated player (mirrors addBotForPlayer
    //     — at regular tables only the human at the seat decides who else
    //     comes to the table, not random spectators in the gallery).
    const isSeated = this.players.has(callerId)
    const isSpectator = this.spectators.has(callerId)
    const caller = this.players.get(callerId) || this.spectators.get(callerId)
    if (!caller) return { success: false, error: 'You must be at the table to auto-fill.' }
    if (caller.isBot) return { success: false, error: 'Bots can\'t add bots.' }
    if (!this.isArena && !isSeated) {
      return { success: false, error: 'Only seated players can add bots at a regular table.' }
    }
    if (this.isArena && !isSpectator) {
      // Arenas have no humans seated, so a seated "caller" would mean a
      // bot — already handled above — or some state we don't expect.
      return { success: false, error: 'Arena auto-fill is for spectators.' }
    }

    if (!Array.isArray(bots) || bots.length === 0) {
      return { success: false, error: 'No bots available.' }
    }

    // Super bots in the list came from a list query that didn't hydrate
    // their members. Hydrate them in parallel before seating — without
    // members the BotPlayer dispatcher has nothing to delegate to and
    // the super bot would just fold/check forever.
    const needsHydration = bots.filter(b => b?.isSuper && !b.members)
    if (needsHydration.length > 0) {
      const hydrated = await Promise.all(needsHydration.map(b =>
        getBotById(b.id, { viewerUserId: null }).catch(() => null)
      ))
      const byId = new Map(hydrated.filter(Boolean).map(b => [b.id, b]))
      bots = bots.map(b => (b?.isSuper && byId.has(b.id)) ? byId.get(b.id) : b)
    }

    const seatedBotIds = new Set(
      [...this.players.values()].filter(p => p.isBot).map(p => p.botId).filter(Boolean)
    )
    const slotsLeft = POKER_CONFIG.MAX_PLAYERS - this.players.size
    if (slotsLeft <= 0) {
      return { success: false, error: this.isArena ? 'Arena is full.' : 'Table is full.' }
    }

    // Starting chips mirror the existing single-bot-add paths:
    //   Arena → fixed `arenaStartingChips`.
    //   Regular table → bot inherits the adder's stack with a STARTING_CHIPS
    //                   floor (same rule as addBotForPlayer).
    const startingChips = this.isArena
      ? this.arenaStartingChips
      : Math.max(POKER_CONFIG.STARTING_CHIPS, caller.chips || POKER_CONFIG.STARTING_CHIPS)

    const added = []
    for (const bot of bots) {
      if (added.length >= slotsLeft) break
      if (!bot || !bot.id) continue
      if (seatedBotIds.has(bot.id)) continue
      const seatId = `bot-${randomUUID()}`
      const botPlayer = new BotPlayer({
        id: seatId,
        bot,
        addedByPlayerId: callerId,
        room: this,
        ownerDisplayName: bot.ownerDisplayName,
        startingChips
      })
      const seated = this.game.addPlayer(botPlayer)
      if (!seated) { botPlayer.destroy(); continue }
      this.players.set(seatId, botPlayer)
      seatedBotIds.add(bot.id)
      added.push(botPlayer.toJSON())
      // Per-bot phrase still fires; it goes through the bot's own emit
      // path, not a broadcast, so it doesn't cost a room-wide round-trip.
      botPlayer.emitPhrase('joined_table')
    }

    if (added.length === 0) {
      return { success: false, error: 'No bots could be seated (all already at the table?).' }
    }

    // Single summary message + single broadcast — avoids the N×broadcast
    // cost of calling addBotFor* in a loop.
    const venue = this.isArena ? 'arena' : 'table'
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `${caller.username} auto-filled the ${venue} with ${added.length} top-rated bot${added.length === 1 ? '' : 's'}.` }
    })
    this.broadcastRoomUpdate()
    // Arenas need an explicit start-hand kick when running; regular
    // tables auto-start any time the seat count crosses MIN_PLAYERS via
    // the existing scheduleStartHand inside addPlayer / addBotForPlayer.
    // Either way, calling it again is idempotent (it bails out if already
    // pending or not eligible).
    this.scheduleStartHand()
    return { success: true, added }
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
    try { this.cryptoEngine?.stop() }
    catch (err) { console.error('[crypto] shutdown failed:', err.message) }
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
      arenaThinkDelayMs: this.arenaThinkDelayMs,
      players: this.getPlayerList(),
      spectators: this.getSpectatorList(),
      gameState: this.game.getGameState(isSpectator ? null : forPlayerId, { revealAllCards: isSpectator }),
      contestMode: this.contestModeSummary(),
      sideBets: this.sideBetEngine?.getStatePayload() || null,
      crypto: this.cryptoEngine?.getStatePayload(forPlayerId) || null
    }
  }

  // ─── Crypto passthroughs (called by MessageHandler) ────────────────────

  cryptoBuy(playerId, { coinId, amount }) {
    if (!this.cryptoEngine) return { success: false, error: 'unavailable' }
    if (!this.players.has(playerId) && !this.spectators.has(playerId)) {
      return { success: false, error: 'not_at_table' }
    }
    return this.cryptoEngine.buy(playerId, coinId, amount)
  }

  cryptoSell(playerId, { coinId, shares }) {
    if (!this.cryptoEngine) return { success: false, error: 'unavailable' }
    if (!this.players.has(playerId) && !this.spectators.has(playerId)) {
      return { success: false, error: 'not_at_table' }
    }
    return this.cryptoEngine.sell(playerId, coinId, shares)
  }

  cryptoCreate(playerId, opts) {
    if (!this.cryptoEngine) return { success: false, error: 'unavailable' }
    if (!this.players.has(playerId) && !this.spectators.has(playerId)) {
      return { success: false, error: 'not_at_table' }
    }
    return this.cryptoEngine.createCoin(playerId, opts || {})
  }

  cryptoRug(playerId) {
    if (!this.cryptoEngine) return { success: false, error: 'unavailable' }
    if (!this.players.has(playerId) && !this.spectators.has(playerId)) {
      return { success: false, error: 'not_at_table' }
    }
    return this.cryptoEngine.rugPull(playerId)
  }

  broadcastGameState() {
    const previousPhase = this._lastBroadcastPhase
    const currentPhase = this.game.phase

    // PREFLOP transition = "a new hand just started" — tick each human's
    // session counter and apply per-turn loan interest + auto-pay.
    let anyTickHadLoans = false
    if (currentPhase === GAME_PHASES.PREFLOP && previousPhase !== GAME_PHASES.PREFLOP) {
      // Contest mode: escalate blinds every N hands.
      this._maybeEscalateContestBlinds()
      // Iterate seated AND spectator humans. Spectators can hold loans
      // too (Bank panel works for them, side bets ride on the same chip
      // pool), so their balances need to accrue interest on the same
      // per-hand cadence as seated players. Previously this loop only
      // covered seated players, which is why a spectator's loan never
      // appeared to grow.
      const audience = [...this.players.values(), ...this.spectators.values()]
      for (const p of audience) {
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
      // Peer-loan interest accrues on the same per-hand cadence as bank
      // loans. Engine internally caps growth at 3× principal so an
      // un-repaid loan can't spiral indefinitely.
      try { this.peerLoanEngine?.tickInterest() }
      catch (err) { console.error('[peer-loan] accrual failed:', err.message) }
    }

    // Build all broadcast views once. Pre-stringify the spectator view (and,
    // during shared-reveal phases, the unified player view) so we don't pay
    // a JSON.stringify per recipient. Bots receive the object directly since
    // their `send()` introspects message.data instead of parsing JSON.
    const views = this.game.buildBroadcastViews()
    const spectatorMsg = { type: MESSAGE_TYPES.GAME_STATE, data: views.spectatorView }
    const spectatorJson = JSON.stringify(spectatorMsg)

    let sharedPlayerJson = null
    if (views.sharedPlayerView) {
      sharedPlayerJson = views.sharedPlayerView === views.spectatorView
        ? spectatorJson
        : JSON.stringify({ type: MESSAGE_TYPES.GAME_STATE, data: views.sharedPlayerView })
    }

    for (const player of this.players.values()) {
      if (player.isBot) {
        // Bots run logic on the data object — give them the per-seat view.
        const data = views.sharedPlayerView || views.perPlayerView(player.id)
        player.send({ type: MESSAGE_TYPES.GAME_STATE, data })
        continue
      }
      if (sharedPlayerJson && typeof player.sendRaw === 'function') {
        player.sendRaw(sharedPlayerJson)
        continue
      }
      const data = views.perPlayerView(player.id)
      if (typeof player.sendRaw === 'function') {
        player.sendRaw(JSON.stringify({ type: MESSAGE_TYPES.GAME_STATE, data }))
      } else {
        player.send({ type: MESSAGE_TYPES.GAME_STATE, data })
      }
    }

    for (const spectator of this.spectators.values()) {
      if (typeof spectator.sendRaw === 'function') spectator.sendRaw(spectatorJson)
      else spectator.send(spectatorMsg)
    }

    this._lastBroadcastPhase = currentPhase
    if (currentPhase === GAME_PHASES.WAITING && previousPhase !== GAME_PHASES.WAITING) {
      this._cleanupBrokeBots()
    }
    // Side-bet engine ticks once per broadcast — it detects new hands via
    // game.handIndex internally, so this single call covers handStart, every
    // action, and every phase advance. Resolution at hand-end is driven by
    // the onBroadcast('showdown') intercept above, not from here.
    try {
      this.sideBetEngine?.onStateChange()
    } catch (err) {
      console.error('[sidebets] state-change hook failed:', err.message)
    }
    // After per-turn loan tick, push an extra room_update so the bank panel
    // sees the new owed/principal/credit numbers without waiting on another
    // explicit action.
    if (anyTickHadLoans) this.broadcastRoomUpdate()
  }

  // ─── Side-bets passthroughs (called by MessageHandler) ─────────────────

  placeSideBet(playerId, { propId, side, amount }) {
    // Spectators bet too — they can't act on the hand but they can watch
    // the runout and gamble on board outcomes. Same chip bankroll system
    // as seated players; same engine (sideBetEngine resolves on their
    // userId for luck stats whether they're seated or spectating).
    if (!this.players.has(playerId) && !this.spectators.has(playerId)) {
      return { success: false, error: 'You must be at the table to place side bets.' }
    }
    if (typeof propId !== 'string' || !propId) return { success: false, error: 'Missing propId.' }
    const stake = Math.floor(Number(amount) || 0)
    if (!Number.isFinite(stake) || stake <= 0) return { success: false, error: 'Invalid amount.' }
    return this.sideBetEngine.placeBet(playerId, propId, side, stake)
  }

  sellSidePosition(playerId, { propId, shares }) {
    if (!this.players.has(playerId) && !this.spectators.has(playerId)) {
      return { success: false, error: 'You must be at the table to manage side bets.' }
    }
    if (typeof propId !== 'string' || !propId) return { success: false, error: 'Missing propId.' }
    return this.sideBetEngine.sellPosition(playerId, propId, shares)
  }

  broadcastRoomUpdate() {
    // Same idea as broadcastGameState — build the heavy per-recipient pieces
    // (gameState) once via buildBroadcastViews and reuse the shared roomData
    // shell across viewers.
    const views = this.game.buildBroadcastViews()
    const playerList = this.getPlayerList()
    const spectatorList = this.getSpectatorList()
    const contestMode = this.contestModeSummary()
    const shell = {
      roomId: this.roomId,
      isPrivate: this.isPrivate,
      inviteCode: this.inviteCode,
      isArena: this.isArena,
      arenaRunning: this.arenaRunning,
      arenaStartingChips: this.arenaStartingChips,
      arenaThinkDelayMs: this.arenaThinkDelayMs,
      players: playerList,
      spectators: spectatorList,
      contestMode
    }

    const spectatorData = { ...shell, isSpectator: true, gameState: views.spectatorView }
    const spectatorMsg = { type: MESSAGE_TYPES.ROOM_UPDATE, data: spectatorData }
    const spectatorJson = JSON.stringify(spectatorMsg)

    let sharedPlayerJson = null
    if (views.sharedPlayerView) {
      const sharedData = { ...shell, isSpectator: false, gameState: views.sharedPlayerView }
      sharedPlayerJson = views.sharedPlayerView === views.spectatorView
        ? JSON.stringify({ type: MESSAGE_TYPES.ROOM_UPDATE, data: sharedData })
        : JSON.stringify({ type: MESSAGE_TYPES.ROOM_UPDATE, data: sharedData })
    }

    for (const player of this.players.values()) {
      if (player.isBot) {
        const gameState = views.sharedPlayerView || views.perPlayerView(player.id)
        player.send({ type: MESSAGE_TYPES.ROOM_UPDATE, data: { ...shell, isSpectator: false, gameState } })
        continue
      }
      if (sharedPlayerJson && typeof player.sendRaw === 'function') {
        player.sendRaw(sharedPlayerJson)
        continue
      }
      const gameState = views.perPlayerView(player.id)
      const data = { ...shell, isSpectator: false, gameState }
      if (typeof player.sendRaw === 'function') {
        player.sendRaw(JSON.stringify({ type: MESSAGE_TYPES.ROOM_UPDATE, data }))
      } else {
        player.send({ type: MESSAGE_TYPES.ROOM_UPDATE, data })
      }
    }

    for (const spectator of this.spectators.values()) {
      if (typeof spectator.sendRaw === 'function') spectator.sendRaw(spectatorJson)
      else spectator.send(spectatorMsg)
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

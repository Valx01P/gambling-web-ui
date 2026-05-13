import { GAME_PHASES, MESSAGE_TYPES, POKER_CONFIG } from "../config/constants.js"
import {
  getBotById,
  listTopUniqueEloBots,
  listNeuralBotsByOwner,
  provisionNeuralBotsForUser
} from "../bots/botRepository.js"
import { verify as verifyJwt } from "../auth/jwt.js"
import { sanitizeDisplayString } from "../utils/sanitize.js"
import { findUserById, touchLastActive } from "../users/userRepository.js"
import { hydrateDailyFromRow } from "../dailies/dailyEngine.js"
import { track as trackPresence } from "../users/presence.js"

export class MessageHandler {
  constructor(playerManager, roomManager) {
    this.playerManager = playerManager
    this.roomManager = roomManager
  }

  handle(playerId, message) {
    const player = this.playerManager.getPlayer(playerId)
    if (!player) return this.error('Player not found')

    // Refresh activity on any message received
    player.updateActivity()

    try {
      const { type, data } = JSON.parse(message)

      switch (type) {
        case MESSAGE_TYPES.JOIN_GAME:
          return this.handleJoin(player, data)

        case MESSAGE_TYPES.LEAVE_GAME:
          return this.handleLeave(player)

        case MESSAGE_TYPES.LIST_TABLES:
          return this.handleListTables(player)

        case MESSAGE_TYPES.CHAT:
          return this.handleChat(player, data)

        case MESSAGE_TYPES.PLAYER_EMOTE:
          return this.handleEmote(player, data)

        case MESSAGE_TYPES.PLAYER_YELL:
          return this.handleYell(player, data)

        case MESSAGE_TYPES.ADD_BOT:
          return this.handleAddBot(player, data)

        case MESSAGE_TYPES.REMOVE_BOT:
          return this.handleRemoveBot(player, data)

        case MESSAGE_TYPES.POKER_LOAN:
          return this.handleLoan(player, data)

        case MESSAGE_TYPES.POKER_REPAY_LOAN:
          return this.handleRepayLoan(player, data)

        case MESSAGE_TYPES.POKER_SET_AUTOPAY:
          return this.handleSetAutoPay(player, data)

        case MESSAGE_TYPES.POKER_BIG_YAHU:
          return this.handleBigYahu(player)

        case MESSAGE_TYPES.POKER_PROPOSE_BLINDS:
          return this.handleProposeBlinds(player, data)

        case MESSAGE_TYPES.POKER_BLINDS_VOTE:
          return this.handleBlindsVote(player, data)

        case MESSAGE_TYPES.POKER_TOGGLE_CONTEST_MODE:
          return this.handleToggleContestMode(player, data)

        case MESSAGE_TYPES.POKER_ARENA_SET_RUNNING:
          return this.handleArenaSetRunning(player, data)

        case MESSAGE_TYPES.POKER_ARENA_SET_STARTING_CHIPS:
          return this.handleArenaSetStartingChips(player, data)

        case MESSAGE_TYPES.POKER_AUTO_FILL_BOTS:
          return this.handleAutoFillBots(player)

        case MESSAGE_TYPES.POKER_AUTO_FILL_NEURAL:
          return this.handleAutoFillNeural(player)

        case MESSAGE_TYPES.AUTH_HELLO:
          return this.handleAuthHello(player, data)

        case MESSAGE_TYPES.UPDATE_PROFILE:
          return this.handleUpdateProfile(player, data)

        case MESSAGE_TYPES.RESET_MONEY:
          return this.handleResetMoney(player)

        case MESSAGE_TYPES.POKER_FOLD:
        case MESSAGE_TYPES.POKER_CHECK:
        case MESSAGE_TYPES.POKER_CALL:
        case MESSAGE_TYPES.POKER_RAISE:
        case MESSAGE_TYPES.POKER_ALL_IN:
          return this.handleAction(player, type, data)

        case 'sidebet:place':
          return this.handleSideBetPlace(player, data)

        case 'sidebet:sell':
          return this.handleSideBetSell(player, data)

        case MESSAGE_TYPES.RUNOUT_VOTE_SUBMIT:
          return this.handleRunoutVoteSubmit(player, data)

        case 'peer_loan:open':
        case 'peer_loan:counter':
        case 'peer_loan:accept':
        case 'peer_loan:decline':
        case 'peer_loan:cancel':
        case 'peer_loan:repay':
          return this.handlePeerLoan(player, type, data)

        case 'crypto:buy':
        case 'crypto:sell':
        case 'crypto:create':
        case 'crypto:rug':
          return this.handleCrypto(player, type, data)

        default:
          return this.error('Unknown message type', player)
      }
    } catch (err) {
      console.error('Message handling error:', err)
      return this.error('Invalid message format', player)
    }
  }

  handleJoin(player, data) {
    // "Play as YOU" — signed-in user wants their server-authoritative
    // profile applied to the table. The server is the source of truth here,
    // so we ignore any avatarId/avatarUrl/username in the payload and pull
    // straight from the cached profile (populated during auth_hello).
    //
    // Why not validate the client-supplied avatarUrl instead? Google
    // profile pictures live on googleusercontent.com, which isn't on our
    // CDN — setCustomAvatarUrl would reject them. Going through the
    // server-side lookup means Google pictures, custom uploads, and
    // no-avatar (initials at the table) all work uniformly.
    // Anchor the "joined as my account" flag here. Recording, ELO updates,
    // and broadcast of publicUserId all read it. The signed-in user can
    // re-join the same WS as anonymous later — we reset the flag to false
    // on every join, never carry it across.
    const playAsSelf = !!(data?.playAsSelf && player.userId)
    player.playingAsSelf = playAsSelf

    if (playAsSelf) {
      if (player.userDisplayName) {
        const clean = sanitizeDisplayString(player.userDisplayName, { maxLength: 24 })
        if (clean) player.username = clean
      }
      player.avatarId = null
      player.avatarUrl = player.userAvatarUrl || null
    } else {
      if (data?.username) {
        const clean = sanitizeDisplayString(data.username, { maxLength: 24 })
        if (clean) player.username = clean
      }
      if (data?.avatarUrl && typeof player.setCustomAvatarUrl === 'function') {
        // Custom upload — must originate from our own S3+CloudFront stack.
        // setCustomAvatarUrl rejects URLs outside the configured CDN host.
        player.setCustomAvatarUrl(data.avatarUrl)
      } else if (data?.avatarId && typeof player.setProfileAvatar === 'function') {
        player.setProfileAvatar(data.avatarId)
      }
    }

    const mode = data?.mode || 'general'
    const code = data?.code || null
    const roomId = data?.roomId || null
    const game = data?.game || 'poker'

    const result = this.roomManager.joinGame(player, mode, code, roomId, game)

    if (result.success) {
      player.send({
        type: MESSAGE_TYPES.JOIN_GAME,
        data: {
          success: true,
          ...result.room.getRoomData(player.id),
          isSpectator: result.isSpectator
        }
      })
    } else {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }

    return result
  }

  handleListTables(player) {
    player.send({
      type: MESSAGE_TYPES.TABLE_LIST,
      data: {
        tables: this.roomManager.getTableList()
      }
    })

    return { success: true }
  }

  handleLeave(player) {
    const result = this.roomManager.leaveGame(player)
    player.send({ type: MESSAGE_TYPES.LEAVE_GAME, data: result })
    return result
  }

  handleAuthHello(player, data) {
    // Verify the JWT and tag the WS player with the signed-in user's id.
    // Anonymous tokens are silently dropped — features that need auth will
    // simply remain locked.
    const token = data?.token
    if (!token || typeof token !== 'string') return { success: false }
    try {
      const payload = verifyJwt(token)
      player.userId = payload.sub
      player.userEmail = payload.email || null
      // Mark online + bump the DB timestamp. Track first so the popover
      // can see "online right now" even before the async DB write
      // settles; the DB row is the durable fallback for offline lookups.
      trackPresence(player.userId, player.id)
      touchLastActive(player.userId).catch(err =>
        console.warn('[auth] touch last_active failed:', err.message)
      )
      // Fire-and-forget profile fetch so "Play as YOU" at join time can
      // pull the server-authoritative username + avatar synchronously.
      // The join happens seconds after auth_hello in normal flows, so the
      // race is benign — if the fetch hasn't completed yet, the player
      // just appears with their (default-null) avatar and we eat one
      // missing-photo turn at the table. Repopulates on every auth_hello
      // in case the user updated their profile between sessions.
      findUserById(player.userId)
        .then(user => {
          if (user && player.userId === payload.sub) {
            player.userDisplayName = user.display_name || null
            player.userAvatarUrl = user.avatar_url || null
            if (typeof user.elo === 'number') player.elo = user.elo
            if (typeof user.hands_played === 'number') player.userHandsPlayed = user.hands_played
            // Mirror persistent daily / achievement / skin state into the
            // in-memory Player so the engine can mutate without an extra
            // round-trip per hand and the client gets the right state in
            // its first room_update.
            hydrateDailyFromRow(player, user)
          }
        })
        .catch(err => console.warn('[auth] profile prefetch failed:', err.message))
      return { success: true }
    } catch {
      player.userId = null
      return { success: false }
    }
  }

  handleChat(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Not in a room' } })
      return { success: false }
    }

    // Spectators on regular tables can't chat — keeps live games quiet.
    // Arenas allow it, since spectators are the only humans there.
    if (player.isSpectator && !room.isArena) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Spectators cannot chat at live tables.' } })
      return { success: false }
    }

    // sanitizeDisplayString trims, collapses whitespace, strips zero-width /
    // bidi-spoof / control chars before capping length. React's escaping
    // already handles HTML; this layer covers Unicode trickery.
    const text = sanitizeDisplayString(data?.message || '', { maxLength: 200 })
    if (!text) return { success: false }

    room.broadcast({
      type: MESSAGE_TYPES.CHAT,
      data: {
        playerId: player.id,
        username: player.username,
        isSpectator: player.isSpectator,
        message: text,
        timestamp: Date.now()
      }
    })

    return { success: true }
  }

  handleEmote(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Not in a room' } })
      return { success: false }
    }

    const result = room.handlePlayerEmote(player.id, data)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleYell(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Not in a room' } })
      return { success: false }
    }

    if (typeof room.handlePlayerYell !== 'function') {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Yells are only available at poker tables' } })
      return { success: false }
    }

    const result = room.handlePlayerYell(player.id, data)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  async handleAddBot(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Bots can only be added at poker tables', player)
    }
    const botId = typeof data?.botId === 'string' ? data.botId : null
    if (!botId) return this.error('Missing botId', player)

    let bot
    try {
      // Pass the WS player's userId so private bots are visible to their
      // owner — they can sit their own private clone bots at any table.
      // Other users' private bots resolve to null and get the same
      // "not found" response so we don't leak that the bot exists.
      bot = await getBotById(botId, { viewerUserId: player.userId || null })
    } catch (err) {
      console.error('[bots] lookup failed:', err.message)
      return this.error('Bot lookup failed', player)
    }
    if (!bot) return this.error('Bot not found or not public', player)

    // Arena spectators have their own bot-add path that uses the arena's
    // configured starting chips and skips the seated-adder check.
    const result = room.isArena
      ? room.addBotForArenaSpectator(player.id, bot)
      : room.addBotForPlayer(player.id, bot)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
      return result
    }
    return result
  }

  handleRemoveBot(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Not at a poker table', player)
    }
    const botSeatId = typeof data?.botSeatId === 'string' ? data.botSeatId : null
    if (!botSeatId) return this.error('Missing botSeatId', player)

    const result = room.isArena
      ? room.removeBotForArenaSpectator(player.id, botSeatId)
      : room.removeBotForPlayer(player.id, botSeatId)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleLoan(player, data) {
    const bankId = typeof data?.bankId === 'string' ? data.bankId : null
    if (!bankId) return this.error('Missing bankId', player)

    const result = player.takeLoan(bankId)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
      return result
    }

    const room = this.roomManager.getPlayerRoom(player)
    if (room) {
      room.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} pulled $${result.loan.principal.toLocaleString()} from ${result.bank.name} at ${(result.loan.interestRate * 100).toFixed(1)}%.` }
      })
      if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    }
    return { success: true }
  }

  handleRepayLoan(player, data) {
    const bankId = typeof data?.bankId === 'string' ? data.bankId : null
    if (!bankId) return this.error('Missing bankId', player)

    const room = this.roomManager.getPlayerRoom(player)
    // Block mid-hand repay so we don't pull chips out of an active bet.
    if (room && room.roomType === 'poker' && room.game) {
      const inHand = room.game.phase !== GAME_PHASES.WAITING && room.game.phase !== GAME_PHASES.SHOWDOWN
      const seated = room.players?.has?.(player.id)
      const folded = room.game.foldedPlayers?.has?.(player.id)
      if (seated && inHand && !folded) {
        return this.error('Repay blocked: finish or fold the current hand first.', player)
      }
    }

    const result = player.repayLoan(bankId)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
      return result
    }

    if (room) {
      room.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} paid back $${result.repaid.toLocaleString()} to ${result.loan.bankName}.` }
      })
      if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    }
    return { success: true }
  }

  handleProposeBlinds(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') return this.error('Not at a poker table', player)
    const small = Number(data?.small)
    const big = Number(data?.big)
    if (!Number.isFinite(small) || !Number.isFinite(big)) return this.error('Invalid blind values', player)
    const result = room.proposeBlinds(player.id, small, big)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleBlindsVote(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') return this.error('Not at a poker table', player)
    const proposalId = typeof data?.proposalId === 'string' ? data.proposalId : null
    const vote = data?.vote === 'reject' ? 'reject' : 'approve'
    if (!proposalId) return this.error('Missing proposalId', player)
    const result = room.voteBlinds(player.id, proposalId, vote)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleArenaSetRunning(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.isArena) return this.error('Not in an arena', player)
    const result = room.setArenaRunning(player.id, Boolean(data?.running))
    if (!result.success) player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    return result
  }

  handleArenaSetStartingChips(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.isArena) return this.error('Not in an arena', player)
    const result = room.setArenaStartingChips(player.id, data?.chips)
    if (!result.success) player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    return result
  }

  async handleAutoFillBots(player) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Not at a poker table', player)
    }
    // Fill every empty seat. We compute the slot count server-side instead
    // of trusting a client param so the room can never over-seat past
    // MAX_PLAYERS. Fetch slotsLeft + buffer so duplicates (bots already at
    // the table) can be skipped and we still hit the target.
    const slotsLeft = Math.max(0, POKER_CONFIG.MAX_PLAYERS - room.players.size)
    if (slotsLeft === 0) {
      return this.error(room.isArena ? 'Arena is full.' : 'Table is full.', player)
    }
    const fetchN = Math.min(20, slotsLeft + POKER_CONFIG.MAX_PLAYERS)
    let bots
    try { bots = await listTopUniqueEloBots({ limit: fetchN }) }
    catch (err) {
      console.error('[autofill] bot lookup failed:', err.message)
      return this.error('Could not load top bots.', player)
    }
    if (!bots.length) return this.error('No public bots available.', player)
    const result = room.autoFillWithTopBots(player.id, bots)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  // Auto-fill with the caller's own 5 NN bots in tier order (α → ε).
  // Requires auth. Lazy-provisions in case the user hits this before
  // ever loading /poker/bots (where /api/bots/mine normally seeds them).
  async handleAutoFillNeural(player) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Not at a poker table', player)
    }
    const userId = player.userId
    if (!userId) {
      return this.error('Sign in to use your neural squad.', player)
    }
    const slotsLeft = Math.max(0, POKER_CONFIG.MAX_PLAYERS - room.players.size)
    if (slotsLeft === 0) {
      return this.error(room.isArena ? 'Arena is full.' : 'Table is full.', player)
    }
    let bots
    try {
      await provisionNeuralBotsForUser(userId)
      bots = await listNeuralBotsByOwner(userId)
    } catch (err) {
      console.error('[autofill-neural] bot lookup failed:', err.message)
      return this.error('Could not load your neural squad.', player)
    }
    if (!bots.length) return this.error('No neural bots provisioned yet.', player)
    const result = room.autoFillWithTopBots(player.id, bots)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleToggleContestMode(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') return this.error('Not at a poker table', player)
    const enabled = Boolean(data?.enabled)
    const startingLevelId = typeof data?.startingLevelId === 'string' ? data.startingLevelId : null
    const result = room.toggleContestMode(player.id, { enabled, startingLevelId })
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleSetAutoPay(player, data) {
    const bankId = typeof data?.bankId === 'string' ? data.bankId : null
    const amount = Number(data?.amount)
    if (!bankId) return this.error('Missing bankId', player)
    if (!Number.isFinite(amount) || amount < 0) return this.error('Invalid amount', player)

    const result = player.setAutoPay(bankId, amount)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
      return result
    }
    const room = this.roomManager.getPlayerRoom(player)
    if (room && typeof room.broadcastRoomUpdate === 'function') {
      room.broadcastRoomUpdate()
    }
    return { success: true }
  }

  handleBigYahu(player) {
    // Big Yahu picks up anytime — even mid-hand. The forgiveness is purely a
    // P/L + loan-state operation; chip stack stays put, so calling during a
    // live hand doesn't corrupt bookkeeping.
    const room = this.roomManager.getPlayerRoom(player)
    const before = { loans: player.loans.length, profit: player.getProfit() }
    const result = player.bigYahu()

    if (room) {
      room.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: {
          message: `${player.username} called Big Yahu. ${before.loans} loan${before.loans === 1 ? '' : 's'} forgiven, P/L wiped, credit restored.`
        }
      })
      if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    }
    return { success: true, ...result }
  }

  handleUpdateProfile(player, data) {
    const nextUsername = typeof data?.username === 'string'
      ? sanitizeDisplayString(data.username, { maxLength: 24 })
      : null
    const nextAvatarId = typeof data?.avatarId === 'string' ? data.avatarId : null
    const nextAvatarUrl = typeof data?.avatarUrl === 'string' ? data.avatarUrl : null

    if (!nextUsername && !nextAvatarId && !nextAvatarUrl) {
      return this.error('Nothing to update', player)
    }

    if (nextUsername) player.username = nextUsername || player.username
    if (nextAvatarUrl && typeof player.setCustomAvatarUrl === 'function') {
      player.setCustomAvatarUrl(nextAvatarUrl)
    } else if (nextAvatarId && typeof player.setProfileAvatar === 'function') {
      player.setProfileAvatar(nextAvatarId)
    }

    const room = this.roomManager.getPlayerRoom(player)
    if (room && typeof room.broadcastRoomUpdate === 'function') {
      room.broadcastRoomUpdate()
    }
    if (room && typeof room.broadcastGameState === 'function') {
      room.broadcastGameState()
    }

    player.send({
      type: MESSAGE_TYPES.UPDATE_PROFILE,
      data: { success: true, username: player.username, avatarId: player.avatarId, avatarUrl: player.avatarUrl }
    })
    return { success: true }
  }

  handleResetMoney(player) {
    const room = this.roomManager.getPlayerRoom(player)
    // Block while you're actually contesting a hand — resetting chips mid-hand
    // would corrupt the engine's in-flight bookkeeping.
    if (room && room.roomType === 'poker' && room.game) {
      const inHand = room.game.phase !== GAME_PHASES.WAITING && room.game.phase !== GAME_PHASES.SHOWDOWN
      const seated = room.players?.has?.(player.id)
      const folded = room.game.foldedPlayers?.has?.(player.id)
      if (seated && inHand && !folded) {
        return this.error('Reset blocked: finish or fold the current hand first.', player)
      }
    }

    player.resetMoney()

    if (room) {
      room.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} reset their bank back to $${POKER_CONFIG.STARTING_CHIPS.toLocaleString()}.` }
      })
      if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
      if (typeof room.broadcastGameState === 'function') room.broadcastGameState()
    }

    player.send({
      type: MESSAGE_TYPES.RESET_MONEY,
      data: { success: true, chips: player.chips, loans: player.loans, loanedTotal: player.loanedTotal }
    })
    return { success: true }
  }

  handleAction(player, actionType, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Not in a room' } })
      return { success: false }
    }

    const result = room.handlePlayerAction(player.id, actionType, data)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleSideBetPlace(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Side bets are only available at poker tables.', player)
    }
    const result = room.placeSideBet(player.id, {
      propId: data?.propId,
      side: data?.side,
      amount: data?.amount
    })
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeSideBetError(result.error) } })
    }
    return result
  }

  handleSideBetSell(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Side bets are only available at poker tables.', player)
    }
    const result = room.sellSidePosition(player.id, {
      propId: data?.propId,
      shares: data?.shares
    })
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeSideBetError(result.error) } })
    }
    return result
  }

  handlePeerLoan(player, type, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.peerLoanEngine) {
      return this.error('Peer loans only work at a poker table.', player)
    }
    const engine = room.peerLoanEngine
    let result
    switch (type) {
      case 'peer_loan:open':    result = engine.open(player.id, data || {}); break
      case 'peer_loan:counter': result = engine.counter(player.id, data || {}); break
      case 'peer_loan:accept':  result = engine.accept(player.id, data || {}); break
      case 'peer_loan:decline': result = engine.decline(player.id, data || {}); break
      case 'peer_loan:cancel':  result = engine.cancel(player.id, data || {}); break
      case 'peer_loan:repay':   result = engine.repay(player.id, data || {}); break
      default: return this.error('Unknown peer-loan action', player)
    }
    if (result && !result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  handleCrypto(player, type, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.cryptoEngine) {
      return this.error('Crypto market is only available at a poker table.', player)
    }
    let result
    switch (type) {
      case 'crypto:buy':    result = room.cryptoBuy(player.id, data || {}); break
      case 'crypto:sell':   result = room.cryptoSell(player.id, data || {}); break
      case 'crypto:create': result = room.cryptoCreate(player.id, data || {}); break
      case 'crypto:rug':    result = room.cryptoRug(player.id); break
      default: return this.error('Unknown crypto action', player)
    }
    if (result && !result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeCryptoError(result.error) } })
      return result
    }
    // Trades mutate player.chips directly. Push a room_update so every
    // client's bankroll / finances view picks up the new balance without
    // waiting on the next hand tick. Same pattern as peer loans + bank loans.
    if (result?.success && typeof room.broadcastRoomUpdate === 'function') {
      room.broadcastRoomUpdate()
    }
    if (result?.success && type === 'crypto:rug' && result?.totalCollected != null) {
      room.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} rugged their coin and walked with $${result.totalCollected.toLocaleString()}.` }
      })
    }
    if (result?.success && type === 'crypto:create' && result?.symbol) {
      room.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${player.username} just minted $${result.symbol}.` }
      })
    }
    return result
  }

  handleRunoutVoteSubmit(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.game) {
      return this.error('Not at a poker table', player)
    }
    const voteId = typeof data?.voteId === 'string' ? data.voteId : null
    const choice = Number(data?.choice)
    if (!voteId) return this.error('Missing voteId', player)
    if (!Number.isFinite(choice)) return this.error('Invalid choice', player)
    const result = room.game.submitRunoutVote(player.id, voteId, choice)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  error(message, player = null) {
    console.error('Handler error:', message)
    if (player) player.send({ type: MESSAGE_TYPES.ERROR, data: { message } })
    return { success: false, error: message }
  }
}

function humanizeCryptoError(code) {
  if (typeof code !== 'string') return 'Crypto trade failed.'
  switch (code) {
    case 'not_at_table': return 'You must be at the table to trade crypto.'
    case 'bots_cannot_trade': return 'Bots can\'t trade crypto.'
    case 'coin_not_found': return 'That coin no longer exists.'
    case 'invalid_amount': return 'Invalid amount.'
    case 'insufficient_chips': return 'Not enough chips in your stack.'
    case 'insufficient_float': return 'Not enough float available on that coin.'
    case 'no_position': return 'You don\'t hold any of that coin.'
    case 'already_minted': return 'You\'ve already minted a coin this session.'
    case 'no_coin': return 'You haven\'t minted a coin.'
    case 'already_rugged': return 'That coin has already been rugged.'
    default: return code
  }
}

// Pretty-print engine error codes for the toast popups on the client.
function humanizeSideBetError(code) {
  if (typeof code !== 'string') return 'Side bet failed.'
  if (code.startsWith('min_bet_')) return `Minimum side bet is ${code.split('_').pop()} chips.`
  switch (code) {
    case 'invalid_side': return 'Pick YES or NO.'
    case 'prop_not_found': return 'That market is no longer available.'
    case 'prop_closed': return 'That market has already resolved.'
    case 'not_seated': return 'You must be seated at the table to place side bets.'
    case 'insufficient_chips': return 'Not enough chips in your stack.'
    case 'no_position': return 'You don\'t hold a position on that market.'
    case 'invalid_shares': return 'Invalid share count.'
    default: return code
  }
}

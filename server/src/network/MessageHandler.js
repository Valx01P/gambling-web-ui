import { BANKS, GAME_PHASES, MESSAGE_TYPES, POKER_CONFIG } from "../config/constants.js"
import { getBotById } from "../bots/botRepository.js"
import { verify as verifyJwt } from "../auth/jwt.js"
import { sanitizeDisplayString } from "../utils/sanitize.js"
import { findUserById, touchLastActive } from "../users/userRepository.js"
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

  error(message, player = null) {
    console.error('Handler error:', message)
    if (player) player.send({ type: MESSAGE_TYPES.ERROR, data: { message } })
    return { success: false, error: message }
  }
}

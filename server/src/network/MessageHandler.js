import { GAME_PHASES, MESSAGE_TYPES, POKER_CONFIG } from "../config/constants.js"
import {
  getBotById,
  listTopUniqueEloBots,
  listNeuralBotsByOwner,
  listDeepMlpBotsByOwner,
  listManualBotsByOwner,
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

        case MESSAGE_TYPES.POKER_ARENA_SET_SPEED:
          return this.handleArenaSetSpeed(player, data)

        case MESSAGE_TYPES.POKER_AUTO_FILL_BOTS:
          return this.handleAutoFillBots(player)

        case MESSAGE_TYPES.POKER_AUTO_FILL_NEURAL:
          return this.handleAutoFillNeural(player)

        case MESSAGE_TYPES.POKER_AUTO_FILL_CUSTOM:
          return this.handleAutoFillCustom(player)

        case MESSAGE_TYPES.POKER_AUTO_FILL_MLP:
          return this.handleAutoFillMlp(player)

        case MESSAGE_TYPES.POKER_KICK_ALL_BOTS:
          return this.handleKickAllBots(player)

        case MESSAGE_TYPES.AUTH_HELLO:
          return this.handleAuthHello(player, data)

        case MESSAGE_TYPES.RECONNECT:
          // Special path: the WS that just connected has a brand-new
          // playerId, but the client claims a sessionToken from a prior
          // session. We need to swap the fresh shell out for the held
          // seat (if any) before any other handler runs.
          return this.handleReconnect(playerId, player, data)

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

        case MESSAGE_TYPES.ITEM_USE:
          return this.handleItemUse(player, data)
        case MESSAGE_TYPES.ITEM_SCAM_RESOLVE:
          return this.handleItemScamResolve(player, data)

        case 'asset:buy':
        case 'asset:sell':
          return this.handleAssetTrade(player, type, data)

        case 'job:claim':
          return this.handleJobClaim(player, data)

        case 'stock:buy':
        case 'stock:sell':
        case 'stock:sabotage':
          return this.handleStockAction(player, type, data)

        case 'options:buy':
          return this.handleOptionsBuy(player, data)

        case 'world:claim':
        case 'world:pandemic':
          return this.handleWorldAction(player, type, data)

        case 'influence:run':
          return this.handleInfluenceRun(player, data)

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
        // 2026-05: if it rejects, fall through to avatarId (or a sane
        // preset default) so anon photo-upload failures don't land the
        // player at the table with no avatar at all. The server log will
        // have a [avatar] warning when this happens.
        const ok = player.setCustomAvatarUrl(data.avatarUrl)
        if (!ok && data?.avatarId && typeof player.setProfileAvatar === 'function') {
          player.setProfileAvatar(data.avatarId)
        }
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

  // Re-attach a fresh WS to the seat held during the grace window. Path:
  //   1. The new WS connection got assigned a placeholder playerId + a
  //      fresh Player shell (see WebSocketServer.init).
  //   2. The client sees its saved sessionToken in localStorage and sends
  //      RECONNECT { sessionToken } as its first non-auth message.
  //   3. We look up the held Player by token. If found and still alive
  //      (token rotates on success, grace not expired), we swap the new
  //      socket onto the held Player and discard the placeholder.
  //   4. We reply RECONNECT_OK with a complete room snapshot so the
  //      client can render mid-hand state without a fresh join.
  //
  // Failure modes (all reply RECONNECT_FAIL with a reason the client can
  // log; client falls back to a normal join flow):
  //   • unknown_token       — never issued, or already rotated past
  //   • grace_expired       — too long; the held player was torn down
  //   • not_in_room         — the held seat already left the room
  //   • same_player         — same WS asking to reconnect to itself
  handleReconnect(placeholderId, placeholder, data) {
    const token = data?.sessionToken
    if (typeof token !== 'string' || token.length === 0) {
      placeholder.send({ type: MESSAGE_TYPES.RECONNECT_FAIL, data: { reason: 'no_token' } })
      return { success: false }
    }
    const held = this.playerManager.getPlayerByToken(token)
    if (!held) {
      placeholder.send({ type: MESSAGE_TYPES.RECONNECT_FAIL, data: { reason: 'unknown_token' } })
      return { success: false }
    }
    if (held.id === placeholderId) {
      // Replayed RECONNECT on an already-active socket. No-op.
      placeholder.send({ type: MESSAGE_TYPES.RECONNECT_FAIL, data: { reason: 'same_player' } })
      return { success: false }
    }
    // Re-attach the fresh socket to the held seat. attachSocket also
    // rotates the token and clears the grace timer.
    const newWs = placeholder.ws
    const reattached = this.playerManager.attachSocket(held.id, newWs)
    if (!reattached) {
      placeholder.send({ type: MESSAGE_TYPES.RECONNECT_FAIL, data: { reason: 'attach_failed' } })
      return { success: false }
    }
    // Drop the placeholder Player object now that its socket is owned by
    // the held player. The WS itself stays open — we just stop tracking
    // the throwaway playerId, including unbinding its message handler's
    // implicit playerId binding by rewriting the closure key.
    this.playerManager.deletePlayer(placeholderId)
    // The ws.on('message') closure was created with the placeholder id
    // captured. Tag the WS so the dispatcher knows which Player to look
    // up on subsequent messages — WebSocketServer reads this on each
    // inbound frame.
    newWs._reattachedPlayerId = reattached.id

    // Build the room snapshot the client needs to re-render. If the
    // player wasn't in a room (rare — grace usually only starts when
    // seated), still reply OK so the client can drop into the lobby.
    const room = this.roomManager.getPlayerRoom(reattached)
    const snapshot = room ? room.getRoomData(reattached.id) : null
    reattached.send({
      type: MESSAGE_TYPES.RECONNECT_OK,
      data: {
        playerId: reattached.id,
        sessionToken: reattached.sessionToken,
        username: reattached.username,
        // Full room snapshot — same shape as JOIN_GAME success — so the
        // client can render hole cards, pot, community, action-on-who
        // without a separate fetch.
        room: snapshot,
        isSpectator: reattached.isSpectator
      }
    })
    // Push fresh per-player engine snapshots so all the side-economy
    // panels (items, real-estate, jobs, stocks, world) repopulate on
    // reconnect instead of staying empty until the next hand-end. The
    // RECONNECT_OK room snapshot doesn't carry these — each engine
    // owns its own state outside the room payload.
    if (room) {
      try { room.itemEngine?.sendSnapshotTo(reattached) } catch {}
      try { room.assetEngine?.sendSnapshotTo(reattached) } catch {}
      try { room.jobEngine?.sendSnapshotTo(reattached) } catch {}
      try { room.stockEngine?.sendSnapshotTo(reattached) } catch {}
      try { room.worldEngine?.sendSnapshotTo(reattached) } catch {}
    }
    // Tell the table that the player is back so other clients can drop
    // the "(reconnecting…)" tag from the seat.
    if (room?.broadcast) {
      room.broadcast({
        type: MESSAGE_TYPES.PLAYER_RECONNECTED,
        data: { playerId: reattached.id }
      })
    }
    return { success: true }
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

  handleArenaSetSpeed(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.isArena) return this.error('Not in an arena', player)
    const result = room.setArenaThinkDelay(player.id, data?.delayMs)
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
    const result = await room.autoFillWithTopBots(player.id, bots)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  // Auto-fill with the caller's own user-coded bots (no clones / NNs).
  // Requires auth. If you have fewer than slotsLeft bots, you seat
  // however many you have — no padding from the public catalog.
  async handleAutoFillCustom(player) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Not at a poker table', player)
    }
    const userId = player.userId
    if (!userId) {
      return this.error('Sign in to seat your own bots.', player)
    }
    const slotsLeft = Math.max(0, POKER_CONFIG.MAX_PLAYERS - room.players.size)
    if (slotsLeft === 0) {
      return this.error(room.isArena ? 'Arena is full.' : 'Table is full.', player)
    }
    let bots
    try { bots = await listManualBotsByOwner(userId) }
    catch (err) {
      console.error('[autofill-custom] bot lookup failed:', err.message)
      return this.error('Could not load your bots.', player)
    }
    if (!bots.length) return this.error('You have no custom bots to seat.', player)
    const result = await room.autoFillWithTopBots(player.id, bots)
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
    const result = await room.autoFillWithTopBots(player.id, bots)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  // Auto-fill with the caller's 5 deep-MLP bots (tiers 6-10: Neuron
  // ζ → κ). Same flow as handleAutoFillNeural but the bot list is
  // narrowed to the deep-MLP variants — the baseline α-ε lineup is
  // *not* included, since the user explicitly wanted these as a
  // separate squad.
  async handleAutoFillMlp(player) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Not at a poker table', player)
    }
    const userId = player.userId
    if (!userId) {
      return this.error('Sign in to use your MLP squad.', player)
    }
    const slotsLeft = Math.max(0, POKER_CONFIG.MAX_PLAYERS - room.players.size)
    if (slotsLeft === 0) {
      return this.error(room.isArena ? 'Arena is full.' : 'Table is full.', player)
    }
    let bots
    try {
      // Lazy-provision: a brand-new account hitting the MLP squad
      // before ever loading /poker/bots wouldn't have these rows yet.
      await provisionNeuralBotsForUser(userId)
      bots = await listDeepMlpBotsByOwner(userId)
    } catch (err) {
      console.error('[autofill-mlp] bot lookup failed:', err.message)
      return this.error('Could not load your MLP squad.', player)
    }
    if (!bots.length) return this.error('No deep-MLP bots provisioned yet.', player)
    const result = await room.autoFillWithTopBots(player.id, bots)
    if (!result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }
    return result
  }

  // Remove every bot currently seated in the caller's room. Same
  // eligibility rules as REMOVE_BOT (must be seated at a regular
  // table, or a spectator at an arena). Quiet no-op if there are no
  // bots — still returns success so the client can chain the next
  // auto-fill message.
  handleKickAllBots(player) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker') {
      return this.error('Not at a poker table', player)
    }
    // Snapshot seated bot ids first; removeBotForPlayer mutates the
    // players Map mid-iteration which would skip seats otherwise.
    const botIds = [...room.players.values()]
      .filter(p => p && p.isBot && p.id)
      .map(p => p.id)
    for (const botId of botIds) {
      try {
        if (room.isArena) room.removeBotForArenaSpectator(player.id, botId)
        else room.removeBotForPlayer(player.id, botId)
      } catch (err) {
        console.error('[kick-all-bots] remove failed:', err.message)
      }
    }
    return { success: true, removed: botIds.length }
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

  // ─── Items (peek / swap / scam / hack) ───────────────────────────────
  // The cooldown engine lives at server/src/items/itemEngine.js. Bots
  // can't use or be targeted by items; scam responses come back via
  // a separate handleItemScamResolve handler.
  handleItemUse(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || room.roomType !== 'poker' || !room.itemEngine) {
      return this.error('Items are only usable at a poker table.', player)
    }
    if (player.isSpectator) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Spectators cannot use items.' } })
      return { success: false }
    }
    const itemId = typeof data?.itemId === 'string' ? data.itemId : null
    const targetId = typeof data?.targetId === 'string' ? data.targetId : null
    let result
    switch (itemId) {
      case 'peek': result = room.itemEngine.peek(player.id, targetId); break
      case 'swap': result = room.itemEngine.swap(player.id, data?.picks); break
      case 'scam': result = room.itemEngine.initiateScam(player.id, targetId); break
      case 'hack': result = room.itemEngine.hack(player.id, targetId); break
      default:
        player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Unknown item.' } })
        return { success: false }
    }
    if (!result?.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeItemError(result?.error) } })
      // Still broadcast the fresh snapshot so the badge doesn't get
      // stuck in an optimistic "Using…" state.
      room.itemEngine.sendSnapshotTo(player)
      return result
    }
    // Reply privately for peek (cards), generically for others.
    player.send({
      type: MESSAGE_TYPES.ITEM_RESULT,
      data: { itemId, ...result }
    })
    // Refresh the user's own cooldown snapshot — peek/swap/scam/hack
    // all just consumed a slot.
    room.itemEngine.sendSnapshotTo(player)
    // Swap mutates hole cards — push fresh game state so the user's
    // card view updates immediately.
    if (itemId === 'swap' && typeof room.broadcastGameState === 'function') {
      room.broadcastGameState()
    }
    // Hack / accepted scam moved chips — broadcast room_update so
    // every bankroll display picks up the new balances.
    if ((itemId === 'hack' || (itemId === 'scam' && result.transferred))
        && typeof room.broadcastRoomUpdate === 'function') {
      room.broadcastRoomUpdate()
    }
    return result
  }

  handleItemScamResolve(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.itemEngine) return { success: false }
    const scamId = typeof data?.scamId === 'string' ? data.scamId : null
    const accepted = !!data?.accepted
    if (!scamId) return { success: false }
    const result = room.itemEngine.resolveScam(player.id, scamId, accepted)
    // Either path may have moved chips (accept) — push room_update so
    // bankrolls stay in sync. Block path is a no-op chip-wise.
    if (result?.success && result.transferred && typeof room.broadcastRoomUpdate === 'function') {
      room.broadcastRoomUpdate()
    }
    return result
  }

  handleInfluenceRun(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.influenceEngine) {
      return this.error('Influence Ops are unavailable here.', player)
    }
    const opId = typeof data?.opId === 'string' ? data.opId : null
    const targetSymbol = typeof data?.targetSymbol === 'string' ? data.targetSymbol : null
    const result = room.influenceEngine.run(player.id, { opId, targetSymbol }, room.game?.handIndex || 0)
    if (!result?.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeInfluenceError(result?.error, result) } })
      return result
    }
    if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    return result
  }

  handleOptionsBuy(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.optionsEngine) {
      return this.error('Options trading is unavailable here.', player)
    }
    const result = room.optionsEngine.buy(player.id, {
      symbol: data?.symbol,
      type: data?.type,
      strike: data?.strike,
      contracts: data?.contracts,
      handIndex: room.game?.handIndex || 0,
    })
    if (!result?.success) {
      const msg = result?.error === 'insufficient_chips' && result?.cost
        ? `Need $${result.cost.toLocaleString()} for that contract.`
        : result?.error === 'invalid_type' ? 'Pick call or put.'
        : result?.error === 'unknown_symbol' ? 'No such ticker.'
        : result?.error === 'invalid_strike' ? 'Invalid strike.'
        : result?.error ? `Options buy failed: ${result.error}`
        : 'Options buy failed.'
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: msg } })
      return result
    }
    if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    return result
  }

  handleWorldAction(player, type, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.worldEngine) {
      return this.error('World map is unavailable here.', player)
    }
    let result
    if (type === 'world:claim') {
      result = room.worldEngine.claim(player.id, data || {})
    } else if (type === 'world:pandemic') {
      result = room.worldEngine.releasePandemic(player.id, { handIndex: room.game?.handIndex || 0 })
    }
    if (result && !result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeWorldError(result.error, result) } })
      return result
    }
    if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    return result
  }

  handleStockAction(player, type, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.stockEngine) {
      return this.error('Stock market is unavailable here.', player)
    }
    let result
    if (type === 'stock:buy') result = room.stockEngine.buy(player.id, data || {})
    else if (type === 'stock:sell') result = room.stockEngine.sell(player.id, data || {})
    else if (type === 'stock:sabotage') {
      result = room.stockEngine.sabotage(player.id, {
        ...(data || {}),
        handIndex: room.game?.handIndex || 0
      })
    }
    if (result && !result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeStockError(result.error, result) } })
      return result
    }
    if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    return result
  }

  handleJobClaim(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.jobEngine) {
      return this.error('Jobs board is unavailable here.', player)
    }
    const instanceId = typeof data?.id === 'string' ? data.id : null
    if (!instanceId) return this.error('Missing job id', player)
    const result = room.jobEngine.claim(player.id, instanceId)
    if (!result?.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeJobError(result?.error) } })
      return result
    }
    // jobs are now luck-rolled — success/failure both report success:true
    // (the application went through), but `succeeded` differs.
    if (result.succeeded) {
      player.send({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `💼 Pulled off "${result.title}" — +$${result.reward.toLocaleString()}.` }
      })
    } else {
      player.send({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `❌ Flopped "${result.title}" — gig burned for the hand.` }
      })
    }
    if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
    return result
  }

  handleAssetTrade(player, type, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room || !room.assetEngine) {
      return this.error('Asset market is unavailable here.', player)
    }
    let result
    if (type === 'asset:buy') result = room.assetEngine.buy(player.id, data || {})
    else if (type === 'asset:sell') result = room.assetEngine.sell(player.id, data || {})
    else return this.error('Unknown asset action', player)
    if (result && !result.success) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: humanizeAssetError(result.error) } })
      return result
    }
    if (typeof room.broadcastRoomUpdate === 'function') room.broadcastRoomUpdate()
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

function humanizeInfluenceError(code, ctx) {
  switch (code) {
    case 'unknown_op': return 'Unknown influence op.'
    case 'not_at_table': return 'Sit down first.'
    case 'bots_cannot_run_ops': return 'Bots don\'t do politics.'
    case 'insufficient_chips': return ctx?.cost ? `Costs $${ctx.cost.toLocaleString()}. Not enough chips.` : 'Not enough chips.'
    case 'cooldown': return ctx?.remaining ? `On cooldown — ${ctx.remaining} more hands.` : 'On cooldown.'
    case 'target_required': return 'Pick a stock target first.'
    case 'unknown_symbol': return 'No such ticker.'
    default: return code ? `Op failed: ${code}` : 'Op failed.'
  }
}

function humanizeWorldError(code, ctx) {
  switch (code) {
    case 'not_at_table': return 'Sit down first.'
    case 'bots_cannot_claim': return 'Bots can\'t claim territory.'
    case 'bots_cannot_release': return 'Bots can\'t release pandemics.'
    case 'unknown_territory': return 'No such territory.'
    case 'already_owned': return 'You already own it.'
    case 'already_active': return 'A pandemic is already in progress.'
    case 'cooldown': return ctx?.cooldownRemaining ? `Pandemic cooldown: ${ctx.cooldownRemaining} hands.` : 'Pandemic is on cooldown.'
    case 'insufficient_chips': return ctx?.cost ? `Need $${ctx.cost.toLocaleString()}.` : 'Not enough chips.'
    default: return code ? `World action failed: ${code}` : 'World action failed.'
  }
}

function humanizeStockError(code, ctx) {
  switch (code) {
    case 'not_at_table': return 'Sit down or spectate first.'
    case 'bots_cannot_trade': return 'Bots can\'t trade stocks.'
    case 'bots_cannot_sabotage': return 'Bots can\'t sabotage.'
    case 'unknown_symbol': return 'No such ticker.'
    case 'insufficient_chips': return ctx?.cost ? `Need $${ctx.cost.toLocaleString()} to sabotage.` : 'Not enough chips.'
    case 'no_position': return 'You don\'t hold that stock.'
    case 'too_small': return 'Buy amount too small.'
    case 'cooldown': return ctx?.cooldownRemaining ? `Sabotage cooldown: ${ctx.cooldownRemaining} hands.` : 'Sabotage is on cooldown.'
    default: return code ? `Stock action failed: ${code}` : 'Stock action failed.'
  }
}

function humanizeJobError(code) {
  switch (code) {
    case 'not_at_table': return 'Sit down or spectate first.'
    case 'bots_cannot_claim': return 'Bots don\'t need jobs.'
    case 'already_claimed_this_hand': return 'You already took a gig this hand. Wait for next hand.'
    case 'job_gone': return 'That job just expired.'
    case 'already_taken': return 'Someone beat you to it.'
    default: return code ? `Job claim failed: ${code}` : 'Job claim failed.'
  }
}

function humanizeAssetError(code) {
  switch (code) {
    case 'not_at_table': return 'Sit down or spectate first.'
    case 'bots_cannot_trade': return 'Bots can\'t hold assets.'
    case 'unknown_asset': return 'No such asset.'
    case 'insufficient_chips': return 'Not enough chips for that buy.'
    case 'insufficient_units': return 'You don\'t hold that many units.'
    default: return code ? `Asset trade failed: ${code}` : 'Asset trade failed.'
  }
}

function humanizeItemError(code) {
  switch (code) {
    case 'cooldown': return 'Item is still on cooldown.'
    case 'cant_target_self': return 'You can\'t target yourself.'
    case 'cant_peek_self': return 'You can\'t peek your own cards.'
    case 'cant_target_bots': return 'Bots are immune to items.'
    case 'bots_cant_use_items': return 'Bots can\'t use items.'
    case 'target_not_at_table': return 'That player isn\'t at the table.'
    case 'target_broke': return 'That target has no chips to take.'
    case 'target_offline': return 'That player is offline right now.'
    case 'no_hand_dealt': return 'No hand is in progress.'
    case 'not_in_hand': return 'You can only swap mid-hand.'
    case 'no_deck': return 'Deck is unavailable.'
    case 'not_at_table': return 'Sit down first.'
    case 'unknown_scam': return 'That scam offer has expired.'
    default: return code ? `Item failed: ${code}` : 'Item failed.'
  }
}

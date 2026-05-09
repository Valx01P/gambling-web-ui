import { MESSAGE_TYPES } from "../config/constants.js"

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

        case MESSAGE_TYPES.POKER_FOLD:
        case MESSAGE_TYPES.POKER_CHECK:
        case MESSAGE_TYPES.POKER_CALL:
        case MESSAGE_TYPES.POKER_RAISE:
        case MESSAGE_TYPES.POKER_ALL_IN:
        case MESSAGE_TYPES.BLACKJACK_BET:
        case MESSAGE_TYPES.BLACKJACK_HIT:
        case MESSAGE_TYPES.BLACKJACK_STAND:
        case MESSAGE_TYPES.BLACKJACK_DOUBLE:
        case MESSAGE_TYPES.BLACKJACK_SPLIT:
        case MESSAGE_TYPES.BLACKJACK_SURRENDER:
        case MESSAGE_TYPES.BLACKJACK_SET_AFK:
        case MESSAGE_TYPES.BACCARAT_BET:
        case MESSAGE_TYPES.BACCARAT_SET_AFK:
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
    if (data?.username) player.username = data.username
    if (data?.avatarId && typeof player.setProfileAvatar === 'function') {
      player.setProfileAvatar(data.avatarId)
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

  handleChat(player, data) {
    const room = this.roomManager.getPlayerRoom(player)
    if (!room) {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Not in a room' } })
      return { success: false }
    }

    const text = (data?.message || '').trim().substring(0, 200)
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

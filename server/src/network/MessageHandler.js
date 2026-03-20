import { MESSAGE_TYPES } from "../config/constants.js"

export class MessageHandler {
  constructor(playerManager, roomManager) {
    this.playerManager = playerManager
    this.roomManager = roomManager
  }

  handle(playerId, message) {
    const player = this.playerManager.getPlayer(playerId)
    if (!player) return this.error('Player not found')

    try {
      const { type, data } = JSON.parse(message)

      switch (type) {
        case MESSAGE_TYPES.JOIN_GAME:
          return this.handleJoin(player, data)

        case MESSAGE_TYPES.LEAVE_GAME:
          return this.handleLeave(player)

        case MESSAGE_TYPES.CHAT:
          return this.handleChat(player, data)

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
    if (data?.username) player.username = data.username

    const result = this.roomManager.joinGame(player)

    if (result.success) {
      player.send({
        type: MESSAGE_TYPES.JOIN_GAME,
        data: {
          success: true,
          roomId: result.room.roomId,
          isSpectator: result.isSpectator,
          players: result.room.getPlayerList(),
          spectators: result.room.getSpectatorList(),
          gameState: result.room.game.getGameState()
        }
      })
    } else {
      player.send({ type: MESSAGE_TYPES.ERROR, data: { message: result.error } })
    }

    return result
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
        message: text,
        timestamp: Date.now()
      }
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
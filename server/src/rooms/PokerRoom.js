import { PokerGame } from '../poker/PokerGame.js'
import { POKER_CONFIG, MESSAGE_TYPES } from '../config/constants.js'

export class PokerRoom {
  constructor(roomId) {
    this.roomId = roomId
    this.players = new Map()    // playerId -> player (seated)
    this.spectators = new Map() // playerId -> player (watching)
    this.game = new PokerGame((msg) => this.broadcast(msg))
  }

  addPlayer(player) {
    // If game is in progress or full, add as spectator
    if (this.players.size >= POKER_CONFIG.MAX_PLAYERS || this.game.phase !== 'waiting') {
      return this.addSpectator(player)
    }

    this.players.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = false
    this.game.addPlayer(player)

    this.broadcastRoomUpdate()

    // Auto-start when we have enough players
    if (this.game.canStart()) {
      setTimeout(() => this.game.startHand(), 2000)
    }

    return { success: true, isSpectator: false }
  }

  addSpectator(player) {
    this.spectators.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = true

    player.send({
      type: MESSAGE_TYPES.SPECTATOR_UPDATE,
      data: {
        roomId: this.roomId,
        gameState: this.game.getGameState(),
        message: 'Watching as spectator. You will join next hand when a seat opens.'
      }
    })

    return { success: true, isSpectator: true }
  }

  removePlayer(playerId) {
    const wasPlayer = this.players.has(playerId)
    const wasSpectator = this.spectators.has(playerId)

    if (wasPlayer) {
      this.players.delete(playerId)
      this.game.removePlayer(playerId)
    }

    if (wasSpectator) {
      this.spectators.delete(playerId)
    }

    // Promote a spectator to player if there's room
    if (wasPlayer && this.spectators.size > 0) {
      const [specId, spectator] = this.spectators.entries().next().value
      this.spectators.delete(specId)
      spectator.isSpectator = false
      this.players.set(specId, spectator)
      this.game.addPlayer(spectator)

      spectator.send({
        type: MESSAGE_TYPES.ROOM_UPDATE,
        data: { message: 'You have been seated at the table!' }
      })
    }

    this.broadcastRoomUpdate()
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

  broadcast(message) {
    // Send to all players
    for (const player of this.players.values()) {
      player.send(message)
    }
    // Send to spectators (without private info)
    for (const spectator of this.spectators.values()) {
      spectator.send(message)
    }
  }

  broadcastRoomUpdate() {
    const update = {
      type: MESSAGE_TYPES.ROOM_UPDATE,
      data: {
        roomId: this.roomId,
        players: this.getPlayerList(),
        spectators: this.getSpectatorList(),
        gameState: this.game.getGameState()
      }
    }
    this.broadcast(update)
  }

  getPlayerList() {
    return [...this.players.values()].map(p => p.toJSON())
  }

  getSpectatorList() {
    return [...this.spectators.values()].map(p => p.toJSON())
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
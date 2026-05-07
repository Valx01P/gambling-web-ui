import { PokerGame } from '../poker/PokerGame.js'
import { POKER_CONFIG, MESSAGE_TYPES } from '../config/constants.js'

export class PokerRoom {
  constructor(roomId, isPrivate = false) {
    this.roomId = roomId
    this.isPrivate = isPrivate
    this.inviteCode = null
    this.players = new Map()    // playerId -> player (seated)
    this.spectators = new Map() // playerId -> player (watching)
    this.startHandTimeout = null
    this.game = new PokerGame(
      (msg) => this.broadcast(msg),
      () => this.broadcastGameState()
    )
  }

  addPlayer(player) {
    if (this.players.has(player.id)) {
      return { success: true, isSpectator: false }
    }
    if (this.spectators.has(player.id)) {
      return { success: true, isSpectator: true }
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
    this.broadcastRoomUpdate()

    // Auto-start when we have enough players
    this.scheduleStartHand()

    return { success: true, isSpectator: false }
  }

  addSpectator(player) {
    if (this.spectators.has(player.id)) {
      return { success: true, isSpectator: true }
    }

    this.spectators.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = true

    player.send({
      type: MESSAGE_TYPES.SPECTATOR_UPDATE,
      data: {
        roomId: this.roomId,
        gameState: this.game.getGameState(),
        message: 'Table is full. Watching as spectator until a seat opens.'
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
    }

    if (wasSpectator) {
      this.spectators.delete(playerId)
      if (spectatorPlayer) spectatorPlayer.isSpectator = false
    }

    // Promote a spectator to player if there's room
    if (wasPlayer && this.spectators.size > 0) {
      const [specId, spectator] = this.spectators.entries().next().value
      this.spectators.delete(specId)
      spectator.isSpectator = false
      const addedToGame = this.game.addPlayer(spectator)

      if (addedToGame) {
        this.players.set(specId, spectator)

        spectator.send({
          type: MESSAGE_TYPES.ROOM_UPDATE,
          data: { ...this.getRoomData(specId), message: 'You have been seated at the table!' }
        })
      } else {
        spectator.isSpectator = true
        this.spectators.set(specId, spectator)
      }
    }

    this.broadcastRoomUpdate()
    this.scheduleStartHand()
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
    for (const player of this.players.values()) {
      player.send(message)
    }
    for (const spectator of this.spectators.values()) {
      spectator.send(message)
    }
  }

  scheduleStartHand(delay = 2000) {
    if (this.startHandTimeout || !this.game.canStart()) return

    this.startHandTimeout = setTimeout(() => {
      this.startHandTimeout = null
      this.game.startHand()
    }, delay)
  }

  getRoomData(forPlayerId = null) {
    const isSpectator = forPlayerId ? this.spectators.has(forPlayerId) : false

    return {
      roomId: this.roomId,
      isPrivate: this.isPrivate,
      inviteCode: this.inviteCode,
      isSpectator,
      players: this.getPlayerList(),
      spectators: this.getSpectatorList(),
      gameState: this.game.getGameState(isSpectator ? null : forPlayerId)
    }
  }

  broadcastGameState() {
    for (const player of this.players.values()) {
      player.send({
        type: MESSAGE_TYPES.GAME_STATE,
        data: this.game.getGameState(player.id)
      })
    }
    for (const spectator of this.spectators.values()) {
      spectator.send({
        type: MESSAGE_TYPES.GAME_STATE,
        data: this.game.getGameState()
      })
    }
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

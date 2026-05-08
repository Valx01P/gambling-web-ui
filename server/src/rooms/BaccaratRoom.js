import { BaccaratGame } from '../baccarat/BaccaratGame.js'
import { BACCARAT_CONFIG, MESSAGE_TYPES } from '../config/constants.js'

const TABLE_EMOTES = new Set(['angry', 'laugh', 'sad', 'shush', 'sunglasses'])

export class BaccaratRoom {
  constructor(roomId) {
    this.roomId = roomId
    this.roomType = 'baccarat'
    this.players = new Map()
    this.emoteSequence = 0
    this.game = new BaccaratGame(
      (msg) => this.broadcast(msg),
      () => this.broadcastGameState()
    )
  }

  addPlayer(player) {
    if (this.players.has(player.id)) {
      return { success: true, isSpectator: false }
    }
    if (this.players.size >= BACCARAT_CONFIG.MAX_PLAYERS) {
      return { success: false, error: 'Baccarat table is full' }
    }

    const added = this.game.addPlayer(player)
    if (!added) return { success: false, error: 'Could not join baccarat table' }

    this.players.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = false
    player.isVoluntarySpectator = false
    this.broadcastRoomUpdate()

    return { success: true, isSpectator: false }
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId)
    this.players.delete(playerId)
    if (player) {
      player.isSpectator = false
      player.isVoluntarySpectator = false
    }
    this.game.removePlayer(playerId)
    this.broadcastRoomUpdate()
  }

  handlePlayerAction(playerId, actionType, data) {
    if (actionType === MESSAGE_TYPES.BACCARAT_SET_AFK) {
      return this.game.setPlayerAfk(playerId, Boolean(data?.afk))
    }
    if (actionType !== MESSAGE_TYPES.BACCARAT_BET) {
      return { success: false, error: 'Unknown baccarat action' }
    }
    return this.game.placeBet(playerId, data?.betType, data?.amount || 0)
  }

  handlePlayerEmote(playerId, data) {
    if (!this.players.has(playerId)) {
      return { success: false, error: 'Only seated players can emote' }
    }

    const emote = String(data?.emote || '')
    const timestamp = Date.now()

    if (!TABLE_EMOTES.has(emote)) {
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

  broadcast(message) {
    for (const player of this.players.values()) {
      player.send(message)
    }
  }

  getRoomData(forPlayerId = null) {
    return {
      roomId: this.roomId,
      game: 'baccarat',
      isPrivate: false,
      inviteCode: null,
      isSpectator: false,
      players: this.getPlayerList(),
      spectators: [],
      gameState: this.game.getGameState(forPlayerId)
    }
  }

  broadcastGameState() {
    for (const player of this.players.values()) {
      player.send({
        type: MESSAGE_TYPES.GAME_STATE,
        data: this.game.getGameState(player.id)
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
  }

  getPlayerList() {
    return [...this.players.values()].map(p => p.toJSON())
  }

  isFull() {
    return this.players.size >= BACCARAT_CONFIG.MAX_PLAYERS
  }

  isEmpty() {
    return this.players.size === 0
  }

  getTotalOccupants() {
    return this.players.size
  }
}

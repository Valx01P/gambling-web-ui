import { BlackjackGame } from '../blackjack/BlackjackGame.js'
import { BLACKJACK_CONFIG, MESSAGE_TYPES } from '../config/constants.js'

const TABLE_EMOTES = new Set(['angry', 'laugh', 'sad', 'shush', 'sunglasses'])

export class BlackjackRoom {
  constructor(roomId) {
    this.roomId = roomId
    this.roomType = 'blackjack'
    this.players = new Map()
    this.emoteSequence = 0
    this.game = new BlackjackGame(
      (msg) => this.broadcast(msg),
      () => this.broadcastGameState()
    )
  }

  addPlayer(player) {
    if (this.players.has(player.id)) {
      return { success: true, isSpectator: false }
    }
    if (this.players.size >= BLACKJACK_CONFIG.MAX_PLAYERS) {
      return { success: false, error: 'Blackjack table is full' }
    }

    const added = this.game.addPlayer(player)
    if (!added) return { success: false, error: 'Could not join blackjack table' }

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
    const actionMap = {
      [MESSAGE_TYPES.BLACKJACK_BET]: 'bet',
      [MESSAGE_TYPES.BLACKJACK_HIT]: 'hit',
      [MESSAGE_TYPES.BLACKJACK_STAND]: 'stand',
      [MESSAGE_TYPES.BLACKJACK_DOUBLE]: 'double',
      [MESSAGE_TYPES.BLACKJACK_SPLIT]: 'split',
      [MESSAGE_TYPES.BLACKJACK_SURRENDER]: 'surrender',
    }

    const action = actionMap[actionType]
    if (!action) return { success: false, error: 'Unknown blackjack action' }
    if (action === 'bet') return this.game.placeBet(playerId, data?.amount || 0)
    return this.game.handleAction(playerId, action)
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
      game: 'blackjack',
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
    return this.players.size >= BLACKJACK_CONFIG.MAX_PLAYERS
  }

  isEmpty() {
    return this.players.size === 0
  }

  getTotalOccupants() {
    return this.players.size
  }
}

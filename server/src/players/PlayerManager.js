import { POKER_CONFIG } from '../config/constants.js'

export class Player {
  constructor(id, ws, username = null) {
    this.id = id
    this.ws = ws
    this.username = username || `Player_${id.substring(0, 6)}`
    this.chips = POKER_CONFIG.STARTING_CHIPS
    this.currentRoom = null
    this.isSpectator = false
    this.isConnected = true
    this.lastActiveTime = Date.now() // Track inactivity
  }

  updateActivity() {
    this.lastActiveTime = Date.now()
  }

  send(data) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(data))
    }
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      chips: this.chips,
      isSpectator: this.isSpectator,
      isConnected: this.isConnected
    }
  }
}

export class PlayerManager {
  constructor() {
    this.players = new Map()
  }

  addPlayer(id, ws, username = null) {
    const player = new Player(id, ws, username)
    this.players.set(id, player)
    return player
  }

  getPlayer(id) {
    return this.players.get(id)
  }

  deletePlayer(id) {
    this.players.delete(id)
  }

  getConnectedPlayers() {
    return [...this.players.values()].filter(p => p.isConnected)
  }
}
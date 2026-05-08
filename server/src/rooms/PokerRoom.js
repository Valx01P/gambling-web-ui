import { PokerGame } from '../poker/PokerGame.js'
import { POKER_CONFIG, MESSAGE_TYPES } from '../config/constants.js'

const TABLE_EMOTES = new Set(['angry', 'laugh', 'sad', 'shush', 'sunglasses'])

export class PokerRoom {
  constructor(roomId, isPrivate = false) {
    this.roomId = roomId
    this.isPrivate = isPrivate
    this.inviteCode = null
    this.players = new Map()    // playerId -> player (seated)
    this.spectators = new Map() // playerId -> player (watching)
    this.emoteSequence = 0
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

  addSpectator(player, options = {}) {
    if (this.spectators.has(player.id)) {
      return { success: true, isSpectator: true }
    }

    const isVoluntary = Boolean(options.voluntary)
    this.spectators.set(player.id, player)
    player.currentRoom = this.roomId
    player.isSpectator = true
    player.isVoluntarySpectator = isVoluntary

    player.send({
      type: MESSAGE_TYPES.SPECTATOR_UPDATE,
      data: {
        roomId: this.roomId,
        gameState: this.game.getGameState(null, { revealAllCards: true }),
        message: options.message || 'Table is full. Watching as spectator until a seat opens.'
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
      if (spectatorPlayer) spectatorPlayer.isVoluntarySpectator = false
    }

    // Promote a spectator to player if there's room
    if (wasPlayer && this.spectators.size > 0) {
      const promotable = [...this.spectators.entries()].find(([, spectator]) => !spectator.isVoluntarySpectator)
      if (!promotable) {
        this.broadcastRoomUpdate()
        this.scheduleStartHand()
        return
      }

      const [specId, spectator] = promotable
      this.spectators.delete(specId)
      spectator.isSpectator = false
      spectator.isVoluntarySpectator = false
      const addedToGame = this.game.addPlayer(spectator)

      if (addedToGame) {
        this.players.set(specId, spectator)

        spectator.send({
          type: MESSAGE_TYPES.ROOM_UPDATE,
          data: { ...this.getRoomData(specId), message: 'You have been seated at the table!' }
        })
      } else {
        spectator.isSpectator = true
        spectator.isVoluntarySpectator = false
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
      gameState: this.game.getGameState(isSpectator ? null : forPlayerId, { revealAllCards: isSpectator })
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
        data: this.game.getGameState(null, { revealAllCards: true })
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

  getTableSummary() {
    const state = this.game.getGameState()
    const activePlayer = state.players.find(p => p.id === state.activePlayerId)

    return {
      roomId: this.roomId,
      isPrivate: this.isPrivate,
      phase: state.phase,
      pot: state.pot,
      currentBet: state.currentBet,
      playerCount: this.players.size,
      spectatorCount: this.spectators.size,
      maxPlayers: POKER_CONFIG.MAX_PLAYERS,
      activePlayer: activePlayer ? { id: activePlayer.id, username: activePlayer.username } : null,
      communityCards: state.communityCards,
      players: state.players.map(p => ({
        id: p.id,
        username: p.username,
        avatarId: p.avatarId || null,
        avatarUrl: p.avatarUrl || null,
        chips: p.chips,
        folded: p.folded,
        allIn: p.allIn,
        waitingNextHand: p.waitingNextHand,
        lastAction: p.lastAction
      }))
    }
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

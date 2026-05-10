import { PokerRoom } from './PokerRoom.js'
import { BlackjackRoom } from './BlackjackRoom.js'
import { BaccaratRoom } from './BaccaratRoom.js'

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
  return code
}

export class RoomManager {
  constructor() {
    this.rooms = new Map()
    this.roomCounter = 0
    this.privateRooms = new Map() // code -> roomId
  }

  createRoom(isPrivate = false, options = {}) {
    this.roomCounter++
    const roomId = `${options.isArena ? 'arena' : 'poker'}_${this.roomCounter}`
    const room = new PokerRoom(roomId, isPrivate, {
      isArena: !!options.isArena,
      ownerUserId: options.ownerUserId || null,
      onArenaExpire: (expiredRoom) => this._destroyRoom(expiredRoom)
    })

    if (isPrivate) {
      let code
      do {
        code = generateRoomCode()
      } while (this.privateRooms.has(code))
      room.inviteCode = code
      this.privateRooms.set(code, roomId)
    }

    this.rooms.set(roomId, room)
    return room
  }

  createBlackjackRoom() {
    this.roomCounter++
    const roomId = `blackjack_${this.roomCounter}`
    const room = new BlackjackRoom(roomId)
    this.rooms.set(roomId, room)
    return room
  }

  createBaccaratRoom() {
    this.roomCounter++
    const roomId = `baccarat_${this.roomCounter}`
    const room = new BaccaratRoom(roomId)
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId) {
    return this.rooms.get(roomId)
  }

  findAvailableRoom() {
    for (const room of this.rooms.values()) {
      if (room.roomType === 'poker' && !room.isPrivate && !room.isFull()) return room
    }
    return this.createRoom(false)
  }

  findAvailableBlackjackRoom() {
    for (const room of this.rooms.values()) {
      if (room.roomType === 'blackjack' && !room.isFull()) return room
    }
    return this.createBlackjackRoom()
  }

  findAvailableBaccaratRoom() {
    for (const room of this.rooms.values()) {
      if (room.roomType === 'baccarat' && !room.isFull()) return room
    }
    return this.createBaccaratRoom()
  }

  joinGame(player, mode = 'general', code = null, roomId = null, game = 'poker') {
    if (player.currentRoom) {
      const currentRoom = this.getRoom(player.currentRoom)
      if (currentRoom) {
        return {
          success: true,
          isSpectator: player.isSpectator,
          room: currentRoom
        }
      }
      player.currentRoom = null
      player.isSpectator = false
    }

    let room

    if (game === 'blackjack') {
      if (mode !== 'general') return { success: false, error: 'Invalid blackjack join mode' }
      room = this.findAvailableBlackjackRoom()
    } else if (game === 'baccarat') {
      if (mode !== 'general') return { success: false, error: 'Invalid baccarat join mode' }
      room = this.findAvailableBaccaratRoom()
    } else if (mode === 'general') {
      room = this.findAvailableRoom()
    } else if (mode === 'create_private') {
      room = this.createRoom(true)
    } else if (mode === 'join_private') {
      if (!code) return { success: false, error: 'Room code required' }
      const roomId = this.privateRooms.get(code.toUpperCase())
      if (!roomId) return { success: false, error: 'Invalid room code' }
      room = this.rooms.get(roomId)
      if (!room) return { success: false, error: 'Room no longer exists' }
    } else if (mode === 'spectate') {
      if (!roomId) return { success: false, error: 'Table required' }
      room = this.rooms.get(roomId)
      if (!room) return { success: false, error: 'Table no longer exists' }
      const result = room.addSpectator(player, {
        voluntary: true,
        message: 'Joined as spectator.'
      })
      return { ...result, room }
    } else if (mode === 'bot_arena') {
      // Creating an arena requires a signed-in account — anonymous WS sockets
      // never get player.userId set, which is the gate.
      if (!player.userId) {
        return { success: false, error: 'Sign in to create a Bot Arena.', code: 'auth_required' }
      }
      // Spawn a fresh public arena room and seat the user as a spectator.
      // No human players seat in arenas — they're a bots-only sandbox.
      room = this.createRoom(false, { isArena: true, ownerUserId: player.userId })
      const result = room.addSpectator(player, {
        voluntary: true,
        message: 'Bot Arena ready. Add bots, then press Start.'
      })
      return { ...result, room }
    } else {
      return { success: false, error: 'Invalid join mode' }
    }

    const result = room.addPlayer(player)
    return { ...result, room }
  }

  leaveGame(player) {
    if (!player.currentRoom) return { success: false, error: 'Not in a room' }

    const room = this.getRoom(player.currentRoom)
    if (!room) {
      player.currentRoom = null
      player.isSpectator = false
      return { success: false, error: 'Room not found' }
    }

    room.removePlayer(player.id)
    player.currentRoom = null
    player.isSpectator = false

    if (room.isEmpty()) {
      this.rooms.delete(room.roomId)
      if (room.isPrivate && room.inviteCode) {
        this.privateRooms.delete(room.inviteCode)
      }
    }

    return { success: true }
  }

  getPlayerRoom(player) {
    if (!player.currentRoom) return null
    return this.getRoom(player.currentRoom)
  }

  // Tear down a room from outside the request flow. Arenas use this when their
  // empty-spectator timer fires — bots need to be cleared and the private code
  // (if any) released back into the pool.
  _destroyRoom(room) {
    if (!room || !this.rooms.has(room.roomId)) return
    if (typeof room.shutdown === 'function') {
      try { room.shutdown() } catch {}
    }
    this.rooms.delete(room.roomId)
    if (room.isPrivate && room.inviteCode) {
      this.privateRooms.delete(room.inviteCode)
    }
  }

  getRoomStats() {
    return {
      totalRooms: this.rooms.size,
      totalPlayers: [...this.rooms.values()].reduce((sum, r) => sum + r.getTotalOccupants(), 0)
    }
  }

  getTableList() {
    return [...this.rooms.values()]
      .filter(room => room.roomType === 'poker' && (room.players.size > 0 || (room.isArena && room.spectators.size > 0)))
      .map(room => room.getTableSummary())
      .sort((a, b) => b.playerCount - a.playerCount || a.roomId.localeCompare(b.roomId))
  }
}

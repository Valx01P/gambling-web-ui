import { PokerRoom } from './PokerRoom.js'

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

  createRoom(isPrivate = false) {
    this.roomCounter++
    const roomId = `poker_${this.roomCounter}`
    const room = new PokerRoom(roomId, isPrivate)

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

  getRoom(roomId) {
    return this.rooms.get(roomId)
  }

  findAvailableRoom() {
    for (const room of this.rooms.values()) {
      if (!room.isPrivate && !room.isFull()) return room
    }
    return this.createRoom(false)
  }

  joinGame(player, mode = 'general', code = null) {
    let room

    if (mode === 'general') {
      room = this.findAvailableRoom()
    } else if (mode === 'create_private') {
      room = this.createRoom(true)
    } else if (mode === 'join_private') {
      if (!code) return { success: false, error: 'Room code required' }
      const roomId = this.privateRooms.get(code.toUpperCase())
      if (!roomId) return { success: false, error: 'Invalid room code' }
      room = this.rooms.get(roomId)
      if (!room) return { success: false, error: 'Room no longer exists' }
    } else {
      return { success: false, error: 'Invalid join mode' }
    }

    const result = room.addPlayer(player)
    return { ...result, room }
  }

  leaveGame(player) {
    if (!player.currentRoom) return { success: false, error: 'Not in a room' }

    const room = this.getRoom(player.currentRoom)
    if (!room) return { success: false, error: 'Room not found' }

    room.removePlayer(player.id)
    player.currentRoom = null

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

  getRoomStats() {
    return {
      totalRooms: this.rooms.size,
      totalPlayers: [...this.rooms.values()].reduce((sum, r) => sum + r.getTotalOccupants(), 0)
    }
  }
}
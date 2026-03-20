import { PokerRoom } from './PokerRoom.js'

export class RoomManager {
  constructor() {
    this.rooms = new Map()
    this.roomCounter = 0
  }

  createRoom() {
    this.roomCounter++
    const roomId = `poker_${this.roomCounter}`
    const room = new PokerRoom(roomId)
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId) {
    return this.rooms.get(roomId)
  }

  findAvailableRoom() {
    for (const room of this.rooms.values()) {
      if (!room.isFull()) return room
    }
    return this.createRoom()
  }

  joinGame(player) {
    const room = this.findAvailableRoom()
    const result = room.addPlayer(player)
    return { ...result, room }
  }

  leaveGame(player) {
    if (!player.currentRoom) return { success: false, error: 'Not in a room' }

    const room = this.getRoom(player.currentRoom)
    if (!room) return { success: false, error: 'Room not found' }

    room.removePlayer(player.id)
    player.currentRoom = null

    if (room.isEmpty()) this.rooms.delete(room.roomId)

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
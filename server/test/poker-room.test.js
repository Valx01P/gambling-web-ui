import test from 'node:test'
import assert from 'node:assert/strict'
import { PokerRoom } from '../src/rooms/PokerRoom.js'
import { MESSAGE_TYPES } from '../src/config/constants.js'

function makePlayer(id) {
  return {
    id,
    username: id,
    chips: 1000,
    currentRoom: null,
    isSpectator: false,
    isConnected: true,
    messages: [],
    send(message) {
      this.messages.push(message)
    },
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
}

function clearRoomStartTimer(room) {
  clearTimeout(room.startHandTimeout)
  room.startHandTimeout = null
}

function addPlayers(room, count) {
  const players = []

  for (let i = 0; i < count; i++) {
    const player = makePlayer(String.fromCharCode(65 + i))
    room.addPlayer(player)
    players.push(player)
  }

  clearRoomStartTimer(room)
  return players
}

function startHand(room) {
  clearRoomStartTimer(room)
  assert.equal(room.game.startHand(), true)
  clearRoomStartTimer(room)
}

test('caps a table at five seated players and makes the sixth a spectator', () => {
  const room = new PokerRoom('room')
  const players = addPlayers(room, 5)
  const sixth = makePlayer('F')

  const result = room.addPlayer(sixth)
  clearRoomStartTimer(room)

  assert.equal(result.success, true)
  assert.equal(result.isSpectator, true)
  assert.equal(room.players.size, 5)
  assert.equal(room.spectators.size, 1)
  assert.deepEqual([...room.players.keys()], players.map(p => p.id))
  assert.equal(sixth.isSpectator, true)
})

test('lets a preflop joiner enter the current hand before any player action', () => {
  const room = new PokerRoom('room')
  const [first, second] = addPlayers(room, 2)
  startHand(room)

  const joiner = makePlayer('C')
  const result = room.addPlayer(joiner)
  clearRoomStartTimer(room)

  const joinerState = room.game.getGameState(joiner.id)
  const publicState = room.game.getGameState(first.id)
  const joinedPlayer = joinerState.players.find(p => p.id === joiner.id)
  const publicJoiner = publicState.players.find(p => p.id === joiner.id)

  assert.equal(result.success, true)
  assert.equal(result.isSpectator, false)
  assert.equal(room.players.size, 3)
  assert.equal(joinedPlayer.waitingNextHand, false)
  assert.equal(joinedPlayer.folded, false)
  assert.equal(joinedPlayer.cards.length, 2)
  assert.deepEqual(publicJoiner.cards, [null, null])
  assert.equal(second.isSpectator, false)
})

test('puts a joiner in waiting state once preflop action has started', () => {
  const room = new PokerRoom('room')
  addPlayers(room, 2)
  startHand(room)

  const activePlayerId = room.game.getGameState().activePlayerId
  assert.equal(room.handlePlayerAction(activePlayerId, MESSAGE_TYPES.POKER_CALL).success, true)

  const joiner = makePlayer('C')
  const result = room.addPlayer(joiner)
  clearRoomStartTimer(room)

  const joinerState = room.game.getGameState(joiner.id)
  const joinedPlayer = joinerState.players.find(p => p.id === joiner.id)

  assert.equal(result.success, true)
  assert.equal(result.isSpectator, false)
  assert.equal(room.players.size, 3)
  assert.equal(joinedPlayer.waitingNextHand, true)
  assert.equal(joinedPlayer.folded, true)
  assert.deepEqual(joinedPlayer.cards, [])
  assert.equal(room.handlePlayerAction(joiner.id, MESSAGE_TYPES.POKER_CALL).success, false)
})

test('keeps replacement players visible when a full-table player leaves mid-hand', () => {
  const room = new PokerRoom('room')
  const players = addPlayers(room, 5)
  startHand(room)

  const activePlayerId = room.game.getGameState().activePlayerId
  assert.equal(room.handlePlayerAction(activePlayerId, MESSAGE_TYPES.POKER_CALL).success, true)

  players[0].isConnected = false
  room.removePlayer(players[0].id)

  const replacement = makePlayer('F')
  const result = room.addPlayer(replacement)
  clearRoomStartTimer(room)

  const replacementState = room.game.getGameState(replacement.id)
  const visibleIds = replacementState.players.map(p => p.id)
  const replacementSeat = replacementState.players.find(p => p.id === replacement.id)

  assert.equal(result.success, true)
  assert.equal(result.isSpectator, false)
  assert.equal(room.players.size, 5)
  assert.equal(room.spectators.size, 0)
  assert.equal(visibleIds.length, 5)
  assert.equal(visibleIds.includes(players[0].id), false)
  assert.equal(visibleIds.includes(replacement.id), true)
  assert.equal(replacementSeat.waitingNextHand, true)
  assert.equal(replacementSeat.cards.length, 0)
})

test('leaving a hand removes the table seat without disconnecting the socket player', () => {
  const firstRoom = new PokerRoom('first')
  const players = addPlayers(firstRoom, 3)
  const leaver = players[1]
  startHand(firstRoom)

  firstRoom.removePlayer(leaver.id)
  clearRoomStartTimer(firstRoom)

  const secondRoom = new PokerRoom('second')
  const result = secondRoom.addPlayer(leaver)
  clearRoomStartTimer(secondRoom)

  assert.equal(leaver.isConnected, true)
  assert.equal(result.success, true)
  assert.equal(result.isSpectator, false)
  assert.equal(firstRoom.players.has(leaver.id), false)
  assert.equal(firstRoom.game.getGameState().players.some(p => p.id === leaver.id), false)
  assert.equal(secondRoom.players.has(leaver.id), true)
})

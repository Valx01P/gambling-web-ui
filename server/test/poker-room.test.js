import test from 'node:test'
import assert from 'node:assert/strict'
import { PokerRoom } from '../src/rooms/PokerRoom.js'
import { RoomManager } from '../src/rooms/RoomManager.js'
import { MESSAGE_TYPES, POKER_CONFIG } from '../src/config/constants.js'

function makePlayer(id) {
  return {
    id,
    username: id,
    avatarId: 'op1',
    avatarUrl: 'https://i.ibb.co/Wpf6XVp0/image.png',
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
        avatarId: this.avatarId,
        avatarUrl: this.avatarUrl,
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

test('voluntary spectators do not count toward seats or auto-promote', () => {
  const room = new PokerRoom('room')
  const players = addPlayers(room, 5)
  const spectator = makePlayer('S')

  const result = room.addSpectator(spectator, { voluntary: true })
  clearRoomStartTimer(room)

  assert.equal(result.success, true)
  assert.equal(result.isSpectator, true)
  assert.equal(room.players.size, 5)
  assert.equal(room.spectators.size, 1)
  assert.equal(spectator.isVoluntarySpectator, true)

  room.removePlayer(players[0].id)
  clearRoomStartTimer(room)

  assert.equal(room.players.size, 4)
  assert.equal(room.spectators.size, 1)
  assert.equal(room.spectators.has(spectator.id), true)
  assert.equal(spectator.isSpectator, true)
})

test('voluntary spectators receive revealable cards while seated players do not', () => {
  const room = new PokerRoom('room')
  const [first, second] = addPlayers(room, 2)
  startHand(room)

  const spectator = makePlayer('S')
  room.addSpectator(spectator, { voluntary: true })
  clearRoomStartTimer(room)

  const firstView = room.getRoomData(first.id).gameState
  const spectatorView = room.getRoomData(spectator.id).gameState
  const firstSeesSecond = firstView.players.find(player => player.id === second.id)
  const spectatorSeesPlayers = spectatorView.players.filter(player => [first.id, second.id].includes(player.id))

  assert.deepEqual(firstSeesSecond.cards, [null, null])
  assert.equal(spectatorView.players.length, 2)
  assert.equal(spectatorSeesPlayers.every(player =>
    player.cards.length === 2 &&
    player.cards.every(card => card?.rank && card?.suit)
  ), true)
})

test('room manager lists occupied tables and joins selected table as voluntary spectator', () => {
  const manager = new RoomManager()
  const room = manager.createRoom()
  const [first, second] = [makePlayer('A'), makePlayer('B')]
  const spectator = makePlayer('S')

  room.addPlayer(first)
  room.addPlayer(second)
  clearRoomStartTimer(room)

  const tables = manager.getTableList()
  const result = manager.joinGame(spectator, 'spectate', null, room.roomId)
  clearRoomStartTimer(room)

  assert.equal(tables.length, 1)
  assert.equal(tables[0].roomId, room.roomId)
  assert.equal(tables[0].playerCount, 2)
  assert.equal(result.success, true)
  assert.equal(result.isSpectator, true)
  assert.equal(room.players.size, 2)
  assert.equal(room.spectators.size, 1)
  assert.equal(spectator.currentRoom, room.roomId)
  assert.equal(spectator.isVoluntarySpectator, true)
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

test('does not throw chips when calling the opening raise', () => {
  const room = new PokerRoom('room')
  const [first, second] = addPlayers(room, 3)
  startHand(room)

  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.POKER_RAISE, { amount: 20 }).success, true)
  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.POKER_CALL).success, true)

  const secondState = room.game.getGameState(second.id).players.find(p => p.id === second.id)
  const chipThrowMessages = second.messages.filter(message => message.type === MESSAGE_TYPES.CHIP_THROW)

  assert.equal(secondState.lastAction.action, 'call')
  assert.equal(secondState.lastAction.chipThrow, false)
  assert.equal(chipThrowMessages.length, 0)
})

test('throws chips when calling a re-raise', () => {
  const room = new PokerRoom('room')
  const [first, second, third] = addPlayers(room, 3)
  startHand(room)

  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.POKER_RAISE, { amount: 20 }).success, true)
  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.POKER_RAISE, { amount: 40 }).success, true)
  assert.equal(room.handlePlayerAction(third.id, MESSAGE_TYPES.POKER_CALL).success, true)

  const thirdState = room.game.getGameState(third.id).players.find(p => p.id === third.id)
  const chipThrowMessages = third.messages.filter(message => message.type === MESSAGE_TYPES.CHIP_THROW)
  const chipThrow = chipThrowMessages.at(-1)

  assert.equal(thirdState.lastAction.action, 'call')
  assert.equal(thirdState.lastAction.chipThrow, true)
  assert.equal(chipThrowMessages.length, 1)
  assert.equal(chipThrow.data.playerId, third.id)
  assert.equal(chipThrow.data.amount, 30)
  assert.equal(chipThrow.data.stackAmount, 40)
  assert.equal(typeof chipThrow.data.seed, 'string')
})

test('throws chips when calling an all-in raise', () => {
  const room = new PokerRoom('room')
  const [first, second] = addPlayers(room, 3)
  startHand(room)

  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.POKER_ALL_IN).success, true)
  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.POKER_CALL).success, true)

  const secondState = room.game.getGameState(second.id).players.find(p => p.id === second.id)
  const chipThrowMessages = second.messages.filter(message => message.type === MESSAGE_TYPES.CHIP_THROW)
  const chipThrow = chipThrowMessages.at(-1)

  assert.equal(secondState.lastAction.action, 'call')
  assert.equal(secondState.lastAction.chipThrow, true)
  assert.equal(chipThrowMessages.length, 1)
  assert.equal(chipThrow.data.playerId, second.id)
  assert.equal(chipThrow.data.amount, 995)
  assert.equal(chipThrow.data.stackAmount, 1000)
  assert.equal(typeof chipThrow.data.seed, 'string')
})

test('tracks poker profit through automatic rebuys', () => {
  // Verifies the auto-rebuy flow: chips drained to 0 → rebuy adds
  // STARTING_CHIPS back, pokerBuyIn rises by the same amount, and the
  // resulting P/L is exactly −STARTING_CHIPS (one rebuy worth of loss).
  // Values track POKER_CONFIG so a balance tweak doesn't break the test.
  const SC = POKER_CONFIG.STARTING_CHIPS
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 2)

  player.chips = 0
  assert.equal(player.pokerBuyIn, SC)
  assert.equal(room.game.rebuyIfNeeded(player), true)

  const playerState = room.game.getGameState(player.id).players.find(p => p.id === player.id)

  assert.equal(player.chips, SC)
  assert.equal(player.pokerBuyIn, 2 * SC)
  assert.equal(playerState.buyIn, 2 * SC)
  assert.equal(playerState.profit, -SC)
})

test('keeps all-in cards hidden until pending callers have acted', () => {
  const room = new PokerRoom('room')
  addPlayers(room, 2)
  startHand(room)

  const activePlayerId = room.game.getGameState().activePlayerId
  const caller = room.game.players.find(player => player.id !== activePlayerId)

  assert.equal(room.handlePlayerAction(activePlayerId, MESSAGE_TYPES.POKER_ALL_IN).success, true)

  const callerView = room.game.getGameState(caller.id)
  const allInPlayer = callerView.players.find(player => player.id === activePlayerId)

  assert.equal(callerView.runoutLocked, false)
  assert.deepEqual(allInPlayer.cards, [null, null])
})

test('reveals active hands during an all-in runout', () => {
  const room = new PokerRoom('room')
  addPlayers(room, 2)
  startHand(room)

  const activePlayerId = room.game.getGameState().activePlayerId
  const caller = room.game.players.find(player => player.id !== activePlayerId)

  assert.equal(room.handlePlayerAction(activePlayerId, MESSAGE_TYPES.POKER_ALL_IN).success, true)
  assert.equal(room.handlePlayerAction(caller.id, MESSAGE_TYPES.POKER_CALL).success, true)
  clearTimeout(room.game.runOutBoardTimeout)

  const state = room.game.getGameState(activePlayerId)
  const activePlayers = state.players.filter(player => !player.folded && !player.waitingNextHand)

  assert.equal(state.runoutLocked, true)
  assert.equal(state.phase, 'preflop')
  assert.equal(state.communityCards.length, 0)
  assert.equal(activePlayers.length, 2)
  assert.equal(activePlayers.every(player =>
    player.cards.length === 2 &&
    player.cards.every(card => card?.rank && card?.suit)
  ), true)
})

test('broadcasts player emotes without requiring it to be their turn', () => {
  const room = new PokerRoom('room')
  addPlayers(room, 3)
  startHand(room)

  const activePlayerId = room.game.getGameState().activePlayerId
  assert.equal(room.handlePlayerEmote(activePlayerId, { emote: 'angry' }).success, true)

  const activePlayer = [...room.players.values()].find(player => player.id === activePlayerId)
  const emoteMessage = activePlayer.messages
    .filter(message => message.type === MESSAGE_TYPES.PLAYER_EMOTE)
    .at(-1)

  assert.equal(emoteMessage.data.playerId, activePlayerId)
  assert.equal(emoteMessage.data.emote, 'angry')
  assert.equal(typeof emoteMessage.data.emoteId, 'string')
})

test('lets seated players emote before a hand starts', () => {
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 2)

  const result = room.handlePlayerEmote(player.id, { emote: 'sad' })
  const emoteMessage = player.messages
    .filter(message => message.type === MESSAGE_TYPES.PLAYER_EMOTE)
    .at(-1)

  assert.equal(result.success, true)
  assert.equal(emoteMessage.data.playerId, player.id)
  assert.equal(emoteMessage.data.emote, 'sad')
})

test('broadcasts every repeated emote with a unique id', () => {
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 3)
  startHand(room)

  assert.equal(room.handlePlayerEmote(player.id, { emote: 'laugh' }).success, true)
  assert.equal(room.handlePlayerEmote(player.id, { emote: 'laugh' }).success, true)

  const emoteMessages = player.messages.filter(message =>
    message.type === MESSAGE_TYPES.PLAYER_EMOTE &&
    message.data.emote === 'laugh'
  )

  assert.equal(emoteMessages.length, 2)
  assert.notEqual(emoteMessages[0].data.emoteId, emoteMessages[1].data.emoteId)
})

test('accepts the eggplant table emote', () => {
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 2)

  const result = room.handlePlayerEmote(player.id, { emote: 'eggplant' })
  const emoteMessage = player.messages
    .filter(message => message.type === MESSAGE_TYPES.PLAYER_EMOTE)
    .at(-1)

  assert.equal(result.success, true)
  assert.equal(emoteMessage.data.playerId, player.id)
  assert.equal(emoteMessage.data.emote, 'eggplant')
})

test('rejects unknown emotes', () => {
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 2)

  const result = room.handlePlayerEmote(player.id, { emote: 'not-real' })

  assert.equal(result.success, false)
  assert.equal(player.messages.some(message => message.type === MESSAGE_TYPES.PLAYER_EMOTE), false)
})

test('broadcasts every repeated yell with a unique id', () => {
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 3)
  startHand(room)

  assert.equal(room.handlePlayerYell(player.id, { message: 'run it twice' }).success, true)
  assert.equal(room.handlePlayerYell(player.id, { message: 'run it twice' }).success, true)

  const yellMessages = player.messages.filter(message =>
    message.type === MESSAGE_TYPES.PLAYER_YELL &&
    message.data.message === 'run it twice'
  )

  assert.equal(yellMessages.length, 2)
  assert.equal(yellMessages[0].data.playerId, player.id)
  assert.equal(yellMessages[0].data.username, player.username)
  assert.notEqual(yellMessages[0].data.yellId, yellMessages[1].data.yellId)
})

test('rejects empty yells', () => {
  const room = new PokerRoom('room')
  const [player] = addPlayers(room, 2)

  const result = room.handlePlayerYell(player.id, { message: '   ' })

  assert.equal(result.success, false)
  assert.equal(player.messages.some(message => message.type === MESSAGE_TYPES.PLAYER_YELL), false)
})

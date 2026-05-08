import test from 'node:test'
import assert from 'node:assert/strict'
import { BaccaratRoom } from '../src/rooms/BaccaratRoom.js'
import { RoomManager } from '../src/rooms/RoomManager.js'
import { MESSAGE_TYPES } from '../src/config/constants.js'

function makePlayer(id) {
  return {
    id,
    username: id,
    avatarId: 'op1',
    avatarUrl: 'https://i.ibb.co/Wpf6XVp0/image.png',
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
        chips: this.baccaratChips,
        isSpectator: this.isSpectator,
        isConnected: this.isConnected
      }
    }
  }
}

function card(rank, suit = 'hearts') {
  return { rank, suit }
}

function addPlayers(room, count) {
  const players = []
  for (let i = 0; i < count; i++) {
    const player = makePlayer(String.fromCharCode(65 + i))
    const result = room.addPlayer(player)
    assert.equal(result.success, true)
    players.push(player)
  }
  room.game.clearTimers()
  return players
}

function stubDeck(room, cards) {
  const drawOrder = [...cards]
  room.game.deck.reset = () => {}
  room.game.deck.draw = () => drawOrder.shift()
}

test('baccarat tables seat up to five players and reject the sixth', () => {
  const room = new BaccaratRoom('baccarat')
  addPlayers(room, 5)
  const sixth = makePlayer('F')

  const result = room.addPlayer(sixth)

  assert.equal(result.success, false)
  assert.equal(room.players.size, 5)
  assert.equal(sixth.currentRoom, null)
})

test('baccarat players start with 1000 chips and can bet on banker', () => {
  const room = new BaccaratRoom('baccarat')
  const [player] = addPlayers(room, 1)

  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'banker', amount: 50 }).success, true)
  room.game.clearTimers()

  const state = room.game.getGameState()
  const playerState = state.players.find(p => p.id === player.id)

  assert.equal(playerState.chips, 950)
  assert.equal(playerState.profit, -50)
  assert.equal(playerState.bet.type, 'banker')
  assert.equal(playerState.bet.amount, 50)
})

test('baccarat waits for all seated players to bet before revealing cards', () => {
  const room = new BaccaratRoom('baccarat')
  const [first, second] = addPlayers(room, 2)

  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'player', amount: 25 }).success, true)
  room.game.clearTimers()
  assert.equal(room.game.getGameState().phase, 'betting')

  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'banker', amount: 25 }).success, true)
  room.game.clearTimers()

  stubDeck(room, [card('4'), card('3'), card('A'), card('2'), card('9')])
  room.game.phase = 'dealing'
  room.game.dealRound()
  room.game.clearTimers()

  let state = room.game.getGameState()

  assert.equal(state.phase, 'dealing')
  assert.equal(state.playerHand.cards.length, 2)
  assert.equal(state.bankerHand.cards.length, 2)
  assert.equal(state.playerHand.cards.filter(Boolean).length, 0)
  assert.equal(state.bankerHand.cards.filter(Boolean).length, 0)

  room.game.revealInitialCard(0)
  room.game.clearTimers()
  state = room.game.getGameState()
  assert.equal(state.phase, 'reveal_player')
  assert.equal(state.playerHand.cards.filter(Boolean).length, 1)
  assert.equal(state.bankerHand.cards.filter(Boolean).length, 0)

  room.game.revealInitialCard(1)
  room.game.clearTimers()
  room.game.revealInitialCard(2)
  room.game.clearTimers()
  room.game.revealInitialCard(3)
  room.game.clearTimers()
  state = room.game.getGameState()
  assert.equal(state.phase, 'reveal_banker')
  assert.equal(state.playerHand.cards.length, 2)
  assert.equal(state.bankerHand.cards.length, 2)
  assert.equal(state.playerHand.cards.filter(Boolean).length, 2)
  assert.equal(state.bankerHand.cards.filter(Boolean).length, 2)

  room.game.afterInitialReveal()
  room.game.clearTimers()
  state = room.game.getGameState()
  assert.equal(state.phase, 'reveal_third')
  assert.equal(state.playerHand.cards.length, 3)
  assert.equal(state.bankerHand.cards.length, 2)
  assert.equal(state.playerHand.cards.filter(Boolean).length, 3)
})

test('baccarat settles player, banker, and tie payouts correctly', () => {
  const room = new BaccaratRoom('baccarat')
  const [playerBet, bankerBet, tieBet] = addPlayers(room, 3)

  assert.equal(room.handlePlayerAction(playerBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'player', amount: 100 }).success, true)
  assert.equal(room.handlePlayerAction(bankerBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'banker', amount: 100 }).success, true)
  assert.equal(room.handlePlayerAction(tieBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'tie', amount: 100 }).success, true)
  room.game.clearTimers()

  room.game.phase = 'reveal_banker'
  room.game.playerHand = [card('4'), card('4')]
  room.game.bankerHand = [card('3'), card('3')]
  room.game.settleRound()
  room.game.clearTimers()

  assert.equal(playerBet.baccaratChips, 1100)
  assert.equal(bankerBet.baccaratChips, 900)
  assert.equal(tieBet.baccaratChips, 900)

  room.game.prepareNextRound()
  assert.equal(room.handlePlayerAction(playerBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'player', amount: 100 }).success, true)
  assert.equal(room.handlePlayerAction(bankerBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'banker', amount: 100 }).success, true)
  assert.equal(room.handlePlayerAction(tieBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'tie', amount: 100 }).success, true)
  room.game.clearTimers()

  room.game.phase = 'reveal_banker'
  room.game.playerHand = [card('2'), card('2')]
  room.game.bankerHand = [card('4'), card('4')]
  room.game.settleRound()
  room.game.clearTimers()

  assert.equal(bankerBet.baccaratChips, 995)

  room.game.prepareNextRound()
  assert.equal(room.handlePlayerAction(playerBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'player', amount: 100 }).success, true)
  assert.equal(room.handlePlayerAction(bankerBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'banker', amount: 100 }).success, true)
  assert.equal(room.handlePlayerAction(tieBet.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'tie', amount: 100 }).success, true)
  room.game.clearTimers()

  room.game.phase = 'reveal_banker'
  room.game.playerHand = [card('7'), card('2')]
  room.game.bankerHand = [card('4'), card('5')]
  room.game.settleRound()
  room.game.clearTimers()

  assert.equal(playerBet.baccaratChips, 1000)
  assert.equal(bankerBet.baccaratChips, 995)
  assert.equal(tieBet.baccaratChips, 1600)
})

test('baccarat reloads players below the table minimum before betting', () => {
  const room = new BaccaratRoom('baccarat')
  const [player] = addPlayers(room, 1)

  player.baccaratChips = 5
  player.baccaratBuyIn = 1000
  player.baccaratProfit = -995
  room.game.phase = 'settle'

  room.game.prepareNextRound()
  room.game.clearTimers()
  const state = room.game.getGameState()
  const playerState = state.players.find(p => p.id === player.id)

  assert.equal(playerState.chips, 1005)
  assert.equal(playerState.profit, -995)
  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'player', amount: 10 }).success, true)
  room.game.clearTimers()
})

test('baccarat sitting out players do not block betting rounds', () => {
  const room = new BaccaratRoom('baccarat')
  const [first, second] = addPlayers(room, 2)

  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.BACCARAT_SET_AFK, { afk: true }).success, true)
  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.BACCARAT_BET, { betType: 'player', amount: 25 }).success, true)
  room.game.clearTimers()

  stubDeck(room, [card('4'), card('3'), card('A'), card('2'), card('9')])
  room.game.dealRound()
  room.game.clearTimers()

  const state = room.game.getGameState()
  const firstState = state.players.find(player => player.id === first.id)
  const secondState = state.players.find(player => player.id === second.id)

  assert.equal(state.phase, 'dealing')
  assert.equal(firstState.bet.amount, 25)
  assert.equal(secondState.sittingOut, true)
  assert.equal(secondState.bet, null)
})

test('room manager can find baccarat rooms separately from other games', () => {
  const manager = new RoomManager()
  const player = makePlayer('A')

  const result = manager.joinGame(player, 'general', null, null, 'baccarat')

  assert.equal(result.success, true)
  assert.equal(result.room.roomType, 'baccarat')
  assert.equal(result.room.players.size, 1)
})

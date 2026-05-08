import test from 'node:test'
import assert from 'node:assert/strict'
import { BlackjackRoom } from '../src/rooms/BlackjackRoom.js'
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
        chips: this.blackjackChips,
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

test('blackjack tables seat up to five players and reject the sixth', () => {
  const room = new BlackjackRoom('blackjack')
  addPlayers(room, 5)
  const sixth = makePlayer('F')

  const result = room.addPlayer(sixth)

  assert.equal(result.success, false)
  assert.equal(room.players.size, 5)
  assert.equal(sixth.currentRoom, null)
})

test('blackjack players start with 1000 chips and can place bets', () => {
  const room = new BlackjackRoom('blackjack')
  const [player] = addPlayers(room, 1)

  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 50 }).success, true)
  room.game.clearTimers()

  const state = room.game.getGameState()
  const playerState = state.players.find(p => p.id === player.id)

  assert.equal(playerState.chips, 950)
  assert.equal(playerState.profit, -50)
  assert.equal(playerState.hands[0].bet, 50)
})

test('blackjack round deals after all seated players bet', () => {
  const room = new BlackjackRoom('blackjack')
  const [first, second] = addPlayers(room, 2)

  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 25 }).success, true)
  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 25 }).success, true)
  room.game.clearTimers()
  room.game.dealRound()

  const state = room.game.getGameState()

  assert.equal(state.phase, 'playing')
  assert.equal(state.dealer.cards.length, 2)
  assert.equal(state.dealer.cards[1], null)
  assert.equal(state.players.every(player => player.hands[0].cards.length === 2), true)
})

test('blackjack dealer natural reveals and settles before player action', () => {
  const room = new BlackjackRoom('blackjack')
  const [player] = addPlayers(room, 1)

  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 100 }).success, true)
  room.game.clearTimers()
  const drawOrder = [card('10'), card('9'), card('A'), card('K')]
  room.game.deck.reset = () => {}
  room.game.deck.draw = () => drawOrder.shift()

  room.game.dealRound()
  room.game.clearTimers()

  let state = room.game.getGameState()
  assert.equal(state.phase, 'dealer')
  assert.equal(state.currentPlayerId, null)
  assert.equal(state.dealer.hidden, false)
  assert.equal(state.dealer.value, 21)
  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_HIT).success, false)

  room.game.settleRound()
  room.game.clearTimers()
  state = room.game.getGameState()
  const playerState = state.players.find(p => p.id === player.id)

  assert.equal(state.phase, 'settle')
  assert.equal(playerState.hands[0].result, 'lose')
  assert.equal(playerState.chips, 900)
  assert.equal(playerState.profit, -100)
})

test('blackjack mid-round joiners wait for the next hand', () => {
  const room = new BlackjackRoom('blackjack')
  const [first] = addPlayers(room, 1)

  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 25 }).success, true)
  room.game.clearTimers()

  const second = makePlayer('B')
  assert.equal(room.addPlayer(second).success, true)

  let state = room.game.getGameState()
  let secondState = state.players.find(player => player.id === second.id)

  assert.equal(secondState.waitingNextRound, true)
  assert.equal(secondState.hands.length, 0)
  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 25 }).success, false)

  room.game.dealRound()
  state = room.game.getGameState()
  secondState = state.players.find(player => player.id === second.id)
  assert.equal(secondState.hands.length, 0)

  room.game.phase = 'settle'
  room.game.prepareNextRound()
  state = room.game.getGameState()
  secondState = state.players.find(player => player.id === second.id)
  assert.equal(secondState.waitingNextRound, false)
})

test('blackjack sitting out players do not block betting rounds', () => {
  const room = new BlackjackRoom('blackjack')
  const [first, second] = addPlayers(room, 2)

  assert.equal(room.handlePlayerAction(second.id, MESSAGE_TYPES.BLACKJACK_SET_AFK, { afk: true }).success, true)
  assert.equal(room.handlePlayerAction(first.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 25 }).success, true)
  room.game.clearTimers()
  const drawOrder = [card('5'), card('6'), card('9'), card('7')]
  room.game.deck.reset = () => {}
  room.game.deck.draw = () => drawOrder.shift()
  room.game.dealRound()

  const state = room.game.getGameState()
  const firstState = state.players.find(player => player.id === first.id)
  const secondState = state.players.find(player => player.id === second.id)

  assert.equal(state.phase, 'playing')
  assert.equal(firstState.hands[0].cards.length, 2)
  assert.equal(secondState.sittingOut, true)
  assert.equal(secondState.hands.length, 0)
})

test('blackjack supports splitting once into two hands', () => {
  const room = new BlackjackRoom('blackjack')
  const [player] = addPlayers(room, 1)

  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 100 }).success, true)
  room.game.clearTimers()
  room.game.phase = 'playing'
  room.game.currentPlayerIndex = 0
  room.game.currentHandIndex = 0
  room.game.playerHands.set(player.id, [{
    id: 'A-1',
    cards: [card('8'), card('8', 'spades')],
    bet: 100,
    status: 'active',
    result: null,
    payout: 0,
    doubled: false,
    split: false,
    surrendered: false,
  }])

  const result = room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_SPLIT)
  const hands = room.game.playerHands.get(player.id)

  assert.equal(result.success, true)
  assert.equal(hands.length, 2)
  assert.equal(hands.every(hand => hand.bet === 100), true)
  assert.equal(player.blackjackChips, 800)
})

test('blackjack double down doubles the bet and advances the hand', () => {
  const room = new BlackjackRoom('blackjack')
  const [player] = addPlayers(room, 1)

  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 100 }).success, true)
  room.game.clearTimers()
  room.game.phase = 'playing'
  room.game.currentPlayerIndex = 0
  room.game.currentHandIndex = 0
  room.game.dealerHand = [card('9'), card('7')]
  room.game.playerHands.get(player.id)[0].cards = [card('5'), card('6')]

  const result = room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_DOUBLE)
  const hand = room.game.playerHands.get(player.id)[0]

  assert.equal(result.success, true)
  assert.equal(hand.bet, 200)
  assert.equal(hand.cards.length, 3)
  assert.equal(player.blackjackChips, 800)
})

test('blackjack settlement updates chips, profit, and reloads broke players', () => {
  const room = new BlackjackRoom('blackjack')
  const [player] = addPlayers(room, 1)

  player.blackjackChips = 0
  player.blackjackBuyIn = 1000
  room.game.phase = 'dealer'
  room.game.dealerHand = [card('10'), card('9')]
  room.game.playerHands.set(player.id, [{
    id: 'A-1',
    cards: [card('10'), card('8')],
    bet: 1000,
    status: 'stood',
    result: null,
    payout: 0,
    doubled: false,
    split: false,
    surrendered: false,
  }])

  room.game.settleRound()
  room.game.clearTimers()

  assert.equal(player.blackjackChips, 1000)
  assert.equal(player.blackjackBuyIn, 2000)
  assert.equal(player.blackjackProfit, -1000)
  assert.equal(player.messages.some(message => message.type === MESSAGE_TYPES.SYSTEM_MESSAGE), true)
})

test('blackjack reloads players below the table minimum before betting', () => {
  const room = new BlackjackRoom('blackjack')
  const [player] = addPlayers(room, 1)

  player.blackjackChips = 9
  player.blackjackBuyIn = 1000
  player.blackjackProfit = -991
  room.game.phase = 'settle'

  room.game.prepareNextRound()
  room.game.clearTimers()
  const state = room.game.getGameState()
  const playerState = state.players.find(p => p.id === player.id)

  assert.equal(state.phase, 'betting')
  assert.equal(playerState.chips, 1009)
  assert.equal(playerState.profit, -991)
  assert.equal(player.messages.some(message => message.type === MESSAGE_TYPES.SYSTEM_MESSAGE), true)
  assert.equal(room.handlePlayerAction(player.id, MESSAGE_TYPES.BLACKJACK_BET, { amount: 10 }).success, true)
  room.game.clearTimers()
})

test('room manager can find blackjack rooms separately from poker rooms', () => {
  const manager = new RoomManager()
  const player = makePlayer('A')

  const result = manager.joinGame(player, 'general', null, null, 'blackjack')

  assert.equal(result.success, true)
  assert.equal(result.room.roomType, 'blackjack')
  assert.equal(result.room.players.size, 1)
})

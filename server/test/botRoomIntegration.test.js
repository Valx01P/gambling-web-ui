import test from 'node:test'
import assert from 'node:assert/strict'
import { PokerRoom } from '../src/rooms/PokerRoom.js'
import { defaultRules } from '../src/bots/ruleSchema.js'

// Minimal stand-in for the websocket Player class — enough to seat a human alongside bots.
function makeFakePlayer(id, name) {
  return {
    id,
    username: name,
    chips: 1000,
    pokerBuyIn: 1000,
    avatarId: null,
    avatarUrl: null,
    isConnected: true,
    isSpectator: false,
    isBot: false,
    currentRoom: null,
    inbox: [],
    send(msg) { this.inbox.push(msg) },
    updateActivity() {},
    setProfileAvatar() { return false },
    toJSON() {
      return { id: this.id, username: this.username, chips: this.chips, isConnected: true, isSpectator: false }
    }
  }
}

function botRecord(name, color) {
  return {
    id: `bot-rec-${name}`,
    name,
    color,
    rules: defaultRules(),
    phrases: { fold: ['nope'], raise: ['lets go'], all_in: ['SHIPPED'] },
    isPublic: true,
    elo: 1200,
    ownerDisplayName: 'Tester',
    ownerUserId: 'u-1',
    stats: { handsPlayed: 0, handsWon: 0 }
  }
}

test('two bots play a hand to completion without stalling', async () => {
  const room = new PokerRoom('test-room', false)
  const human = makeFakePlayer('h1', 'Human')

  // Seat human first
  room.addPlayer(human)

  // Add two bots to the room
  const r1 = room.addBotForPlayer(human.id, botRecord('Alpha', '#22c55e'))
  assert.equal(r1.success, true, 'first bot added')
  const r2 = room.addBotForPlayer(human.id, botRecord('Beta', '#3b82f6'))
  assert.equal(r2.success, true, 'second bot added')

  assert.equal(room.players.size, 3, 'room has 3 seats (human + 2 bots)')

  // Force-start the hand instead of waiting for scheduled timer
  clearTimeout(room.startHandTimeout)
  room.startHandTimeout = null
  const started = room.game.startHand()
  assert.equal(started, true, 'hand started')

  // Force-act for the human if it's their turn (bots schedule async; we drive synchronously here).
  // We just keep folding the human so the bots play heads-up to a result.
  let safety = 30
  while (room.game.phase !== 'waiting' && room.game.phase !== 'showdown' && safety-- > 0) {
    const active = room.game.players[room.game.activeIndex]
    if (!active) break
    if (active.id === human.id) {
      // Human folds immediately
      room.game.handleAction(human.id, 'fold')
    } else {
      // Bot's turn — drive it synchronously (skip the think timeout)
      const bot = room.players.get(active.id)
      assert.ok(bot?.isBot, 'expected bot at active seat')
      bot.cancelPending()
      bot._decideAndAct()
    }
  }

  // Either ended in fold-out (one bot wins) or progressed to showdown
  const finalPhase = room.game.phase
  assert.ok(['waiting', 'showdown'].includes(finalPhase), `phase ${finalPhase} should be terminal-ish`)
})

test('only the player who added a bot can remove it', async () => {
  const room = new PokerRoom('test-room-2', false)
  const a = makeFakePlayer('a', 'Adder')
  const b = makeFakePlayer('b', 'Other')

  room.addPlayer(a)
  room.addPlayer(b)
  const { bot } = room.addBotForPlayer(a.id, botRecord('Bot', '#3b82f6'))

  const denied = room.removeBotForPlayer(b.id, bot.id)
  assert.equal(denied.success, false)
  assert.match(denied.error, /Only the player who added/)

  const allowed = room.removeBotForPlayer(a.id, bot.id)
  assert.equal(allowed.success, true)
  assert.equal(room.players.has(bot.id), false, 'bot seat removed')
})

test('bot inherits adder chips with 1000 floor', () => {
  const room = new PokerRoom('test-room-3', false)
  const rich = makeFakePlayer('rich', 'Rich')
  rich.chips = 4242
  room.addPlayer(rich)
  const { bot } = room.addBotForPlayer(rich.id, botRecord('Bot1', '#3b82f6'))
  const seat = room.players.get(bot.id)
  assert.equal(seat.chips, 4242)

  const room2 = new PokerRoom('test-room-4', false)
  const poor = makeFakePlayer('poor', 'Poor')
  poor.chips = 250
  room2.addPlayer(poor)
  const { bot: bot2 } = room2.addBotForPlayer(poor.id, botRecord('Bot2', '#3b82f6'))
  const seat2 = room2.players.get(bot2.id)
  assert.equal(seat2.chips, 1000)
})

test('bot at 0 chips is auto-removed when room returns to WAITING', () => {
  const room = new PokerRoom('test-room-5', false)
  const human = makeFakePlayer('h', 'Human')
  room.addPlayer(human)
  const { bot } = room.addBotForPlayer(human.id, botRecord('Doomed', '#ef4444'))

  const seat = room.players.get(bot.id)
  seat.chips = 0

  // Simulate a phase transition triggering cleanup
  room._lastBroadcastPhase = 'showdown'
  room.broadcastGameState() // game.phase will be 'waiting' (no hand active) -> cleanup runs
  assert.equal(room.players.has(bot.id), false, 'broke bot was removed')
})

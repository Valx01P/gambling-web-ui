import test from 'node:test'
import assert from 'node:assert/strict'
import { PokerRoom } from '../src/rooms/PokerRoom.js'
import { POKER_CONFIG } from '../src/config/constants.js'

// Minimal bot-shaped player used as a test double. PokerRoom._cleanupBrokeBots
// only reads .isBot, .chips, .pokerBuyIn, and .id, so we don't need the full
// BotPlayer class — keeps the test fast and avoids pulling in the runtime.
function makeBot(id) {
  return {
    id, username: id, chips: 0, pokerBuyIn: 1000,
    isBot: true, isConnected: true,
    send() {}, destroy() {}, emitPhrase() {},
    toJSON() { return { id, isBot: true, chips: this.chips } }
  }
}

test('arena: busted bots auto-rebuy back to arenaStartingChips', () => {
  const room = new PokerRoom('arena-1', false, { isArena: true })
  room.arenaStartingChips = 1000
  const bot = makeBot('bot-A')
  // Skip the normal addBotForArenaSpectator flow — we just need the bot
  // tracked in room.players so _cleanupBrokeBots sees it.
  room.players.set(bot.id, bot)

  room._cleanupBrokeBots()

  assert.equal(bot.chips, 1000, 'busted bot should be rebought to 1000')
  assert.equal(bot.pokerBuyIn, 2000, 'pokerBuyIn should bump by the rebuy amount')
  assert.ok(room.players.has(bot.id), 'bot stays at the table (not removed)')
})

test('arena: arenaStartingChips override is honored on rebuy', () => {
  const room = new PokerRoom('arena-2', false, { isArena: true })
  room.arenaStartingChips = 5000
  const bot = makeBot('bot-B')
  room.players.set(bot.id, bot)

  room._cleanupBrokeBots()

  assert.equal(bot.chips, 5000, 'rebuy uses the arena-configured starting stack')
})

test('regular table: busted bots still leave (not rebought)', () => {
  // Non-arena room should preserve the legacy "bot leaves when busted"
  // behavior. Owners can re-add via Add Bots if they want it back.
  const room = new PokerRoom('table-1', false, { isArena: false })
  const bot = makeBot('bot-C')
  room.players.set(bot.id, bot)
  // Stub removePlayer so we don't need full game state; we just want to
  // see that it's called instead of a rebuy.
  let removed = null
  room.removePlayer = (id) => { removed = id }

  room._cleanupBrokeBots()

  assert.equal(bot.chips, 0, 'no rebuy at a regular table')
  assert.equal(removed, 'bot-C', 'bot removed instead')
})

test('arena: bot with non-zero chips is untouched', () => {
  const room = new PokerRoom('arena-3', false, { isArena: true })
  room.arenaStartingChips = 1000
  const live = makeBot('bot-D')
  live.chips = 750
  live.pokerBuyIn = 1000
  room.players.set(live.id, live)

  room._cleanupBrokeBots()

  assert.equal(live.chips, 750, 'non-busted bot untouched')
  assert.equal(live.pokerBuyIn, 1000, 'pokerBuyIn unchanged')
})

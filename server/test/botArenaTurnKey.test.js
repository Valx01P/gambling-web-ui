import test from 'node:test'
import assert from 'node:assert/strict'
import { PokerGame } from '../src/poker/PokerGame.js'

// Regression: in a bot-only arena, every active turn was emitting
// activeTurnStartedAt = null because hasTimedActiveTurn required another
// human at the table. BotPlayer's turn-dedup keyed on
// `${phase}-${activeTurnStartedAt}`, so any time action wrapped back to a
// bot within the same phase (after a raise reopened betting), the dedup
// collided and the bot froze.
//
// Fix: emit a fresh timestamp on every setActiveIndex regardless of human
// presence. The "is this turn timed?" UX gates on activeTurnExpiresAt
// instead, which preserves the warning-ring behavior.

function makeBot(id) {
  return {
    id, username: id, chips: 1000, isBot: true, isConnected: true,
    send() {}, toJSON() { return { id: this.id, isBot: true } }
  }
}

test('activeTurnStartedAt is non-null in bot-only arenas', () => {
  const game = new PokerGame()
  for (const p of ['A', 'B', 'C'].map(makeBot)) game.addPlayer(p)
  game.startHand()

  const state = game.getGameState()
  assert.equal(state.activeTurnExpiresAt, null,
    'no timed deadline in bot arena (no human to auto-fold)')
  assert.ok(Number.isFinite(state.activeTurnStartedAt),
    'activeTurnStartedAt must be a real timestamp so BotPlayer can dedup turns')
})

test('activeTurnStartedAt advances when the same active seat reopens', () => {
  // Simulating wrap-around: setActiveIndex called twice with the same
  // index in the same phase. Without the fix, both broadcasts shared the
  // same turnKey ("preflop-null") and BotPlayer's _lastTurnKey collided.
  const game = new PokerGame()
  for (const p of ['A', 'B', 'C'].map(makeBot)) game.addPlayer(p)
  game.startHand()

  const t1 = game.getGameState().activeTurnStartedAt
  // Busy-wait one ms — Date.now() is ms-precision so anything shorter
  // could land in the same tick.
  const wait = Date.now() + 2
  while (Date.now() < wait) {}
  game.setActiveIndex(game.activeIndex)
  const t2 = game.getGameState().activeTurnStartedAt

  assert.ok(Number.isFinite(t1) && Number.isFinite(t2))
  assert.notEqual(t1, t2, 'timestamps must differ across setActiveIndex calls')
})

test('activeTurnStartedAt is null in WAITING phase', () => {
  // Before a hand starts, there's no active turn → no timestamp. Keeps
  // any client logic that treats "null = idle" working.
  const game = new PokerGame()
  const state = game.getGameState()
  assert.equal(state.activeTurnStartedAt, null,
    'no timestamp before a hand has started')
})

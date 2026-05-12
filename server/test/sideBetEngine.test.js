import test from 'node:test'
import assert from 'node:assert/strict'

import { SideBetEngine } from '../src/sidebets/sideBetEngine.js'

// Minimal fakes of PokerGame + the room.broadcast callback. The engine only
// reads a handful of fields off `game`, so we mock just enough to drive the
// state machine deterministically without spinning up a real PokerGame.

function makeFakeGame({
  handIndex = 1,
  phase = 'preflop',
  board = [],
  players = [],
  foldedPlayers = new Set(),
  removedPlayers = new Set(),
  allInPlayers = new Set(),
  handActionHistory = [],
  aggressionCount = 0
} = {}) {
  return {
    handIndex, phase,
    communityCards: board,
    players,
    foldedPlayers, removedPlayers, allInPlayers,
    handActionHistory,
    aggressionCount,
  }
}

function makeEngine(game) {
  const broadcasts = []
  const engine = new SideBetEngine({
    room: null,
    game,
    broadcast: (msg) => broadcasts.push(msg),
  })
  return { engine, broadcasts }
}

// The engine picks ~4 props per hand from a catalog of 7+ candidates, so any
// given prop type lands ~half the time. For tests that need a *specific*
// prop type to exist, re-roll the spawn (by bumping handIndex) until it
// appears, then hand back the spawned instance.
function spawnUntil(engine, game, type, maxTries = 40) {
  for (let i = 0; i < maxTries; i++) {
    const found = [...engine.props.values()].find(p => p.type === type && p.status === 'open')
    if (found) return found
    game.handIndex += 1
    engine.onHandStart()
  }
  throw new Error(`prop ${type} never spawned across ${maxTries} hand starts`)
}

test('engine spawns ≥3 props on hand start and emits one state broadcast', () => {
  const game = makeFakeGame({
    players: [
      { id: 'p1', chips: 1000, username: 'alice' },
      { id: 'p2', chips: 1000, username: 'bob' }
    ]
  })
  const { engine, broadcasts } = makeEngine(game)
  engine.onHandStart()
  const stateMsgs = broadcasts.filter(b => b.type === 'sidebet:state')
  assert.ok(stateMsgs.length >= 1, 'should emit at least one sidebet:state')
  const props = stateMsgs[stateMsgs.length - 1].data.props
  assert.ok(props.length >= 3, `expected ≥3 props, got ${props.length}`)
  for (const p of props) {
    assert.equal(p.status, 'open')
    assert.ok(p.buyYesPrice > 0 && p.buyYesPrice < 1, `bad buy yes price: ${p.buyYesPrice}`)
    assert.ok(p.buyNoPrice > 0 && p.buyNoPrice < 1, `bad buy no price: ${p.buyNoPrice}`)
  }
})

test('buy YES, then prop resolves YES → chips reflect the payout, position cleared', () => {
  const player = { id: 'p1', chips: 1000, username: 'alice' }
  const game = makeFakeGame({ players: [player, { id: 'p2', chips: 1000, username: 'bob' }] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  const aceProp = spawnUntil(engine, game, 'ace_on_board')

  const buyResult = engine.placeBet('p1', aceProp.id, 'yes', 100)
  assert.equal(buyResult.success, true)
  // Player paid 100 chips → stack now 900.
  assert.equal(player.chips, 900)
  const sharesBought = buyResult.shares
  assert.ok(sharesBought > 0)

  // Force the YES condition by dealing an ace on the flop. Mutate the
  // shared game object — the engine reads from it directly.
  game.communityCards.push({ rank: 'A', suit: 'spades' })
  game.communityCards.push({ rank: '7', suit: 'clubs' })
  game.communityCards.push({ rank: '2', suit: 'diamonds' })
  game.phase = 'flop'

  engine.onStateChange()

  // Prop should be resolved YES → 1 chip per share, rounded.
  assert.equal(aceProp.status, 'resolved')
  assert.equal(aceProp.outcome, 'yes')
  const expectedCredit = Math.round(sharesBought)
  assert.equal(player.chips, 900 + expectedCredit, `expected 900 + ${expectedCredit}, got ${player.chips}`)
})

test('buy YES, prop resolves NO → player loses stake (no credit)', () => {
  const player = { id: 'p1', chips: 1000, username: 'alice' }
  const game = makeFakeGame({ players: [player, { id: 'p2', chips: 1000, username: 'bob' }] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  const aceProp = spawnUntil(engine, game, 'ace_on_board')

  engine.placeBet('p1', aceProp.id, 'yes', 100)
  assert.equal(player.chips, 900)

  // River out with no aces.
  game.communityCards.push(
    { rank: '2', suit: 'clubs' },
    { rank: '7', suit: 'hearts' },
    { rank: '9', suit: 'diamonds' },
    { rank: 'J', suit: 'spades' },
    { rank: 'Q', suit: 'clubs' }
  )
  game.phase = 'river'

  engine.onStateChange()

  assert.equal(aceProp.status, 'resolved')
  assert.equal(aceProp.outcome, 'no')
  assert.equal(player.chips, 900, 'lost stake stays gone')
})

test('void refunds the original stake', () => {
  const player = { id: 'p1', chips: 1000, username: 'alice' }
  const game = makeFakeGame({ players: [player, { id: 'p2', chips: 1000, username: 'bob' }] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  // Pick a card-runout prop with `handEnded → void` behavior (river_red is
  // a turn-window prop so we'd need to advance phase first; use ace_on_board
  // which voids on fold-out before river).
  const aceProp = spawnUntil(engine, game, 'ace_on_board')
  engine.placeBet('p1', aceProp.id, 'yes', 200)
  assert.equal(player.chips, 800)

  // Hand ends fold-out style: phase advances to showdown but the board
  // never gets to 5 cards. Engine's onHandEnd should VOID + refund.
  game.phase = 'showdown'
  engine.onHandEnd({ reachedShowdown: false })

  assert.equal(aceProp.status, 'resolved')
  assert.equal(aceProp.outcome, 'void')
  assert.equal(player.chips, 1000, 'stake refunded')
})

test('cheap YES that auto-resolves true returns the headline ~10x ROI', () => {
  // This is the user's flagship scenario: bought at long odds, the runout
  // lands in your favor → big chip payout. flop_three_suited is ~5.2% fair
  // preflop, so buying at the ~7% ask should ~14x the stake on a YES.
  const player = { id: 'p1', chips: 1000, username: 'alice' }
  const game = makeFakeGame({ players: [player, { id: 'p2', chips: 1000, username: 'bob' }] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  const longshot = spawnUntil(engine, game, 'flop_three_suited')

  engine.placeBet('p1', longshot.id, 'yes', 100)
  const shares = engine.positions.get('p1').get(longshot.id).shares
  const stackBeforeReveal = player.chips
  assert.ok(shares > 1000, `expected ~1400 shares at ~7% ask, got ${shares}`)

  // Drop a monotone flop → flop_three_suited locks YES.
  game.communityCards.push(
    { rank: '2', suit: 'spades' },
    { rank: '9', suit: 'spades' },
    { rank: 'K', suit: 'spades' }
  )
  game.phase = 'flop'
  engine.onStateChange()

  assert.equal(longshot.status, 'resolved')
  assert.equal(longshot.outcome, 'yes')
  const credit = Math.round(shares)
  assert.equal(player.chips, stackBeforeReveal + credit)
  // 100-chip stake at ~7% ask → ~1400 shares → ≥10x payout on YES.
  assert.ok(credit >= 1000, `expected ≥10x payout on cheap YES, got credit=${credit}`)
})

test('placeBet rejects when stake exceeds available chips', () => {
  const player = { id: 'p1', chips: 50, username: 'alice' }
  const game = makeFakeGame({ players: [player, { id: 'p2', chips: 1000, username: 'bob' }] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  const prop = [...engine.props.values()][0]
  const result = engine.placeBet('p1', prop.id, 'yes', 100)
  assert.equal(result.success, false)
  assert.equal(result.error, 'insufficient_chips')
  assert.equal(player.chips, 50, 'no chips deducted on rejected bet')
})

test('placeBet enforces the MIN_BET floor', () => {
  const player = { id: 'p1', chips: 1000, username: 'alice' }
  const game = makeFakeGame({ players: [player] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  const prop = [...engine.props.values()][0]
  const result = engine.placeBet('p1', prop.id, 'yes', 5)
  assert.equal(result.success, false)
  assert.ok(result.error.startsWith('min_bet_'), `error was ${result.error}`)
  assert.equal(player.chips, 1000)
})

test('YES + NO buy prices on a fair-coin prop sum to 1 + edge', () => {
  const player = { id: 'p1', chips: 10000, username: 'alice' }
  const game = makeFakeGame({ players: [player] })
  const { engine } = makeEngine(game)
  engine.onHandStart()
  for (const prop of engine.props.values()) {
    const spread = prop.buyYesPrice + prop.buyNoPrice
    assert.ok(spread > 1.02 && spread < 1.05, `spread out of range: ${spread}`)
  }
})

test('catalog only spawns props the local player cannot self-rig', () => {
  // After removing goes_to_showdown + anyone_all_in, the spawn pool is pure
  // card-runout. This guards against accidentally adding an action-driven
  // prop back in without thinking about exploitability.
  const player = { id: 'p1', chips: 1000, username: 'alice' }
  const game = makeFakeGame({ players: [player, { id: 'p2', chips: 1000, username: 'bob' }] })
  const { engine } = makeEngine(game)
  const banned = new Set(['anyone_all_in', 'goes_to_showdown'])
  for (let i = 0; i < 50; i++) {
    game.handIndex += 1
    engine.onHandStart()
    for (const p of engine.props.values()) {
      assert.ok(!banned.has(p.type), `banned prop type spawned: ${p.type}`)
    }
  }
})

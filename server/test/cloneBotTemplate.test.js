import test from 'node:test'
import assert from 'node:assert/strict'
import { compileBot } from '../src/bots/runtime/codeSandbox.js'
import { renderCloneBotCode } from '../src/users/cloneBotTemplate.js'
import { deriveProfile } from '../src/users/botFromUser.js'

// Convenience: build a profile from raw stat counts, then render+compile.
// Always passes the floors path so a "thin data" user still produces a
// playable bot.
function buildAndCompile(stats = {}) {
  const merged = { handsSeated: 12, handsVoluntary: 4, ...stats }
  const profile = deriveProfile(merged)
  const code = renderCloneBotCode(profile, 'TestUser')
  const compiled = compileBot(code)
  if (compiled.error) throw new Error(`compile failed: ${compiled.error}`)
  return compiled
}

// Skeleton ctx. Override fields per test for the situation under test.
function ctx(overrides = {}) {
  return {
    phase: 'preflop',
    streetIsPreflop: true,
    streetIsPostflop: false,
    position: 'btn',
    handStrength: 'medium',
    handStrengthScore: 0.55,
    handStrengthIndex: 2,
    equity: 0.55,
    potOdds: 0,
    potSize: 15,
    currentBet: 10,
    toCall: 10,
    minRaiseTarget: 20,
    maxRaiseTarget: 1000,
    bigBlind: 10,
    smallBlind: 5,
    aggressionCount: 1,
    numActiveOpponents: 1,
    facingBet: true,
    facingRaise: false,
    facingAllIn: false,
    holeCards: [{ rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'hearts' }],
    communityCards: [],
    handIndex: 1,
    me: { id: 'me', seat: 0, chips: 1000 },
    opponents: [],
    actionHistory: [],
    handHistory: [],
    lastAggressor: null,
    draws: { outs: 0 },
    ...overrides
  }
}

test('clone bot compiles cleanly (no top-level return SyntaxError)', () => {
  const compiled = buildAndCompile()
  assert.equal(compiled.error, null)
})

test('clone bot never folds pocket Kings preflop facing a raise', () => {
  const compiled = buildAndCompile()
  const result = compiled.run(ctx({
    handStrengthScore: 0.96,        // KK
    equity: 0.82,
    facingBet: true,
    aggressionCount: 1,
    currentBet: 30,
    toCall: 30,
    minRaiseTarget: 60
  }))
  assert.equal(result.ok, true)
  assert.notEqual(result.action, 'fold', `KK should never fold preflop facing a raise (got ${result.action})`)
})

test('clone bot never folds AA preflop facing a 3-bet', () => {
  const compiled = buildAndCompile()
  const result = compiled.run(ctx({
    handStrengthScore: 1.0,
    equity: 0.85,
    facingBet: true,
    aggressionCount: 2,
    currentBet: 90,
    toCall: 90,
    minRaiseTarget: 180
  }))
  assert.equal(result.ok, true)
  assert.notEqual(result.action, 'fold')
})

test('BB checks for free when toCall=0 (no raise to face)', () => {
  const compiled = buildAndCompile()
  const result = compiled.run(ctx({
    position: 'bb',
    handStrengthScore: 0.30,        // 7-2o
    equity: 0.30,
    facingBet: false,
    toCall: 0,
    currentBet: 10,
    aggressionCount: 0
  }))
  assert.equal(result.ok, true)
  // BB with no raise must take the free flop. Fold or call here would be a bug.
  assert.equal(result.action, 'check', `BB free-flop must check, got ${result.action}`)
})

test('BB raises premium with the option', () => {
  const compiled = buildAndCompile()
  const result = compiled.run(ctx({
    position: 'bb',
    handStrengthScore: 1.0,         // AA
    equity: 0.85,
    facingBet: false,
    toCall: 0,
    currentBet: 10,
    aggressionCount: 0
  }))
  assert.equal(result.ok, true)
  assert.equal(result.action, 'raise', `BB AA should raise, got ${result.action}`)
})

test('SB completes with a playable hand at 0.5 BB to call', () => {
  const compiled = buildAndCompile()
  const result = compiled.run(ctx({
    position: 'sb',
    handStrengthScore: 0.55,
    equity: 0.55,
    facingBet: true,
    toCall: 5,                      // 0.5 BB
    currentBet: 10
  }))
  assert.equal(result.ok, true)
  assert.notEqual(result.action, 'fold', 'SB should complete or raise vs only BB, never fold')
})

test('clone bot folds 7-2o to a UTG raise (pot odds bad, weak hand)', () => {
  const compiled = buildAndCompile({ handsVoluntary: 4, preflopOpens: 1 })
  const result = compiled.run(ctx({
    position: 'mp',
    handStrengthScore: 0.18,
    equity: 0.30,
    facingBet: true,
    aggressionCount: 1,
    currentBet: 30,
    toCall: 30,
    potOdds: 0.30
  }))
  assert.equal(result.ok, true)
  assert.equal(result.action, 'fold')
})

test('postflop value bet when equity is strong and no bet to face', () => {
  const compiled = buildAndCompile({ preflopOpens: 1 })
  const result = compiled.run(ctx({
    phase: 'flop',
    streetIsPreflop: false,
    streetIsPostflop: true,
    handStrengthScore: 0.78,
    equity: 0.72,
    facingBet: false,
    toCall: 0,
    currentBet: 0,
    potSize: 60,
    minRaiseTarget: 10,
    communityCards: [
      { rank: 'A', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
      { rank: '2', suit: 'clubs' }
    ],
    lastAggressor: { id: 'me', isMe: true, action: 'raise', phase: 'preflop' }
  }))
  assert.equal(result.ok, true)
  assert.equal(result.action, 'raise', `strong equity should bet, got ${result.action}`)
})

test('postflop call when equity beats call threshold', () => {
  const compiled = buildAndCompile({ handsVoluntary: 6 })
  const result = compiled.run(ctx({
    phase: 'turn',
    streetIsPreflop: false,
    streetIsPostflop: true,
    handStrengthScore: 0.50,
    equity: 0.55,
    facingBet: true,
    aggressionCount: 1,
    currentBet: 30,
    toCall: 30,
    potSize: 80,
    potOdds: 0.27,
    communityCards: [
      { rank: 'A', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
      { rank: '3', suit: 'diamonds' }
    ]
  }))
  assert.equal(result.ok, true)
  assert.notEqual(result.action, 'fold', `call-threshold beat should not fold, got ${result.action}`)
})

test('rocky-tight stats still produce a playable bot (does NOT fold every hand)', () => {
  // Rock profile: VPIP 8%, PFR 8%. Without floors this would fold ~90% of
  // preflop spots. Floors should kick in so the bot still opens premium and
  // plays the BB free flops.
  const compiled = buildAndCompile({
    handsSeated: 12, handsVoluntary: 1, preflopOpens: 1
  })
  // BB free flop must still check, never fold.
  const free = compiled.run(ctx({
    position: 'bb', handStrengthScore: 0.30, equity: 0.30,
    facingBet: false, toCall: 0, currentBet: 10
  }))
  assert.equal(free.action, 'check')
  // Even rocky bots open premium hands.
  const opening = compiled.run(ctx({
    position: 'btn', handStrengthScore: 0.96, equity: 0.82,
    facingBet: false, toCall: 0, currentBet: 0,
    aggressionCount: 0, minRaiseTarget: 20
  }))
  assert.equal(opening.action, 'raise')
})

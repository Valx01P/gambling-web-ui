import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  actionQuality, shapedReward,
  extractFeatures, legalActionMask, NUM_ACTIONS
} from '../src/bots/neural/shared.js'
import { policyFor } from '../src/bots/neural/registry.js'

// Build a feature vector for "you're facing a small bet preflop with
// equity X". potOdds tunable to match the spot.
function featuresForEquity(equity, { facingBet = true, potOdds = 0.10, position = 0.5 } = {}) {
  return [
    1,             // bias
    1, 0, 0, 0,    // preflop one-hot
    equity,
    potOdds,
    0.5,           // sprNorm
    0.6,           // stackBBNorm
    position,
    0.5,           // opponentsNorm
    facingBet ? 1 : 0,
    0,             // facingRaise
    0.2,           // aggressionNorm
    0              // commitNorm
  ]
}

// === actionQuality scenarios from the user's screenshots ============

test('jamming 72-offsuit-equivalent (very low equity) → strongly negative quality', () => {
  // 72o vs random ~0.10 equity. Action: ALL_IN (5).
  const f = featuresForEquity(0.10)
  const q = actionQuality(5 /* raise_allin */, f)
  assert.ok(q <= -1.0, `quality should be heavily negative, got ${q}`)
})

test('jamming AKs preflop (high equity) → strongly positive quality', () => {
  // AKs vs random ~0.65 equity. Action: ALL_IN.
  const f = featuresForEquity(0.66)
  const q = actionQuality(5, f)
  assert.ok(q >= 0.5, `quality should be positive, got ${q}`)
})

test('folding AK preflop facing a small raise → strongly negative quality', () => {
  // AK preflop vs cheap call (small potOdds) — folding is bad.
  // equity 0.55, potOdds 0.10 → margin = 0.45.
  const f = featuresForEquity(0.55, { potOdds: 0.10 })
  const q = actionQuality(0 /* fold */, f)
  assert.ok(q <= -1.0, `quality should be heavily negative, got ${q}`)
})

test('folding 27o preflop facing any bet → positive quality', () => {
  // 27o vs random ~0.08, margin = -0.05 to potOdds 0.10. Decent fold.
  const f = featuresForEquity(0.08, { potOdds: 0.20 })
  const q = actionQuality(0, f)
  assert.ok(q > 0, `quality should be positive, got ${q}`)
})

test('check when no bet is pending → mildly positive', () => {
  const f = featuresForEquity(0.40, { facingBet: false, potOdds: 0 })
  const q = actionQuality(1 /* check */, f)
  assert.ok(q > 0, `check should be ok, got ${q}`)
})

// === shapedReward scenarios ============

test('bad action + win → reward heavily dampened (no reinforcing luck)', () => {
  // quality = -1.2 (jammed junk), terminalReward = +0.8 (won the hand)
  const r = shapedReward(-1.2, 0.8)
  assert.ok(r < 0.3, `expected dampened reward, got ${r}`)
  assert.ok(r > 0, `still positive though, got ${r}`)
})

test('bad action + loss → penalty AMPLIFIED', () => {
  // quality = -1.2, terminalReward = -0.8
  const r = shapedReward(-1.2, -0.8)
  assert.ok(r < -0.8, `expected amplified penalty, got ${r}`)
  // 1.80x amplification on the worst-quality bucket
  assert.ok(r <= -1.4, `should be near -1.44, got ${r}`)
})

test('good action + loss → penalty dampened (bad luck, not bad decision)', () => {
  // quality = +0.8, terminalReward = -0.8
  const r = shapedReward(0.8, -0.8)
  assert.ok(r > -0.8, `penalty should be smaller in magnitude than raw, got ${r}`)
  assert.ok(r < 0, `still a penalty though, got ${r}`)
})

test('good action + win → reward at full strength or slight bonus', () => {
  const r = shapedReward(0.8, 0.5)
  assert.ok(r >= 0.5, `reward should be ≥ raw, got ${r}`)
})

// === Integration: jamming junk and losing should pull the policy
// AWAY from that action faster than the unshaped baseline did. ===
test('shaping makes ALL_IN-with-junk losses pull harder than equal-loss good plays', () => {
  const policy = policyFor('reinforce')
  const badStep  = { features: featuresForEquity(0.10), mask: new Array(NUM_ACTIONS).fill(1), actionIdx: 5 } // ALL_IN with 10% equity
  const goodStep = { features: featuresForEquity(0.65), mask: new Array(NUM_ACTIONS).fill(1), actionIdx: 5 } // ALL_IN with 65% equity

  // Snapshot row-5 weights before + after each update; the row-5 DELTA
  // is what tells us how hard the gradient pulled on the ALL_IN action.
  function deltaForStep(step) {
    const s = policy.initialState()
    const before = s.weights[5].slice()
    policy.update(s, [step], -0.8)
    const after = s.weights[5]
    let d = 0
    for (let i = 0; i < before.length; i++) d += Math.abs(after[i] - before[i])
    return d
  }
  const badDelta  = deltaForStep(badStep)
  const goodDelta = deltaForStep(goodStep)

  assert.ok(badDelta > goodDelta * 1.5,
    `bad-action loss should produce a notably bigger gradient than good-action loss. bad=${badDelta.toFixed(4)} good=${goodDelta.toFixed(4)}`)
})

test('convergence: training only on bad-action losses pushes ALL_IN prob DOWN', () => {
  const policy = policyFor('reinforce')
  const s = policy.initialState()
  const features = featuresForEquity(0.10)
  const mask = new Array(NUM_ACTIONS).fill(1)
  // Drill the bad action with a loss many times. Each pass amplifies
  // the penalty via shapedReward, so the ALL_IN row's pull on the
  // low-equity feature region should converge negative.
  for (let i = 0; i < 100; i++) {
    policy.update(s, [{ features, mask, actionIdx: 5 }], -0.8)
  }
  // After many bad-action losses, the ALL_IN row's weighted-by-equity
  // logit should be strongly negative, so resampling at the same state
  // should pick ALL_IN much less often than 1/6.
  let allinHits = 0
  const ctx = {
    phase: 'preflop',
    equity: 0.10, potSize: 100, toCall: 11,
    spr: 5, myStackBB: 60, position: 'btn',
    opponents: [{ folded: false }, { folded: false }],
    facingBet: true, facingRaise: false, aggressionCount: 1,
    commitmentRatio: 0,
    myChips: 600, minRaiseTarget: 20, maxRaiseTarget: 600
  }
  for (let i = 0; i < 200; i++) {
    const r = policy.decide(s, ctx)
    if (r.step.actionIdx === 5) allinHits++
  }
  // Random sampling baseline would put ~33 of 200 at ALL_IN (≈1/6).
  // After punishment we expect well below that.
  assert.ok(allinHits < 25,
    `policy should rarely jam after punishment, got ${allinHits}/200`)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { policyFor, VARIANTS } from '../src/bots/neural/registry.js'
import {
  initialNeuralState,
  normalizeState,
  applyReinforceUpdate,
  decide,
  NUM_FEATURES,
  NUM_ACTIONS
} from '../src/bots/neuralPolicy.js'

const sampleCtx = {
  phase: 'flop',
  equity: 0.6,
  potSize: 250,
  toCall: 50,
  spr: 4,
  myStackBB: 90,
  position: 'btn',
  opponents: [{ folded: false }, { folded: false }],
  facingBet: true,
  facingRaise: false,
  aggressionCount: 1,
  commitmentRatio: 0.2,
  myChips: 900,
  minRaiseTarget: 100,
  maxRaiseTarget: 900
}

for (const variant of VARIANTS) {
  test(`${variant.kind}: initialState has the right shape`, () => {
    const s = policyFor(variant.kind).initialState()
    assert.equal(s.kind, variant.kind)
    assert.equal(s.handsTrained, 0)
    assert.deepEqual(s.actionCounts, new Array(NUM_ACTIONS).fill(0))
  })

  test(`${variant.kind}: decide returns a legal action`, () => {
    const s = policyFor(variant.kind).initialState()
    const r = policyFor(variant.kind).decide(s, sampleCtx)
    assert.ok(r, 'decide returns something')
    assert.ok(['fold', 'check', 'call', 'raise', 'all_in'].includes(r.command.action))
    assert.ok(Number.isInteger(r.step.actionIdx))
    assert.equal(r.step.features.length, NUM_FEATURES)
  })

  test(`${variant.kind}: update with positive reward biases policy without NaN`, () => {
    const policy = policyFor(variant.kind)
    const s = policy.initialState()
    // Build a trajectory by sampling 5 decisions
    const traj = []
    for (let i = 0; i < 5; i++) {
      const r = policy.decide(s, sampleCtx)
      traj.push(r.step)
    }
    policy.update(s, traj, 0.7)
    assert.equal(s.handsTrained, 1)
    // No NaN propagation through any of the stored numbers
    for (const r of s.rewardHistory) assert.ok(Number.isFinite(r))
    if (s.weights) for (const row of s.weights) for (const v of row) assert.ok(Number.isFinite(v))
    if (s.q)       for (const row of s.q)       for (const v of row) assert.ok(Number.isFinite(v))
    if (s.w1)      for (const row of s.w1)      for (const v of row) assert.ok(Number.isFinite(v))
    if (s.w2)      for (const row of s.w2)      for (const v of row) assert.ok(Number.isFinite(v))
  })
}

test('dispatcher: applyReinforceUpdate picks the variant by state.kind', () => {
  // Make an MLP state, give it a positive-reward trajectory through the
  // public API, verify the MLP-only weight matrices changed.
  const policy = policyFor('mlp')
  const s = policy.initialState()
  const r = policy.decide(s, sampleCtx)
  const before = JSON.stringify(s.w2)
  applyReinforceUpdate(s, [r.step], 0.8)
  assert.notEqual(JSON.stringify(s.w2), before, 'mlp w2 changed via dispatcher')
})

test('legacy state without `kind` falls back to reinforce', () => {
  // Old rows from before migration 017. The normalizeState path needs to
  // produce a working reinforce state when given a weight matrix without
  // any kind tag on the blob.
  const legacy = {
    weights: Array.from({ length: NUM_ACTIONS }, () => new Array(NUM_FEATURES).fill(0)),
    handsTrained: 7
  }
  const norm = normalizeState(legacy)
  assert.equal(norm.kind, 'reinforce')
  assert.equal(norm.handsTrained, 7)
})

test('Q-learning: ε-greedy with ε=0 picks argmax', () => {
  const policy = policyFor('qlearning')
  const s = policy.initialState()
  // Force ε to 0 by setting a giant handsTrained — but our schedule has a
  // floor (0.05). So instead, train the bot strongly on a single action so
  // its Q-value dominates, then verify decisions hit it most of the time.
  const ctx = { ...sampleCtx }
  const r = policy.decide(s, ctx)
  // Strong positive reward for the chosen action — repeat many times.
  for (let i = 0; i < 80; i++) policy.update(s, [r.step], 1.0)
  let hits = 0
  for (let i = 0; i < 100; i++) {
    const d = policy.decide(s, ctx)
    if (d.step.actionIdx === r.step.actionIdx) hits++
  }
  assert.ok(hits >= 60, `argmax action should be picked frequently, got ${hits}/100`)
})

test('REINFORCE+baseline: baseline tracks running reward', () => {
  const policy = policyFor('reinforce_baseline')
  const s = policy.initialState()
  for (let i = 0; i < 30; i++) {
    const r = policy.decide(s, sampleCtx)
    policy.update(s, [r.step], 0.5) // consistent positive reward
  }
  assert.ok(s.baseline > 0, `baseline should drift positive, got ${s.baseline}`)
  assert.ok(s.baseline < 0.5, 'baseline should not overshoot the input reward')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractFeatures,
  legalActionMask,
  actionToCommand,
  softmaxMasked,
  sampleFromProbs,
  NUM_FEATURES,
  NUM_ACTIONS
} from '../src/bots/neural/shared.js'
import {
  initialNeuralState,
  normalizeState,
  applyReinforceUpdate,
  decide,
  currentLearningRate
} from '../src/bots/neuralPolicy.js'

const sampleCtx = {
  phase: 'flop',
  equity: 0.55,
  potSize: 200,
  toCall: 40,
  spr: 4,
  myStackBB: 80,
  position: 'btn',
  opponents: [{ folded: false }, { folded: false }, { folded: true }],
  facingBet: true,
  facingRaise: false,
  aggressionCount: 1,
  commitmentRatio: 0.15,
  myChips: 800,
  minRaiseTarget: 80,
  maxRaiseTarget: 800
}

test('initialNeuralState defaults to reinforce shape', () => {
  const s = initialNeuralState()
  assert.equal(s.kind, 'reinforce')
  assert.equal(s.weights.length, NUM_ACTIONS)
  for (const row of s.weights) assert.equal(row.length, NUM_FEATURES)
  assert.equal(s.handsTrained, 0)
  assert.deepEqual(s.actionCounts, new Array(NUM_ACTIONS).fill(0))
})

test('extractFeatures returns 15 finite numbers', () => {
  const f = extractFeatures(sampleCtx)
  assert.equal(f.length, NUM_FEATURES)
  for (const x of f) assert.ok(Number.isFinite(x), `feature is finite: ${x}`)
  assert.equal(f[0], 1)
})

test('legalActionMask: facing a bet allows fold + call, blocks check', () => {
  const mask = legalActionMask(sampleCtx)
  assert.equal(mask[0], 1)
  assert.equal(mask[1], 0)
  assert.equal(mask[2], 1)
})

test('legalActionMask: no bet → check is legal, fold is not', () => {
  const mask = legalActionMask({ ...sampleCtx, toCall: 0, facingBet: false })
  assert.equal(mask[0], 0)
  assert.equal(mask[1], 1)
})

test('softmax + sample returns a legal action', () => {
  const mask = legalActionMask(sampleCtx)
  const logits = new Array(NUM_ACTIONS).fill(0)
  const probs = softmaxMasked(logits, mask)
  let total = 0
  for (let a = 0; a < NUM_ACTIONS; a++) {
    if (!mask[a]) assert.equal(probs[a], 0, `illegal action ${a} has 0 prob`)
    total += probs[a]
  }
  assert.ok(Math.abs(total - 1) < 1e-6, `probs sum to ~1, got ${total}`)
  const idx = sampleFromProbs(probs)
  assert.ok(mask[idx] === 1, `sampled action ${idx} is legal`)
})

test('decide → applyReinforceUpdate moves weights without NaN', () => {
  const s = initialNeuralState()
  const r = decide(s, sampleCtx)
  const before = s.weights[r.step.actionIdx].slice()
  applyReinforceUpdate(s, [r.step], 0.5)
  let changed = false
  for (let i = 0; i < before.length; i++) {
    if (s.weights[r.step.actionIdx][i] !== before[i]) changed = true
    assert.ok(Number.isFinite(s.weights[r.step.actionIdx][i]))
  }
  assert.ok(changed, 'chosen action row should have moved')
  assert.equal(s.handsTrained, 1)
})

test('positive reward biases the policy toward the chosen action', () => {
  const s = initialNeuralState()
  const r = decide(s, sampleCtx)
  // record initial prob of the same action
  const features = r.step.features
  const mask = r.step.mask
  const initialLogits = new Array(NUM_ACTIONS)
  for (let a = 0; a < NUM_ACTIONS; a++) {
    let z = 0
    for (let f = 0; f < NUM_FEATURES; f++) z += s.weights[a][f] * features[f]
    initialLogits[a] = z
  }
  const before = softmaxMasked(initialLogits, mask)[r.step.actionIdx]
  for (let i = 0; i < 60; i++) applyReinforceUpdate(s, [r.step], 1.0)
  const afterLogits = new Array(NUM_ACTIONS)
  for (let a = 0; a < NUM_ACTIONS; a++) {
    let z = 0
    for (let f = 0; f < NUM_FEATURES; f++) z += s.weights[a][f] * features[f]
    afterLogits[a] = z
  }
  const after = softmaxMasked(afterLogits, mask)[r.step.actionIdx]
  assert.ok(after > before, `prob(chosen action) increased: ${before} → ${after}`)
})

test('actionToCommand maps every action index to a legal command name', () => {
  for (let a = 0; a < NUM_ACTIONS; a++) {
    const cmd = actionToCommand(a, sampleCtx)
    assert.ok(
      ['fold', 'check', 'call', 'raise', 'all_in'].includes(cmd.action),
      `action ${a} maps to a legal command, got ${cmd.action}`
    )
  }
})

test('currentLearningRate decays with hands trained', () => {
  const lr0 = currentLearningRate(0)
  const lr1000 = currentLearningRate(1000)
  assert.ok(lr1000 < lr0)
  assert.ok(lr0 > 0)
})

test('normalizeState repairs missing fields', () => {
  const repaired = normalizeState({ weights: null, handsTrained: 'oops' })
  assert.equal(repaired.weights.length, NUM_ACTIONS)
  assert.equal(repaired.weights[0].length, NUM_FEATURES)
  assert.equal(repaired.handsTrained, 0)
})

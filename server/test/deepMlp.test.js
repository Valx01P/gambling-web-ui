import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDeepMlp, ARCHITECTURES, DEEP_MLP_BY_KIND } from '../src/bots/neural/deepMlp.js'
import { NUM_FEATURES, NUM_ACTIONS } from '../src/bots/neural/shared.js'

// Ctx with enough fields for the mask to leave multiple actions legal —
// otherwise softmax over a singleton is 1.0 and the policy gradient is
// always zero, so the test would never see weights move.
function makeCtx() {
  return {
    phase: 'flop',
    equity: 0.55,
    toCall: 10,
    potSize: 100,
    myChips: 800,
    myStack: 800,
    minRaiseTarget: 20,
    maxRaiseTarget: 800,
    myStackBB: 80,
    spr: 5,
    position: 2,
    opponents: 1,
    facingBet: 1,
    facingRaise: 0,
    aggression: 0.2,
    commit: 0.05
  }
}

test('deepMlp: every registered architecture initializes the right layer shapes', () => {
  for (const arch of ARCHITECTURES) {
    const mod = DEEP_MLP_BY_KIND[arch.kind]
    assert.ok(mod, `module missing for kind=${arch.kind}`)
    const state = mod.initialState()
    assert.equal(state.kind, arch.kind)
    // Expect L = hidden.length + 1 weight layers.
    assert.equal(state.layers.length, arch.hidden.length + 1)
    const sizes = [NUM_FEATURES, ...arch.hidden, NUM_ACTIONS]
    for (let i = 0; i < state.layers.length; i++) {
      const fanIn = sizes[i]
      const fanOut = sizes[i + 1]
      assert.equal(state.layers[i].w.length, fanOut,
        `${arch.kind} layer ${i} should have ${fanOut} rows`)
      assert.equal(state.layers[i].w[0].length, fanIn,
        `${arch.kind} layer ${i} should have ${fanIn} cols`)
      assert.equal(state.layers[i].b.length, fanOut)
    }
  }
})

test('deepMlp: decide returns a legal command + trajectory step', () => {
  const mod = DEEP_MLP_BY_KIND.mlp_2x16
  const state = mod.initialState()
  const result = mod.decide(state, makeCtx())
  assert.ok(result, 'decide should return a result')
  assert.ok(result.command, 'result.command missing')
  assert.ok(['fold', 'check', 'call', 'raise', 'all_in'].includes(result.command.action))
  assert.equal(result.step.features.length, NUM_FEATURES)
  assert.equal(result.step.mask.length, NUM_ACTIONS)
  assert.ok(Number.isInteger(result.step.actionIdx))
})

test('deepMlp: update increments handsTrained and writes finite weights', () => {
  const mod = DEEP_MLP_BY_KIND.mlp_3x16
  const state = mod.initialState()
  const ctx = makeCtx()

  // Build a short trajectory by sampling a few decisions.
  const trajectory = []
  for (let i = 0; i < 4; i++) {
    const r = mod.decide(state, ctx)
    if (r) trajectory.push(r.step)
  }
  const before = JSON.parse(JSON.stringify(state.layers[0].w[0]))
  mod.update(state, trajectory, 0.4)
  assert.equal(state.handsTrained, 1)
  // At least one weight in layer 0 row 0 should have moved.
  const after = state.layers[0].w[0]
  const moved = after.some((v, i) => v !== before[i])
  assert.ok(moved, 'weights should have moved after update')
  // And every weight stays finite.
  for (const layer of state.layers) {
    for (const row of layer.w) for (const v of row) assert.ok(Number.isFinite(v))
    for (const v of layer.b) assert.ok(Number.isFinite(v))
  }
})

test('deepMlp: normalizeState repairs mismatched arch by falling back to fresh', () => {
  const mod = DEEP_MLP_BY_KIND.mlp_32
  // Pretend the user had a previous 16-wide state on disk and we
  // changed the arch.
  const stale = makeDeepMlp('mlp_16', [16]).initialState()
  const repaired = mod.normalizeState(stale)
  // Should now match mlp_32's shape (1 hidden layer of 32).
  assert.equal(repaired.layers.length, 2)
  assert.equal(repaired.layers[0].w.length, 32)
  assert.equal(repaired.layers[1].w.length, NUM_ACTIONS)
})

test('deepMlp: lower-tier policy survives normalizeState round-trip', () => {
  const mod = DEEP_MLP_BY_KIND.mlp_2x32
  const state = mod.initialState()
  // Mutate a weight; round-trip; confirm the value survived.
  state.layers[1].w[0][0] = 0.987654
  state.handsTrained = 42
  state.rewardHistory.push(0.1, 0.2)
  state.actionCounts[3] = 7
  const repaired = mod.normalizeState(JSON.parse(JSON.stringify(state)))
  assert.equal(repaired.layers[1].w[0][0], 0.987654)
  assert.equal(repaired.handsTrained, 42)
  assert.deepEqual(repaired.rewardHistory, [0.1, 0.2])
  assert.equal(repaired.actionCounts[3], 7)
})

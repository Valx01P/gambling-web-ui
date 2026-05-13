import test from 'node:test'
import assert from 'node:assert/strict'
import { SimulationRunner } from '../src/bots/simulator/SimulationRunner.js'
import { defaultCode } from '../src/bots/ruleSchema.js'

// Two rule bots with the default-code policy. Smoke test: hands run to
// completion, summary aggregates per-bot stats, ELO moves.
function ruleBot(id, name) {
  return {
    id,
    name,
    color: '#888',
    code: defaultCode(),
    elo: 1000,
    stats: { handsPlayed: 0, handsVoluntary: 0, handsWon: 0, showdownsPlayed: 0, showdownsWon: 0, bluffWins: 0 },
    isPublic: true,
    isNeural: false,
    isSuper: false,
    isClone: false,
    ownerUserId: 'sim-test-owner'
  }
}

test('SimulationRunner: handsCompleted equals numHands exactly (2 bots)', () => {
  for (const n of [5, 25, 100]) {
    const runner = new SimulationRunner({
      bots: [ruleBot('a', 'A'), ruleBot('b', 'B')],
      numHands: n,
      startingChips: 500,
      blinds: { sb: 5, bb: 10 }
    })
    const summary = runner.run()
    assert.equal(summary.handsRequested, n)
    assert.equal(summary.handsCompleted, n,
      `expected exactly ${n} hands, got ${summary.handsCompleted}`)
    for (const p of summary.participants) {
      assert.equal(p.sim.handsPlayed, n,
        `${p.name} should have played in all ${n} hands, got ${p.sim.handsPlayed}`)
      assert.equal(p.sim.chipsByHand.length, n)
    }
  }
})

test('SimulationRunner: 5-bot 100-hand run completes exactly 100 hands', () => {
  // Regression: a previous stuck-detector heuristic compared only
  // activeIndex (not phase) and produced false positives when the
  // engine advanced street and the first decider on the new street
  // happened to land on the same seat index. With 5 bots the
  // collision is common — runs would bail mid-flop after the first
  // hand, leaving `1/100` in the UI.
  const runner = new SimulationRunner({
    bots: [
      ruleBot('r1', 'A'),
      ruleBot('r2', 'B'),
      ruleBot('r3', 'C'),
      ruleBot('r4', 'D'),
      ruleBot('r5', 'E'),
    ],
    numHands: 100,
    startingChips: 1000,
    blinds: { sb: 5, bb: 10 }
  })
  const summary = runner.run()
  assert.equal(summary.handsCompleted, 100,
    `expected exactly 100 hands, got ${summary.handsCompleted}`)
  for (const p of summary.participants) {
    assert.equal(p.sim.handsPlayed, 100)
    assert.equal(p.sim.chipsByHand.length, 100)
  }
})

test('SimulationRunner: rule bots play to completion', () => {
  const runner = new SimulationRunner({
    bots: [ruleBot('a', 'Alice'), ruleBot('b', 'Bob')],
    numHands: 5,
    startingChips: 500,
    blinds: { sb: 5, bb: 10 }
  })
  const summary = runner.run()
  assert.equal(summary.handsRequested, 5)
  assert.equal(summary.handsCompleted, 5)
  assert.equal(summary.participants.length, 2)
  for (const p of summary.participants) {
    assert.equal(p.sim.handsPlayed, 5, `${p.name} should have played 5 hands`)
    // ELO can go up or down but should remain a finite number.
    assert.ok(Number.isFinite(p.eloAfter), `${p.name} elo not finite`)
    // before/after snapshots both present and rule bots have no neural digest.
    assert.ok(p.before && p.after, `${p.name} should have before+after`)
    assert.equal(p.before.neural, null)
    assert.equal(p.after.neural, null)
    // Lifetime counters include this run's hands.
    assert.equal(p.after.handsPlayed, p.before.handsPlayed + 5)
  }
})

test('SimulationRunner: every hand starts each bot at startingChips (no carry-over)', () => {
  // 20 hands at 500 starting chips. Cumulative P/L = sum of per-hand
  // deltas. If a bot somehow accumulated chips across hands, the per-
  // hand deltas would balloon as the stacks compounded — instead they
  // should each be bounded by ±500 (one bot's full stack going to the
  // other in a single all-in is the max possible swing).
  const runner = new SimulationRunner({
    bots: [ruleBot('a', 'Alice'), ruleBot('b', 'Bob')],
    numHands: 20,
    startingChips: 500,
    blinds: { sb: 5, bb: 10 }
  })
  const summary = runner.run()
  for (const p of summary.participants) {
    assert.ok(Array.isArray(p.sim.chipsByHand), `${p.name} chipsByHand should be an array`)
    assert.equal(p.sim.chipsByHand.length, p.sim.handsPlayed)
    for (const delta of p.sim.chipsByHand) {
      assert.ok(Math.abs(delta) <= 500,
        `${p.name} per-hand delta ${delta} exceeds starting stack — chips are leaking across hands`)
    }
    // Cumulative array's last value should equal the sum of per-hand
    // deltas AND the running chipsPL total.
    const sum = p.sim.chipsByHand.reduce((s, x) => s + x, 0)
    assert.equal(sum, p.sim.chipsPL)
    if (p.sim.chipsCumulative.length > 0) {
      assert.equal(p.sim.chipsCumulative[p.sim.chipsCumulative.length - 1], p.sim.chipsPL)
    }
    // Conservation: chips don't appear out of thin air — every chip
    // one bot won, the other lost. Per-hand sum across bots = 0.
  }
  // Zero-sum check: every chip won by one bot was lost by the others.
  if (summary.participants.length === 2) {
    const a = summary.participants[0].sim.chipsPL
    const b = summary.participants[1].sim.chipsPL
    assert.equal(a + b, 0, `chips should be zero-sum across the two bots, got ${a} + ${b}`)
  }
})

test('SimulationRunner: rejects bad input', () => {
  assert.throws(() => new SimulationRunner({ bots: [ruleBot('a', 'A')], numHands: 5 }),
    /2-5 participants/)
  assert.throws(() => new SimulationRunner({
    bots: [ruleBot('a', 'A'), ruleBot('b', 'B')],
    numHands: 0
  }), /between 1 and 5000/)
  assert.throws(() => new SimulationRunner({
    bots: [ruleBot('a', 'A'), ruleBot('b', 'B')],
    numHands: 999999
  }), /between 1 and 5000/)
})

test('SimulationRunner: neural bot trajectory + weight update', () => {
  // Lightweight neural bot — let the policy normalize its initial state
  // by passing an empty state. Goes head-to-head with a rule bot; we
  // just want to confirm `weightsAfter > weightsBefore` after some
  // hands, i.e. the training step is actually running.
  const neuralBot = {
    id: 'n1',
    name: 'NeuralBot',
    color: '#9cf',
    isNeural: true,
    neuralKind: 'reinforce',
    neuralState: null,
    elo: 1000,
    stats: {},
    isPublic: true,
    ownerUserId: 'sim-test-owner'
  }
  const runner = new SimulationRunner({
    bots: [neuralBot, ruleBot('rule1', 'Rules')],
    numHands: 10,
    startingChips: 500,
    blinds: { sb: 5, bb: 10 }
  })
  const summary = runner.run()
  const neural = summary.participants.find(p => p.botId === 'n1')
  assert.ok(neural, 'neural bot missing from summary')
  assert.equal(neural.isNeural, true)
  // Both snapshots carry the neural digest object with handsTrained,
  // weightMagnitude, actionCounts, etc.
  assert.ok(neural.before.neural, 'before.neural missing')
  assert.ok(neural.after.neural, 'after.neural missing')
  // Strict: after a 10-hand sim, the neural bot WILL have voluntarily
  // entered at least one pot (default action distribution puts non-
  // trivial probability mass on every action), which means `update()`
  // runs at least once and `handsTrained` increments.
  assert.ok(neural.after.neural.handsTrained > neural.before.neural.handsTrained,
    `handsTrained should be > before — training step never ran (got ${neural.before.neural.handsTrained} → ${neural.after.neural.handsTrained})`)
  // The action distribution should reflect actual decisions made
  // during the run — every action chosen contributes to the bot's
  // ACTION_COUNTS bucket.
  const totalActions = neural.after.neural.actionCounts.reduce((s, n) => s + n, 0)
  assert.ok(totalActions > 0, 'no actions recorded in action distribution after training')
  // Action counts is an array of NUM_ACTIONS (6) integers.
  assert.equal(neural.after.neural.actionCounts.length, 6)
  // Weight magnitude must be finite (training shouldn't blow up).
  assert.ok(Number.isFinite(neural.after.neural.weightMagnitude))
})

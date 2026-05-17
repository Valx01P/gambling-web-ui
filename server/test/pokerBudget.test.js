import test from 'node:test'
import assert from 'node:assert/strict'

import { Player } from '../src/players/PlayerManager.js'

// setPokerBudget moves chips between `chips` (on table) and
// `pokerReserves` (off-table) without creating or destroying any.
// These tests pin that invariant + the boundary cases.

function makePlayer(chips = 0) {
  const p = new Player('test-id', { readyState: 1, send: () => {} })
  p.chips = chips
  p.pokerReserves = 0
  return p
}

test('setPokerBudget(amount) shelves excess to reserves', () => {
  const p = makePlayer(10_000)
  const r = p.setPokerBudget(2_500)
  assert.equal(p.chips, 2_500)
  assert.equal(p.pokerReserves, 7_500)
  assert.equal(p.pokerBudget, 2_500)
  assert.equal(r.chipsDelta, -7_500)
  assert.equal(r.reservesDelta, 7_500)
})

test('setPokerBudget(amount) tops up from reserves to reach cap', () => {
  const p = makePlayer(500)
  p.pokerReserves = 5_000
  const r = p.setPokerBudget(3_000)
  assert.equal(p.chips, 3_000)
  assert.equal(p.pokerReserves, 2_500)
  assert.equal(p.pokerBudget, 3_000)
  assert.equal(r.chipsDelta, 2_500)
  assert.equal(r.reservesDelta, -2_500)
})

test('setPokerBudget partial top-up when reserves are thin', () => {
  const p = makePlayer(100)
  p.pokerReserves = 50
  p.setPokerBudget(1_000)
  // Reserves drained, chips up to 100 + 50, cap still recorded at 1000.
  assert.equal(p.chips, 150)
  assert.equal(p.pokerReserves, 0)
  assert.equal(p.pokerBudget, 1_000)
})

test('setPokerBudget(null) folds reserves back to the table', () => {
  const p = makePlayer(2_000)
  p.pokerReserves = 8_000
  p.pokerBudget = 2_000
  const r = p.setPokerBudget(null)
  assert.equal(p.chips, 10_000)
  assert.equal(p.pokerReserves, 0)
  assert.equal(p.pokerBudget, null)
  assert.equal(r.chipsDelta, 8_000)
  assert.equal(r.reservesDelta, -8_000)
})

test('setPokerBudget conserves total chips', () => {
  const p = makePlayer(10_000)
  const total1 = p.chips + p.pokerReserves
  p.setPokerBudget(1_500)
  assert.equal(p.chips + p.pokerReserves, total1)
  p.setPokerBudget(8_000)
  assert.equal(p.chips + p.pokerReserves, total1)
  p.setPokerBudget(null)
  assert.equal(p.chips + p.pokerReserves, total1)
})

test('setPokerBudget with no-change is a no-op', () => {
  const p = makePlayer(5_000)
  p.setPokerBudget(2_000)
  // chips=2000, reserves=3000 now. Calling with 2000 again should
  // not move chips around.
  const r = p.setPokerBudget(2_000)
  assert.equal(p.chips, 2_000)
  assert.equal(p.pokerReserves, 3_000)
  assert.equal(r.chipsDelta, 0)
  assert.equal(r.reservesDelta, 0)
})

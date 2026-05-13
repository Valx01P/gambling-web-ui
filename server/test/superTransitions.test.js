import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  initialSuperState, normalizeSuperState,
  pickNextMember, applyHandResult,
  MODES, DEFAULT_MODE
} from '../src/bots/super/transitions.js'

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

test('initialSuperState seeds a stats row per member', () => {
  const s = initialSuperState({ memberIds: [A, B, C] })
  assert.equal(s.mode, DEFAULT_MODE)
  for (const id of [A, B, C]) {
    assert.ok(s.members[id])
    assert.equal(s.members[id].actions, 0)
    assert.equal(s.members[id].wins, 0)
  }
})

test('normalizeSuperState adds rows for new members + keeps existing', () => {
  const old = {
    mode: 'thompson',
    handsTrained: 7,
    members: { [A]: { actions: 10, wins: 4, hands: 7, totalReward: 0.5 } }
  }
  const next = normalizeSuperState(old, [A, B])
  assert.equal(next.members[A].actions, 10) // preserved
  assert.equal(next.members[B].actions, 0)  // new
  assert.equal(next.handsTrained, 7)
})

test('uniform mode picks every member roughly equally', () => {
  const s = initialSuperState({ mode: 'uniform', memberIds: [A, B, C] })
  const counts = { 0: 0, 1: 0, 2: 0 }
  for (let i = 0; i < 3000; i++) counts[pickNextMember(s, [A, B, C])]++
  // Each should be ~1000. Allow generous wiggle for Math.random variance.
  for (const c of Object.values(counts)) assert.ok(c > 800 && c < 1200, `uniform skew: ${c}`)
})

test('Thompson sampling converges to the member with higher win rate', () => {
  const s = initialSuperState({ mode: 'thompson', memberIds: [A, B] })
  // Pretend B has played 60 hands and won 50; A played 60 lost 50.
  s.members[A] = { actions: 60, hands: 60, wins: 10, totalReward: -30 }
  s.members[B] = { actions: 60, hands: 60, wins: 50, totalReward: 30 }
  let bWins = 0
  for (let i = 0; i < 400; i++) if (pickNextMember(s, [A, B]) === 1) bWins++
  // Thompson should pick B way more than half the time.
  assert.ok(bWins > 320, `thompson should prefer the winner, got ${bWins}/400`)
})

test('weighted mode prefers higher-reward members', () => {
  const s = initialSuperState({ mode: 'weighted', memberIds: [A, B] })
  s.members[A] = { actions: 30, hands: 30, wins: 5, totalReward: -10 }
  s.members[B] = { actions: 30, hands: 30, wins: 25, totalReward: 20 }
  let bWins = 0
  for (let i = 0; i < 400; i++) if (pickNextMember(s, [A, B]) === 1) bWins++
  assert.ok(bWins > 250, `weighted should prefer the winner, got ${bWins}/400`)
})

test('applyHandResult bumps wins on positive reward + transitions on win', () => {
  const s = initialSuperState({ mode: 'markov', memberIds: [A, B, C] })
  // Trajectory: A acted twice, then B, then C — and we won the hand.
  applyHandResult(s, [A, A, B, C], 0.4)
  assert.equal(s.members[A].wins, 1)
  assert.equal(s.members[B].wins, 1)
  assert.equal(s.members[C].wins, 1)
  assert.equal(s.members[A].actions, 2)
  assert.equal(s.members[B].actions, 1)
  // Transitions only recorded on win — A→B and B→C should have count 1.
  assert.equal(s.transitions[A][B], 1)
  assert.equal(s.transitions[B][C], 1)
  // No A→A self-loop even though A acted twice in a row.
  assert.ok(!s.transitions[A][A])
})

test('applyHandResult: loss does not bump win counts or transitions', () => {
  const s = initialSuperState({ mode: 'markov', memberIds: [A, B] })
  applyHandResult(s, [A, B, A], -0.5)
  assert.equal(s.members[A].wins, 0)
  assert.equal(s.members[B].wins, 0)
  assert.equal(s.members[A].hands, 1)
  // Reward is negative — totalReward should reflect it (per-member).
  assert.ok(s.members[A].totalReward < 0)
  // No transitions added on a loss.
  assert.deepEqual(s.transitions, {})
})

test('Markov mode falls back to Thompson on the first pick of a session', () => {
  const s = initialSuperState({ mode: 'markov', memberIds: [A, B] })
  s.members[A] = { actions: 0, hands: 0, wins: 0, totalReward: 0 }
  s.members[B] = { actions: 50, hands: 50, wins: 50, totalReward: 20 } // dominant
  // Without a current member, markov shouldn't lock onto a guess —
  // it falls back to thompson which heavily favors B.
  let bPicks = 0
  for (let i = 0; i < 200; i++) if (pickNextMember(s, [A, B], null) === 1) bPicks++
  assert.ok(bPicks > 150, `markov-cold-start should defer to thompson, got ${bPicks}/200`)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOpponentPatterns, summarizeTable } from '../src/bots/runtime/opponentPatterns.js'

function pat(overrides = {}) {
  return computeOpponentPatterns({
    playerId: 'opp',
    rawStats: { handsObserved: 10, vpipHands: 3, aggressiveActions: 2, showdownsSeen: 2, showdownsWon: 1 },
    currentHandActions: [],
    handHistory: [],
    bigBlind: 10,
    myChips: 1000,
    oppChips: 1000,
    oppRevealedShowdowns: [],
    ...overrides
  })
}

test('archetype: TAG when tight + aggressive', () => {
  const p = pat({
    rawStats: { handsObserved: 30, vpipHands: 6, aggressiveActions: 8 }
  })
  assert.equal(p.archetype, 'tag')
  assert.equal(p.aggressionBias, 'balanced')
})

test('archetype: maniac when loose + very aggressive', () => {
  const p = pat({
    rawStats: { handsObserved: 30, vpipHands: 18, aggressiveActions: 14 }
  })
  assert.equal(p.archetype, 'maniac')
  assert.equal(p.aggressionBias, 'over_aggressive')
})

test('archetype: fish when loose + passive', () => {
  const p = pat({
    rawStats: { handsObserved: 30, vpipHands: 18, aggressiveActions: 1 }
  })
  assert.equal(p.archetype, 'fish')
  assert.equal(p.aggressionBias, 'passive')
})

test('archetype: nit when tight + passive', () => {
  const p = pat({
    rawStats: { handsObserved: 30, vpipHands: 2, aggressiveActions: 1 }
  })
  assert.equal(p.archetype, 'nit')
})

test('archetype: unknown without enough data', () => {
  const p = pat({
    rawStats: { handsObserved: 3, vpipHands: 1, aggressiveActions: 1 }
  })
  assert.equal(p.archetype, 'unknown')
  assert.equal(p.sampleConfidence, 'low')
})

test('bluffer flag fires when reveals are weak hands', () => {
  const p = pat({
    rawStats: { handsObserved: 20, vpipHands: 8, aggressiveActions: 7 },
    oppRevealedShowdowns: [
      { cards: [{ rank: '7', suit: 'spades' }, { rank: '2', suit: 'hearts' }], won: true,  handName: 'High Card', pot: 200, handIndex: 1 },
      { cards: [{ rank: '8', suit: 'spades' }, { rank: '3', suit: 'hearts' }], won: false, handName: 'High Card', pot: 200, handIndex: 2 },
      { cards: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }], won: true,  handName: 'Pair',      pot: 200, handIndex: 3 }
    ]
  })
  assert.equal(p.bluffer, true)
  assert.ok(p.showdownBluffRate >= 0.20)
})

test('sticky caller: high wtsd + low aggression', () => {
  const p = pat({
    rawStats: { handsObserved: 20, vpipHands: 12, aggressiveActions: 2, showdownsSeen: 10, showdownsWon: 4 }
  })
  assert.equal(p.stickyCaller, true)
})

test('stackBB and bbToBust reflect the player\'s own stack in BB', () => {
  const p = pat({ oppChips: 320, bigBlind: 10 })
  assert.equal(p.stackBB, 32)
  assert.equal(p.bbToBust, 32)
})

test('tilt flag triggers on big recent losses', () => {
  const handHistory = [
    { handIndex: 1, profitByPlayer: { opp: -100 }, winners: [], actions: [] },
    { handIndex: 2, profitByPlayer: { opp: -80 },  winners: [], actions: [] },
    { handIndex: 3, profitByPlayer: { opp: -50 },  winners: [], actions: [] }
  ]
  const p = pat({ handHistory, bigBlind: 10 })
  assert.equal(p.tilt, 'tilted')
  assert.ok(p.recentLossBB >= 20)
})

test('c-bet frequency: opener that fires every flop = 1.0', () => {
  const handHistory = [
    {
      handIndex: 1,
      actions: [
        { seq: 1, phase: 'preflop', playerId: 'opp', action: 'raise', amount: 30 },
        { seq: 2, phase: 'preflop', playerId: 'me',  action: 'call',  amount: 30 },
        { seq: 3, phase: 'flop',    playerId: 'opp', action: 'raise', amount: 50 }
      ],
      profitByPlayer: {},
      winners: []
    },
    {
      handIndex: 2,
      actions: [
        { seq: 1, phase: 'preflop', playerId: 'opp', action: 'raise', amount: 30 },
        { seq: 2, phase: 'preflop', playerId: 'me',  action: 'call',  amount: 30 },
        { seq: 3, phase: 'flop',    playerId: 'opp', action: 'raise', amount: 70 }
      ],
      profitByPlayer: {},
      winners: []
    }
  ]
  const p = pat({ handHistory })
  assert.equal(p.cBetFreq, 1)
})

test('check-raise count picks up check-then-raise on same street', () => {
  const handHistory = [
    {
      handIndex: 1,
      actions: [
        { seq: 1, phase: 'preflop', playerId: 'me',  action: 'raise', amount: 30 },
        { seq: 2, phase: 'preflop', playerId: 'opp', action: 'call',  amount: 30 },
        { seq: 3, phase: 'flop',    playerId: 'opp', action: 'check', amount: 0 },
        { seq: 4, phase: 'flop',    playerId: 'me',  action: 'raise', amount: 60 },
        { seq: 5, phase: 'flop',    playerId: 'opp', action: 'raise', amount: 180 }
      ],
      profitByPlayer: {},
      winners: []
    }
  ]
  const p = pat({ handHistory })
  assert.equal(p.checkRaises, 1)
})

test('summarizeTable rolls up archetypes', () => {
  const patterns = [
    { archetype: 'nit',    tilt: 'normal',  bluffer: false, stickyCaller: false },
    { archetype: 'nit',    tilt: 'normal',  bluffer: false, stickyCaller: false },
    { archetype: 'maniac', tilt: 'tilted',  bluffer: true,  stickyCaller: false },
    { archetype: 'fish',   tilt: 'normal',  bluffer: false, stickyCaller: true }
  ]
  const s = summarizeTable(patterns)
  assert.equal(s.dominantArchetype, 'nit')
  assert.equal(s.tightTable, true)
  assert.equal(s.tiltedSeats, 1)
  assert.equal(s.bluffers, 1)
  assert.equal(s.stickyCallers, 1)
})

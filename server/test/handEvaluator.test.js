// Fuzz-test the fast bitmask evaluator (scoreHand) against the canonical
// evaluateHand + compareHands. Both must agree on the relative ordering of
// every pair of random 7-card hands — that's all the MC equity loop needs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHand, compareHands, scoreHand } from '../src/poker/handEvaluator.js'

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function fullDeck() {
  const d = []
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r })
  return d
}

function dealRandom(deck, n) {
  const out = []
  const taken = new Set()
  while (out.length < n) {
    const i = Math.floor(Math.random() * deck.length)
    if (taken.has(i)) continue
    taken.add(i)
    out.push(deck[i])
  }
  return out
}

test('scoreHand agrees with evaluateHand+compareHands on random 7-card hands', () => {
  const deck = fullDeck()
  const N = 2000
  let mismatches = 0
  for (let i = 0; i < N; i++) {
    const a = dealRandom(deck, 7)
    const b = dealRandom(deck, 7)
    const evalA = evaluateHand(a)
    const evalB = evaluateHand(b)
    const refSign = Math.sign(compareHands(evalA, evalB))
    const scoreA = scoreHand(a)
    const scoreB = scoreHand(b)
    const fastSign = Math.sign(scoreA - scoreB)
    if (refSign !== fastSign) {
      mismatches += 1
      if (mismatches <= 3) {
        console.error('mismatch:', { a, b, evalA, evalB, scoreA, scoreB, refSign, fastSign })
      }
    }
  }
  assert.equal(mismatches, 0, `${mismatches}/${N} ordering mismatches between scoreHand and evaluateHand`)
})

test('scoreHand: straight flush beats four of a kind', () => {
  const sf = [
    { suit: 'hearts', rank: '9' }, { suit: 'hearts', rank: '10' },
    { suit: 'hearts', rank: 'J' }, { suit: 'hearts', rank: 'Q' },
    { suit: 'hearts', rank: 'K' }, { suit: 'diamonds', rank: '2' },
    { suit: 'clubs', rank: '3' }
  ]
  const quads = [
    { suit: 'hearts', rank: 'A' }, { suit: 'diamonds', rank: 'A' },
    { suit: 'clubs', rank: 'A' }, { suit: 'spades', rank: 'A' },
    { suit: 'hearts', rank: '2' }, { suit: 'diamonds', rank: '3' },
    { suit: 'clubs', rank: '4' }
  ]
  assert.ok(scoreHand(sf) > scoreHand(quads))
})

test('scoreHand: wheel straight (A-2-3-4-5) is the lowest straight', () => {
  const wheel = [
    { suit: 'hearts', rank: 'A' }, { suit: 'diamonds', rank: '2' },
    { suit: 'clubs', rank: '3' }, { suit: 'spades', rank: '4' },
    { suit: 'hearts', rank: '5' }, { suit: 'diamonds', rank: 'K' },
    { suit: 'clubs', rank: 'J' }
  ]
  const sixHigh = [
    { suit: 'hearts', rank: '2' }, { suit: 'diamonds', rank: '3' },
    { suit: 'clubs', rank: '4' }, { suit: 'spades', rank: '5' },
    { suit: 'hearts', rank: '6' }, { suit: 'diamonds', rank: 'K' },
    { suit: 'clubs', rank: 'J' }
  ]
  assert.ok(scoreHand(sixHigh) > scoreHand(wheel))
})

test('scoreHand: royal flush is the strongest possible hand', () => {
  const royal = [
    { suit: 'spades', rank: '10' }, { suit: 'spades', rank: 'J' },
    { suit: 'spades', rank: 'Q' }, { suit: 'spades', rank: 'K' },
    { suit: 'spades', rank: 'A' }, { suit: 'hearts', rank: '2' },
    { suit: 'diamonds', rank: '3' }
  ]
  const sf = [
    { suit: 'spades', rank: '9' }, { suit: 'spades', rank: '10' },
    { suit: 'spades', rank: 'J' }, { suit: 'spades', rank: 'Q' },
    { suit: 'spades', rank: 'K' }, { suit: 'hearts', rank: '2' },
    { suit: 'diamonds', rank: '3' }
  ]
  assert.ok(scoreHand(royal) > scoreHand(sf))
})

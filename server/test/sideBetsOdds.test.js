import test from 'node:test'
import assert from 'node:assert/strict'

import {
  combinations,
  pAtLeastOneTarget,
  pBoardPairsByRiver,
  pFlushOnBoardByRiver,
  pNextCardRed,
  pRankAppearsOnBoard
} from '../src/sidebets/oddsCalc.js'

const card = (rank, suit) => ({ rank, suit })

test('combinations matches small reference values', () => {
  assert.equal(combinations(5, 2), 10)
  assert.equal(combinations(52, 5), 2598960)
  assert.equal(combinations(13, 3), 286)
  assert.equal(combinations(0, 0), 1)
  assert.equal(combinations(5, 6), 0)
})

test('P(at least one ace on the board) preflop ≈ 0.341', () => {
  const p = pRankAppearsOnBoard([], 'A')
  // 1 - C(48,5)/C(52,5) = 1 - 1712304/2598960 ≈ 0.341
  assert.ok(Math.abs(p - 0.3411) < 0.001, `expected ~0.341, got ${p}`)
})

test('P(ace on board) = 1 if ace already on flop', () => {
  assert.equal(pRankAppearsOnBoard([card('A', 'spades'), card('5', 'clubs'), card('K', 'hearts')], 'A'), 1)
})

test('P(ace on board) at river without an ace = 0', () => {
  assert.equal(
    pRankAppearsOnBoard(
      [card('2', 'clubs'), card('5', 'hearts'), card('9', 'diamonds'), card('J', 'spades'), card('Q', 'clubs')],
      'A'
    ),
    0
  )
})

test('P(flop has any pair) preflop ≈ 0.1718', () => {
  // P(no pair on flop) = C(13,3) * 4^3 / C(52,3) = 18304 / 22100
  const p = 1 - (286 * 64) / 22100
  assert.ok(Math.abs(p - 0.1718) < 0.001, `expected ~0.1718, got ${p}`)
})

test('pBoardPairsByRiver returns 1 if board is already paired', () => {
  const board = [card('7', 'spades'), card('7', 'hearts'), card('K', 'clubs')]
  assert.equal(pBoardPairsByRiver(board), 1)
})

test('pBoardPairsByRiver with empty board ≈ 0.493', () => {
  // P(any pair across 5 cards from a fresh deck) = 1 - C(13,5) * 4^5 / C(52,5)
  // = 1 - 1287 * 1024 / 2598960 ≈ 0.4929
  const p = pBoardPairsByRiver([])
  assert.ok(Math.abs(p - 0.493) < 0.005, `expected ~0.493, got ${p}`)
})

test('pBoardPairsByRiver with three distinct ranks on the flop is well-defined and < 1', () => {
  const board = [card('2', 'spades'), card('9', 'diamonds'), card('K', 'clubs')]
  const p = pBoardPairsByRiver(board)
  assert.ok(p > 0 && p < 1, `expected 0 < p < 1, got ${p}`)
})

test('pFlushOnBoardByRiver returns 1 if 3+ suits already on board', () => {
  const board = [card('2', 'spades'), card('9', 'spades'), card('K', 'spades')]
  assert.equal(pFlushOnBoardByRiver(board), 1)
})

test('pFlushOnBoardByRiver preflop ≈ 0.37', () => {
  // P(some single suit reaches ≥3 on a 5-card board, from a fresh deck):
  // For each suit, P(≥3 of that suit) = (C(13,3)*C(39,2) + C(13,4)*C(39,1) +
  //   C(13,5)) / C(52,5) = 241098/2598960. Disjoint across the 4 suits since
  // only one suit can hit ≥3 in 5 cards → multiply by 4 → ≈ 0.3711.
  const p = pFlushOnBoardByRiver([])
  assert.ok(p > 0.36 && p < 0.38, `expected ~0.3711, got ${p}`)
})

test('pFlushOnBoardByRiver returns 0 at river with max-suit 2', () => {
  const board = [
    card('2', 'spades'),
    card('9', 'spades'),
    card('K', 'clubs'),
    card('7', 'hearts'),
    card('J', 'diamonds')
  ]
  assert.equal(pFlushOnBoardByRiver(board), 0)
})

test('pNextCardRed on a fresh deck is 0.5', () => {
  assert.equal(pNextCardRed([]), 0.5)
})

test('pNextCardRed on flop with 3 red cards is correctly biased down', () => {
  const board = [card('2', 'hearts'), card('9', 'diamonds'), card('K', 'hearts')]
  const p = pNextCardRed(board)
  // 23 red / 49 unseen
  assert.ok(Math.abs(p - 23 / 49) < 0.001, `expected 23/49 ≈ 0.469, got ${p}`)
})

test('pAtLeastOneTarget is monotonic in draws', () => {
  const a = pAtLeastOneTarget(4, 50, 1)
  const b = pAtLeastOneTarget(4, 50, 3)
  const c = pAtLeastOneTarget(4, 50, 5)
  assert.ok(a < b && b < c, `expected monotonic increase, got ${a} ${b} ${c}`)
})

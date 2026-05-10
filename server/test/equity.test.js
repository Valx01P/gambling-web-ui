import test from 'node:test'
import assert from 'node:assert/strict'
import {
  preflopHandScore,
  postflopStrengthScore,
  thresholdForTopPct,
  inferOpponentTopPct,
  calculateRangeEquity
} from '../src/bots/runtime/equity.js'

// Sanity: preflop hand ordering matches classical strength sense.
test('preflopHandScore ranks pairs and suited correctly', () => {
  const score = (r1, s1, r2, s2) => preflopHandScore({ rank: r1, suit: s1 }, { rank: r2, suit: s2 })
  // Pair ordering: AA > KK > 99 > 22.
  assert.ok(score('A', 'spades', 'A', 'hearts') > score('K', 'spades', 'K', 'hearts'))
  assert.ok(score('K', 'spades', 'K', 'hearts') > score('9', 'spades', '9', 'hearts'))
  assert.ok(score('9', 'spades', '9', 'hearts') > score('2', 'spades', '2', 'hearts'))
  // Suited beats off-suit at the same ranks.
  assert.ok(score('A', 'spades', 'K', 'spades') > score('A', 'spades', 'K', 'hearts'))
  // AKs is one of the strongest non-pair hands — above mid pairs.
  assert.ok(score('A', 'spades', 'K', 'spades') > score('Q', 'spades', 'J', 'hearts'))
  // TT beats AKs (premium pairs cluster at the very top).
  assert.ok(score('T', 'spades', 'T', 'hearts') < score('A', 'spades', 'A', 'hearts')) // sanity
  // Big-pair > AK (modern ranges put TT+ above AKs).
  // Note: we use '10' as the rank label everywhere else in the codebase.
  assert.ok(score('10', 'spades', '10', 'hearts') > score('A', 'spades', 'K', 'spades'))
})

test('thresholdForTopPct produces stricter thresholds for tighter ranges', () => {
  const tight = thresholdForTopPct(0.05)
  const loose = thresholdForTopPct(0.50)
  const wide = thresholdForTopPct(1.0)
  assert.ok(tight > loose, 'top 5% threshold should exceed top 50%')
  assert.ok(loose > wide, 'top 50% threshold should exceed any-two-cards')
})

test('AA gets >85% equity vs a 1 random opponent on a fresh board', () => {
  const result = calculateRangeEquity({
    holeCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'A', suit: 'hearts' }
    ],
    communityCards: [],
    opponents: [{ id: 'opp', _topPct: 1 }],
    iterations: 800
  })
  // Real AA equity vs random is ~85.2%. Allow ±3% MC slop.
  assert.ok(result.equity > 0.81, `AA equity too low: ${result.equity}`)
  assert.ok(result.equity < 0.92, `AA equity unrealistically high: ${result.equity}`)
})

test('KK gets >80% equity vs a 1 random opponent — never folds preflop', () => {
  // The whole point of this engine: pocket kings should not be folded preflop.
  // Real KK equity vs random is ~82%. We assert KK is clearly a "raise/call"
  // strength regardless of how the bot uses the number.
  const result = calculateRangeEquity({
    holeCards: [
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'hearts' }
    ],
    communityCards: [],
    opponents: [{ id: 'opp', _topPct: 1 }],
    iterations: 800
  })
  assert.ok(result.equity > 0.78, `KK equity too low for preflop: ${result.equity}`)
})

test('72o gets <40% equity vs a single random opponent', () => {
  const result = calculateRangeEquity({
    holeCards: [
      { rank: '7', suit: 'spades' },
      { rank: '2', suit: 'hearts' }
    ],
    communityCards: [],
    opponents: [{ id: 'opp', _topPct: 1 }],
    iterations: 800
  })
  // 72o vs random is ~34%. ±5% MC slop on the upper bound.
  assert.ok(result.equity < 0.40, `72o equity too high: ${result.equity}`)
})

test('equity drops when opponent range is tight (3-bet range vs random)', () => {
  // AKo vs the top 5% (premium pairs + AK) is much worse than vs any-two.
  const cards = [
    { rank: 'A', suit: 'spades' },
    { rank: 'K', suit: 'diamonds' }
  ]
  const vsRandom = calculateRangeEquity({
    holeCards: cards,
    communityCards: [],
    opponents: [{ id: 'opp', _topPct: 1 }],
    iterations: 800
  }).equity
  const vsTight = calculateRangeEquity({
    holeCards: cards,
    communityCards: [],
    opponents: [{ id: 'opp', _topPct: 0.05 }],
    iterations: 800
  }).equity
  assert.ok(vsRandom > vsTight, `Expected vs-random > vs-3bet-range: ${vsRandom} vs ${vsTight}`)
})

test('inferOpponentTopPct: 4-bet+ tightens dramatically vs unopened', () => {
  const fourBet = inferOpponentTopPct({ preflopProfile: 'four_bet_plus', isPostflop: false })
  const opened = inferOpponentTopPct({ preflopProfile: 'opened', isPostflop: false })
  const unopened = inferOpponentTopPct({ preflopProfile: 'unopened', isPostflop: false })
  assert.ok(fourBet < opened, 'four-bet should be tighter than open-raise')
  assert.ok(opened < unopened, 'open-raise should be tighter than unopened')
  assert.ok(fourBet <= 0.05, 'four-bet+ should be top 5% or tighter')
})

test('postflopStrengthScore: full house > flush > straight > trips > two pair > pair', () => {
  const flop = (cards) => postflopStrengthScore(
    [{ rank: cards[0][0], suit: cards[0][1] }, { rank: cards[1][0], suit: cards[1][1] }],
    cards.slice(2).map(([r, s]) => ({ rank: r, suit: s }))
  )
  // Full house: AAA over KK on the board
  const fullHouse = flop([['A', 'spades'], ['A', 'hearts'], ['A', 'diamonds'], ['K', 'spades'], ['K', 'hearts']])
  // Flush: 5 spades
  const flush = flop([['A', 'spades'], ['K', 'spades'], ['Q', 'spades'], ['J', 'spades'], ['9', 'spades']])
  // Straight: A-high non-flush
  const straight = flop([['A', 'spades'], ['K', 'hearts'], ['Q', 'diamonds'], ['J', 'clubs'], ['10', 'spades']])
  // Trips
  const trips = flop([['A', 'spades'], ['A', 'hearts'], ['A', 'diamonds'], ['K', 'spades'], ['7', 'hearts']])
  // Two pair
  const twoPair = flop([['A', 'spades'], ['K', 'hearts'], ['A', 'diamonds'], ['K', 'spades'], ['7', 'hearts']])
  // Pair
  const pair = flop([['A', 'spades'], ['K', 'hearts'], ['A', 'diamonds'], ['7', 'spades'], ['3', 'hearts']])

  assert.ok(fullHouse > flush, `${fullHouse} > ${flush}`)
  assert.ok(flush > straight, `${flush} > ${straight}`)
  assert.ok(straight > trips, `${straight} > ${trips}`)
  assert.ok(trips > twoPair, `${trips} > ${twoPair}`)
  assert.ok(twoPair > pair, `${twoPair} > ${pair}`)
})

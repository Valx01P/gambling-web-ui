import test from 'node:test'
import assert from 'node:assert/strict'
import {
  performanceScore,
  eloDelta,
  isBluffWin,
  kFactor,
  STARTING_RATING,
  RATING_FLOOR
} from '../src/bots/runtime/eloEngine.js'

test('starting rating is 500 and floor is 300', () => {
  assert.equal(STARTING_RATING, 500)
  assert.equal(RATING_FLOOR, 300)
})

test('kFactor: provisional > settled > established', () => {
  assert.ok(kFactor(0) > kFactor(50))
  assert.ok(kFactor(50) > kFactor(500))
})

test('performanceScore: voluntary win at showdown beats blind-fold', () => {
  const win = performanceScore({
    won: true, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: 200, bigBlind: 10, vpipRate: 0.30
  })
  const fold = performanceScore({
    foldedPreflop: true, voluntarilyIn: false,
    chipsDelta: -5, bigBlind: 10, vpipRate: 0.30
  })
  assert.ok(win > fold, `win ${win} should beat blind-fold ${fold}`)
  // With healthy VPIP and a non-trivial chip delta, a showdown win should
  // come out near or above 1.0 (we cap the return at 1.05).
  assert.ok(win >= 1.0, `showdown-win score should be ≥ 1.0 with healthy VPIP: ${win}`)
})

test('performanceScore: voluntary loss is worse than blind-fold', () => {
  const loss = performanceScore({
    won: false, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: -300, bigBlind: 10
  })
  const fold = performanceScore({
    foldedPreflop: true, voluntarilyIn: false,
    chipsDelta: -5, bigBlind: 10
  })
  assert.ok(loss < fold, `loss ${loss} should be worse than blind-fold ${fold}`)
})

test('performanceScore: bluff win adds bonus on top of fold-out win', () => {
  const plain = performanceScore({
    won: true, voluntarilyIn: true, wentToShowdown: false,
    chipsDelta: 50, bigBlind: 10
  })
  const bluff = performanceScore({
    won: true, voluntarilyIn: true, wentToShowdown: false,
    chipsDelta: 50, bigBlind: 10, bluffWin: true, postflopRaises: 1
  })
  assert.ok(bluff > plain, `bluff win ${bluff} should beat plain fold-out ${plain}`)
})

test('performanceScore: variety multiplier rewards looser play', () => {
  // Same outcome, different VPIP rates.
  const nit = performanceScore({
    won: true, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: 200, bigBlind: 10, vpipRate: 0.05
  })
  const balanced = performanceScore({
    won: true, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: 200, bigBlind: 10, vpipRate: 0.30
  })
  assert.ok(balanced > nit, `balanced VPIP ${balanced} should outscore nit ${nit}`)
})

test('eloDelta: equal ratings score=0.5 → ~0 change', () => {
  const d = eloDelta({ rating: 500, opponentRatings: [500, 500, 500], score: 0.5, handsPlayed: 100 })
  assert.ok(Math.abs(d) <= 1, `expected ~0 delta, got ${d}`)
})

test('eloDelta: winning bot at lower rating gains points; underdog upset', () => {
  const underdogWin = eloDelta({ rating: 400, opponentRatings: [800], score: 1.0, handsPlayed: 50 })
  const favoredWin = eloDelta({ rating: 800, opponentRatings: [400], score: 1.0, handsPlayed: 50 })
  assert.ok(underdogWin > favoredWin, `underdog gain ${underdogWin} should beat favored gain ${favoredWin}`)
  assert.ok(underdogWin > 10, `underdog gain too small: ${underdogWin}`)
})

test('eloDelta: losing as favorite costs more than losing as underdog', () => {
  const favoredLoss = eloDelta({ rating: 800, opponentRatings: [400], score: 0.0, handsPlayed: 50 })
  const underdogLoss = eloDelta({ rating: 400, opponentRatings: [800], score: 0.0, handsPlayed: 50 })
  assert.ok(favoredLoss < underdogLoss, `favored loss ${favoredLoss} should be more negative than underdog loss ${underdogLoss}`)
})

test('isBluffWin: true for fold-out aggressor with weak preflop', () => {
  // 7-2o is the textbook trash hand; sub-50% preflop score.
  const result = isBluffWin({
    won: true,
    wentToShowdown: false,
    voluntarilyIn: true,
    postflopRaises: 2,
    holeCards: [
      { rank: '7', suit: 'spades' },
      { rank: '2', suit: 'hearts' }
    ]
  })
  assert.equal(result, true)
})

test('isBluffWin: false when winning showdown with weak hand', () => {
  // Lucky river with 7-2o doesn't count as a bluff — it went to showdown.
  const result = isBluffWin({
    won: true,
    wentToShowdown: true,
    voluntarilyIn: true,
    postflopRaises: 2,
    holeCards: [
      { rank: '7', suit: 'spades' },
      { rank: '2', suit: 'hearts' }
    ]
  })
  assert.equal(result, false)
})

test('isBluffWin: false with premium hand even on fold-out win', () => {
  // KK winning by fold-out is "got there with a strong hand", not a bluff.
  const result = isBluffWin({
    won: true,
    wentToShowdown: false,
    voluntarilyIn: true,
    postflopRaises: 1,
    holeCards: [
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'hearts' }
    ]
  })
  assert.equal(result, false)
})

test('integration: dominant bot pulls ahead of weak bot over many hands', () => {
  // Two abstract bots play 300 hands head-to-head. Elite scores 0.80 average
  // (clearly beating the other), weak scores 0.20. Equilibrium gap from
  // standard ELO math: 200 * log10(0.8/0.2) ≈ 120 points. We assert ≥ 100
  // to give MC variance room.
  let elite = STARTING_RATING
  let weak = STARTING_RATING
  let elitePlayed = 0
  let weakPlayed = 0
  for (let i = 0; i < 300; i++) {
    const eDelta = eloDelta({
      rating: elite,
      opponentRatings: [weak],
      score: 0.80 + (Math.random() - 0.5) * 0.1,
      handsPlayed: elitePlayed
    })
    const wDelta = eloDelta({
      rating: weak,
      opponentRatings: [elite],
      score: 0.20 + (Math.random() - 0.5) * 0.1,
      handsPlayed: weakPlayed
    })
    elite = Math.max(RATING_FLOOR, elite + eDelta)
    weak = Math.max(RATING_FLOOR, weak + wDelta)
    elitePlayed++; weakPlayed++
  }
  assert.ok(elite > weak + 100, `elite ${elite} should pull ahead of weak ${weak} by 100+`)
  assert.ok(elite > STARTING_RATING + 30, `elite ${elite} should clearly climb above ${STARTING_RATING}`)
  assert.ok(weak < STARTING_RATING - 30, `weak ${weak} should clearly drop below ${STARTING_RATING}`)
})

test('integration: weak bot floors at RATING_FLOOR vs equal opponents', () => {
  // Bot loses every hand against same-rated opponents. Expected = 0.5, score
  // = 0.0, so delta = -K/2 each hand. With provisional K=40 that's -20/hand,
  // reaching floor (500 → 300) in ~10 hands. Floor enforcement should hold.
  let r = STARTING_RATING
  let played = 0
  // Opponent rating tracks the bot so the gap never blows up.
  for (let i = 0; i < 100; i++) {
    const d = eloDelta({ rating: r, opponentRatings: [r], score: 0.0, handsPlayed: played })
    r = Math.max(RATING_FLOOR, r + d)
    played++
  }
  assert.equal(r, RATING_FLOOR, `rating should bottom at ${RATING_FLOOR}, got ${r}`)
})

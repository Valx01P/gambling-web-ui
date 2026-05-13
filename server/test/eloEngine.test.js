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

test('performanceScore: well-played showdown win beats sat-out hand', () => {
  // New (skill-first) scoring: a great-quality showdown win still
  // outscores a hand the bot folded preflop without acting. The exact
  // magnitude is much smaller than the old multiplier-based math
  // (~0.92 vs ~0.50) because we no longer multiply by 1.10 variety;
  // we just want win > sat-out, which still holds.
  const win = performanceScore({
    actionQualities: [+0.6, +0.6, +0.6],  // consistent strong play
    won: true, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: 200, bigBlind: 10
  })
  const fold = performanceScore({
    actionQualities: [],
    foldedPreflop: true, voluntarilyIn: false,
    chipsDelta: -5, bigBlind: 10
  })
  assert.ok(win > fold, `win ${win} should beat sat-out fold ${fold}`)
  // Well-played hands sit comfortably above 0.5 (the neutral anchor).
  assert.ok(win > 0.7, `well-played showdown win should score > 0.7: ${win}`)
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

test('performanceScore: better decision quality outscores worse', () => {
  // Replaces the old variety-multiplier test. Same outcome (won at
  // showdown with the same chip swing); the only difference is mean
  // action quality. Skill-first scoring should put the higher-quality
  // hand above the marginal one.
  const goodPlay = performanceScore({
    actionQualities: [+0.6, +0.8, +0.6],  // textbook line throughout
    won: true, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: 200, bigBlind: 10
  })
  const sloppyWin = performanceScore({
    actionQualities: [-0.5, -0.3, -0.5],   // got there but the line was bad
    won: true, voluntarilyIn: true, wentToShowdown: true,
    chipsDelta: 200, bigBlind: 10
  })
  assert.ok(goodPlay > sloppyWin,
    `good play (${goodPlay}) should outscore sloppy win (${sloppyWin})`)
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

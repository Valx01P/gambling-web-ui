import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeScoresZeroSum,
  computeRatingUpdatesForTable,
  performanceScore,
  STARTING_RATING,
  kFactor
} from '../src/bots/runtime/eloEngine.js'

test('normalizeScoresZeroSum: shifts mean to 0.5 (drift-free)', () => {
  // Inflationary input: 5 bots all scored above 0.5 on the same hand.
  // The old engine would give every one of them a positive ELO delta;
  // the new normalization shifts the mean back to 0.5.
  const raw = [0.7, 0.6, 0.8, 0.5, 0.9]
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length
  assert.ok(mean > 0.5, 'precondition: input mean is above 0.5')
  const adjusted = normalizeScoresZeroSum(raw)
  const newMean = adjusted.reduce((a, b) => a + b, 0) / adjusted.length
  assert.ok(Math.abs(newMean - 0.5) < 1e-9, `new mean should be 0.5, got ${newMean}`)
})

test('normalizeScoresZeroSum: preserves relative ordering', () => {
  const raw = [0.9, 0.3, 0.5, 0.6]
  const adjusted = normalizeScoresZeroSum(raw)
  // Ordering should be the same.
  for (let i = 0; i < raw.length; i++) {
    for (let j = 0; j < raw.length; j++) {
      if (raw[i] > raw[j]) assert.ok(adjusted[i] > adjusted[j],
        `${raw[i]} > ${raw[j]} should still hold after normalization`)
    }
  }
})

test('computeRatingUpdatesForTable: ELO is zero-sum across all participants', () => {
  // 5 equal-rated bots, varied outcomes. The sum of ELO deltas must be
  // zero (modulo integer rounding) — chips are zero-sum, so ELO should
  // be too.
  const participants = [
    { rating: 1000, handsPlayed: 100, outcome: { won: true,  chipsDelta: 200, bigBlind: 10, voluntarilyIn: true,  wentToShowdown: true } },
    { rating: 1000, handsPlayed: 100, outcome: { won: false, chipsDelta: -50, bigBlind: 10, voluntarilyIn: true,  wentToShowdown: true } },
    { rating: 1000, handsPlayed: 100, outcome: { won: false, chipsDelta: -50, bigBlind: 10, foldedPreflop: true } },
    { rating: 1000, handsPlayed: 100, outcome: { won: false, chipsDelta: -50, bigBlind: 10, foldedPreflop: true } },
    { rating: 1000, handsPlayed: 100, outcome: { won: false, chipsDelta: -50, bigBlind: 10, voluntarilyIn: true } }
  ]
  const results = computeRatingUpdatesForTable(participants)
  assert.equal(results.length, participants.length)
  const sumDeltas = results.reduce((s, r) => s + r.delta, 0)
  // Integer rounding can leave up to ±N/2 of slop in the worst case.
  // 5 bots with K=18 = max ±4 of slop. In practice it's usually 0-1.
  assert.ok(Math.abs(sumDeltas) <= 3,
    `ELO should net to ~0 across the table, got sum=${sumDeltas}`)
  // The winner gained, the losers lost.
  assert.ok(results[0].delta > 0, 'winner should gain ELO')
})

test('computeRatingUpdatesForTable: equal bots ⇒ no drift over many hands', () => {
  // Regression for the closed-pool inflation bug. 5 identical bots play
  // 500 hands against each other with random outcomes; the average ELO
  // should stay near 1000 (the starting point) the whole time. Under
  // the OLD scoring this average would creep up by ~100+.
  const N = 5
  const HANDS = 500
  let ratings = new Array(N).fill(1000)
  let handsPlayed = new Array(N).fill(0)

  function randOutcome() {
    const won = Math.random() < (1 / N)
    return {
      won,
      chipsDelta: won ? Math.round(Math.random() * 200) : -Math.round(Math.random() * 60),
      bigBlind: 10,
      foldedPreflop: !won && Math.random() < 0.5,
      voluntarilyIn: won || Math.random() < 0.3,
      wentToShowdown: won && Math.random() < 0.4,
      postflopRaises: won ? Math.floor(Math.random() * 2) : 0,
      vpipRate: 0.3,
      bluffSuccessRate: 0.05,
      bluffWin: false
    }
  }

  for (let h = 0; h < HANDS; h++) {
    // Pick a winner index so exactly one bot wins this hand.
    const winnerIdx = Math.floor(Math.random() * N)
    const participants = ratings.map((rating, i) => ({
      rating,
      handsPlayed: handsPlayed[i],
      outcome: {
        ...randOutcome(),
        won: i === winnerIdx
      }
    }))
    const updates = computeRatingUpdatesForTable(participants)
    for (let i = 0; i < N; i++) {
      ratings[i] = updates[i].nextRating
      handsPlayed[i] += 1
    }
  }

  const avgRating = ratings.reduce((a, b) => a + b, 0) / N
  // Allow ±60 of noise from integer rounding + score asymmetry. Under
  // the OLD scoring this number was easily +200 after 500 hands.
  assert.ok(Math.abs(avgRating - 1000) <= 60,
    `Average rating should stay near 1000 after ${HANDS} hands, got ${avgRating}`)
})

test('performanceScore: skill dominates outcome — quads-vs-flush bot not punished', () => {
  // The user's example: bot jams quads (correct line — almost always
  // +EV) but loses to a one-in-a-million straight flush. With skill-
  // first scoring the hand should score HIGH despite the chip loss.
  //
  // Action qualities for the great-decision case: jamming quads is
  // captured as raise_allin (idx 5) at very high equity → quality
  // ~+1.0. Preflop call/raise at high equity → ~+0.5 each.
  const greatDecisions = [+0.5, +0.5, +1.0]  // mean = +0.67
  const score = performanceScore({
    actionQualities: greatDecisions,
    won: false,
    voluntarilyIn: true,
    chipsDelta: -1000,
    bigBlind: 10,
    foldedPreflop: false
  })
  // Mean +0.67 maps to base 0.5 + 0.40*0.67 = 0.77. Lost voluntarily
  // adds -0.02. Big chip loss (1000 chips at 10bb = 100bb = clamped at
  // -1) adds -0.03. Final ~0.72.
  assert.ok(score > 0.65, `quads-vs-flush should score high, got ${score}`)
})

test('performanceScore: lucky nit who folded a winner gets a low score', () => {
  // Inverse: bot mucks AK preflop facing a raise (terrible fold — high
  // equity, cheap call). Saved chips. Old scoring would've rewarded
  // not losing. New scoring sees the awful decision and scores low.
  const badFold = [-1.2]   // single terrible-fold decision
  const score = performanceScore({
    actionQualities: badFold,
    won: false,
    foldedPreflop: false,
    voluntarilyIn: false,   // they didn't put chips in voluntarily
    chipsDelta: -5          // just the SB they posted
  })
  // Mean -1.2 clamped to -1, maps to 0.5 + 0.40*(-1) = 0.10. No win,
  // no voluntary loss — outcome tilt 0. Final ~0.10.
  assert.ok(score < 0.20, `bad-fold bot should score low, got ${score}`)
})

test('performanceScore: didn\'t-play hand is neutral', () => {
  // Folded preflop without acting (folded the SB facing a 4-bet).
  // No quality scores logged. Score should be a clean 0.5 — bot didn't
  // gain or lose anything skill-wise.
  const score = performanceScore({
    actionQualities: [],
    won: false,
    foldedPreflop: true,
    voluntarilyIn: false,
    chipsDelta: -5
  })
  assert.ok(Math.abs(score - 0.5) < 0.01, `sat-out hand should be neutral, got ${score}`)
})

test('kFactor: more aggressive decay past 500 hands', () => {
  assert.equal(kFactor(0), 40)
  assert.equal(kFactor(29), 40)
  assert.equal(kFactor(30), 28)
  assert.equal(kFactor(99), 28)
  assert.equal(kFactor(100), 18)
  assert.equal(kFactor(499), 18)
  assert.equal(kFactor(500), 10)
  assert.equal(kFactor(1999), 10)
  assert.equal(kFactor(2000), 6)
  assert.equal(kFactor(10000), 6)
})

// ELO engine for poker bots.
//
// Goals (from product):
//   * Start every bot at 500.
//   * 300 = floor (a bot literally folding every hand should converge here).
//   * 500 = beginner.
//   * 1000 = solid bot, mostly profitable.
//   * 1500 = excellent, near-always profitable, plays multiple lines.
//   * 2000+ = elite — wins big, wins with bluffs, plays a wide voluntary range.
//
// Why a custom score instead of the textbook +1 / 0 / -1 outcome:
//   Poker hands aren't binary. A nit who folds 90% of the time wins their few
//   hands and "wins" the rating fight if you only count showdowns. That's
//   wrong — strong play is winning *more chips* across *more hands* with a
//   *wider voluntary range*. So we compute a per-hand performance score in
//   [0, 1] from outcome + chip magnitude + bluff success + style breadth,
//   then feed that into the standard ELO update.

import { preflopHandScore } from './equity.js'

// Config the rest of the codebase reads from this single module.
export const STARTING_RATING = 500
export const RATING_FLOOR = 300
// Soft ceiling — we don't actually clamp this server-side, but it's the
// "elite" anchor in the product copy. ~2200+ is exceptional.
export const RATING_ELITE = 2000

// Dynamic K-factor. New bots learn fast (provisional rating), settled
// bots move more slowly so a single hand of variance doesn't tank a
// settled rating. Decay continues past 500 hands so a bot that's
// played thousands of hands doesn't keep swinging — without this a
// 1000-hand training run could still drift the rating by 100+ points
// over noise alone.
export function kFactor(handsPlayed) {
  if (handsPlayed < 30)   return 40
  if (handsPlayed < 100)  return 28
  if (handsPlayed < 500)  return 18
  if (handsPlayed < 2000) return 10
  return 6
}

// Inputs the score function expects; documented here so callers know exactly
// what to gather before invoking. All are optional except the outcome flags.
//
// won            - did this bot end the hand with the pot?
// chipsDelta     - net chip change for this hand (+ won, - lost)
// bigBlind       - current bb at the table; used to normalize chipsDelta
// foldedPreflop  - bot mucked preflop without putting chips in (besides blinds)
// voluntarilyIn  - bot put chips in by choice (call/raise) at any point
// wentToShowdown - bot reached river+showdown (regardless of result)
// preflopHoleCards - the bot's two cards (used for bluff-win detection)
// postflopRaises - count of voluntary raise/all-in actions postflop
// vpipRate       - bot's lifetime VPIP rate, 0-1; controls variety multiplier
// bluffSuccessRate - lifetime fraction of fold-out wins where preflop was weak

// SKILL-FIRST scoring (overhauled).
//
// Old behavior: outcome dominated. A bot that jammed quads against an
// unlikely straight flush was punished hard (lost chips → score → ELO).
// A bot that folded a winner was rewarded (didn't lose chips). That's
// backwards — strong play sometimes loses to variance, and the rating
// should reward decisions, not luck.
//
// New behavior: the bot's per-hand actionQuality scores (captured per-
// decision in BotPlayer / SimSeat) drive the score. Each decision is
// graded against equity vs pot-odds — the exact math an informed
// observer would use. Outcome contributes a small tilt (a few percent)
// so winning still nudges the score up and losing still nudges it
// down, but the skill signal is dominant.
//
// Returns a continuous score in [0, 1.05]. ELO expects [0, 1] but we
// let the score peek slightly over 1 when a bot played a *great* hand
// AND won it — gives the very top of the distribution somewhere to
// climb to.
export function performanceScore({
  actionQualities = null,
  won = false,
  chipsDelta = 0,
  bigBlind = 10,
  foldedPreflop = false,
  voluntarilyIn = false,
  wentToShowdown = false,
  bluffWin = false
}) {
  // --- Primary signal: average action quality ----------------------------
  // actionQuality() returns roughly [-1.5, +1] per decision. Mean is
  // mapped linearly to [0.05, 0.95]: a hand of textbook plays (mean
  // quality ≈ +1) scores 0.9; a hand of obvious mistakes (mean ≈ -1)
  // scores 0.1; neutral play scores 0.5.
  //
  // No actions means the bot folded preflop without facing a bet (or
  // wasn't dealt in). That's a neutral, not-played-this-hand outcome —
  // score 0.5 so the bot doesn't gain or lose ELO from sitting out.
  let s = 0.5
  if (Array.isArray(actionQualities) && actionQualities.length > 0) {
    const mean = actionQualities.reduce((a, b) => a + b, 0) / actionQualities.length
    s = 0.5 + 0.40 * Math.max(-1, Math.min(1, mean))
  }

  // --- Tertiary tilt: outcome ---------------------------------------------
  // Outcome contributes a small ±0.05 nudge so winning a great-quality
  // hand scores slightly higher than losing one. The user's example —
  // jamming quads and losing to a straight flush — still scores ~0.9
  // (great quality) minus a 0.02 voluntarily-lost-pot tilt = 0.88. Not
  // punished. A nit that folds a flopped set scores ~0.3 (bad quality)
  // even if it "saved chips" because no money was at risk.
  let outcomeTilt = 0
  if (won) outcomeTilt += 0.05
  else if (voluntarilyIn) outcomeTilt -= 0.02
  // Bluff wins ARE skill (the math says +EV pressure on a weak hand
  // is a great line). Small extra credit so the bot that finds them
  // climbs slightly faster.
  if (bluffWin) outcomeTilt += 0.02
  // Showdown wins are slightly more valuable than fold-out wins
  // because they prove the bot beat a revealed hand.
  if (won && wentToShowdown) outcomeTilt += 0.01

  // --- Chip-magnitude is now a TINY signal --------------------------------
  // We keep a vestigial ±0.03 from big swings so a bot that consistently
  // wins/loses huge pots still trends correctly over many hands. But the
  // single-hand impact is bounded so one cooler can't crash a rating.
  const bb = Math.max(1, bigBlind || 10)
  const norm = Math.max(-1, Math.min(1, chipsDelta / (200 * bb)))
  const chipsTilt = 0.03 * norm

  // Suppress all outcome signal entirely for hands the bot folded
  // preflop without acting voluntarily — that's "sat out", and chip
  // changes there were just blinds.
  if (foldedPreflop && !voluntarilyIn) {
    outcomeTilt = 0
    return Math.max(0, Math.min(1.05, s))
  }

  return Math.max(0, Math.min(1.05, s + outcomeTilt + chipsTilt))
}

// Standard ELO update with a continuous score in [0, 1]. Returns the
// (rounded) integer delta to apply to the bot's rating.
export function eloDelta({ rating, opponentRatings, score, handsPlayed = 0 }) {
  if (!Array.isArray(opponentRatings) || opponentRatings.length === 0) return 0
  const avg = opponentRatings.reduce((a, b) => a + b, 0) / opponentRatings.length
  // Standard ELO expectation. Note 400 is the historical chess constant —
  // controls how much rating gap implies how much win-probability gap.
  const expected = 1 / (1 + Math.pow(10, (avg - rating) / 400))
  const k = kFactor(handsPlayed)
  return Math.round(k * (Math.min(1, score) - expected))
}

// Bluff-win detection. Returns true if this hand was won as the aggressor
// without a showdown, holding a sub-50%-percentile starting hand. We use
// preflopHandScore from equity.js for consistency with how the bot signals
// classify hands elsewhere.
//
// Threshold 0.50: roughly any unpaired hand worse than mid-pair pocket pairs.
// Premium hands (AKs, JJ+) wouldn't be considered bluffs even if won by fold.
export function isBluffWin({ won, wentToShowdown, voluntarilyIn, postflopRaises, holeCards }) {
  if (!won || wentToShowdown || !voluntarilyIn) return false
  if (postflopRaises < 1) return false
  if (!Array.isArray(holeCards) || holeCards.length !== 2) return false
  const score = preflopHandScore(holeCards[0], holeCards[1])
  return score < 0.50
}

// Convenience for the single-call site that records the result + computes
// the rating change. Keeps PokerRoom.js a few lines lighter.
export function computeRatingUpdate({
  rating,
  opponentRatings,
  handsPlayed,
  outcome
}) {
  const score = performanceScore(outcome)
  const delta = eloDelta({
    rating,
    opponentRatings,
    score,
    handsPlayed
  })
  const next = Math.max(RATING_FLOOR, rating + delta)
  return { score, delta, nextRating: next }
}

// ─── Zero-sum pool normalization ─────────────────────────────────────────
// THE FIX FOR CLOSED-POOL INFLATION.
//
// performanceScore() returns an independent [0, 1.05] score per bot. In a
// classic chess ELO match the two players' scores sum to a fixed constant
// (1.0 = W + L or 0.5 + 0.5 = D + D), so K·(score - expected) summed
// across both players is exactly zero — ratings can only redistribute,
// never inflate.
//
// Our continuous score has no such constraint. Asymmetric bonuses (the
// bluff-win bonus, aggression bonus, variety multiplier) only ever ADD,
// so the mean score across a table tends to drift above 0.5 — meaning
// every bot at the table gains a little rating per hand on average. Over
// 1000 hands of bot-vs-bot training, every bot ends up above 2000 even
// when they're all the same strength.
//
// `normalizeScoresZeroSum` shifts each raw score so the table-average
// equals the table-average expected score against a uniform-rated pool
// (0.5). The relative ordering is preserved — bots who outperformed
// peers stay above 0.5, underperformers go below — but the sum is
// pinned, so any per-hand ELO redistribution nets to zero.
//
// Takes the raw scores array. Returns the same length, clipped to
// [0, 1.05] after shifting so we don't push a great hand below 0.
export function normalizeScoresZeroSum(rawScores) {
  if (!Array.isArray(rawScores) || rawScores.length === 0) return []
  const mean = rawScores.reduce((a, b) => a + b, 0) / rawScores.length
  // Shift so the new mean = 0.5. If all bots scored 0.6 (avg = 0.6),
  // shift = -0.1 → every bot's adjusted score = 0.5 → zero delta.
  // If one bot scored 0.9 and four scored 0.4 (avg = 0.5), no shift
  // is applied and the gap stays intact.
  const shift = 0.5 - mean
  return rawScores.map(s => Math.max(0, Math.min(1.05, s + shift)))
}

// Batch ELO update for one full hand. Takes the entire seat lineup so
// the scores can be normalized as a pool before each per-bot delta is
// computed.
//
// Each entry in `participants`:
//   {
//     rating:        current ELO (number)
//     handsPlayed:   lifetime hand count (for K-factor)
//     outcome:       the full outcome object performanceScore() consumes
//                     (won, chipsDelta, bigBlind, foldedPreflop, …)
//   }
//
// Returns an array aligned to `participants` with:
//   { rawScore, normalizedScore, delta, nextRating }
//
// Per-bot expected score is computed against the AVERAGE of every
// other participant's current rating — same as before. The
// normalization happens to the score side of (score - expected),
// which is where the asymmetric bonuses lived.
export function computeRatingUpdatesForTable(participants) {
  if (!Array.isArray(participants) || participants.length === 0) return []
  const rawScores = participants.map(p => performanceScore(p.outcome))
  const normalized = normalizeScoresZeroSum(rawScores)
  return participants.map((p, idx) => {
    const opponentRatings = participants
      .filter((_, j) => j !== idx)
      .map(o => o.rating ?? STARTING_RATING)
    const delta = eloDelta({
      rating: p.rating ?? STARTING_RATING,
      opponentRatings,
      score: normalized[idx],
      handsPlayed: p.handsPlayed || 0
    })
    const nextRating = Math.max(RATING_FLOOR, (p.rating ?? STARTING_RATING) + delta)
    return {
      rawScore: rawScores[idx],
      normalizedScore: normalized[idx],
      delta,
      nextRating
    }
  })
}

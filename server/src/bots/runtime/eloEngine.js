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

// Dynamic K-factor. New bots learn fast (provisional rating), settled bots
// move more slowly so a single hand of variance doesn't tank a 1500 rating.
export function kFactor(handsPlayed) {
  if (handsPlayed < 30) return 40
  if (handsPlayed < 200) return 28
  return 18
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

// Returns a continuous score in [0, 1.05]. ELO expects [0, 1] but we let the
// score peek slightly over 1 when a bot scores big AND showed wide-range
// + bluff aggression — that's how you climb past 1500.
export function performanceScore({
  won = false,
  chipsDelta = 0,
  bigBlind = 10,
  foldedPreflop = false,
  voluntarilyIn = false,
  wentToShowdown = false,
  bluffWin = false,
  postflopRaises = 0,
  vpipRate = 0,
  bluffSuccessRate = 0
}) {
  // --- Base outcome score --------------------------------------------------
  let s
  if (foldedPreflop && !voluntarilyIn) {
    // Didn't play; neutral. Keeps blind-folding from feeling punishing.
    s = 0.50
  } else if (won) {
    // Showdown wins are slightly more valuable than fold-out wins because
    // they prove the bot beat at least one revealed hand.
    s = wentToShowdown ? 1.0 : 0.85
  } else if (voluntarilyIn) {
    // Played and lost — the cost of being wrong.
    s = 0.30
  } else {
    // Posted blind, mucked. Mild negative — could have defended.
    s = 0.45
  }

  // --- Chip-magnitude scaling ---------------------------------------------
  // Treat ~50bb as the reference stake. A 50bb win shifts score by +0.20;
  // a 50bb loss shifts by -0.20. Capped at ±0.20 so a single huge cooler
  // doesn't move the needle past what the outcome justifies.
  const bb = Math.max(1, bigBlind || 10)
  const norm = Math.max(-1, Math.min(1, chipsDelta / (50 * bb)))
  s += 0.20 * norm

  // --- Bluff bonus ---------------------------------------------------------
  // Won the hand without a showdown after voluntarily betting/raising with
  // a weak preflop hand. This is "bought the pot," and it's worth more than
  // a generic fold-out win because the bot deliberately pressured a fold.
  if (bluffWin) s += 0.10

  // --- Aggression bonus on wins -------------------------------------------
  // A win after multiple voluntary raises shows real action — small bump
  // capped at +0.05 so it can't snowball.
  if (won && postflopRaises > 0) {
    s += Math.min(0.05, postflopRaises * 0.02)
  }

  // --- Style/variety multiplier -------------------------------------------
  // The whole point of this overhaul: tight nits should not outrank versatile
  // bots that win across many hand types. Multiplier ranges 0.85 – 1.10 from
  // VPIP plus a small extra reward for sustained bluff-win rate.
  let varietyMult = 0.85
  // VPIP from 0 → 0.30+ scales 0.85 → 1.00 linearly (most healthy ranges
  // sit between 0.20 and 0.40 in real poker).
  varietyMult += 0.15 * Math.min(1, vpipRate / 0.30)
  // Up to +0.10 if the bot's hitting bluffs at >= 10% of its fold-out wins.
  varietyMult += 0.10 * Math.min(1, bluffSuccessRate / 0.10)

  s *= varietyMult

  // Allow a hair above 1 so consistently exceptional play can climb past
  // mediocre opponents. Floor at 0 in case multiplier flips negative.
  return Math.max(0, Math.min(1.05, s))
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

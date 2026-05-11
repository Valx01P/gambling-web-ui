// Range-aware Monte Carlo equity engine for poker bots.
//
// The categorical handStrength signal we ship next to this file is good for
// quick rule lookups but it can't tell a bot "you're 82% to win" — that's
// what this module does. The flow per call is:
//
//   1. Estimate each unfolded opponent's range as a fraction of the 169
//      starting hands (top X%) inferred from their preflop action + size.
//   2. Sample N times: for each opponent, deal a random pair from the
//      remaining deck that fits their range; deal the missing board cards
//      from what's left; evaluate every player's best 5; tally wins/ties.
//   3. Return equity = (wins + ties/N) / samples.
//
// The opponent's *actual* hole cards are NEVER used — every input is either
// the bot's own cards, the public board, or public actions. So a bot using
// this is making the same kind of decision a strong human would.
//
// Cost: ~1ms per 200 samples for 5 players, scales linearly. Default 600
// samples = ~3ms per decision, comfortably inside the bot think-window.

import { evaluateHand, compareHands } from '../../poker/handEvaluator.js'
import { GAME_PHASES } from '../../config/constants.js'
import { preflopScore as analyzerPreflopScore } from './handAnalyzer.js'

const RANK_VALS = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function buildFullDeck() {
  const deck = []
  for (const r of RANKS) for (const s of SUITS) deck.push({ rank: r, suit: s })
  return deck
}

function cardKey(c) {
  return `${c.rank}-${c.suit}`
}

// --- Preflop hand scoring -------------------------------------------------

// Numeric strength for any 2-card preflop hand, on a 0..1 scale. Delegates
// to the canonical handAnalyzer table (preflopScore) so every consumer in
// the bot stack sees the same value. Why this matters: the previous formula
// rated AKo at ~0.62, which sat below the 'strong' bot-template branch and
// caused AK to fold preflop in spots where it should never fold.
//
// Score → tier breakpoints used downstream:
//   >= 0.85  premium      AA, KK, QQ, JJ, TT, AKs, AKo, AQs
//   >= 0.70  strong       99-77, KQs/AJs/KJs/ATs/KTs/QJs/AQo
//   >= 0.55  medium       small pairs, broadways, suited aces
//   >= 0.40  weak         suited connectors, weak Ax offsuit
//   else     trash
export function preflopHandScore(c1, c2) {
  if (!c1 || !c2) return 0
  return analyzerPreflopScore(c1, c2)
}

// --- Range inference ------------------------------------------------------

// Map an opponent's table behavior to a "play this top X% of hands"
// percentile, returned as a number 0-1. 0.05 = top 5% (premium), 1.0 = any
// two cards. We deliberately keep this conservative — being slightly too
// loose on opponents costs less equity than being too tight (folding
// premium hands).
export function inferOpponentTopPct({ preflopProfile, lastAction, isPostflop, betFractionOfPot, hasShownAggressionPostflop, isLimper }) {
  let pct
  switch (preflopProfile) {
    case 'four_bet_plus': pct = 0.04; break // QQ+, AK
    case 'three_bet':     pct = 0.10; break // TT+, AQ+, KQs
    case 'opened':        pct = 0.25; break // typical raise-first-in
    case 'unopened':
    default:              pct = isLimper ? 0.55 : 0.65; break
  }

  // Postflop: a continuation bet/raise tightens the range; a check/call leaves it wide.
  if (isPostflop) {
    if (hasShownAggressionPostflop) {
      // Aggression scales with bet size relative to pot.
      if (betFractionOfPot >= 1.5) pct *= 0.35       // overbet → top of range or pure bluffs
      else if (betFractionOfPot >= 0.8) pct *= 0.55  // pot-sized
      else if (betFractionOfPot >= 0.4) pct *= 0.7   // 1/2 pot
      else pct *= 0.85                                // small probe
    } else if (lastAction === 'call') {
      // Calling station: medium hands, draws. Don't tighten dramatically.
      pct *= 0.85
    }
  }

  return Math.max(0.01, Math.min(1, pct))
}

// Given a topPct (0-1), find the preflop-score threshold below which a hand
// is OUT of the range. Computed fresh per call so the score function can
// evolve without invalidating a cached table.
export function thresholdForTopPct(topPct) {
  if (topPct >= 1) return 0
  // Enumerate the 169 starting-hand types with their combo weight (pair=6,
  // suited=4, offsuit=12) and sort by score desc.
  const types = []
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      const r1 = RANKS[i]
      const r2 = RANKS[j]
      const c1 = { rank: r1, suit: 'hearts' }
      const c2 = { rank: r2, suit: r1 === r2 ? 'diamonds' : 'hearts' }
      const score = preflopHandScore(c1, c2)
      const weight = r1 === r2 ? 6 : 4 // suited path; we add offsuit below
      types.push({ score, weight })
      if (r1 !== r2) {
        const off1 = { rank: r1, suit: 'hearts' }
        const off2 = { rank: r2, suit: 'spades' }
        types.push({ score: preflopHandScore(off1, off2), weight: 12 })
      }
    }
  }
  types.sort((a, b) => b.score - a.score)
  const totalCombos = types.reduce((s, t) => s + t.weight, 0) // 1326
  const target = topPct * totalCombos
  let cum = 0
  for (const t of types) {
    cum += t.weight
    if (cum >= target) return t.score
  }
  return 0
}

// --- Monte Carlo equity ---------------------------------------------------

function takeRandomCard(deck) {
  const i = Math.floor(Math.random() * deck.length)
  const card = deck[i]
  // Swap-remove for O(1) deletion.
  deck[i] = deck[deck.length - 1]
  deck.pop()
  return card
}

function takeRandomCards(deck, n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(takeRandomCard(deck))
  return out
}

// Pull two cards from the deck that satisfy the score threshold. Falls back
// to "any two cards" if the threshold is unreachable in a few tries — an
// extremely tight range with a depleted deck shouldn't lock the loop.
function sampleHandFromRange(deck, threshold, maxAttempts = 40) {
  if (deck.length < 2) return null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (deck.length < 2) return null
    const i1 = Math.floor(Math.random() * deck.length)
    let i2 = Math.floor(Math.random() * (deck.length - 1))
    if (i2 >= i1) i2 += 1
    const c1 = deck[i1]
    const c2 = deck[i2]
    if (preflopHandScore(c1, c2) >= threshold) {
      // Remove both by index — pop the higher index first so the lower index
      // stays valid. Splice handles array compaction correctly.
      const hi = Math.max(i1, i2)
      const lo = Math.min(i1, i2)
      deck.splice(hi, 1)
      deck.splice(lo, 1)
      return [c1, c2]
    }
  }
  // Fallback — take any pair so the simulation can finish even with
  // a pathologically narrow range and depleted deck.
  return [takeRandomCard(deck), takeRandomCard(deck)]
}

// Main entry. Returns:
//   { equity, win, tie, samples, opponentRanges: [{id, topPct, threshold}, ...] }
//
// `opponents` should be an array of unfolded opponents already filtered by
// the caller (from buildContext). Each opponent must include the same shape
// the buildContext exports — at minimum `id`, `lastAction`, plus the
// `_topPct` we attach in signals.js. We accept either a precomputed topPct
// or compute one from the inference fields.
export function calculateRangeEquity({
  holeCards,
  communityCards,
  opponents,
  iterations = 600
}) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) {
    return { equity: 0, win: 0, tie: 0, samples: 0, opponentRanges: [] }
  }
  const board = Array.isArray(communityCards) ? communityCards : []
  const known = [...holeCards, ...board]
  const deadKeys = new Set(known.map(cardKey))
  const baseDeck = buildFullDeck().filter(c => !deadKeys.has(cardKey(c)))

  // Precompute each opponent's score threshold once.
  const oppRanges = opponents.map(o => {
    const topPct = typeof o._topPct === 'number'
      ? o._topPct
      : inferOpponentTopPct({
          preflopProfile: o._preflopProfile || 'opened',
          lastAction: o.lastAction?.action || '',
          isPostflop: board.length > 0,
          betFractionOfPot: o._betFractionOfPot || 0,
          hasShownAggressionPostflop: Boolean(o._hasShownAggressionPostflop),
          isLimper: Boolean(o._isLimper)
        })
    return { id: o.id, topPct, threshold: thresholdForTopPct(topPct) }
  })

  if (oppRanges.length === 0) {
    // Heads-up vs nobody (everyone folded) — 100% equity.
    return { equity: 1, win: 1, tie: 0, samples: 0, opponentRanges: oppRanges }
  }

  let wins = 0
  let ties = 0
  let played = 0

  const missingBoardCount = Math.max(0, 5 - board.length)

  for (let it = 0; it < iterations; it++) {
    const deck = baseDeck.slice()
    const oppHands = []
    let aborted = false
    for (const range of oppRanges) {
      const hand = sampleHandFromRange(deck, range.threshold)
      if (!hand) { aborted = true; break }
      oppHands.push(hand)
    }
    if (aborted) continue
    const remainingBoard = takeRandomCards(deck, missingBoardCount)
    const finalBoard = [...board, ...remainingBoard]

    const heroEval = evaluateHand([...holeCards, ...finalBoard])
    let bestRank = heroEval
    let tiedWithHero = 0
    let beatenByOpp = false
    for (const oh of oppHands) {
      const oppEval = evaluateHand([...oh, ...finalBoard])
      const cmp = compareHands(oppEval, bestRank)
      if (cmp > 0) {
        beatenByOpp = true
        break
      } else if (cmp === 0) {
        tiedWithHero += 1
      }
    }
    played += 1
    if (beatenByOpp) continue
    if (tiedWithHero > 0) ties += 1 / (tiedWithHero + 1)
    else wins += 1
  }

  const samples = played || 1
  const equity = (wins + ties) / samples
  return {
    equity,
    win: wins / samples,
    tie: ties / samples,
    samples,
    opponentRanges: oppRanges
  }
}

// --- Postflop hand strength score ----------------------------------------

// 0-1 numeric postflop strength keyed by hand-evaluator rank (0=high card,
// 9=royal). Calibrated to roughly track win-frequency at showdown in
// 2-3-handed pots. The rank scheme matches handEvaluator.HAND_RANK.
const POSTFLOP_RANK_BASELINE = {
  0: 0.10, // high card
  1: 0.25, // pair
  2: 0.40, // two pair
  3: 0.55, // three of a kind
  4: 0.70, // straight
  5: 0.78, // flush
  6: 0.88, // full house
  7: 0.95, // four of a kind
  8: 0.98, // straight flush
  9: 0.99  // royal flush
}

export function postflopStrengthScore(holeCards, communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length < 3) return null
  try {
    const evalResult = evaluateHand([...holeCards, ...communityCards])
    return POSTFLOP_RANK_BASELINE[evalResult.rank] ?? 0.1
  } catch {
    return null
  }
}

// --- Helpers exported for signals.js -------------------------------------

// Aggregate per-opponent inference inputs from the live game. Pure: doesn't
// know about freeze-deep or context shape, just reads game.* state.
export function inferRangesForOpponents(game, opponentSeats) {
  const isPostflop = game.phase !== GAME_PHASES.PREFLOP &&
                     game.phase !== GAME_PHASES.WAITING &&
                     game.phase !== GAME_PHASES.SHOWDOWN

  // Action-history-derived signals.
  const handActions = game.handActionHistory || []
  let preflopRaises = 0
  for (const a of handActions) {
    if (a.phase !== GAME_PHASES.PREFLOP) break
    if (a.action === 'raise' || a.action === 'all_in') preflopRaises += 1
  }

  return opponentSeats.map(opp => {
    const oppActions = handActions.filter(a => a.playerId === opp.id)
    const limpedPreflop = oppActions.some(a => a.phase === GAME_PHASES.PREFLOP && a.action === 'call' && a.amount <= game.bigBlind)
    const raisedPreflop = oppActions.some(a => a.phase === GAME_PHASES.PREFLOP && (a.action === 'raise' || a.action === 'all_in'))
    const reraisedPreflop = oppActions.filter(a => a.phase === GAME_PHASES.PREFLOP && (a.action === 'raise' || a.action === 'all_in')).length >= 2
    let preflopProfile = 'unopened'
    if (reraisedPreflop || preflopRaises >= 3) preflopProfile = 'four_bet_plus'
    else if (preflopRaises >= 2) preflopProfile = 'three_bet'
    else if (preflopRaises === 1 && raisedPreflop) preflopProfile = 'opened'
    else if (preflopRaises === 1) preflopProfile = 'unopened' // facing a raise but didn't open

    const postflopActions = oppActions.filter(a => a.phase !== GAME_PHASES.PREFLOP)
    const hasShownAggressionPostflop = postflopActions.some(a => a.action === 'raise' || a.action === 'all_in')
    const lastBet = [...postflopActions].reverse().find(a => a.action === 'raise' || a.action === 'all_in' || a.action === 'call')
    const lastBetAmount = lastBet?.amount || 0
    const betFractionOfPot = game.pot > 0 ? lastBetAmount / game.pot : 0

    const topPct = inferOpponentTopPct({
      preflopProfile,
      lastAction: opp.lastAction?.action || '',
      isPostflop,
      betFractionOfPot,
      hasShownAggressionPostflop,
      isLimper: limpedPreflop && !raisedPreflop
    })

    return {
      id: opp.id,
      topPct,
      preflopProfile,
      betFractionOfPot,
      hasShownAggressionPostflop,
      isLimper: limpedPreflop && !raisedPreflop
    }
  })
}

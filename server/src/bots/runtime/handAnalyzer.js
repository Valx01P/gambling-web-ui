// Industry-grade hand analyzer. The single source of truth for "how strong
// is this hand right now" — both preflop and postflop.
//
// Why this module exists:
//   • The old Chen-style scorer rated AKo at ~0.62, which is BELOW the
//     'strong' branch of most bot templates → AK was getting folded preflop
//     in spots where it should never fold. That's poker malpractice.
//   • Bots need more than a single number. They need to know: is this a
//     premium hand? Is it an overpair on a wet board? What's the kicker
//     strength of my top pair? How vulnerable am I to draws?
//
// Everything here is derived from the bot's OWN cards + the public board.
// No opponent hole-card information is used. The output is exposed at
// ctx.handAnalysis with a rich, well-typed shape.

import { evaluateHand } from '../../poker/handEvaluator.js'

const RANK_VAL = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

const RANK_LABEL = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
}

// Canonical "hand label" — "AA", "AKs", "QJo", "T9s", "72o". Two-letter
// rank labels with 's'/'o' suffix for unpaired hands. Tens are 'T' so the
// label always packs into 2-3 chars.
export function handLabel(c1, c2) {
  if (!c1 || !c2) return ''
  const v1 = RANK_VAL[c1.rank], v2 = RANK_VAL[c2.rank]
  if (!v1 || !v2) return ''
  const high = v1 >= v2 ? v1 : v2
  const low = v1 >= v2 ? v2 : v1
  const hi = RANK_LABEL[high]
  const lo = RANK_LABEL[low]
  if (v1 === v2) return hi + hi
  return hi + lo + (c1.suit === c2.suit ? 's' : 'o')
}

// --- Preflop scoring ------------------------------------------------------
//
// Hard-coded scores for the 169 hand types, broken into tiers. The exact
// numbers were calibrated against published hold'em equity tables (hands
// ranked by win rate vs random + vs typical opening ranges) so the score
// approximately tracks "real" preflop strength.
//
// Score → tier breakpoints:
//   >= 0.85  premium      AA-TT, AKs, AKo, AQs                (top ~3%)
//   >= 0.70  strong       99-77, KQs/AQo/AJs/KJs/ATs/KTs/QJs  (top ~10%)
//   >= 0.55  good         66-22, broadways, suited aces       (top ~25%)
//   >= 0.40  speculative  suited connectors, small offsuit Ax (top ~45%)
//   >= 0.25  weak         suited gappers, marginal hands      (top ~65%)
//   else     trash
//
// Calling `tierFromLabel('AKo')` should always return 'premium'. That's
// the contract; the bot template branches on this.

const HAND_SCORES = (() => {
  // Build the table programmatically so we don't have to maintain 169
  // hard-coded entries. Step:
  //   1. Score every (rank, rank, suited?) combination with a tuned formula.
  //   2. Apply explicit overrides for the canonical premium / strong hands
  //      so they always land above their tier breakpoint.
  const table = new Map()

  function ratePair(rank) {
    // Pairs: AA = 1.0, KK = 0.97, QQ = 0.94, …, 22 = 0.555.
    // Curve is steeper at the top because the gap between AA and KK
    // matters more than between 33 and 22.
    if (rank === 14) return 1.000
    if (rank === 13) return 0.970
    if (rank === 12) return 0.940
    if (rank === 11) return 0.910
    if (rank === 10) return 0.890   // TT — slightly above AKs by conventional ranking
    if (rank === 9)  return 0.825
    if (rank === 8)  return 0.745
    if (rank === 7)  return 0.715
    // 22-66: roughly 0.56..0.65 — small pairs still have set-mining value.
    return 0.555 + (rank - 2) * 0.018
  }

  function rateUnpaired(high, low, suited) {
    // Base score: average of normalized ranks, weighted heavily toward high.
    let s = (high * 0.7 + low * 0.3) / 14 * 0.55
    const gap = high - low
    if (suited) s += 0.07
    // Connector / gapper bonuses (mostly for suited).
    if (gap === 1) s += suited ? 0.05 : 0.025
    else if (gap === 2) s += suited ? 0.025 : 0.010
    else if (gap === 3) s += suited ? 0.010 : 0.000
    else if (gap >= 5) s -= 0.05
    // Ace and king bonuses — they make top pair top kicker postflop.
    if (high === 14) s += 0.06
    if (high === 13) s += 0.03
    if (high === 12 && suited) s += 0.01
    return Math.max(0, Math.min(0.93, s))
  }

  // Build pairs.
  for (let r = 2; r <= 14; r++) {
    table.set(RANK_LABEL[r] + RANK_LABEL[r], ratePair(r))
  }
  // Build unpaired (suited + offsuit).
  for (let h = 14; h >= 2; h--) {
    for (let l = h - 1; l >= 2; l--) {
      const hi = RANK_LABEL[h]
      const lo = RANK_LABEL[l]
      table.set(hi + lo + 's', rateUnpaired(h, l, true))
      table.set(hi + lo + 'o', rateUnpaired(h, l, false))
    }
  }

  // Premium overrides — guarantees these land at score ≥ 0.85.
  // Calibrated against win-rate-vs-random tables.
  table.set('AKs', 0.880)
  table.set('AKo', 0.860)   // KEY FIX: AKo is premium and never folds preflop.
  table.set('AQs', 0.855)
  table.set('AQo', 0.760)
  table.set('AJs', 0.795)
  table.set('KQs', 0.795)
  table.set('ATs', 0.770)
  table.set('KJs', 0.760)
  table.set('KTs', 0.730)
  table.set('QJs', 0.720)
  table.set('AJo', 0.715)
  table.set('JTs', 0.685)
  table.set('KQo', 0.710)
  table.set('QTs', 0.680)
  table.set('T9s', 0.625)
  table.set('98s', 0.580)
  table.set('87s', 0.555)
  table.set('76s', 0.530)
  table.set('65s', 0.515)

  return table
})()

// 0..1 numeric score for a 2-card hand. Looking up the canonical label is
// O(1) — the table is built once at module load.
export function preflopScore(c1, c2) {
  const label = handLabel(c1, c2)
  const s = HAND_SCORES.get(label)
  return typeof s === 'number' ? s : 0
}

// Coarse tier name from the numeric score. 5-tier scheme is backward-
// compatible with existing rule schemas:
//   trash < weak < medium < strong < premium
export function tierFromScore(score) {
  if (score >= 0.85) return 'premium'
  if (score >= 0.70) return 'strong'
  if (score >= 0.55) return 'medium'
  if (score >= 0.40) return 'weak'
  return 'trash'
}

// Convenience: full preflop classification of a 2-card hand. Used by the
// bot ctx builder so the analyzer surfaces every preflop signal a bot
// might branch on, without re-deriving it.
export function analyzePreflop(c1, c2) {
  if (!c1 || !c2) return null
  const v1 = RANK_VAL[c1.rank], v2 = RANK_VAL[c2.rank]
  if (!v1 || !v2) return null
  const high = Math.max(v1, v2)
  const low = Math.min(v1, v2)
  const suited = c1.suit === c2.suit
  const pair = v1 === v2
  const gap = high - low
  const label = handLabel(c1, c2)
  const score = preflopScore(c1, c2)
  const tier = tierFromScore(score)

  return {
    label,                            // 'AKs' | 'AKo' | 'TT' | …
    score,                            // 0..1 numeric strength
    tier,                             // 'trash' | 'weak' | 'medium' | 'strong' | 'premium'
    highRank: high,                   // 2..14
    lowRank: low,                     // 2..14
    suited,
    pair,
    gap,
    isBigPair: pair && high >= 11,    // JJ+
    isMidPair: pair && high >= 7 && high <= 10,
    isSmallPair: pair && high <= 6,
    isBroadway: !pair && high >= 10 && low >= 10,
    isSuitedAce: suited && high === 14,
    isOffsuitAce: !suited && high === 14,
    isSuitedConnector: suited && gap === 1 && low >= 4,
    isSuitedGapper: suited && gap === 2 && low >= 4,
    // Hard rules to gate decision branches. "neverFold" is the AK fix —
    // bots that branch on this will never fold AK preflop.
    neverFoldPreflop: tier === 'premium',
    // Should rarely open from any position.
    neverOpen: tier === 'trash' && !suited,
    // Open ranges by position — bot can map directly to action.
    playableUTG: tier === 'premium' || tier === 'strong',
    playableMP: score >= 0.62,
    playableCO: score >= 0.45,
    // BTN opens wider — small suited connectors and one-gappers qualify as
    // steals, so the cutoff sits around the top 55% of hands.
    playableBTN: score >= 0.30,
    threeBetWorthy: score >= 0.75,    // 3-bet for value
    threeBetBluffCandidate: score >= 0.40 && score < 0.62 && suited
  }
}

// --- Postflop analysis ----------------------------------------------------

// Maps the 5-card hand-evaluator rank to a baseline strength score. Bots
// rarely need to remember the exact rank → name mapping; this gives them
// a number on the same 0..1 scale as the preflop score.
const POSTFLOP_BASE = {
  0: 0.12, // high card
  1: 0.30, // pair
  2: 0.50, // two pair
  3: 0.66, // three of a kind
  4: 0.78, // straight
  5: 0.83, // flush
  6: 0.92, // full house
  7: 0.97, // four of a kind
  8: 0.99, // straight flush
  9: 0.995 // royal
}

// Detect a flush draw (4 cards of one suit) using hole + board.
function flushDrawInfo(holeCards, board) {
  const all = [...holeCards, ...board]
  const counts = {}
  for (const c of all) counts[c.suit] = (counts[c.suit] || 0) + 1
  const maxSuit = Object.keys(counts).find(s => counts[s] >= 4) || null
  if (!maxSuit) return { has: false, suit: null, viaHole: false }
  // Did our hole cards contribute? (Flush draw on the BOARD alone is much
  // worse — anyone with that suit shares it.)
  const holeSuitsInDraw = holeCards.filter(c => c.suit === maxSuit).length
  return { has: counts[maxSuit] === 4, suit: maxSuit, viaHole: holeSuitsInDraw >= 1, holeCount: holeSuitsInDraw }
}

// Detect open-ended / gutshot straight draws using full 7-card set.
function straightDrawInfo(holeCards, board) {
  const all = [...holeCards, ...board]
  const ranksSet = new Set(all.map(c => RANK_VAL[c.rank]).filter(Boolean))
  if (ranksSet.has(14)) ranksSet.add(1) // ace plays low
  let openEnded = false
  let gutshot = false
  // Scan every 5-card window of consecutive ranks.
  for (let start = 1; start <= 10; start++) {
    let count = 0
    let missingPos = -1
    for (let i = 0; i < 5; i++) {
      if (ranksSet.has(start + i)) count += 1
      else missingPos = i
    }
    if (count === 5) return { openEnded: false, gutshot: false, made: true }
    if (count === 4) {
      if (missingPos === 0 || missingPos === 4) openEnded = true
      else gutshot = true
    }
  }
  return { openEnded, gutshot: gutshot && !openEnded, made: false }
}

// Classify how my pair (if I have one) relates to the board: overpair,
// top pair, second pair, etc. Drives sizing + commit-vs-pot-control reads.
function pairContext(holeCards, board, evalRank) {
  if (evalRank !== 1) return null   // not a one-pair hand
  // Board ranks sorted high-to-low.
  const boardVals = board.map(c => RANK_VAL[c.rank]).filter(Boolean).sort((a, b) => b - a)
  if (boardVals.length === 0) return null
  // Find which rank is paired in the 5-card best hand.
  const holeVals = holeCards.map(c => RANK_VAL[c.rank]).filter(Boolean)
  // Could be a pocket pair, or one of our hole cards paired the board.
  if (holeVals[0] === holeVals[1]) {
    // Pocket pair — is it an overpair (above the highest board card)?
    const pairVal = holeVals[0]
    const overpair = pairVal > boardVals[0]
    return {
      isOverpair: overpair,
      isTopPair: false,
      isMidPair: !overpair && pairVal > (boardVals[1] || 0) && pairVal < boardVals[0],
      isUnderpair: !overpair && pairVal < (boardVals[boardVals.length - 1] || 0),
      pairValue: pairVal,
      kickerStrength: 'n/a',
      pairLabel: overpair ? 'overpair' : 'pocket-pair'
    }
  }
  // One hole card paired the board. Which board rank?
  const pairedBoardRank = holeVals.find(v => boardVals.includes(v))
  if (!pairedBoardRank) return null
  const isTopPair = pairedBoardRank === boardVals[0]
  const isMidPair = pairedBoardRank === boardVals[1]
  // Kicker = my other hole card.
  const kicker = holeVals.find(v => v !== pairedBoardRank) || 0
  const kickerStrength = kicker >= 13 ? 'strong' : kicker >= 11 ? 'medium' : 'weak'
  return {
    isOverpair: false,
    isTopPair,
    isMidPair,
    isUnderpair: false,
    isBottomPair: pairedBoardRank === boardVals[boardVals.length - 1],
    pairValue: pairedBoardRank,
    kicker,
    kickerStrength,
    pairLabel: isTopPair ? `top-pair-${kickerStrength}-kicker`
             : isMidPair ? 'middle-pair'
             : 'weak-pair'
  }
}

// Full postflop analysis. Returns null preflop (board too short).
export function analyzePostflop(holeCards, board) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) return null
  if (!Array.isArray(board) || board.length < 3) return null

  let made
  try {
    made = evaluateHand([...holeCards, ...board])
  } catch {
    return null
  }
  const baseScore = POSTFLOP_BASE[made.rank] ?? 0.1
  const flushD = flushDrawInfo(holeCards, board)
  const straightD = straightDrawInfo(holeCards, board)
  const pair = pairContext(holeCards, board, made.rank)

  // Outs estimate: combine made-hand redraw potential with draws.
  // Rough rule of thumb that bots can override:
  //   flush draw:  9 outs
  //   open-ended:  8 outs
  //   gutshot:     4 outs
  //   combo (flush + straight): 12-15 outs
  let outs = 0
  if (flushD.has && flushD.viaHole) outs += 9
  if (straightD.openEnded) outs += 8
  else if (straightD.gutshot) outs += 4
  if (flushD.has && straightD.openEnded) outs -= 2   // de-dup overlap

  // Relative strength — adjusts the baseline for "is this hand still good
  // given the board". Heavy adjustments for:
  //   • pair on a flushy/straighty board: dock 0.10
  //   • two-pair on a paired board (full house possible): dock 0.08
  //   • set on dry board: bump +0.05
  //   • top pair top kicker on dry board: bump +0.05
  let relativeStrength = baseScore
  const boardCounts = {}
  for (const c of board) {
    boardCounts[c.suit] = (boardCounts[c.suit] || 0) + 1
    boardCounts[c.rank] = (boardCounts[c.rank] || 0) + 1
  }
  const boardMaxSuit = Math.max(...board.map(c => board.filter(b => b.suit === c.suit).length))
  const boardPaired = Object.values(boardCounts).some(v => v >= 2)

  if (made.rank === 1) {
    // Pair on a dangerous board.
    if (boardMaxSuit >= 3) relativeStrength -= 0.10
    if (boardPaired) relativeStrength -= 0.05
    // Top pair good kicker bump.
    if (pair?.isTopPair && pair.kickerStrength === 'strong') relativeStrength += 0.05
    if (pair?.isOverpair) relativeStrength += 0.08
  }
  if (made.rank === 2 && boardPaired) relativeStrength -= 0.08  // 2pair on paired = full-house possible
  if (made.rank === 3 && !boardPaired) relativeStrength += 0.04 // set on dry
  if (made.rank === 5 && flushD.viaHole && flushD.holeCount >= 1) {
    // Flush — bump for nut/strong flush (Ace or King high).
    const myFlushHighCards = holeCards.filter(c => c.suit === flushD.suit).map(c => RANK_VAL[c.rank]).filter(Boolean)
    if (myFlushHighCards.includes(14)) relativeStrength += 0.06
    else if (myFlushHighCards.includes(13)) relativeStrength += 0.03
  }
  relativeStrength = Math.max(0, Math.min(1, relativeStrength))

  // Value classification — used by bots to size bets and pick commit
  // decisions. "Thin" = bet a little, "nut" = bet huge.
  const valueClass = made.rank >= 6 ? 'nut'
                   : made.rank >= 4 || (pair?.isOverpair && boardMaxSuit < 3) ? 'strong'
                   : made.rank === 3 ? 'strong'
                   : made.rank === 2 ? 'medium'
                   : made.rank === 1 && pair?.isTopPair && pair.kickerStrength !== 'weak' ? 'medium'
                   : made.rank === 1 ? 'thin'
                   : 'air'

  // Bluff / semi-bluff candidacy — a hand that can credibly represent
  // strong AND has equity if called.
  const semibluffCandidate = (flushD.has && flushD.viaHole) || straightD.openEnded
  const bluffCandidate = made.rank === 0 && !semibluffCandidate    // air with no outs

  // Vulnerability — how often a turn/river is likely to wreck us.
  let vulnerability = 'low'
  if (made.rank === 1) {
    if (boardMaxSuit >= 2 || (flushD.has && !flushD.viaHole)) vulnerability = 'high'
    else if (pair?.isUnderpair || pair?.isBottomPair) vulnerability = 'high'
    // Top pair top kicker on a rainbow / dry board — minimal redraw risk.
    else if (pair?.isTopPair && pair.kickerStrength === 'strong' && boardMaxSuit < 2) {
      vulnerability = 'low'
    }
    // Overpair on a dry board — same story.
    else if (pair?.isOverpair && boardMaxSuit < 2) vulnerability = 'low'
    else vulnerability = 'medium'
  } else if (made.rank === 2 && boardPaired) {
    vulnerability = 'medium'
  } else if (made.rank >= 4 && boardPaired) {
    vulnerability = 'medium' // could be cracked by a full house
  }

  // Suggested commit level — quick gut check the bot can read directly.
  const commitmentSuggestion = made.rank >= 4 ? 'commit'
                             : made.rank === 3 ? 'commit'
                             : made.rank === 2 && !boardPaired ? 'commit'
                             : made.rank === 1 && pair?.isOverpair && boardMaxSuit < 3 ? 'commit'
                             : made.rank === 1 && pair?.isTopPair && pair.kickerStrength !== 'weak' ? 'pot-control'
                             : made.rank === 1 ? 'pot-control'
                             : valueClass === 'air' ? 'discard'
                             : 'pot-control'

  return {
    made: {
      rank: made.rank,
      name: madeHandName(made.rank),
      bestCards: (made.bestCards || []).map(c => ({ ...c }))
    },
    score: relativeStrength,             // 0..1 — primary handStrengthScore for postflop
    baseScore,                           // unaware-of-board baseline
    relativeStrength,                    // = score; explicit name for read-out
    valueClass,                          // 'air' | 'thin' | 'medium' | 'strong' | 'nut'
    pair,                                // null when not a one-pair hand
    flushDraw: flushD,
    straightDraw: straightD,
    outs,
    semibluffCandidate,
    bluffCandidate,
    vulnerability,                       // 'low' | 'medium' | 'high'
    commitmentSuggestion,                // 'commit' | 'pot-control' | 'discard'
    boardPaired,
    boardMaxSuit
  }
}

function madeHandName(rank) {
  const names = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush']
  return names[rank] || 'Unknown'
}

// Single entry-point used by the ctx builder. Returns BOTH the preflop
// analysis (always present when hole cards exist) AND postflop (null
// preflop, populated from the flop onward). One field bots branch on.
export function analyzeHand(holeCards, board) {
  const pre = (Array.isArray(holeCards) && holeCards.length === 2)
    ? analyzePreflop(holeCards[0], holeCards[1])
    : null
  const post = analyzePostflop(holeCards, board || [])
  return { preflop: pre, postflop: post }
}

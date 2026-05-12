// Probability helpers for live side-bet pricing.
//
// All functions here model a single-deck Texas hold'em runout from an
// *observer's* perspective: only the visible board is known. Players' hole
// cards are treated as part of the unseen deck. This keeps prices fair to
// every viewer (player, spectator, folded) and avoids leaking edge that
// only the server has.

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RED_SUITS = new Set(['hearts', 'diamonds'])

// Cached factorials up to 52 — every probability in this file routes through
// here, so paying for the table once at module-load is worth a few KB.
const FACT = new Float64Array(53)
FACT[0] = 1
for (let i = 1; i <= 52; i++) FACT[i] = FACT[i - 1] * i

export function combinations(n, k) {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  return FACT[n] / (FACT[k] * FACT[n - k])
}

// P(at least one of N target cards appears in `draws` cards drawn from a
// deck of `deckSize` unseen cards). Used by "ace on board", "king on board".
export function pAtLeastOneTarget(targetsInDeck, deckSize, draws) {
  if (targetsInDeck <= 0 || draws <= 0) return 0
  if (draws >= deckSize) return 1
  const nonTargets = deckSize - targetsInDeck
  if (nonTargets < draws) return 1
  return 1 - combinations(nonTargets, draws) / combinations(deckSize, draws)
}

// Count cards remaining of each rank given a list of visible cards.
function rankCountsRemaining(visibleCards) {
  const counts = new Map(RANKS.map(r => [r, 4]))
  for (const c of visibleCards) counts.set(c.rank, (counts.get(c.rank) || 0) - 1)
  return counts
}

// Count cards remaining of each suit.
function suitCountsRemaining(visibleCards) {
  const counts = new Map(SUITS.map(s => [s, 13]))
  for (const c of visibleCards) counts.set(c.suit, (counts.get(c.suit) || 0) - 1)
  return counts
}

// P(the final 5-card board contains a pair, trips, or quads — i.e. any rank
// appears 2+ times across all 5 cards) given the board so far.
//
// Closed-form path: P(no pair) requires the 5 final ranks be all distinct.
// Given `k` cards on the board with `u` distinct ranks already shown and any
// rank already paired → return 1 immediately. Otherwise we need the
// remaining `r = 5 - k` cards to:
//   (a) all come from the 13 - u unseen-on-board ranks
//   (b) be mutually rank-distinct
// That's C(13 - u, r) * 4^r / C(52 - k, r).
export function pBoardPairsByRiver(boardCards) {
  const k = boardCards.length
  if (k >= 5) {
    // Already at river — count directly.
    return hasBoardPair(boardCards) ? 1 : 0
  }
  if (hasBoardPair(boardCards)) return 1

  const u = new Set(boardCards.map(c => c.rank)).size
  const r = 5 - k
  const deckSize = 52 - k
  const distinctUnseenRanks = 13 - u
  if (distinctUnseenRanks < r) return 1  // pigeonhole — guaranteed pair
  const noPair = (combinations(distinctUnseenRanks, r) * Math.pow(4, r)) / combinations(deckSize, r)
  return Math.max(0, Math.min(1, 1 - noPair))
}

function hasBoardPair(boardCards) {
  const seen = new Set()
  for (const c of boardCards) {
    if (seen.has(c.rank)) return true
    seen.add(c.rank)
  }
  return false
}

// P(the final 5-card board contains 3+ of some single suit — i.e. a flush is
// possible from board alone) given the board so far. Enumerates all ways the
// remaining `r = 5 - k` cards can be distributed across the four suits and
// sums multinomial probabilities, weighted by suit-count availability.
export function pFlushOnBoardByRiver(boardCards) {
  const k = boardCards.length
  if (k >= 5) return maxSuitCount(boardCards) >= 3 ? 1 : 0

  const currentSuits = SUITS.map(s => boardCards.filter(c => c.suit === s).length)
  if (currentSuits.some(c => c >= 3)) return 1

  const remainingPerSuit = SUITS.map((s, i) => 13 - currentSuits[i])
  const r = 5 - k
  const deckSize = 52 - k

  // Enumerate (a, b, c, d) with a+b+c+d = r, 0 ≤ x ≤ remainingPerSuit[x].
  // r ≤ 5 → at most C(8,3)=56 combinations. Cheap.
  let pYes = 0
  const totalWays = combinations(deckSize, r)

  function rec(idx, left, picks) {
    if (idx === 4) {
      if (left !== 0) return
      const finalCounts = currentSuits.map((c, i) => c + picks[i])
      const isYes = finalCounts.some(c => c >= 3)
      if (!isYes) return
      let ways = 1
      for (let i = 0; i < 4; i++) ways *= combinations(remainingPerSuit[i], picks[i])
      pYes += ways / totalWays
      return
    }
    const cap = Math.min(left, remainingPerSuit[idx])
    for (let take = 0; take <= cap; take++) {
      picks[idx] = take
      rec(idx + 1, left - take, picks)
    }
    picks[idx] = 0
  }
  rec(0, r, [0, 0, 0, 0])

  return Math.max(0, Math.min(1, pYes))
}

function maxSuitCount(boardCards) {
  const counts = new Map()
  for (const c of boardCards) counts.set(c.suit, (counts.get(c.suit) || 0) + 1)
  let max = 0
  for (const v of counts.values()) if (v > max) max = v
  return max
}

// P(the next single community card is red, given the board so far). Trivially
// (red cards left) / (deck left). The observer doesn't know the hole cards;
// we treat them as part of the unseen deck along with the rest.
export function pNextCardRed(boardCards) {
  const k = boardCards.length
  const deckSize = 52 - k
  let redOnBoard = 0
  for (const c of boardCards) if (RED_SUITS.has(c.suit)) redOnBoard += 1
  const redRemaining = 26 - redOnBoard
  return redRemaining / deckSize
}

// P(at least one card of a specific rank appears across all 5 community
// cards) given the board so far. "Will an ace appear on the board?"
export function pRankAppearsOnBoard(boardCards, targetRank) {
  const onBoard = boardCards.filter(c => c.rank === targetRank).length
  if (onBoard >= 1) return 1
  const k = boardCards.length
  if (k >= 5) return 0
  const deckSize = 52 - k
  const targetsLeft = 4 - onBoard
  const draws = 5 - k
  return pAtLeastOneTarget(targetsLeft, deckSize, draws)
}

// P(the final 5-card board contains 3+ of some single rank — board "trips"
// or stronger) given the board so far. Useful for the eye-popping props the
// user mentioned ("three aces on the board"). Same enumeration shape as
// flush; rank space is bigger (13) but `r` is still small.
export function pBoardTripsByRiver(boardCards) {
  const k = boardCards.length
  if (k >= 5) return maxRankCount(boardCards) >= 3 ? 1 : 0

  const currentRanks = new Map()
  for (const c of boardCards) currentRanks.set(c.rank, (currentRanks.get(c.rank) || 0) + 1)
  for (const v of currentRanks.values()) if (v >= 3) return 1

  // P(no rank reaches 3 across the final 5 cards). Equivalent to: each rank's
  // final count ≤ 2. Enumeration over (count_for_rank_R) for the 13 ranks is
  // huge, but we only have r ≤ 5 remaining cards — so only a few ranks can
  // gain. Easier: P(at least one rank trips) = 1 - sum over compositions of r
  // among 13 ranks (with cap 2 - currentForRank, ignoring ranks that already
  // have 3+ which are short-circuited above) of multinomial mass.
  //
  // For 5-card boards the enumeration of "no rank trips" is feasible by
  // direct branch over which subset of unseen ranks gets a 2 vs a 1. Rather
  // than reinvent that, we just enumerate over the new draws by suit-rank
  // tuples is too expensive. Practical compromise: Monte Carlo with a fixed
  // seed off the board state for stable pricing.
  return monteCarloBoardTrips(boardCards, currentRanks, k)
}

function maxRankCount(boardCards) {
  const counts = new Map()
  for (const c of boardCards) counts.set(c.rank, (counts.get(c.rank) || 0) + 1)
  let max = 0
  for (const v of counts.values()) if (v > max) max = v
  return max
}

// Tiny Monte Carlo, seeded off a hash of the board so the same board always
// produces the same price (no jittery flicker on the client between identical
// state ticks). 4000 trials → ±0.8% at 95% CI for a 50% true value.
function monteCarloBoardTrips(boardCards, currentRanks, k) {
  const seed = boardCards.reduce((a, c) => a * 31 + c.rank.charCodeAt(0) * 17 + c.suit.charCodeAt(0), 7919)
  const rng = mulberry32(seed >>> 0)
  const deck = buildDeck(boardCards)
  const r = 5 - k
  const trials = 4000
  let hits = 0
  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates: only shuffle the first `r` positions.
    const counts = new Map(currentRanks)
    for (let i = 0; i < r; i++) {
      const j = i + Math.floor(rng() * (deck.length - i))
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp
      const rank = deck[i].rank
      counts.set(rank, (counts.get(rank) || 0) + 1)
    }
    let trip = false
    for (const v of counts.values()) if (v >= 3) { trip = true; break }
    if (trip) hits += 1
  }
  return hits / trials
}

function buildDeck(boardCards) {
  const seen = new Set(boardCards.map(c => `${c.rank}-${c.suit}`))
  const deck = []
  for (const r of RANKS) for (const s of SUITS) {
    if (!seen.has(`${r}-${s}`)) deck.push({ rank: r, suit: s })
  }
  return deck
}

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

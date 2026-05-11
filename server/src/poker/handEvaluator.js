// Hand rankings (higher = better)
const HAND_RANK = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
}

const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

const HAND_NAMES = {
  0: 'High Card',
  1: 'Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush'
}

function rankValue(rank) {
  return RANK_VALUES[rank]
}

function cardName(val) {
  const names = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }
  return names[val] || String(val)
}

// Enumerate every k-subset of `cards`. The previous implementation was a
// recursive `[first, ...rest]` walk that allocated O(2^n) intermediate
// arrays for what is only C(n, k) outputs. This version is iterative — for
// the canonical case (7 choose 5 = 21 results) it allocates exactly 21
// arrays and walks indices via swap-pop, no spread or recursion.
function combinations(cards, k) {
  if (k === 0) return [[]]
  const n = cards.length
  if (n < k) return []
  const out = []
  const idx = new Array(k)
  for (let i = 0; i < k; i++) idx[i] = i
  while (true) {
    const combo = new Array(k)
    for (let i = 0; i < k; i++) combo[i] = cards[idx[i]]
    out.push(combo)
    // Advance the rightmost index that can still move.
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return out
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

function evaluateFive(cards) {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)

  const isFlush = suits.every(s => s === suits[0])

  // Check straight (including ace-low: A-2-3-4-5)
  let isStraight = false
  let straightHigh = values[0]

  const unique = [...new Set(values)].sort((a, b) => b - a)
  if (unique.length >= 5) {
    // Normal straight
    if (unique[0] - unique[4] === 4 && unique.length === 5) {
      isStraight = true
      straightHigh = unique[0]
    }
    // Ace-low straight (A-2-3-4-5)
    if (!isStraight && unique.includes(14) && unique.includes(2) &&
        unique.includes(3) && unique.includes(4) && unique.includes(5)) {
      isStraight = true
      straightHigh = 5 // 5 is high in wheel
    }
  }

  // Count ranks
  const counts = {}
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1
  }
  const groups = Object.entries(counts)
    .map(([val, count]) => ({ val: parseInt(val), count }))
    .sort((a, b) => b.count - a.count || b.val - a.val)

  let result

  if (isFlush && isStraight) {
    if (straightHigh === 14) result = { rank: HAND_RANK.ROYAL_FLUSH, kickers: [14] }
    else result = { rank: HAND_RANK.STRAIGHT_FLUSH, kickers: [straightHigh] }
  }
  else if (groups[0].count === 4) {
    result = { rank: HAND_RANK.FOUR_OF_A_KIND, kickers: [groups[0].val, groups[1].val] }
  }
  else if (groups[0].count === 3 && groups[1].count === 2) {
    result = { rank: HAND_RANK.FULL_HOUSE, kickers: [groups[0].val, groups[1].val] }
  }
  else if (isFlush) {
    result = { rank: HAND_RANK.FLUSH, kickers: values }
  }
  else if (isStraight) {
    result = { rank: HAND_RANK.STRAIGHT, kickers: [straightHigh] }
  }
  else if (groups[0].count === 3) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a)
    result = { rank: HAND_RANK.THREE_OF_A_KIND, kickers: [groups[0].val, ...kickers] }
  }
  else if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter(g => g.count === 2).map(g => g.val).sort((a, b) => b - a)
    const kicker = groups.find(g => g.count === 1)?.val || 0
    result = { rank: HAND_RANK.TWO_PAIR, kickers: [...pairs, kicker] }
  }
  else if (groups[0].count === 2) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a)
    result = { rank: HAND_RANK.PAIR, kickers: [groups[0].val, ...kickers] }
  }
  else {
    result = { rank: HAND_RANK.HIGH_CARD, kickers: values }
  }

  // Attach the exact 5 cards used for this evaluation
  result.bestCards = cards
  return result
}

// Evaluate best 5-card hand from up to 7 cards
export function evaluateHand(cards) {
  if (cards.length <= 5) return evaluateFive(cards)

  let best = null
  for (const combo of combinations(cards, 5)) {
    const result = evaluateFive(combo)
    if (!best || compareHands(result, best) > 0) {
      best = result
    }
  }
  return best
}

// Compare two evaluated hands. Returns >0 if a wins, <0 if b wins, 0 if tie
export function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const ak = a.kickers[i] || 0
    const bk = b.kickers[i] || 0
    if (ak !== bk) return ak - bk
  }
  return 0
}

export function getHandName(evaluation) {
  const baseName = HAND_NAMES[evaluation.rank];
  
  if (!evaluation.kickers || evaluation.kickers.length === 0) return baseName;

  const main = cardName(evaluation.kickers[0]);
  const sub = evaluation.kickers.length > 1 ? cardName(evaluation.kickers[1]) : '';

  switch (evaluation.rank) {
    case 0: return `${main} High`;
    case 1: return `Pair of ${main}s`;
    case 2: return `Two Pair, ${main}s & ${sub}s`;
    case 3: return `Three of a Kind, ${main}s`;
    case 4: return `Straight, ${main} High`;
    case 5: return `Flush, ${main} High`;
    case 6: return `Full House, ${main}s full of ${sub}s`;
    case 7: return `Four of a Kind, ${main}s`;
    case 8: return `Straight Flush, ${main} High`;
    case 9: return `Royal Flush`;
    default: return baseName;
  }
}

// ---------------------------------------------------------------------------
// Fast comparator-only evaluator. Returns a single integer ("score") that
// sorts higher = stronger. Skips the C(7,5)=21 combinations enumeration the
// canonical evaluateHand uses — Monte Carlo equity simulations call this in
// the inner loop at ~60K invocations per bot decision.
//
// Score layout (24 bits):
//   rank   (4 bits) << 20
//   k0..k4 (4 bits each) << 16/12/8/4/0
//
// Ranks line up with HAND_RANK above (0=high card, 9=royal flush). All
// kicker slots store rank values 2..14, which fit in 4 bits.
// ---------------------------------------------------------------------------

const SUIT_INDEX = { hearts: 0, diamonds: 1, clubs: 2, spades: 3 }

// Precomputed bitmasks for every possible straight, ordered highest-first
// (broadway 10-J-Q-K-A first, wheel A-2-3-4-5 last). Each mask uses bit i
// for rank (i + 2), so bit 0 = '2', bit 12 = 'A'.
const STRAIGHT_MASKS = (() => {
  const list = []
  // Wheel: A,2,3,4,5 — high card is 5 in the wheel
  list.push({ high: 5, mask: (1 << 12) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) })
  for (let hi = 6; hi <= 14; hi++) {
    let m = 0
    for (let r = hi - 4; r <= hi; r++) m |= 1 << (r - 2)
    list.push({ high: hi, mask: m })
  }
  // Highest straight first so the first match wins.
  list.sort((a, b) => b.high - a.high)
  return list
})()

function findStraightHigh(rankMask) {
  for (let i = 0; i < STRAIGHT_MASKS.length; i++) {
    const { high, mask } = STRAIGHT_MASKS[i]
    if ((rankMask & mask) === mask) return high
  }
  return 0
}

// Module-level scratch buffers reused by scoreHand. Node is single-threaded
// and scoreHand is synchronous + non-recursive, so it's safe to share a
// single buffer across calls. Saves the ~180K array allocations per bot
// decision (3 buffers × 60K invocations) that a per-call literal would.
const _scratchRankCount = new Uint8Array(15)
const _scratchSuitMask = new Uint16Array(4)
const _scratchSuitCount = new Uint8Array(4)

export function scoreHand(cards) {
  // Reset the shared scratch buffers. Fixed-size memset is essentially free
  // compared to allocating fresh arrays per call.
  _scratchRankCount.fill(0)
  _scratchSuitMask[0] = 0; _scratchSuitMask[1] = 0; _scratchSuitMask[2] = 0; _scratchSuitMask[3] = 0
  _scratchSuitCount[0] = 0; _scratchSuitCount[1] = 0; _scratchSuitCount[2] = 0; _scratchSuitCount[3] = 0
  const rankCount = _scratchRankCount
  const suitMask = _scratchSuitMask
  const suitCount = _scratchSuitCount

  // Build per-suit rank bitmasks + global rank counts in one pass.
  let rankMask = 0

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const r = RANK_VALUES[c.rank]
    const s = SUIT_INDEX[c.suit]
    rankCount[r]++
    rankMask |= 1 << (r - 2)
    suitMask[s] |= 1 << (r - 2)
    suitCount[s]++
  }

  // Flush suit (at most one possible in 7 cards).
  let flushSuit = -1
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) { flushSuit = s; break }
  }

  // Straight flush / royal flush: only worth checking inside the flush suit.
  if (flushSuit !== -1) {
    const sfHigh = findStraightHigh(suitMask[flushSuit])
    if (sfHigh > 0) {
      const rank = sfHigh === 14 ? 9 : 8
      return (rank << 20) | (sfHigh << 16)
    }
  }

  // Walk ranks high-to-low to find the best quads / trip / pairs.
  let quad = 0
  let trip1 = 0
  let trip2 = 0
  let pair1 = 0
  let pair2 = 0
  for (let r = 14; r >= 2; r--) {
    const c = rankCount[r]
    if (c === 4) {
      if (!quad) quad = r
    } else if (c === 3) {
      if (!trip1) trip1 = r
      else if (!trip2) trip2 = r
    } else if (c === 2) {
      if (!pair1) pair1 = r
      else if (!pair2) pair2 = r
    }
  }

  // FOUR OF A KIND
  if (quad) {
    let kicker = 0
    for (let r = 14; r >= 2; r--) {
      if (r !== quad && rankCount[r] > 0) { kicker = r; break }
    }
    return (7 << 20) | (quad << 16) | (kicker << 12)
  }

  // FULL HOUSE — second trip or top pair fills the boat.
  if (trip1 && (pair1 || trip2)) {
    const pairVal = pair1 > trip2 ? pair1 : trip2
    return (6 << 20) | (trip1 << 16) | (pairVal << 12)
  }

  // FLUSH (we know it's not a straight flush from the early-return above).
  if (flushSuit !== -1) {
    let score = 5 << 20
    let shift = 16
    let count = 0
    for (let r = 14; r >= 2 && count < 5; r--) {
      if (suitMask[flushSuit] & (1 << (r - 2))) {
        score |= r << shift
        shift -= 4
        count++
      }
    }
    return score
  }

  // STRAIGHT (not suited).
  const strHigh = findStraightHigh(rankMask)
  if (strHigh) {
    return (4 << 20) | (strHigh << 16)
  }

  // THREE OF A KIND
  if (trip1) {
    let k1 = 0, k2 = 0
    for (let r = 14; r >= 2; r--) {
      if (r === trip1 || rankCount[r] === 0) continue
      if (!k1) k1 = r
      else { k2 = r; break }
    }
    return (3 << 20) | (trip1 << 16) | (k1 << 12) | (k2 << 8)
  }

  // TWO PAIR
  if (pair1 && pair2) {
    let kicker = 0
    for (let r = 14; r >= 2; r--) {
      if (r === pair1 || r === pair2) continue
      if (rankCount[r] > 0) { kicker = r; break }
    }
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8)
  }

  // ONE PAIR
  if (pair1) {
    let k1 = 0, k2 = 0, k3 = 0
    for (let r = 14; r >= 2; r--) {
      if (r === pair1 || rankCount[r] === 0) continue
      if (!k1) k1 = r
      else if (!k2) k2 = r
      else { k3 = r; break }
    }
    return (1 << 20) | (pair1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4)
  }

  // HIGH CARD — top 5 distinct ranks.
  let score = 0
  let shift = 16
  let count = 0
  for (let r = 14; r >= 2 && count < 5; r--) {
    if (rankCount[r] > 0) {
      score |= r << shift
      shift -= 4
      count++
    }
  }
  return score
}

// Determine winners from array of { playerId, cards }
// communityCards are shared cards on the table
export function determineWinners(players, communityCards) {
  const evaluated = players.map(p => ({
    playerId: p.playerId,
    hand: evaluateHand([...p.cards, ...communityCards]),
  }))

  // Sort best to worst
  evaluated.sort((a, b) => compareHands(b.hand, a.hand))

  // Find all players tied for best hand
  const best = evaluated[0]
  const winners = evaluated.filter(e => compareHands(e.hand, best.hand) === 0)

  return winners.map(w => ({
    playerId: w.playerId,
    handName: getHandName(w.hand),
    handRank: w.hand.rank,
    winningCards: w.hand.bestCards
  }))
}
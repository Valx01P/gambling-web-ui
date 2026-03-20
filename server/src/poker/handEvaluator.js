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

// Get all 5-card combinations from 7 cards
function combinations(cards, k) {
  if (k === 0) return [[]]
  if (cards.length === 0) return []
  const [first, ...rest] = cards
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c])
  const withoutFirst = combinations(rest, k)
  return [...withFirst, ...withoutFirst]
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

  if (isFlush && isStraight) {
    if (straightHigh === 14) return { rank: HAND_RANK.ROYAL_FLUSH, kickers: [14] }
    return { rank: HAND_RANK.STRAIGHT_FLUSH, kickers: [straightHigh] }
  }
  if (groups[0].count === 4) {
    return { rank: HAND_RANK.FOUR_OF_A_KIND, kickers: [groups[0].val, groups[1].val] }
  }
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: HAND_RANK.FULL_HOUSE, kickers: [groups[0].val, groups[1].val] }
  }
  if (isFlush) {
    return { rank: HAND_RANK.FLUSH, kickers: values }
  }
  if (isStraight) {
    return { rank: HAND_RANK.STRAIGHT, kickers: [straightHigh] }
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a)
    return { rank: HAND_RANK.THREE_OF_A_KIND, kickers: [groups[0].val, ...kickers] }
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter(g => g.count === 2).map(g => g.val).sort((a, b) => b - a)
    const kicker = groups.find(g => g.count === 1)?.val || 0
    return { rank: HAND_RANK.TWO_PAIR, kickers: [...pairs, kicker] }
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a)
    return { rank: HAND_RANK.PAIR, kickers: [groups[0].val, ...kickers] }
  }

  return { rank: HAND_RANK.HIGH_CARD, kickers: values }
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
  return HAND_NAMES[evaluation.rank]
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
    handRank: w.hand.rank
  }))
}
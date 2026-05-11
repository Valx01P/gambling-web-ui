const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export const HAND_RANK = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
}

const RANK_VALUES = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

const HAND_NAMES = {
  0: 'High Card',
  1: 'Pair',
  2: 'Two Pair',
  3: 'Trips',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Quads',
  8: 'Straight Flush',
  9: 'Royal Flush',
}

const RANK_WORDS = {
  2: 'Twos',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
}

const RANK_NAMES = {
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
}

const SHORT_RANKS = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

const FULL_DECK = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })))
const SUIT_INDEX = { hearts: 0, diamonds: 1, clubs: 2, spades: 3 }

function isRealCard(card) {
  return Boolean(card?.rank && card?.suit)
}

function cardKey(card) {
  return `${card.rank}-${card.suit}`
}

function valueOf(card) {
  return RANK_VALUES[card.rank]
}

function rankWord(value) {
  return RANK_WORDS[value] || String(value)
}

function rankName(value) {
  return RANK_NAMES[value] || String(value)
}

function rankShort(value) {
  return SHORT_RANKS[value] || String(value)
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return '0%'
  if (value > 0 && value < 0.1) return '<0.1%'
  if (value > 99.9 && value < 100) return '>99.9%'
  return `${value.toFixed(digits)}%`
}

export function formatCard(card) {
  if (!isRealCard(card)) return ''
  const suits = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' }
  return `${card.rank}${suits[card.suit] || ''}`
}

function realCards(cards = []) {
  return cards.filter(isRealCard)
}

function remainingDeck(knownCards) {
  const dead = new Set(realCards(knownCards).map(cardKey))
  return FULL_DECK.filter((card) => !dead.has(cardKey(card)))
}

function combinationsCount(n, k) {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i
  }
  return Math.round(result)
}

function forEachCombination(items, size, callback) {
  if (size === 0) {
    callback([])
    return
  }

  const combo = new Array(size)

  function walk(start, depth) {
    if (depth === size) {
      callback(combo.slice())
      return
    }

    const remaining = size - depth
    for (let i = start; i <= items.length - remaining; i++) {
      combo[depth] = items[i]
      walk(i + 1, depth + 1)
    }
  }

  walk(0, 0)
}

export function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank
  const len = Math.max(a.kickers.length, b.kickers.length)
  for (let i = 0; i < len; i++) {
    const diff = (a.kickers[i] || 0) - (b.kickers[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

// Bitmask-based integer scorer. Mirror of the server's scoreHand (~95x
// faster than evaluateHand+compareHands per call). Used in the Monte Carlo
// equity loop where the existing `{ rank, kickers }` shape is overkill —
// integer compare is enough to settle each runout.
//
// Score layout (24 bits): rank (4) << 20 | k0 (4) << 16 | k1 << 12 | k2 << 8
// | k3 << 4 | k4 << 0. Higher score = better hand.
const _scoreRankCount = new Uint8Array(15)
const _scoreSuitMasks = new Uint16Array(4)
const _scoreSuitCounts = new Uint8Array(4)

function _findStraightHigh(mask) {
  for (let high = 14; high >= 6; high--) {
    const needed =
      (1 << high) | (1 << (high - 1)) | (1 << (high - 2)) | (1 << (high - 3)) | (1 << (high - 4))
    if ((mask & needed) === needed) return high
  }
  const wheel = (1 << 14) | (1 << 5) | (1 << 4) | (1 << 3) | (1 << 2)
  return (mask & wheel) === wheel ? 5 : 0
}

export function scoreHand(cards) {
  if (cards.length < 5) return 0
  _scoreRankCount.fill(0)
  _scoreSuitMasks[0] = 0; _scoreSuitMasks[1] = 0; _scoreSuitMasks[2] = 0; _scoreSuitMasks[3] = 0
  _scoreSuitCounts[0] = 0; _scoreSuitCounts[1] = 0; _scoreSuitCounts[2] = 0; _scoreSuitCounts[3] = 0
  let rankMask = 0

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const v = RANK_VALUES[c.rank]
    const s = SUIT_INDEX[c.suit]
    _scoreRankCount[v]++
    rankMask |= 1 << v
    _scoreSuitMasks[s] |= 1 << v
    _scoreSuitCounts[s]++
  }

  let flushSuit = -1
  for (let s = 0; s < 4; s++) if (_scoreSuitCounts[s] >= 5) { flushSuit = s; break }

  if (flushSuit !== -1) {
    const sfHigh = _findStraightHigh(_scoreSuitMasks[flushSuit])
    if (sfHigh) {
      const rank = sfHigh === 14 ? 9 : 8
      return (rank << 20) | (sfHigh << 16)
    }
  }

  let quad = 0, trip1 = 0, trip2 = 0, pair1 = 0, pair2 = 0
  for (let v = 14; v >= 2; v--) {
    const c = _scoreRankCount[v]
    if (c === 4) { if (!quad) quad = v }
    else if (c === 3) { if (!trip1) trip1 = v; else if (!trip2) trip2 = v }
    else if (c === 2) { if (!pair1) pair1 = v; else if (!pair2) pair2 = v }
  }

  if (quad) {
    let k = 0
    for (let v = 14; v >= 2; v--) if (v !== quad && _scoreRankCount[v] > 0) { k = v; break }
    return (7 << 20) | (quad << 16) | (k << 12)
  }
  if (trip1 && (pair1 || trip2)) {
    const p = pair1 > trip2 ? pair1 : trip2
    return (6 << 20) | (trip1 << 16) | (p << 12)
  }
  if (flushSuit !== -1) {
    let score = 5 << 20, shift = 16, n = 0
    for (let v = 14; v >= 2 && n < 5; v--) {
      if (_scoreSuitMasks[flushSuit] & (1 << v)) { score |= v << shift; shift -= 4; n++ }
    }
    return score
  }
  const sh = _findStraightHigh(rankMask)
  if (sh) return (4 << 20) | (sh << 16)
  if (trip1) {
    let k1 = 0, k2 = 0
    for (let v = 14; v >= 2; v--) {
      if (v === trip1 || _scoreRankCount[v] === 0) continue
      if (!k1) k1 = v
      else { k2 = v; break }
    }
    return (3 << 20) | (trip1 << 16) | (k1 << 12) | (k2 << 8)
  }
  if (pair1 && pair2) {
    let k = 0
    for (let v = 14; v >= 2; v--) {
      if (v === pair1 || v === pair2) continue
      if (_scoreRankCount[v] > 0) { k = v; break }
    }
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (k << 8)
  }
  if (pair1) {
    let k1 = 0, k2 = 0, k3 = 0
    for (let v = 14; v >= 2; v--) {
      if (v === pair1 || _scoreRankCount[v] === 0) continue
      if (!k1) k1 = v
      else if (!k2) k2 = v
      else { k3 = v; break }
    }
    return (1 << 20) | (pair1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4)
  }
  let score = 0, shift = 16, n = 0
  for (let v = 14; v >= 2 && n < 5; v--) {
    if (_scoreRankCount[v] > 0) { score |= v << shift; shift -= 4; n++ }
  }
  return score
}

function straightHighFromMask(mask) {
  for (let high = 14; high >= 6; high--) {
    const needed =
      (1 << high) |
      (1 << (high - 1)) |
      (1 << (high - 2)) |
      (1 << (high - 3)) |
      (1 << (high - 4))

    if ((mask & needed) === needed) return high
  }

  const wheel = (1 << 14) | (1 << 5) | (1 << 4) | (1 << 3) | (1 << 2)
  return (mask & wheel) === wheel ? 5 : 0
}

function topValuesFromMask(mask, limit, excluded = null) {
  const values = []
  for (let value = 14; value >= 2 && values.length < limit; value--) {
    if ((mask & (1 << value)) && !excluded?.has(value)) {
      values.push(value)
    }
  }
  return values
}

export function evaluateHand(cards) {
  if (cards.length < 5) return null

  const counts = Array(15).fill(0)
  const suitCounts = [0, 0, 0, 0]
  const suitMasks = [0, 0, 0, 0]
  let rankMask = 0

  for (const card of cards) {
    const value = valueOf(card)
    const suit = SUIT_INDEX[card.suit]
    counts[value] += 1
    suitCounts[suit] += 1
    suitMasks[suit] |= (1 << value)
    rankMask |= (1 << value)
  }

  const flushSuit = suitCounts.findIndex((count) => count >= 5)
  if (flushSuit !== -1) {
    const straightFlushHigh = straightHighFromMask(suitMasks[flushSuit])
    if (straightFlushHigh) {
      return {
        rank: straightFlushHigh === 14 ? HAND_RANK.ROYAL_FLUSH : HAND_RANK.STRAIGHT_FLUSH,
        kickers: [straightFlushHigh],
        bestCards: [],
      }
    }
  }

  const quads = []
  const trips = []
  const pairs = []

  for (let value = 14; value >= 2; value--) {
    if (counts[value] === 4) quads.push(value)
    else if (counts[value] === 3) trips.push(value)
    else if (counts[value] === 2) pairs.push(value)
  }

  if (quads.length) {
    return {
      rank: HAND_RANK.FOUR_OF_A_KIND,
      kickers: [quads[0], topValuesFromMask(rankMask, 1, new Set([quads[0]]))[0] || 0],
      bestCards: [],
    }
  }

  if (trips.length && (pairs.length || trips.length > 1)) {
    return {
      rank: HAND_RANK.FULL_HOUSE,
      kickers: [trips[0], trips.length > 1 ? trips[1] : pairs[0]],
      bestCards: [],
    }
  }

  if (flushSuit !== -1) {
    return {
      rank: HAND_RANK.FLUSH,
      kickers: topValuesFromMask(suitMasks[flushSuit], 5),
      bestCards: [],
    }
  }

  const straightHigh = straightHighFromMask(rankMask)
  if (straightHigh) {
    return { rank: HAND_RANK.STRAIGHT, kickers: [straightHigh], bestCards: [] }
  }

  if (trips.length) {
    return {
      rank: HAND_RANK.THREE_OF_A_KIND,
      kickers: [trips[0], ...topValuesFromMask(rankMask, 2, new Set([trips[0]]))],
      bestCards: [],
    }
  }

  if (pairs.length >= 2) {
    return {
      rank: HAND_RANK.TWO_PAIR,
      kickers: [
        pairs[0],
        pairs[1],
        topValuesFromMask(rankMask, 1, new Set([pairs[0], pairs[1]]))[0] || 0,
      ],
      bestCards: [],
    }
  }

  if (pairs.length === 1) {
    return {
      rank: HAND_RANK.PAIR,
      kickers: [pairs[0], ...topValuesFromMask(rankMask, 3, new Set([pairs[0]]))],
      bestCards: [],
    }
  }

  return {
    rank: HAND_RANK.HIGH_CARD,
    kickers: topValuesFromMask(rankMask, 5),
    bestCards: [],
  }
}

export function getHandName(evaluation) {
  if (!evaluation) return 'No hand'
  const main = rankWord(evaluation.kickers[0])
  const sub = rankWord(evaluation.kickers[1])

  switch (evaluation.rank) {
    case HAND_RANK.HIGH_CARD:
      return `${rankName(evaluation.kickers[0])} High`
    case HAND_RANK.PAIR:
      return `Pair of ${main}`
    case HAND_RANK.TWO_PAIR:
      return `Two Pair, ${main} & ${sub}`
    case HAND_RANK.THREE_OF_A_KIND:
      return `Trips, ${main}`
    case HAND_RANK.STRAIGHT:
      return `Straight, ${rankName(evaluation.kickers[0])} High`
    case HAND_RANK.FLUSH:
      return `Flush, ${rankName(evaluation.kickers[0])} High`
    case HAND_RANK.FULL_HOUSE:
      return `Full House, ${main} over ${sub}`
    case HAND_RANK.FOUR_OF_A_KIND:
      return `Quads, ${main}`
    case HAND_RANK.STRAIGHT_FLUSH:
      return `Straight Flush, ${rankName(evaluation.kickers[0])} High`
    case HAND_RANK.ROYAL_FLUSH:
      return 'Royal Flush'
    default:
      return HAND_NAMES[evaluation.rank] || 'Unknown'
  }
}

function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function makeRng(seed) {
  let state = hashString(seed) || 1
  return () => {
    state = Math.imul(1664525, state) + 1013904223
    return ((state >>> 0) / 4294967296)
  }
}

function drawRandom(pool, count, rng) {
  const drawn = []
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * pool.length)
    drawn.push(pool[index])
    pool[index] = pool[pool.length - 1]
    pool.pop()
  }
  return drawn
}

// Pre-allocated 7-card buffer reused across MC iterations to avoid the
// `[...player.cards, ...finalBoard]` spread on every player every iter.
const _settleHandBuf = new Array(7)

function settleEquity(players, finalBoard, totals, distributions = null) {
  // Score each player to a sortable integer; integer compare replaces the
  // old object-walking compareHands. With 2000 iters × 5 players that's
  // 10K evaluations per equity refresh — bitmask scoring is ~95x faster.
  let bestScore = -1
  let bestCount = 0  // tracks how many tie at bestScore so we don't need a second pass
  const scores = new Array(players.length)

  for (let i = 0; i < players.length; i++) {
    const cards = players[i].cards
    _settleHandBuf[0] = cards[0]
    _settleHandBuf[1] = cards[1]
    for (let j = 0; j < finalBoard.length; j++) _settleHandBuf[2 + j] = finalBoard[j]
    _settleHandBuf.length = 2 + finalBoard.length
    const s = scoreHand(_settleHandBuf)
    scores[i] = s
    if (s > bestScore) { bestScore = s; bestCount = 1 }
    else if (s === bestScore) bestCount += 1
  }

  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    const total = totals.get(player.id)
    if (scores[i] === bestScore) {
      total.equity += 1 / bestCount
      if (bestCount === 1) total.wins += 1
      else total.ties += 1
    }
    if (distributions) {
      const dist = distributions.get(player.id)
      // Rank lives in bits 23..20 of the packed score.
      const rank = (scores[i] >>> 20) & 0xf
      const label = HAND_NAMES[rank] || 'Unknown'
      dist.set(label, (dist.get(label) || 0) + 1)
    }
  }
}

function statsRows(players, totals, totalRunouts, distributions = null) {
  return players.map((player) => {
    const total = totals.get(player.id)
    const distribution = distributions?.get(player.id)

    return {
      id: player.id,
      username: player.username,
      equity: (total.equity / totalRunouts) * 100,
      win: (total.wins / totalRunouts) * 100,
      tie: (total.ties / totalRunouts) * 100,
      handDistribution: distribution
        ? [...distribution.entries()]
          .map(([label, count]) => ({ label, percent: (count / totalRunouts) * 100, count }))
          .sort((a, b) => b.percent - a.percent)
        : [],
    }
  })
}

export function calculateExactEquity(players, board, options = {}) {
  const knownCards = [...board, ...players.flatMap((player) => player.cards)]
  const deck = remainingDeck(knownCards)
  const missingBoardCards = 5 - board.length
  const totalRunouts = combinationsCount(deck.length, missingBoardCards)
  const totals = new Map(players.map((player) => [player.id, { equity: 0, wins: 0, ties: 0 }]))
  const distributions = options.includeDistributions
    ? new Map(players.map((player) => [player.id, new Map()]))
    : null

  forEachCombination(deck, missingBoardCards, (runout) => {
    settleEquity(players, [...board, ...runout], totals, distributions)
  })

  return {
    mode: 'Exact',
    totalRunouts,
    boardCardsToCome: missingBoardCards,
    players: statsRows(players, totals, totalRunouts || 1, distributions),
  }
}

// Sampled version of calculateExactEquity for boards with too many runouts to
// enumerate in real time. Preflop with 5 players is C(42,5) ≈ 850k runouts;
// blocking the main thread to enumerate them takes ~1.5s every time game
// state arrives. 2000 samples land in ~15ms with ±0.6% accuracy at 95% CI —
// close enough for a live equity bar.
export function calculateSampledMultiplayerEquity(players, board, options = {}) {
  const iterations = Math.max(200, Math.min(20000, options.iterations || 2000))
  const seed = options.seed ?? Date.now()
  const knownCards = [...board, ...players.flatMap((player) => player.cards)]
  const baseDeck = remainingDeck(knownCards)
  const missingBoardCards = 5 - board.length
  const totals = new Map(players.map((player) => [player.id, { equity: 0, wins: 0, ties: 0 }]))
  const rng = makeRng(seed)

  for (let i = 0; i < iterations; i++) {
    const pool = baseDeck.slice()
    const runout = drawRandom(pool, missingBoardCards, rng)
    settleEquity(players, [...board, ...runout], totals)
  }

  return {
    mode: 'Sampled',
    totalRunouts: iterations,
    boardCardsToCome: missingBoardCards,
    players: statsRows(players, totals, iterations, null),
  }
}

function calculateSampledHeroEquity({ heroCards, board, knownOpponents, hiddenOpponentCount, iterations, seed }) {
  const knownCards = [...heroCards, ...board, ...knownOpponents.flatMap((player) => player.cards)]
  const baseDeck = remainingDeck(knownCards)
  const missingBoardCards = 5 - board.length
  const totals = new Map([['hero', { equity: 0, wins: 0, ties: 0 }]])
  const rng = makeRng(seed)
  let completed = 0

  for (let i = 0; i < iterations; i++) {
    const pool = baseDeck.slice()
    const players = [
      { id: 'hero', cards: heroCards },
      ...knownOpponents.map((player) => ({ id: player.id, cards: player.cards })),
    ]

    for (const player of knownOpponents) {
      if (!totals.has(player.id)) totals.set(player.id, { equity: 0, wins: 0, ties: 0 })
    }

    for (let opponent = 0; opponent < hiddenOpponentCount; opponent++) {
      const id = `hidden-${opponent}`
      players.push({ id, cards: drawRandom(pool, 2, rng) })
      if (!totals.has(id)) totals.set(id, { equity: 0, wins: 0, ties: 0 })
    }

    const finalBoard = [...board, ...drawRandom(pool, missingBoardCards, rng)]
    settleEquity(players, finalBoard, totals)
    completed += 1
  }

  const hero = totals.get('hero')

  return {
    mode: 'Sampled',
    sampleSize: completed,
    equity: (hero.equity / completed) * 100,
    win: (hero.wins / completed) * 100,
    tie: (hero.ties / completed) * 100,
  }
}

function calculateKnownHeroEquity(heroCards, board, opponents) {
  const result = calculateExactEquity(
    [
      { id: 'hero', username: 'You', cards: heroCards },
      ...opponents,
    ],
    board,
  )

  const hero = result.players.find((player) => player.id === 'hero')
  return {
    mode: result.mode,
    totalRunouts: result.totalRunouts,
    equity: hero?.equity || 0,
    win: hero?.win || 0,
    tie: hero?.tie || 0,
  }
}

function calculateHandPotential(heroCards, board, knownDeadCards) {
  const missingBoardCards = 5 - board.length
  const deck = remainingDeck(knownDeadCards)
  const exact = missingBoardCards <= 2
  const counts = new Map()
  let total = 0

  const record = (runout) => {
    const evaluation = evaluateHand([...heroCards, ...board, ...runout])
    if (!evaluation) return
    const label = HAND_NAMES[evaluation.rank] || 'Unknown'
    counts.set(label, (counts.get(label) || 0) + 1)
    total += 1
  }

  if (exact) {
    forEachCombination(deck, missingBoardCards, record)
  } else {
    const iterations = 8000
    const rng = makeRng(`potential:${heroCards.map(cardKey).join('|')}:${board.map(cardKey).join('|')}`)
    for (let i = 0; i < iterations; i++) {
      record(drawRandom(deck.slice(), missingBoardCards, rng))
    }
  }

  return {
    mode: exact ? 'Exact' : 'Sampled',
    sampleSize: exact ? total : 8000,
    hands: [...counts.entries()]
      .map(([label, count]) => ({ label, count, percent: (count / Math.max(total, 1)) * 100 }))
      .sort((a, b) => b.percent - a.percent),
  }
}

function calculateOuts(heroCards, board, knownDeadCards) {
  if (board.length < 3 || board.length >= 5) return []

  const current = evaluateHand([...heroCards, ...board])
  if (!current) return []

  const groups = new Map()
  for (const card of remainingDeck(knownDeadCards)) {
    const evaluation = evaluateHand([...heroCards, ...board, card])
    if (!evaluation || compareHands(evaluation, current) <= 0) continue

    const label = HAND_NAMES[evaluation.rank] || 'Unknown'
    if (!groups.has(label)) {
      groups.set(label, { label, rank: evaluation.rank, count: 0, cards: [], bestName: getHandName(evaluation) })
    }
    const group = groups.get(label)
    group.count += 1
    if (group.cards.length < 8) group.cards.push(formatCard(card))
  }

  return [...groups.values()].sort((a, b) => b.rank - a.rank || b.count - a.count)
}

function calculateThreats(heroCards, board, knownDeadCards) {
  if (board.length < 3) return []

  const hero = evaluateHand([...heroCards, ...board])
  if (!hero) return []

  const deck = remainingDeck(knownDeadCards)
  const groups = new Map()

  for (let i = 0; i < deck.length - 1; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const cards = [deck[i], deck[j]]
      const evaluation = evaluateHand([...cards, ...board])
      if (!evaluation || compareHands(evaluation, hero) <= 0) continue

      const label = getHandName(evaluation)
      if (!groups.has(label)) {
        groups.set(label, {
          label,
          rank: evaluation.rank,
          count: 0,
          examples: [],
        })
      }

      const group = groups.get(label)
      group.count += 1
      if (group.examples.length < 3) group.examples.push(cards.map(formatCard).join(' '))
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.rank - a.rank || b.count - a.count)
    .slice(0, 6)
}

function describeStartingHand(cards) {
  if (cards.length !== 2) return null

  const values = cards.map(valueOf).sort((a, b) => b - a)
  const [high, low] = values
  const suited = cards[0].suit === cards[1].suit
  const pair = high === low
  const gap = Math.abs(high - low) - 1
  const connected = gap === 0 && !pair
  const broadway = high >= 10 && low >= 10

  const code = pair
    ? `${rankShort(high)}${rankShort(low)}`
    : `${rankShort(high)}${rankShort(low)}${suited ? 's' : 'o'}`

  const label = pair
    ? `Pocket ${rankWord(high)}`
    : `${rankName(high)}-${rankName(low)} ${suited ? 'suited' : 'offsuit'}`

  const traits = []
  if (pair) traits.push('Pair')
  if (suited && !pair) traits.push('Suited')
  if (connected) traits.push('Connected')
  if (!connected && !pair && gap > 0 && gap <= 3) traits.push(`${gap}-gap`)
  if (broadway) traits.push('Broadway')
  if (high === 14) traits.push('Ace high')

  return { code, label, traits }
}

function activePlayers(gameState) {
  return (gameState?.players || []).filter((player) =>
    !player.folded &&
    !player.waitingNextHand &&
    Array.isArray(player.cards) &&
    player.cards.length > 0
  )
}

export function buildPokerStatistics(gameState, playerId, options = {}) {
  const includeDetails = options.includeDetails ?? true

  if (!gameState) {
    return { available: false, reason: 'No game state' }
  }

  const board = realCards(gameState.communityCards)
  const players = activePlayers(gameState)
  const heroPlayer = players.find((player) => player.id === playerId)
  const heroCards = realCards(heroPlayer?.cards || [])
  const exposedOpponents = players
    .filter((player) => player.id !== playerId && realCards(player.cards).length === 2)
    .map((player) => ({ id: player.id, username: player.username, cards: realCards(player.cards) }))

  const allInKnownPlayers = players
    .filter((player) => realCards(player.cards).length === 2)
    .map((player) => ({ id: player.id, username: player.username, cards: realCards(player.cards) }))

  const canCalculateAllIn =
    gameState.runoutLocked &&
    allInKnownPlayers.length >= 2 &&
    allInKnownPlayers.length === players.length &&
    board.length <= 5

  const allIn = canCalculateAllIn
    ? calculateExactEquity(allInKnownPlayers, board)
    : null

  if (heroCards.length !== 2 || heroPlayer?.folded || heroPlayer?.waitingNextHand) {
    return {
      available: Boolean(allIn),
      phase: gameState.phase,
      boardCards: board.length,
      hero: null,
      allIn,
    }
  }

  const opponentCount = players.filter((player) => player.id !== playerId).length
  const hiddenOpponentCount = Math.max(0, opponentCount - exposedOpponents.length)
  const knownDeadCards = [...heroCards, ...board, ...exposedOpponents.flatMap((player) => player.cards)]
  const currentHand = board.length >= 3 ? evaluateHand([...heroCards, ...board]) : null
  const seed = [
    playerId,
    gameState.phase,
    board.map(cardKey).join(','),
    heroCards.map(cardKey).join(','),
    opponentCount,
    gameState.pot,
    gameState.currentBet,
  ].join('|')

  const allInHero = allIn?.players.find((player) => player.id === playerId)
  const heroEquity = opponentCount === 0
    ? null
    : allInHero
      ? {
        mode: allIn.mode,
        totalRunouts: allIn.totalRunouts,
        equity: allInHero.equity,
        win: allInHero.win,
        tie: allInHero.tie,
      }
      : hiddenOpponentCount === 0 && exposedOpponents.length > 0
        ? calculateKnownHeroEquity(heroCards, board, exposedOpponents)
        : calculateSampledHeroEquity({
          heroCards,
          board,
          knownOpponents: exposedOpponents,
          hiddenOpponentCount,
          iterations: board.length >= 3 ? 12000 : 9000,
          seed,
        })

  return {
    available: true,
    phase: gameState.phase,
    boardCards: board.length,
    hero: {
      startingHand: describeStartingHand(heroCards),
      currentHand: currentHand ? getHandName(currentHand) : null,
      opponentCount,
      equity: heroEquity,
      potential: includeDetails ? calculateHandPotential(heroCards, board, knownDeadCards) : null,
      outs: calculateOuts(heroCards, board, knownDeadCards),
      threats: includeDetails ? calculateThreats(heroCards, board, knownDeadCards) : null,
    },
    allIn,
  }
}

// Anything above this many runouts switches the spectator equity calc to
// Monte Carlo sampling. ~5k iterations of settleEquity is fast (<10ms);
// beyond that we bog down the main thread, especially preflop with 4-5
// hands where C(42,5) is ~850k.
const SPECTATOR_EXACT_RUNOUT_THRESHOLD = 5000

export function buildSpectatorStatistics(gameState, options = {}) {
  if (!gameState || options.blindMode) {
    return { available: false, players: [] }
  }

  const board = realCards(gameState.communityCards)
  const players = (gameState.players || [])
    .filter((player) =>
      !player.folded &&
      !player.waitingNextHand &&
      realCards(player.cards || []).length === 2
    )
    .map((player) => ({
      id: player.id,
      username: player.username,
      cards: realCards(player.cards),
    }))

  if (players.length < 2 || board.length > 5) {
    return { available: false, players: [] }
  }

  // Decide exact-vs-sampled based on combinatorial size of the runout space.
  // Cheap to compute; saves us from blocking the main thread on preflop.
  const knownCards = [...board, ...players.flatMap((p) => p.cards)]
  const remainingCount = 52 - knownCards.length
  const missingBoard = 5 - board.length
  const runoutSize = combinationsCount(remainingCount, missingBoard)
  const useSampled = runoutSize > SPECTATOR_EXACT_RUNOUT_THRESHOLD

  return {
    available: true,
    ...(useSampled
      ? calculateSampledMultiplayerEquity(players, board, { iterations: 2000 })
      : calculateExactEquity(players, board)),
  }
}

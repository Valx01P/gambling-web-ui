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

function settleEquity(players, finalBoard, totals, distributions = null) {
  let best = null
  const evaluated = players.map((player) => {
    const hand = evaluateHand([...player.cards, ...finalBoard])
    if (!best || compareHands(hand, best) > 0) best = hand
    return { ...player, hand }
  })

  const winners = evaluated.filter((player) => compareHands(player.hand, best) === 0)

  for (const player of evaluated) {
    const total = totals.get(player.id)
    if (winners.some((winner) => winner.id === player.id)) {
      total.equity += 1 / winners.length
      if (winners.length === 1) total.wins += 1
      else total.ties += 1
    }

    if (distributions) {
      const dist = distributions.get(player.id)
      const label = HAND_NAMES[player.hand.rank] || 'Unknown'
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

  return {
    available: true,
    ...calculateExactEquity(players, board),
  }
}

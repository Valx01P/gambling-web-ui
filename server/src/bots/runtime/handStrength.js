import { evaluateHand } from '../../poker/handEvaluator.js'

const RANK_INDEX = {
  '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6,
  '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12
}

export const TIER_ORDER = ['trash', 'weak', 'medium', 'strong', 'premium']

export function tierIndex(name) {
  const i = TIER_ORDER.indexOf(name)
  return i === -1 ? 0 : i
}

// Sklansky-flavored preflop tiers — coarse but deterministic.
export function preflopStrength(cards) {
  if (!Array.isArray(cards) || cards.length !== 2 || !cards[0] || !cards[1]) return 'trash'
  const ai = RANK_INDEX[cards[0].rank]
  const bi = RANK_INDEX[cards[1].rank]
  if (ai === undefined || bi === undefined) return 'trash'

  const high = Math.max(ai, bi)
  const low = Math.min(ai, bi)
  const suited = cards[0].suit === cards[1].suit
  const pair = ai === bi
  const gap = high - low

  if (pair) {
    if (high >= 9) return 'premium'    // JJ+
    if (high >= 7) return 'strong'     // 99–TT
    if (high >= 4) return 'medium'     // 66–88
    return 'weak'                      // 22–55
  }

  // A-x
  if (high === 12 && low === 11) return 'premium'              // AK
  if (high === 12 && low === 10) return suited ? 'premium' : 'strong'  // AQ
  if (high === 12 && low === 9)  return suited ? 'strong'  : 'medium'  // AJ
  if (high === 12 && low === 8)  return suited ? 'strong'  : 'medium'  // AT
  if (high === 12)               return suited ? 'medium'  : 'weak'    // Ax other

  // K-x
  if (high === 11 && low === 10) return suited ? 'strong' : 'medium'   // KQ
  if (high === 11 && low === 9)  return suited ? 'medium' : 'weak'     // KJ
  if (high === 11 && low === 8)  return suited ? 'medium' : 'weak'     // KT
  if (high === 11)               return suited ? 'weak'   : 'trash'

  // Q-J / Q-T / J-T
  if (high === 10 && low === 9)  return suited ? 'medium' : 'weak'     // QJ
  if (high === 10 && low === 8)  return suited ? 'medium' : 'weak'     // QT
  if (high === 9  && low === 8)  return suited ? 'medium' : 'weak'     // JT

  // Suited connectors / 1-gappers
  if (suited && gap === 1 && low >= 4) return 'medium'  // 65s+ thru 98s
  if (suited && gap === 1)             return 'weak'    // 32s–54s
  if (suited && gap === 2 && low >= 5) return 'weak'    // suited 1-gappers mid

  return 'trash'
}

// Postflop: evaluate the bot's best 5-card hand and bucket it.
export function postflopStrength(holeCards, communityCards) {
  if (!Array.isArray(holeCards) || holeCards.length < 2) return 'trash'
  if (!Array.isArray(communityCards) || communityCards.length === 0) {
    return preflopStrength(holeCards)
  }
  try {
    const evalResult = evaluateHand([...holeCards, ...communityCards])
    const r = evalResult.rank
    if (r >= 6) return 'premium' // full house, quads, straight flush, royal
    if (r === 5) return 'strong' // flush
    if (r === 4) return 'strong' // straight
    if (r === 3) return 'strong' // three of a kind
    if (r === 2) return 'medium' // two pair
    if (r === 1) return 'medium' // pair
    return 'trash'               // high card
  } catch {
    return 'trash'
  }
}

export function strengthFor(holeCards, communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length === 0) {
    return preflopStrength(holeCards)
  }
  return postflopStrength(holeCards, communityCards)
}

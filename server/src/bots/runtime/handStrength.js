import { evaluateHand } from '../../poker/handEvaluator.js'
import { tierFromScore, preflopScore } from './handAnalyzer.js'

export const TIER_ORDER = ['trash', 'weak', 'medium', 'strong', 'premium']

export function tierIndex(name) {
  const i = TIER_ORDER.indexOf(name)
  return i === -1 ? 0 : i
}

// Preflop tier classification. Delegates to the canonical handAnalyzer so
// the categorical bucket stays consistent with the numeric handStrengthScore.
// This is the function bot rules (ruleSchema.js) compare against, so any
// drift here would break rule-based bots — keeping the mapping in one place.
//
// Tier breakpoints (from handAnalyzer.tierFromScore):
//   premium  >= 0.85   AA, KK, QQ, JJ, TT, AKs, AKo, AQs   (top ~3%)
//   strong   >= 0.70   99-77, KQs/AJs/KJs/ATs/QJs/AQo      (top ~10%)
//   medium   >= 0.55   66-22, broadways, suited aces       (top ~25%)
//   weak     >= 0.40   suited connectors, small offsuit Ax (top ~45%)
//   trash             everything else
export function preflopStrength(cards) {
  if (!Array.isArray(cards) || cards.length !== 2 || !cards[0] || !cards[1]) return 'trash'
  return tierFromScore(preflopScore(cards[0], cards[1]))
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

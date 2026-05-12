// Derive a short, human-readable headline for a recorded hand. Reads the
// compressed JSONB blob produced by PokerRoom._recordHumanHandResults and
// returns one of:
//   "Won — Full House, Aces full of Kings"
//   "Lost — Two Pair, Aces & Tens"
//   "Won — uncontested"
//   "Folded on the turn"
//
// We compute this at read-time so we don't have to backfill historical
// rows. The cost is bounded (40 rows per profile page; each evaluation is
// a fast 21-combination scan).

import { evaluateHand, getHandName } from '../poker/handEvaluator.js'

const SUIT_BY_LETTER = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades'
}

const PHASE_NAME = {
  p: 'preflop',
  f: 'the flop',
  t: 'the turn',
  r: 'the river'
}

// Parse a "10h" / "As" / "Ts" card string back into { rank, suit }.
// Returns null if the input shape is wrong — we fall back to an action-
// based summary in that case rather than crash on a bad row.
function parseCard(s) {
  if (typeof s !== 'string' || s.length < 2 || s.length > 3) return null
  const rank = s.length === 3 ? s.slice(0, 2) : s[0]
  const suit = SUIT_BY_LETTER[s[s.length - 1]]
  if (!suit) return null
  return { rank, suit }
}

function parseCards(arr) {
  if (!Array.isArray(arr)) return null
  const out = []
  for (const s of arr) {
    const c = parseCard(s)
    if (!c) return null
    out.push(c)
  }
  return out
}

// Letters used by the compressed action format: ['p', 'f', 1000] etc.
// First char of phase, first char of action.
function lastActionPhase(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]
    if (!Array.isArray(a)) continue
    return { phase: a[0], action: a[1] }
  }
  return null
}

// Returns a short headline (≤ 80 chars). The hand JSON is the per-row
// `data` blob; the boolean flags come from the archive's outcome columns.
export function summarizeHand({ data, won, wentToShowdown, voluntarilyIn, foldedPreflop }) {
  const d = data || {}
  const actions = d.a || []
  const hole = parseCards(d.hc)
  const board = parseCards(d.bd)

  // Folded preflop → simplest case, no board involved.
  if (foldedPreflop) return 'Folded preflop'

  const last = lastActionPhase(actions)
  // Folded mid-hand → name the street they bailed on.
  if (last && last.action === 'f' && !won) {
    return `Folded on ${PHASE_NAME[last.phase] || 'the flop'}`
  }

  // Won without showdown → opponents folded to our aggression.
  if (won && !wentToShowdown) return 'Won — uncontested'

  // From here, we want the made-hand name. Need full hole + at least the
  // flop to evaluate; if cards are missing for any reason we fall back.
  if (!hole || hole.length !== 2 || !board || board.length < 3) {
    if (won) return 'Won'
    if (voluntarilyIn) return 'Lost'
    return 'No action'
  }

  let madeName
  try {
    const evalResult = evaluateHand([...hole, ...board])
    madeName = getHandName(evalResult)
  } catch {
    madeName = null
  }
  if (!madeName) return won ? 'Won' : 'Lost'

  return won ? `Won — ${madeName}` : `Lost — ${madeName}`
}

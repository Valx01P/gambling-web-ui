// Player luck stats. Two stream-recorders (side bets, all-in showdowns)
// and a pure derivation that maps the four raw counters down to a single
// 0-10 score the client can render as a profile badge.
//
// Both record-functions are fire-and-forget — they accept a userId that
// might be null/missing (anonymous seats) and silently bail. DB errors
// are logged but never bubble, so a busted pool can't crash the engine.
//
// The luck score itself is intentionally simple: count (lucky_events −
// unlucky_events), normalize against a sample-size scale, clamp into
// [-5, 5], shift to [0, 10]. New users see 5 (neutral) until they have
// a few real events.

import { query } from '../db/pool.js'
import { evaluateHand, compareHands } from '../poker/handEvaluator.js'

// Below this displayed YES/NO price we treat a winning side bet as a
// "longshot win" — the position was a clear underdog at entry and paid
// out anyway. 30% is liberal enough to register the cheap-flop / cheap-
// runout props but won't reward 45% coin flips.
const LONGSHOT_PRICE_THRESHOLD = 0.30

// Sample size that makes the luck score start sitting near its extremes
// instead of staying glued to 5. Tuned so ~10 lucky events without any
// unlucky ones pushes the score up to ~8-9.
const LUCK_SAMPLE_SCALE = 10

// Equity threshold for "underdog at all-in". Strictly less than this
// counts; ties don't (so a 50/50 isn't a "lucky" win).
const UNDERDOG_EQUITY = 0.50

// ─── Repo writes ────────────────────────────────────────────────────────

// Called for every resolved side-bet position. `outcome` ∈ {'win', 'loss',
// 'void'} mirrors the engine's payout label. void resolutions don't move
// any counter (no win, no loss, stake refunded).
export async function recordSideBetResult({
  userId,
  outcome,
  entryPrice,   // 0..1 displayed buy price at entry
  chipDelta,    // realized P/L in chips (credit - costPaid). Negative on loss.
}) {
  if (!userId) return
  if (outcome !== 'win' && outcome !== 'loss') return

  const isWin = outcome === 'win'
  const isLongshotWin = isWin
    && typeof entryPrice === 'number'
    && entryPrice > 0
    && entryPrice < LONGSHOT_PRICE_THRESHOLD
  const delta = Math.round(Number.isFinite(chipDelta) ? chipDelta : 0)

  try {
    await query(
      `UPDATE users
          SET side_bets_won           = side_bets_won + $2,
              side_bets_lost          = side_bets_lost + $3,
              side_bet_longshot_wins  = side_bet_longshot_wins + $4,
              side_bet_chip_pl        = side_bet_chip_pl + $5
        WHERE id = $1`,
      [userId, isWin ? 1 : 0, isWin ? 0 : 1, isLongshotWin ? 1 : 0, delta]
    )
  } catch (err) {
    console.warn('[luck] recordSideBetResult failed:', err.message)
  }
}

// Called once per showdown for every all-in seat that's a signed-in user.
// `equity` is the player's pre-runout win probability against the field
// (computed by computeAllInEquity below); `won` is whether they actually
// took at least one pot share at showdown.
export async function recordAllInShowdown({ userId, equity, won }) {
  if (!userId) return
  const wasUnderdog = typeof equity === 'number' && equity < UNDERDOG_EQUITY
  const underdogWin = wasUnderdog && won

  try {
    await query(
      `UPDATE users
          SET all_in_showdowns     = all_in_showdowns + 1,
              all_in_underdog_wins = all_in_underdog_wins + $2
        WHERE id = $1`,
      [userId, underdogWin ? 1 : 0]
    )
  } catch (err) {
    console.warn('[luck] recordAllInShowdown failed:', err.message)
  }
}

// ─── Score derivation (pure) ────────────────────────────────────────────

// Map a row from the users table (with the luck columns present) to:
//   { luckScore, sideBetsWon, sideBetsLost, sideBetLongshotWins,
//     sideBetChipPl, allInShowdowns, allInUnderdogWins }
// luckScore is 0-10. 5 = neutral (no data, or wins == losses).
export function deriveLuckProfile(row) {
  if (!row) return null
  const sideBetsWon          = Number(row.side_bets_won          ?? 0)
  const sideBetsLost         = Number(row.side_bets_lost         ?? 0)
  const sideBetLongshotWins  = Number(row.side_bet_longshot_wins ?? 0)
  const sideBetChipPl        = Number(row.side_bet_chip_pl       ?? 0)
  const allInShowdowns       = Number(row.all_in_showdowns       ?? 0)
  const allInUnderdogWins    = Number(row.all_in_underdog_wins   ?? 0)

  // Lucky tail: each longshot side-bet win counts double (it's a stronger
  // signal than an at-the-money win), plus every all-in underdog win.
  const luckyEvents = sideBetLongshotWins * 2 + allInUnderdogWins
  // Unlucky tail: side-bet losses are the main "you bought, market moved
  // against you" signal. We don't penalize for losing as the all-in
  // favorite — that's just bad runs of cards, not the player's tilt to
  // measure here. (Could add `all_in_favorite_losses` later if we want
  // to track the other axis.)
  const unluckyEvents = sideBetsLost

  const signedSamples = luckyEvents - unluckyEvents
  // Normalize against sample-size scale, clamp to [-5, 5], shift to [0, 10].
  const score = 5 + Math.max(-5, Math.min(5, signedSamples / LUCK_SAMPLE_SCALE * 5))
  return {
    luckScore: Math.round(score),
    sideBetsWon, sideBetsLost, sideBetLongshotWins, sideBetChipPl,
    allInShowdowns, allInUnderdogWins
  }
}

// ─── All-in equity (Monte Carlo) ────────────────────────────────────────

// Compute each player's win equity at the moment of all-in given:
//   players:  [{ playerId, hole: [{rank,suit},{rank,suit}] }, ...]
//   boardAtAllIn: cards visible when the last all-in committed (0/3/4 of them)
// Returns Map<playerId, number> in [0, 1].
//
// 800 trials at 2-3 players is fast (<10ms) and tight enough for a luck
// stat that's already only used probabilistically. The seed comes from the
// joined hole+board so a given snapshot always evaluates the same way —
// makes the recorded counter stable across retries.
export function computeAllInEquity(players, boardAtAllIn) {
  if (!Array.isArray(players) || players.length < 2) return new Map()
  const visible = []
  for (const p of players) {
    if (!Array.isArray(p.hole) || p.hole.length !== 2) return new Map()
    visible.push(...p.hole)
  }
  visible.push(...boardAtAllIn)
  const deck = buildDeckExcluding(visible)
  const remaining = 5 - boardAtAllIn.length
  if (remaining < 0) return new Map()

  const wins = new Map(players.map(p => [p.playerId, 0]))
  const TRIALS = 800
  const rng = mulberry32(seedFromCards(visible))

  for (let t = 0; t < TRIALS; t++) {
    // Partial Fisher-Yates: only shuffle the first `remaining` positions.
    for (let i = 0; i < remaining; i++) {
      const j = i + Math.floor(rng() * (deck.length - i))
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp
    }
    const fullBoard = boardAtAllIn.concat(deck.slice(0, remaining))
    let bestHand = null
    let bestPlayers = []
    for (const p of players) {
      const h = evaluateHand([...p.hole, ...fullBoard])
      if (!bestHand || compareHands(h, bestHand) > 0) {
        bestHand = h
        bestPlayers = [p.playerId]
      } else if (compareHands(h, bestHand) === 0) {
        bestPlayers.push(p.playerId)
      }
    }
    // Split equity across ties so a chopped pot is 50/50, not 100/0.
    const share = 1 / bestPlayers.length
    for (const id of bestPlayers) wins.set(id, wins.get(id) + share)
  }

  const result = new Map()
  for (const [id, w] of wins) result.set(id, w / TRIALS)
  return result
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
function buildDeckExcluding(cards) {
  const seen = new Set(cards.map(c => `${c.rank}-${c.suit}`))
  const deck = []
  for (const r of RANKS) for (const s of SUITS) {
    if (!seen.has(`${r}-${s}`)) deck.push({ rank: r, suit: s })
  }
  return deck
}
function seedFromCards(cards) {
  let h = 7919
  for (const c of cards) {
    h = (h * 31 + c.rank.charCodeAt(0) * 17 + c.suit.charCodeAt(0)) >>> 0
  }
  return h
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

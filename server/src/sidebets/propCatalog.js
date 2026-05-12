// Side-bet prop catalog.
//
// Each entry describes one *type* of in-hand prop bet (Polymarket-style YES/
// NO market). The engine spawns an instance whenever `spawn` returns true
// for the current game state, prices it on every state change via `fairYes`,
// and asks `outcome` whether the prop has resolved. Returning null from
// `outcome` means "still open"; 'yes', 'no', or 'void' resolves it.
//
// State shape passed into every function:
//   {
//     phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'waiting',
//     board: Card[],                  // visible community cards
//     handEnded: boolean,             // true when the hand finished (showdown or fold-out)
//     activePlayerCount: number,      // not folded, not removed
//     seatCount: number,
//     anyAllIn: boolean,              // anyone has been all-in this hand
//     reachedShowdown: boolean,       // hand made it to runout w/ ≥2 players
//     aggressionThisHand: number,     // cumulative raise/all-in count
//     foldOutWinner: string | null,   // playerId if hand ended via fold-out
//   }
//
// Card shape: { rank: '2'..'A', suit: 'hearts'|'diamonds'|'clubs'|'spades' }.

import {
  pBoardPairsByRiver,
  pFlushOnBoardByRiver,
  pNextCardRed,
  pRankAppearsOnBoard,
  pBoardTripsByRiver
} from './oddsCalc.js'

const RED = new Set(['hearts', 'diamonds'])

function hasBoardPair(board) {
  const seen = new Set()
  for (const c of board) {
    if (seen.has(c.rank)) return true
    seen.add(c.rank)
  }
  return false
}

function maxSuitCount(board) {
  const counts = {}
  for (const c of board) counts[c.suit] = (counts[c.suit] || 0) + 1
  return Math.max(0, ...Object.values(counts))
}

function maxRankCount(board) {
  const counts = {}
  for (const c of board) counts[c.rank] = (counts[c.rank] || 0) + 1
  return Math.max(0, ...Object.values(counts))
}

function clampProb(p) {
  if (!Number.isFinite(p)) return 0.5
  return Math.max(0.02, Math.min(0.98, p))
}

export const PROP_CATALOG = {
  // ─── Card-runout props ──────────────────────────────────────────────────
  // These all VOID with refund if the hand ends fold-out before the relevant
  // street, so players aren't penalized for resolution conditions that
  // literally never had a chance to play out.

  flop_has_pair: {
    type: 'flop_has_pair',
    shortLabel: 'Paired flop',
    question: 'Will the flop pair?',
    detail: 'Any two cards of the same rank on the flop.',
    streetWindow: 'preflop',
    spawn: (s) => s.phase === 'preflop' && s.board.length === 0,
    fairYes: (s) => clampProb(pBoardPairsByRiverFromFlopWindow(s.board)),
    outcome: (s) => {
      if (s.board.length >= 3) return hasBoardPair(s.board.slice(0, 3)) ? 'yes' : 'no'
      if (s.handEnded && s.board.length < 3) return 'void'
      return null
    },
  },

  flop_three_suited: {
    type: 'flop_three_suited',
    shortLabel: 'Monotone flop',
    question: 'Will the flop be all one suit?',
    detail: 'All three flop cards share a single suit.',
    streetWindow: 'preflop',
    spawn: (s) => s.phase === 'preflop' && s.board.length === 0,
    fairYes: (s) => {
      // P(flop all same suit) = 4 * C(13,3) / C(52,3) ≈ 0.0518
      if (s.board.length >= 3) {
        const top3 = s.board.slice(0, 3)
        return new Set(top3.map(c => c.suit)).size === 1 ? 0.99 : 0.02
      }
      return 0.0518
    },
    outcome: (s) => {
      if (s.board.length >= 3) {
        return new Set(s.board.slice(0, 3).map(c => c.suit)).size === 1 ? 'yes' : 'no'
      }
      if (s.handEnded && s.board.length < 3) return 'void'
      return null
    },
  },

  ace_on_board: {
    type: 'ace_on_board',
    shortLabel: 'Ace on board',
    question: 'Will an ace land on the board?',
    detail: 'At least one ace appears in the 5 community cards.',
    streetWindow: 'preflop-turn',
    spawn: (s) => s.phase === 'preflop' || (s.phase === 'flop' && s.board.length === 3) || s.phase === 'turn',
    fairYes: (s) => clampProb(pRankAppearsOnBoard(s.board, 'A')),
    outcome: (s) => {
      if (s.board.some(c => c.rank === 'A')) return 'yes'
      if (s.board.length >= 5) return 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  king_on_board: {
    type: 'king_on_board',
    shortLabel: 'King on board',
    question: 'Will a king land on the board?',
    detail: 'At least one king appears in the 5 community cards.',
    streetWindow: 'preflop-turn',
    spawn: (s) => s.phase === 'preflop' || (s.phase === 'flop' && s.board.length === 3) || s.phase === 'turn',
    fairYes: (s) => clampProb(pRankAppearsOnBoard(s.board, 'K')),
    outcome: (s) => {
      if (s.board.some(c => c.rank === 'K')) return 'yes'
      if (s.board.length >= 5) return 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  board_pairs_by_river: {
    type: 'board_pairs_by_river',
    shortLabel: 'Board pairs',
    question: 'Will the board pair by the river?',
    detail: 'Any rank appears 2+ times across all 5 community cards.',
    streetWindow: 'preflop-turn',
    spawn: (s) => s.phase === 'preflop' || s.phase === 'flop' || s.phase === 'turn',
    fairYes: (s) => clampProb(pBoardPairsByRiver(s.board)),
    outcome: (s) => {
      if (hasBoardPair(s.board)) return 'yes'
      if (s.board.length >= 5) return 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  flush_on_board: {
    type: 'flush_on_board',
    shortLabel: 'Flush draw on board',
    question: 'Will the board show 3+ of one suit?',
    detail: 'A flush is possible from the community cards alone.',
    streetWindow: 'preflop-turn',
    spawn: (s) => s.phase === 'preflop' || s.phase === 'flop' || s.phase === 'turn',
    fairYes: (s) => clampProb(pFlushOnBoardByRiver(s.board)),
    outcome: (s) => {
      if (maxSuitCount(s.board) >= 3) return 'yes'
      if (s.board.length >= 5) return 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  board_trips_by_river: {
    type: 'board_trips_by_river',
    shortLabel: 'Trips on board',
    question: 'Will the board show 3 of a kind?',
    detail: 'Any rank appears 3+ times across the 5 community cards.',
    streetWindow: 'preflop-turn',
    spawn: (s) => s.phase === 'preflop' || s.phase === 'flop',
    fairYes: (s) => clampProb(pBoardTripsByRiver(s.board)),
    outcome: (s) => {
      if (maxRankCount(s.board) >= 3) return 'yes'
      if (s.board.length >= 5) return 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  // Short-window streetly props. Quick adrenaline: resolves on the *next*
  // card. Spawned right after the previous street's cards land.
  turn_red: {
    type: 'turn_red',
    shortLabel: 'Red turn',
    question: 'Will the turn be a red card?',
    detail: 'The fourth community card is a heart or diamond.',
    streetWindow: 'flop',
    spawn: (s) => s.phase === 'flop' && s.board.length === 3,
    fairYes: (s) => {
      if (s.board.length >= 4) return RED.has(s.board[3].suit) ? 0.99 : 0.02
      return clampProb(pNextCardRed(s.board))
    },
    outcome: (s) => {
      if (s.board.length >= 4) return RED.has(s.board[3].suit) ? 'yes' : 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  river_red: {
    type: 'river_red',
    shortLabel: 'Red river',
    question: 'Will the river be a red card?',
    detail: 'The fifth community card is a heart or diamond.',
    streetWindow: 'turn',
    spawn: (s) => s.phase === 'turn' && s.board.length === 4,
    fairYes: (s) => {
      if (s.board.length >= 5) return RED.has(s.board[4].suit) ? 0.99 : 0.02
      return clampProb(pNextCardRed(s.board))
    },
    outcome: (s) => {
      if (s.board.length >= 5) return RED.has(s.board[4].suit) ? 'yes' : 'no'
      if (s.handEnded) return 'void'
      return null
    },
  },

  // ─── Action props ───────────────────────────────────────────────────────
  // These don't depend on cards we haven't dealt; they read the betting
  // action. Always resolve definitively at hand end (never void).

  anyone_all_in: {
    type: 'anyone_all_in',
    shortLabel: 'All-in this hand',
    question: 'Will anyone go all-in this hand?',
    detail: 'Any player commits their full stack at any point.',
    streetWindow: 'full',
    spawn: (s) => s.phase === 'preflop',
    fairYes: (s) => {
      if (s.anyAllIn) return 0.99
      // Baseline conditional on # players + how many streets remain +
      // aggression so far. Each raise nudges the price up, since action heat
      // correlates with shove risk.
      const phaseWeight = { preflop: 1, flop: 0.85, turn: 0.6, river: 0.4 }
      const base = 0.10 + 0.04 * Math.max(0, s.seatCount - 2)
      const streetMult = phaseWeight[s.phase] ?? 0.3
      const agro = Math.min(0.5, s.aggressionThisHand * 0.10)
      return clampProb(base * streetMult + agro)
    },
    outcome: (s) => {
      if (s.anyAllIn) return 'yes'
      if (s.handEnded) return 'no'
      return null
    },
  },

  // Note: `goes_to_showdown` was removed — the local player can guarantee a
  // YES by simply not folding, which makes it self-rigging and exploitable.
}

// Pre-flop "flop pair" wants the prob conditioned on just the next 3 cards,
// not the full 5-card runout. We reuse the closed form by passing a virtual
// "5-card target board" of size 3.
function pBoardPairsByRiverFromFlopWindow(board) {
  // Fresh deck preflop: P(flop has any pair) = 1 - C(13,3) * 4^3 / C(52,3)
  //                                          = 1 - 18304/22100 ≈ 0.1718.
  if (board.length === 0) {
    return 0.1718
  }
  return pBoardPairsByRiver(board)
}

export const PROP_TYPES = Object.keys(PROP_CATALOG)

// Hand-start pool — preflop-eligible props the engine picks from on a fresh
// hand. Short-window types (turn_red, river_red) are NOT here: their spawn
// condition gates them by phase, so they're only eligible as top-up
// replacements after the flop/turn lands. That way the rotation stays
// interesting through the runout instead of front-loading at preflop.
export const PROPS_AT_HAND_START = PROP_TYPES.filter(t =>
  PROP_CATALOG[t].streetWindow === 'preflop' ||
  PROP_CATALOG[t].streetWindow === 'preflop-turn' ||
  PROP_CATALOG[t].streetWindow === 'full'
)

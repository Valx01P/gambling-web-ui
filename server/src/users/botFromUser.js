// Player-clone bot generator. Reads a user's rolling stats + last 100 hands
// and produces a personalized JS bot — same code-only sandbox the rest of
// the app uses, but with thresholds + sizings tuned to mimic *this* user.
//
// Design goals:
//   * No two players generate the same bot. Every threshold is data-derived.
//   * Generated code is short + readable so the user can edit it after.
//   * ELO seed reflects observed performance — a winning player's clone
//     starts above 500, a losing one starts below.
//   * Pure functions; no DB access here. The route layer fetches stats +
//     history and feeds them in.

import { STARTING_RATING, RATING_FLOOR } from '../bots/runtime/eloEngine.js'
import { renderCloneBotCode } from './cloneBotTemplate.js'

// Five clone tiers, ordered by sample size. The Nth tier is built from the
// user's last `hands` recorded play snapshots. tierIndex (1-based) is the
// public identifier used by the routes / unique constraint on the bots
// table; clientLabel is used in toast/UI copy.
export const CLONE_TIERS = [
  { tier: 1, hands: 12,  label: 'v1 · first read'   },
  { tier: 2, hands: 25,  label: 'v2 · early sample' },
  { tier: 3, hands: 50,  label: 'v3 · half stack'   },
  { tier: 4, hands: 75,  label: 'v4 · solid sample' },
  { tier: 5, hands: 100, label: 'v5 · full window'  }
]

export function findCloneTier(tierId) {
  return CLONE_TIERS.find(t => t.tier === tierId) || null
}

// Slice helpers — the route layer passes the user's whole 100-hand window
// in; we trim to what each tier should see so the generator's `seedHands`
// reflects the right sample.
export function recentHandsForTier(allHands, tier) {
  const t = findCloneTier(tier)
  if (!t) return allHands || []
  return (allHands || []).slice(0, t.hands)
}

// Mirror of client/lib/botColors. Kept inline so this module has no external
// dependency on the client tree — the server runs on its own.
const BOT_COLOR_PRESETS = [
  { name: 'red',     hex: '#ef4444' },
  { name: 'orange',  hex: '#f97316' },
  { name: 'amber',   hex: '#f59e0b' },
  { name: 'yellow',  hex: '#eab308' },
  { name: 'lime',    hex: '#84cc16' },
  { name: 'green',   hex: '#22c55e' },
  { name: 'emerald', hex: '#10b981' },
  { name: 'teal',    hex: '#14b8a6' },
  { name: 'cyan',    hex: '#06b6d4' },
  { name: 'sky',     hex: '#0ea5e9' },
  { name: 'blue',    hex: '#3b82f6' },
  { name: 'indigo',  hex: '#6366f1' },
  { name: 'violet',  hex: '#8b5cf6' },
  { name: 'purple',  hex: '#a855f7' },
  { name: 'fuchsia', hex: '#d946ef' },
  { name: 'pink',    hex: '#ec4899' },
  { name: 'rose',    hex: '#f43f5e' },
  { name: 'slate',   hex: '#64748b' }
]

// Map a rate signal to a discrete style label that drives the bot template.
function classifyVpip(vpipRate) {
  if (vpipRate < 0.15) return 'rock'
  if (vpipRate < 0.22) return 'tight'
  if (vpipRate < 0.32) return 'balanced'
  if (vpipRate < 0.45) return 'loose'
  return 'maniac'
}

function classifyAggression(aggrFreq) {
  if (aggrFreq < 0.10) return 'passive'
  if (aggrFreq < 0.20) return 'measured'
  if (aggrFreq < 0.35) return 'aggressive'
  return 'hyper'
}

// Derive numeric knobs the generated code uses. All of these come from the
// user's own play data — never a hardcoded "good poker player" template.
//
// Returns an object the template renders inline. Each field is well-named so
// a curious player can read the code and understand how their stats shaped it.
export function deriveProfile(stats) {
  const seated = Math.max(1, stats?.handsSeated ?? 0)
  const voluntary = Math.max(0, stats?.handsVoluntary ?? 0)
  const showdowns = Math.max(0, stats?.showdownsSeen ?? 0)
  const showdownsWon = Math.max(0, stats?.showdownsWon ?? 0)
  const aggrActions = (stats?.preflopOpens ?? 0)
                    + (stats?.preflopThreeBets ?? 0)
                    + (stats?.postflopBets ?? 0)
                    + (stats?.postflopRaises ?? 0)
  const passiveActions = (stats?.preflopCalls ?? 0) + (stats?.postflopCalls ?? 0)
  const cBetAttempts = stats?.cBetsAttempted ?? 0
  const cBetWins = stats?.cBetsWon ?? 0
  const bluffWins = stats?.bluffWins ?? 0
  const opens = stats?.preflopOpens ?? 0
  const totalOpenSize = Number(stats?.totalOpenSizeBB ?? 0)

  // Frequency signals (0-1)
  const vpipRate = voluntary / seated
  const pfrRate = opens / seated
  const aggrFreq = aggrActions / seated
  // Aggression Factor (raises+bets / calls). Floor calls at 1 to avoid /0.
  const aggrFactor = aggrActions / Math.max(1, passiveActions)
  const wtsdRate = voluntary > 0 ? showdowns / voluntary : 0
  const wsdRate = showdowns > 0 ? showdownsWon / showdowns : 0
  const cBetFreq = opens > 0 ? Math.min(1, cBetAttempts / opens) : 0.5
  const cBetSuccessRate = cBetAttempts > 0 ? cBetWins / cBetAttempts : 0
  const bluffRate = voluntary > 0 ? bluffWins / voluntary : 0
  const avgOpenSizeBB = opens > 0 ? Math.max(2, Math.min(6, totalOpenSize / opens)) : 3

  // Style classification → template selection
  const vpipStyle = classifyVpip(vpipRate)
  const aggStyle = classifyAggression(aggrFreq)

  // Equity thresholds — looser players continue with weaker holdings.
  // Anchor around a balanced 0.42 call / 0.58 value, then nudge per style.
  // Numbers are conservative on the call side: at the live table, our equity
  // estimate already accounts for opponents' inferred ranges, so we don't
  // need to add another margin on top.
  let callThreshold = 0.42
  let valueThreshold = 0.58
  if (vpipStyle === 'rock')     { callThreshold = 0.55; valueThreshold = 0.65 }
  if (vpipStyle === 'tight')    { callThreshold = 0.48; valueThreshold = 0.62 }
  if (vpipStyle === 'loose')    { callThreshold = 0.36; valueThreshold = 0.54 }
  if (vpipStyle === 'maniac')   { callThreshold = 0.30; valueThreshold = 0.48 }

  // Aggression-style modifies sizing tendencies and bluff frequency.
  let openSize = Math.round(avgOpenSizeBB * 10) / 10
  let postBetSize = 0.66
  // Bluff frequency: derived from observed bluff rate, but floored so the
  // bot ever bluffs at all. Even a "passive" version still mixes a few in.
  let bluffFreq = Math.max(0.04, Math.min(0.30, bluffRate * 2.0))
  if (aggStyle === 'passive')   { postBetSize = 0.50; bluffFreq = Math.max(0.04, Math.min(bluffFreq, 0.10)) }
  if (aggStyle === 'measured')  { postBetSize = 0.60 }
  if (aggStyle === 'aggressive'){ postBetSize = 0.75 }
  if (aggStyle === 'hyper')     { postBetSize = 0.90; bluffFreq = Math.max(0.20, bluffFreq) }

  // --- Floors --------------------------------------------------------------
  // The user's true play frequencies aren't 0% even if 12 hands of recorded
  // stats look thin. The pre-floor numbers are still exposed (under
  // vpipRate/pfrRate/cBetFreq) for read-out / display; the *play* knobs the
  // generated bot reads are floored so it never folds every hand.
  const vpipPlayCutoff = clamp01(Math.max(vpipRate, 0.22))   // play at least top ~22%
  const pfrCutoff      = clamp01(Math.max(pfrRate, 0.12))    // open at least top ~12%
  const cBetFreqFloor  = Math.max(0.45, Math.min(0.85, cBetFreq))
  const openSizeBB     = clamp(openSize, 2.2, 5)             // never under 2.2bb opens

  return {
    seated,
    vpipRate, pfrRate, aggrFreq, aggrFactor,
    wtsdRate, wsdRate,
    cBetFreq, cBetSuccessRate,
    bluffRate, bluffFreq,
    avgOpenSizeBB, openSize: openSizeBB,
    callThreshold, valueThreshold,
    postBetSize,
    vpipStyle, aggStyle,
    // Knobs the generated code actually consumes (post-floor).
    vpipPlayCutoff, pfrCutoff,
    cBetFreq: cBetFreqFloor
  }
}

function clamp01(n) { return Math.max(0, Math.min(1, n)) }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

// Map the user's avg performance score to a starting ELO on the 300-2000
// scale. Linear interpolation: 0.40 avg → 350, 0.50 → 500, 0.65 → 800,
// 0.80 → 1300, 0.90 → 1700, 0.95+ → 2000.
export function deriveStartingElo(stats) {
  const n = stats?.performanceCount ?? 0
  if (n < 4) return STARTING_RATING  // not enough data — start at baseline
  const avg = (stats?.performanceSum ?? 0) / n
  const rating = Math.round(500 + (avg - 0.5) * 3000)
  return Math.max(RATING_FLOOR, Math.min(2000, rating))
}

// Pick a deterministic-but-distinctive color from BOT_COLOR_PRESETS based
// on the user id. Same user → same color; different users get spread.
function pickColor(userId) {
  if (!userId) return BOT_COLOR_PRESETS[0]
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  }
  return BOT_COLOR_PRESETS[Math.abs(hash) % BOT_COLOR_PRESETS.length]
}

// Render the personalized bot code. Reads ctx.equity (range-aware),
// ctx.handStrengthScore (0-1), ctx.position, ctx.facingBet, etc. The actual
// decision tree lives in cloneBotTemplate.js so this generator stays small.
export function renderBotCode(profile, displayName) {
  return renderCloneBotCode(profile, displayName)
}

// First word of the user's display name, capped to a sensible length so
// "Pablo Valdes" → "Pablo" but "VeryLongFirstNameSomeone" → "VeryLongFirst".
// Falls back to "Player" when the user hasn't set a name.
function firstName(displayName) {
  const raw = (displayName || 'Player').trim()
  const first = raw.split(/\s+/)[0] || 'Player'
  return first.slice(0, 14)
}

// Top-level: produce the createBot payload from user + their play data.
//
// Pass `tier` to build a clone for a specific tier (1-5). When omitted the
// bot is built as a generic clone using whatever hands you provide — the
// auto-tier flow always passes a tier; the legacy `/from-me` endpoint can
// default to tier 1 (12 hands) for back-compat.
export function buildBotFromUser({ user, stats, recentHands, tier = null }) {
  const profile = deriveProfile(stats || {})
  const elo = deriveStartingElo(stats || {})
  const color = pickColor(user.id).hex
  const fname = firstName(user.displayName)
  const code = renderBotCode(profile, fname)
  const tierMeta = tier ? findCloneTier(tier) : null
  // Naming: "Pablo v3" — short, clear, and stable across recalculations
  // since the tier identifier is part of the name.
  const name = tierMeta
    ? `${fname} v${tier}`.slice(0, 32)
    : `${fname} clone`.slice(0, 32)

  return {
    name,
    color,
    textColor: 'auto',
    code,
    codeEnabled: true,
    // Clones default private — they're personal and tied to the user's data.
    // Non-clone "from-me" creations still ship public for parity with the
    // generic bot create path.
    isPublic: tierMeta ? false : true,
    isClone: Boolean(tierMeta),
    cloneTier: tierMeta?.tier ?? null,
    cloneHandsUsed: tierMeta?.hands ?? null,
    elo,
    profile,
    seedHandsAnalyzed: recentHands?.length ?? 0
  }
}

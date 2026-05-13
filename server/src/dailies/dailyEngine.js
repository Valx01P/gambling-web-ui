// Daily engine. Hooked once per completed hand for each Player at the
// table (seated OR spectator). Builds a per-user `event` from the
// PokerGame's hand summary + the user's role in it, runs that day's
// daily-check predicate, and bumps progress on the Player instance.
//
// Persistence:
//   • Signed-in user (userId set)  → DB write via dailyRepo on completion.
//   • Anonymous                    → in-session only (Player object).
//
// Reward on completion: +1000 chips to the player's bankroll, regardless
// of signed-in status. Lifetime `dailiesCompleted` only increments for
// signed-in users (it gates the skin unlock tiers).

import { query } from '../db/pool.js'
import { getTodayDaily, todayDateKey } from './dailyPicker.js'
import { evaluateAchievements } from '../achievements/engine.js'

const DAILY_REWARD_CHIPS = 1000

// ─── Event extraction ─────────────────────────────────────────────────

// `summary` is the recorded-hand object produced by PokerGame.recordCompletedHand.
// `player` is the Player instance (seated or spectator) we're scoring for.
// `extra` carries side-bet outcomes from the engine path (separate from
// the hand summary because the hand history doesn't track prop bets).
export function buildEventForPlayer(summary, player, extra = {}) {
  const userId = player.id
  const cards  = summary.cards?.[userId] || null
  const winner = summary.winners?.find(w => w.playerId === userId) || null
  const won    = !!winner
  const split  = won && summary.winners.length > 1
  const folded = summary.foldedAtSummary?.has?.(userId)
                 || !cards  // no cards revealed at showdown → typically folded
  const chipsDelta = summary.profitsByPlayer?.[userId] ?? 0

  // Action stats — derive from actionsByPlayer to keep this independent
  // of any per-Player counters the engine itself may already track.
  const acts = summary.actionsByPlayer?.[userId] || []
  let raisesThisHand = 0, wentAllIn = false, vpip = false, foldedPreflop = false, foldedToRaise = false
  for (const a of acts) {
    if (a.action === 'raise' || a.action === 'all_in') raisesThisHand += 1
    if (a.action === 'all_in') wentAllIn = true
    if (a.phase === 'preflop' && (a.action === 'call' || a.action === 'raise' || a.action === 'all_in')) vpip = true
    if (a.phase === 'preflop' && a.action === 'fold') foldedPreflop = true
    if (a.action === 'fold' && (a.toCallBefore || 0) > 0) foldedToRaise = true
  }

  return {
    userId,
    won, lost: !won && !split && acts.length > 0, split,
    handName: summary.playerHandNames?.[userId] || null,
    cards,
    communityCards: summary.communityCards || [],
    foldedPreflop, foldedToRaise, wentToShowdown: !folded && !!cards, wentAllIn,
    vpip,
    raisesThisHand,
    chipsDelta,
    potSize: summary.pot || 0,
    sideBetOutcomes: extra.sideBetOutcomes || [],  // ['win'|'loss'|'void', ...]
    sideBetLongshotWins: extra.sideBetLongshotWins || 0,
  }
}

// ─── Daily progress ───────────────────────────────────────────────────

export async function applyDailyToPlayer(player, event) {
  if (!player || !event) return
  if (player.isBot) return

  const today = todayDateKey()
  const daily = getTodayDaily()
  if (!daily) return

  // Reset progress when the date rolls over. The "completed for today" flag
  // also resets because it was tied to yesterday's challenge.
  if (player.dailyDateKey !== today) {
    player.dailyDateKey = today
    player.dailyProgress = 0
    player.dailyCompleted = false
    // Each daily gets a private scratch slot for stateful checks (streaks,
    // "comeback hand"). Reset here so streaks don't carry across days.
    player._dailyScratch = {}
  }

  // Already completed today? Don't double-credit.
  if (player.dailyCompleted) return

  let delta = 0
  try { delta = daily.check(event, player._dailyScratch || (player._dailyScratch = {})) || 0 }
  catch (err) { console.warn('[daily] check threw for', daily.id, err.message); return }
  if (!Number.isFinite(delta) || delta <= 0) return

  player.dailyProgress = Math.min(daily.target, (player.dailyProgress || 0) + delta)
  const justCompleted = player.dailyProgress >= daily.target

  if (justCompleted) {
    player.dailyCompleted = true
    player.dailyCompletedAt = Date.now()
    player.chips += DAILY_REWARD_CHIPS  // reward fires for everyone (signed-in or not)
    if (player.userId) {
      player.dailiesCompleted = (player.dailiesCompleted || 0) + 1
    }
  }

  // Persist for signed-in users only. Anonymous progress dies with the
  // session — same rule as the existing ELO / hands-played counters.
  if (player.userId) {
    persistDailyProgress(player, today, justCompleted).catch(err =>
      console.warn('[daily] persist failed:', err.message)
    )
  }
}

async function persistDailyProgress(player, dateKey, justCompleted) {
  await query(
    `UPDATE users
        SET daily_date_key       = $2,
            daily_progress       = $3,
            daily_completed_at   = ${justCompleted ? 'NOW()' : 'daily_completed_at'},
            dailies_completed    = dailies_completed + $4
      WHERE id = $1`,
    [player.userId, dateKey, player.dailyProgress, justCompleted ? 1 : 0]
  )
  if (justCompleted) {
    // Per-day completion log — the users row is overwritten each day so
    // historical completions live here. Idempotent via (user_id, day) PK.
    await query(
      `INSERT INTO user_daily_completions (user_id, day, daily_id)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (user_id, day) DO NOTHING`,
      [player.userId, dateKey, player.dailyId || null]
    )
  }
}

// ─── Public hook ──────────────────────────────────────────────────────

// Apply both daily AND achievement engines for one player's hand result.
// Single export so PokerRoom's broadcast intercept doesn't have to know
// about each engine individually.
export async function scoreHandForPlayer(player, summary, extra) {
  const event = buildEventForPlayer(summary, player, extra)
  await applyDailyToPlayer(player, event)
  evaluateAchievements(player, event)
}

// ─── DB hydrate at auth ────────────────────────────────────────────────

// Called from AUTH_HELLO when we look up the user. Mirrors the DB row's
// daily state into the in-memory Player so the engine can mutate it
// without an extra round-trip per hand.
export function hydrateDailyFromRow(player, row) {
  if (!player || !row) return
  const today = todayDateKey()
  const sameDay = row.daily_date_key === today
  player.dailyDateKey   = sameDay ? today : null
  player.dailyProgress  = sameDay ? (row.daily_progress || 0) : 0
  player.dailyCompleted = sameDay
    && row.daily_completed_at
    && new Date(row.daily_completed_at).toISOString().slice(0, 10) === today
  player.dailiesCompleted = row.dailies_completed || 0
  player.achievements   = Array.isArray(row.achievements) ? row.achievements : []
  player.skinId         = row.skin_id || 0
  player.customSkin     = row.custom_skin || null
}

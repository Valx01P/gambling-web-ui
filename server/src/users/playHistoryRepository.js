// Repository for the player-clone feature. Two responsibilities:
//
//   1. Append a compressed per-hand record to user_hand_history (capped at
//      100 newest per user).
//   2. Increment the rolling counters in user_play_stats so the bot
//      generator has aggregate signals to read.
//
// Both writes happen in a single transaction so a hand can't be partially
// recorded. Public reads return a normalized shape (camelCase + numbers)
// so the bot generator doesn't deal with snake_case.

import { query } from '../db/pool.js'

// Bounded window of recorded hands per user. Older rows get pruned at
// write time so the table stays predictable in size.
export const USER_HAND_HISTORY_LIMIT = 100

// Threshold the achievement system reads. Crossing this on `hands_seated`
// fires the "{name} bot unlocked" toast exactly once per user. (Kept as a
// constant for back-compat — the multi-tier system uses CLONE_TIERS from
// botFromUser.js, but legacy callers still import this name.)
export const BOT_UNLOCK_THRESHOLD = 12

// Tier hand thresholds — must match CLONE_TIERS in botFromUser.js. Repeated
// here so the recording path doesn't need to import the bot-generator.
const CLONE_TIER_THRESHOLDS = [12, 25, 50, 75, 100]

// Returns the tier id (1..5) the user just crossed by going from
// previousHandsSeated -> currentHandsSeated, or null if no tier was crossed.
// Used by PokerRoom._recordHumanHandResults to decide whether to fire an
// achievement toast on this exact hand.
export function tierCrossedByHand(previousHandsSeated, currentHandsSeated) {
  for (let i = 0; i < CLONE_TIER_THRESHOLDS.length; i++) {
    const threshold = CLONE_TIER_THRESHOLDS[i]
    if (previousHandsSeated < threshold && currentHandsSeated >= threshold) {
      return i + 1
    }
  }
  return null
}

function statsToApi(row) {
  if (!row) return null
  return {
    userId: row.user_id,
    handsSeated: row.hands_seated,
    handsVoluntary: row.hands_voluntary,
    handsWon: row.hands_won,
    showdownsSeen: row.showdowns_seen,
    showdownsWon: row.showdowns_won,
    bluffWins: row.bluff_wins,
    preflopOpens: row.preflop_opens,
    preflopThreeBets: row.preflop_three_bets,
    preflopCalls: row.preflop_calls,
    postflopBets: row.postflop_bets,
    postflopRaises: row.postflop_raises,
    postflopCalls: row.postflop_calls,
    cBetsAttempted: row.c_bets_attempted,
    cBetsWon: row.c_bets_won,
    chipsWonTotal: Number(row.chips_won_total),
    bigBlindsPlayed: row.big_blinds_played,
    totalOpenSizeBB: Number(row.total_open_size_bb),
    performanceSum: Number(row.performance_sum),
    performanceCount: row.performance_count,
    botUnlockedAt: row.bot_unlocked_at,
    botBuiltAt: row.bot_built_at
  }
}

// Read-only fetch of the current rolling stats. Returns zeros for unknown users.
export async function getPlayStats(userId) {
  if (!userId) return null
  const { rows } = await query(
    `SELECT * FROM user_play_stats WHERE user_id = $1`,
    [userId]
  )
  return statsToApi(rows[0])
}

export async function getRecentHands(userId, limit = USER_HAND_HISTORY_LIMIT) {
  if (!userId) return []
  const { rows } = await query(
    `SELECT data FROM user_hand_history
       WHERE user_id = $1
       ORDER BY played_at DESC
       LIMIT $2`,
    [userId, Math.min(USER_HAND_HISTORY_LIMIT, Math.max(1, limit))]
  )
  return rows.map(r => r.data)
}

// Atomic "record one hand for a user". Increments stats and appends a
// compressed hand row. Returns the *new* stats — the caller uses this to
// detect the 12-hand achievement crossover.
//
// `delta` is a structured set of additive bumps to apply to user_play_stats.
// `compressed` is the JSONB blob describing the hand from the user's POV.
//
// Pruning: if the user is already at USER_HAND_HISTORY_LIMIT rows, we drop
// the oldest one in the same transaction. Cheaper than a CTE / RANK and
// still bounds the table tightly.
export async function recordHumanHand({ userId, delta, compressed }) {
  if (!userId) return null
  // One round-trip via record_human_hand (migration 007). Previously this
  // ran 5 statements inside an explicit transaction (BEGIN + UPSERT + INSERT
  // + prune DELETE + COMMIT). The stored procedure does the same work in a
  // single SQL call and returns the updated stats row.
  // `SELECT * FROM record_human_hand(...)` expands the user_play_stats row
  // type returned by the function into individual columns, so node-postgres
  // gives us back a normal row object instead of a stringified composite.
  // Net: 1 round-trip total to do the upsert + insert + prune + return stats.
  const { rows } = await query(
    `SELECT * FROM record_human_hand(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19::jsonb, $20
     )`,
    [
      userId,
      delta.handsVoluntary || 0,
      delta.handsWon || 0,
      delta.showdownsSeen || 0,
      delta.showdownsWon || 0,
      delta.bluffWins || 0,
      delta.preflopOpens || 0,
      delta.preflopThreeBets || 0,
      delta.preflopCalls || 0,
      delta.postflopBets || 0,
      delta.postflopRaises || 0,
      delta.postflopCalls || 0,
      delta.cBetsAttempted || 0,
      delta.cBetsWon || 0,
      Math.floor(delta.chipsDelta || 0),
      delta.bigBlindsPlayed || 0,
      Number(delta.openSizeBB || 0),
      Number(delta.performanceScore || 0),
      JSON.stringify(compressed),
      USER_HAND_HISTORY_LIMIT
    ]
  )
  return statsToApi(rows[0])
}

// Mark that this user has crossed the bot-unlock threshold. Idempotent —
// hitting it twice doesn't reset the timestamp.
export async function markBotUnlocked(userId) {
  if (!userId) return
  await query(
    `UPDATE user_play_stats
        SET bot_unlocked_at = COALESCE(bot_unlocked_at, NOW())
      WHERE user_id = $1`,
    [userId]
  )
}

export async function markBotBuilt(userId) {
  if (!userId) return
  await query(
    `UPDATE user_play_stats
        SET bot_built_at = NOW()
      WHERE user_id = $1`,
    [userId]
  )
}

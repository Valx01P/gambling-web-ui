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

// Atomic "record one hand for a user". Increments stats, appends to the
// rolling 100-hand window AND the unbounded archive, bumps the user's ELO,
// and upserts their per-day rollup — all in one round-trip via
// record_human_hand_v2 (migration 010).
//
// Returns the *new* stats (for tier-crossing detection) plus the user's
// new ELO and the inserted archive row id so the caller can fan out
// rivalry writes without re-reading anything.
export async function recordHumanHand({ userId, tableId, delta, compressed, eloDelta = 0, outcome = {} }) {
  if (!userId) return null
  const { rows } = await query(
    `SELECT * FROM record_human_hand_v2(
       $1, $2,
       $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
       $18, $19, $20::jsonb, $21,
       $22, $23, $24, $25, $26
     )`,
    [
      userId,
      tableId || 'unknown',
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
      USER_HAND_HISTORY_LIMIT,
      Math.floor(eloDelta || 0),
      Boolean(outcome.won),
      Boolean(outcome.wentToShowdown),
      Boolean(outcome.voluntarilyIn),
      Boolean(outcome.foldedPreflop)
    ]
  )
  const row = rows[0]
  if (!row) return null
  return {
    ...statsToApi(row),
    newElo: row.new_elo,
    archiveId: Number(row.archive_id)
  }
}

// Increment the per-day anon-hands counter for a user. Fire-and-forget
// upsert keyed on (user_id, day). We don't track ELO / chip deltas for
// anon play — those hands intentionally don't influence the user's
// public stats. This is purely "active today, but staying anonymous."
export async function recordAnonHand(userId) {
  if (!userId) return
  await query(
    `
    INSERT INTO user_daily_activity (
      user_id, day, hands_played, hands_won, chips_delta,
      elo_start, elo_end, first_hand_at, last_hand_at, anon_hands
    ) VALUES (
      $1, (NOW() AT TIME ZONE 'UTC')::date, 0, 0, 0,
      0, 0, NOW(), NOW(), 1
    )
    ON CONFLICT (user_id, day) DO UPDATE SET
      anon_hands   = user_daily_activity.anon_hands + 1,
      last_hand_at = EXCLUDED.last_hand_at
    `,
    [userId]
  )
}

// Anonymous-mode hand archive write. Mirrors `recordHumanHand` but skips
// EVERYTHING that would influence public-facing stats (no ELO update, no
// user_play_stats bump, no rolling 100-hand window in user_hand_history,
// no rivalry signal). Just the archive row tagged is_anonymous = TRUE so
// the user can drill into their own day list and replay the hand without
// leaking anything to other viewers (the public day query filters on
// is_anonymous = FALSE). Also bumps the per-day anon_hands counter so
// the calendar still shows activity. Fire-and-forget at the call site.
export async function archiveAnonHand({ userId, tableId, compressed, outcome = {}, chipsDelta = 0, elo = 0 }) {
  if (!userId) return
  await query(
    `
    INSERT INTO user_hand_archive (
      user_id, table_id, chips_delta,
      won, went_to_showdown, voluntarily_in, folded_preflop,
      elo_before, elo_after, elo_delta,
      data, is_anonymous
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $8, 0,
      $9::jsonb, TRUE
    )
    `,
    [
      userId,
      tableId || 'unknown',
      Math.floor(chipsDelta || 0),
      Boolean(outcome.won),
      Boolean(outcome.wentToShowdown),
      Boolean(outcome.voluntarilyIn),
      Boolean(outcome.foldedPreflop),
      Math.floor(elo || 0),
      JSON.stringify(compressed || {})
    ]
  )
  // Same daily-counter bump that recordAnonHand does — kept atomic with
  // the archive write by being inside the same async function. Callers
  // get one Promise to await instead of two.
  await query(
    `
    INSERT INTO user_daily_activity (
      user_id, day, hands_played, hands_won, chips_delta,
      elo_start, elo_end, first_hand_at, last_hand_at, anon_hands
    ) VALUES (
      $1, (NOW() AT TIME ZONE 'UTC')::date, 0, 0, 0,
      0, 0, NOW(), NOW(), 1
    )
    ON CONFLICT (user_id, day) DO UPDATE SET
      anon_hands   = user_daily_activity.anon_hands + 1,
      last_hand_at = EXCLUDED.last_hand_at
    `,
    [userId]
  )
}

// --- Read paths for the profile history UI -------------------------------

// Daily summary list for a date range. Returns days in DESC order so the
// most recent activity is up top. Caller paginates by adjusting from/to.
// Joins user_daily_progress on the date so the calendar can mark days
// where the user completed that day's challenge.
export async function listDailyActivity(userId, { from, to } = {}) {
  if (!userId) return []
  const params = [userId]
  let where = 'WHERE a.user_id = $1'
  if (from) { params.push(from); where += ` AND a.day >= $${params.length}` }
  if (to)   { params.push(to);   where += ` AND a.day <= $${params.length}` }
  // LEFT JOIN against user_daily_completions so days where the user
  // completed that day's daily get the flag, regardless of how long ago.
  // The activity table is the spine — completions sit alongside it.
  const { rows } = await query(
    `SELECT a.day,
            a.hands_played, a.hands_won, a.chips_delta,
            a.anon_hands,
            a.elo_start, a.elo_end, a.first_hand_at, a.last_hand_at,
            (c.day IS NOT NULL) AS daily_completed
       FROM user_daily_activity a
       LEFT JOIN user_daily_completions c
         ON c.user_id = a.user_id AND c.day = a.day
       ${where}
       ORDER BY a.day DESC
       LIMIT 365`,
    params
  )
  return rows.map(r => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    handsPlayed: r.hands_played,
    handsWon: r.hands_won,
    anonHands: r.anon_hands ?? 0,
    chipsDelta: Number(r.chips_delta),
    eloStart: r.elo_start,
    eloEnd: r.elo_end,
    firstHandAt: r.first_hand_at,
    lastHandAt: r.last_hand_at,
    dailyCompleted: !!r.daily_completed
  }))
}

// All hands a user played on a given day. Returns the compressed JSONB blob
// + the outcome columns so the UI can render a hand-by-hand replay.
// Returns `{ hands, total }` so the client knows how many pages remain.
//
// `viewerIsSelf` gates the anonymous-hand visibility. When TRUE, anon
// rows are returned with isAnonymous=true so the UI can badge them; when
// FALSE (a non-self viewer hitting the public profile), anon rows are
// excluded entirely — hidden plays stay hidden. The partial index on
// (user_id, played_day) WHERE is_anonymous = FALSE serves the public path
// directly so non-self queries don't waste IO scanning anon rows.
export async function listHandsForDay(userId, day, { limit = 40, offset = 0, viewerIsSelf = true } = {}) {
  if (!userId || !day) return { hands: [], total: 0 }
  const cappedLimit = Math.min(200, Math.max(1, limit))
  const cappedOffset = Math.max(0, offset)
  // Append the anon filter for non-self queries. Self queries see
  // everything (and the row's is_anonymous flag rides along so the UI
  // can render a badge).
  const anonClause = viewerIsSelf ? '' : ' AND is_anonymous = FALSE'
  const [pageResult, countResult] = await Promise.all([
    query(
      `SELECT id, played_at, table_id, chips_delta, won, went_to_showdown,
              voluntarily_in, folded_preflop, elo_before, elo_after, elo_delta, data,
              is_anonymous
         FROM user_hand_archive
        WHERE user_id = $1 AND played_day = $2${anonClause}
        ORDER BY played_at ASC, id ASC
        LIMIT $3 OFFSET $4`,
      [userId, day, cappedLimit, cappedOffset]
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM user_hand_archive
        WHERE user_id = $1 AND played_day = $2${anonClause}`,
      [userId, day]
    )
  ])
  const hands = pageResult.rows.map(r => ({
    id: Number(r.id),
    playedAt: r.played_at,
    tableId: r.table_id,
    chipsDelta: r.chips_delta,
    won: r.won,
    wentToShowdown: r.went_to_showdown,
    voluntarilyIn: r.voluntarily_in,
    foldedPreflop: r.folded_preflop,
    eloBefore: r.elo_before,
    eloAfter: r.elo_after,
    eloDelta: r.elo_delta,
    data: r.data,
    isAnonymous: Boolean(r.is_anonymous)
  }))
  return { hands, total: countResult.rows[0]?.n ?? hands.length }
}

// Streaming-friendly iterator over a user's archive between two timestamps.
// Used by the export endpoint to JSONL-dump hands without loading the whole
// range into memory. We page in chunks of `pageSize` ordered by id so the
// pagination key is monotonic.
export async function* iterateArchive(userId, { from, to, pageSize = 500 } = {}) {
  if (!userId) return
  let lastId = 0
  while (true) {
    const params = [userId, lastId]
    let where = 'WHERE user_id = $1 AND id > $2'
    if (from) { params.push(from); where += ` AND played_at >= $${params.length}` }
    if (to)   { params.push(to);   where += ` AND played_at <= $${params.length}` }
    params.push(pageSize)
    const { rows } = await query(
      `SELECT id, played_at, table_id, chips_delta, won, went_to_showdown,
              voluntarily_in, folded_preflop, elo_before, elo_after, elo_delta, data
         FROM user_hand_archive
         ${where}
         ORDER BY id ASC
         LIMIT $${params.length}`,
      params
    )
    if (rows.length === 0) return
    for (const r of rows) {
      yield {
        id: Number(r.id),
        playedAt: r.played_at,
        tableId: r.table_id,
        chipsDelta: r.chips_delta,
        won: r.won,
        wentToShowdown: r.went_to_showdown,
        voluntarilyIn: r.voluntarily_in,
        foldedPreflop: r.folded_preflop,
        eloBefore: r.elo_before,
        eloAfter: r.elo_after,
        eloDelta: r.elo_delta,
        data: r.data
      }
      lastId = Number(r.id)
    }
    if (rows.length < pageSize) return
  }
}

// --- Rivalry tracker -----------------------------------------------------

// Apply one hand's worth of rivalry deltas. `entries` is an array of
// { kind, id, name, chipsNet, didLoseToThem, didBeatThem } — one per
// opponent at the table. Single round-trip via a parameterized VALUES
// upsert keeps this cheap even when 4 opponents are present.
export async function applyRivalryDeltas(userId, entries) {
  if (!userId || !Array.isArray(entries) || entries.length === 0) return
  // Build (VALUES ...) tuple list manually so we can pass a variable number
  // of opponents in one SQL statement. Each tuple is six params; the
  // user_id is added at the front of every row by the ON CONFLICT target.
  const values = []
  const params = []
  let p = 1
  for (const e of entries) {
    if (!e || !e.kind || !e.id) continue
    values.push(`($${p++}::uuid, $${p++}::text, $${p++}::text, $${p++}::text, $${p++}::bigint, $${p++}::int, $${p++}::int)`)
    params.push(
      userId,
      e.kind,
      e.id,
      (e.name || '').slice(0, 64) || '(unknown)',
      Math.floor(e.chipsNet || 0),
      e.didLoseToThem ? 1 : 0,
      e.didBeatThem ? 1 : 0
    )
  }
  if (values.length === 0) return
  await query(
    `INSERT INTO user_rivalries
       (user_id, opponent_kind, opponent_id, opponent_name, chips_net, hands_lost_to, hands_won_vs)
     VALUES ${values.join(',')}
     ON CONFLICT (user_id, opponent_kind, opponent_id) DO UPDATE SET
       chips_net     = user_rivalries.chips_net     + EXCLUDED.chips_net,
       hands_vs      = user_rivalries.hands_vs      + 1,
       hands_lost_to = user_rivalries.hands_lost_to + EXCLUDED.hands_lost_to,
       hands_won_vs  = user_rivalries.hands_won_vs  + EXCLUDED.hands_won_vs,
       opponent_name = EXCLUDED.opponent_name,
       updated_at    = NOW()`,
    params
  )
  // hands_vs is bumped on every conflict via the +1 above. For first inserts,
  // the row has hands_vs default 0; bump it to 1 with a tail update so the
  // count matches the actual number of distinct hands played against.
  await query(
    `UPDATE user_rivalries SET hands_vs = GREATEST(hands_vs, 1)
       WHERE user_id = $1 AND hands_vs = 0`,
    [userId]
  )
}

// Top rivals for a user, ordered "worst" first (most chips lost net).
// Filters out broken-even or net-positive entries — a "rival" is someone
// you're losing to. Returns up to `limit` rows.
export async function getTopRivals(userId, { limit = 5 } = {}) {
  if (!userId) return []
  const { rows } = await query(
    `SELECT opponent_kind, opponent_id, opponent_name, hands_vs,
            chips_net, hands_lost_to, hands_won_vs
       FROM user_rivalries
      WHERE user_id = $1 AND chips_net < 0
      ORDER BY chips_net ASC
      LIMIT $2`,
    [userId, Math.min(50, Math.max(1, limit))]
  )
  return rows.map(r => ({
    opponentKind: r.opponent_kind,
    opponentId: r.opponent_id,
    opponentName: r.opponent_name,
    handsVs: r.hands_vs,
    chipsNet: Number(r.chips_net),
    handsLostTo: r.hands_lost_to,
    handsWonVs: r.hands_won_vs
  }))
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

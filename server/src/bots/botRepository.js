import { query, withTransaction } from '../db/pool.js'
import { initialNeuralState, normalizeState } from './neuralPolicy.js'
import { VARIANTS as NEURAL_VARIANTS } from './neural/registry.js'
import { initialSuperState, MODES as SUPER_MODES } from './super/transitions.js'
import { STARTING_RATING } from './runtime/eloEngine.js'

const PUBLIC_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.avatar_url, b.rules, b.phrases, b.is_public,
  b.code, b.code_enabled,
  b.is_clone, b.clone_tier, b.clone_hands_used,
  b.is_neural, b.neural_tier, b.neural_kind, b.neural_state,
  b.is_super, b.super_member_ids, b.super_state,
  b.elo, b.hands_played, b.hands_voluntary, b.hands_won,
  b.showdowns_played, b.showdowns_won,
  b.bluffs_attempted, b.bluffs_succeeded, b.bluff_wins, b.chips_won_total,
  b.created_at, b.updated_at
`

// Slim shape for list endpoints. Excludes the heavy fields (rules, phrases,
// code) which the leaderboard and "my bots" page never display. With ~5KB
// average code size × 50 rows that's 250KB saved per leaderboard hit.
// `neural_state` IS included here on purpose: it's small (~90 floats) and
// the bot-list UI shows a tiny "hands trained / current LR" badge for NN
// bots, which needs the state shape.
const LIST_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.avatar_url, b.is_public,
  b.code_enabled,
  b.is_clone, b.clone_tier, b.clone_hands_used,
  b.is_neural, b.neural_tier, b.neural_kind, b.neural_state,
  b.is_super, b.super_member_ids, b.super_state,
  b.elo, b.hands_played, b.hands_voluntary, b.hands_won,
  b.showdowns_played, b.showdowns_won,
  b.bluffs_attempted, b.bluffs_succeeded, b.bluff_wins, b.chips_won_total,
  b.created_at, b.updated_at
`

function toApi(row, ownerName = null) {
  if (!row) return null
  // `rules`, `phrases`, `code` are only present on full reads. List shape
  // omits them — readers should not assume they exist. We pass undefined
  // through so JSON.stringify drops them rather than emitting null payloads.
  const out = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: ownerName,
    name: row.name,
    color: row.color,
    textColor: row.text_color || 'auto',
    avatarUrl: row.avatar_url || null,
    codeEnabled: Boolean(row.code_enabled),
    isPublic: row.is_public,
    elo: row.elo,
    isClone: Boolean(row.is_clone),
    cloneTier: row.clone_tier ?? null,
    cloneHandsUsed: row.clone_hands_used ?? null,
    isNeural: Boolean(row.is_neural),
    neuralTier: row.neural_tier ?? null,
    neuralKind: row.neural_kind ?? null,
    // neuralState is the full model blob. The runtime needs it for
    // inference + updates; the edit page renders the weights table from
    // the same field. Shape depends on neuralKind — pass it through so
    // normalizeState picks the right variant.
    neuralState: row.is_neural ? normalizeState(row.neural_state, row.neural_kind) : null,
    // Super-bot metadata. `superMemberIds` is the ordered list of member
    // bot UUIDs; populated only when isSuper. The full member records
    // are hydrated in `getBotById` for runtime dispatch + the edit page.
    isSuper: Boolean(row.is_super),
    superMemberIds: Array.isArray(row.super_member_ids) ? row.super_member_ids.slice() : null,
    // Bandit state for super bots. The runtime hydrates this through
    // normalizeSuperState; the edit page reads it raw for the stats UI.
    superState: row.is_super ? (row.super_state || null) : null,
    stats: {
      handsPlayed: row.hands_played,
      handsVoluntary: row.hands_voluntary ?? 0,
      handsWon: row.hands_won,
      showdownsPlayed: row.showdowns_played,
      showdownsWon: row.showdowns_won,
      bluffsAttempted: row.bluffs_attempted,
      bluffsSucceeded: row.bluffs_succeeded,
      bluffWins: row.bluff_wins ?? 0,
      chipsWonTotal: Number(row.chips_won_total)
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if ('rules' in row) out.rules = row.rules
  if ('phrases' in row) out.phrases = row.phrases
  if ('code' in row) out.code = row.code || ''
  return out
}

export async function createSuperBot({
  ownerUserId,
  name, color, textColor,
  isPublic = false,
  superMemberIds,
  mode = 'thompson'
}) {
  // Seed a fresh bandit state — one stats row per member, zeroed. Mode
  // defaults to thompson (the modern, explore-aware default) but
  // callers can pass any of uniform/weighted/thompson/markov.
  const initialState = initialSuperState({ mode, memberIds: superMemberIds })
  const { rows } = await query(
    `
    INSERT INTO bots (
      owner_user_id, name, color, text_color,
      rules, phrases, is_public,
      code, code_enabled,
      is_super, super_member_ids, super_state
    )
    VALUES ($1, $2, $3, $4, '[]'::jsonb, '{}'::jsonb, $5,
            '', FALSE,
            TRUE, $6::uuid[], $7::jsonb)
    RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [
      ownerUserId, name, color, textColor || 'auto',
      Boolean(isPublic),
      superMemberIds,
      JSON.stringify(initialState)
    ]
  )
  return toApi(rows[0])
}

export async function createBot({
  ownerUserId,
  name, color, textColor, rules, phrases,
  isPublic, code, codeEnabled,
  // Clone-only metadata. Pass these together or leave them all out.
  isClone = false, cloneTier = null, cloneHandsUsed = null
}) {
  const { rows } = await query(
    `
    INSERT INTO bots (
      owner_user_id, name, color, text_color, rules, phrases, is_public,
      code, code_enabled,
      is_clone, clone_tier, clone_hands_used
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
    RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [
      ownerUserId, name, color,
      textColor || 'auto',
      JSON.stringify(rules),
      JSON.stringify(phrases ?? {}),
      isPublic ?? true,
      code ?? '',
      Boolean(codeEnabled),
      Boolean(isClone),
      isClone ? cloneTier : null,
      isClone ? cloneHandsUsed : null
    ]
  )
  return toApi(rows[0])
}

export async function updateBot({ botId, ownerUserId, patch }) {
  const fields = []
  const values = []
  let idx = 1

  for (const [col, key] of [
    ['name', 'name'],
    ['color', 'color'],
    ['text_color', 'textColor'],
    ['avatar_url', 'avatarUrl'],
    ['is_public', 'isPublic'],
    ['code', 'code'],
    ['code_enabled', 'codeEnabled']
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = $${idx++}`)
      values.push(patch[key])
    }
  }
  if (patch.rules !== undefined) {
    fields.push(`rules = $${idx++}::jsonb`)
    values.push(JSON.stringify(patch.rules))
  }
  if (patch.phrases !== undefined) {
    fields.push(`phrases = $${idx++}::jsonb`)
    values.push(JSON.stringify(patch.phrases))
  }
  if (patch.superMemberIds !== undefined) {
    fields.push(`super_member_ids = $${idx++}::uuid[]`)
    values.push(patch.superMemberIds)
  }
  if (patch.superState !== undefined) {
    // Used by the mode-toggle UI: caller hands us the in-memory state
    // (with mode updated), we persist it whole. Bandit stats are
    // preserved across mode flips so a user can experiment without
    // burning their accumulated counts.
    fields.push(`super_state = $${idx++}::jsonb`)
    values.push(JSON.stringify(patch.superState))
  }

  if (fields.length === 0) {
    return getBotById(botId)
  }

  fields.push('updated_at = NOW()')
  values.push(botId, ownerUserId)

  const { rows } = await query(
    `
    UPDATE bots SET ${fields.join(', ')}
     WHERE id = $${idx++} AND owner_user_id = $${idx}
     RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    values
  )
  return toApi(rows[0])
}

// Refuses to delete clone bots — they're permanent slots tied to the user's
// play data. Same rule for neural bots: they're auto-provisioned fixed slots,
// not user-created. Returns { ok, reason } so the caller can render a sensible
// error rather than a generic 404.
export async function deleteBot({ botId, ownerUserId }) {
  const { rows } = await query(
    'SELECT is_clone, is_neural FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  if (rows.length === 0) return { ok: false, reason: 'not_found' }
  if (rows[0].is_clone) return { ok: false, reason: 'clone_locked' }
  if (rows[0].is_neural) return { ok: false, reason: 'neural_locked' }
  const { rowCount } = await query(
    'DELETE FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  return { ok: rowCount > 0, reason: rowCount > 0 ? null : 'not_found' }
}

// Auto-provision the full neural-net squad for a user — five bots, each a
// different learning variant. Idempotent: the unique (owner_user_id,
// neural_tier) constraint means re-running this never duplicates, so old
// users gain new variants on next /mine call without a one-off backfill.
//
// Variants come from the registry so adding a new technique only requires
// extending VARIANTS — this function picks up the new row automatically.
export async function provisionNeuralBotsForUser(ownerUserId) {
  for (const v of NEURAL_VARIANTS) {
    await query(
      `
      INSERT INTO bots (
        owner_user_id, name, color, text_color,
        rules, phrases, is_public,
        code, code_enabled,
        is_neural, neural_tier, neural_kind, neural_state
      )
      VALUES ($1, $2, $3, 'auto', '[]'::jsonb, '{}'::jsonb, FALSE,
              '', FALSE,
              TRUE, $4, $5, $6::jsonb)
      ON CONFLICT (owner_user_id, neural_tier) DO NOTHING
      `,
      [
        ownerUserId,
        v.name, v.color,
        v.tier, v.kind,
        JSON.stringify(initialNeuralState(v.kind))
      ]
    )
  }
}

// Persist the super bot's bandit state after each hand it plays. The
// caller (PokerRoom) owns the in-memory state through the BotPlayer
// instance; this just writes it back. Fire-and-forget — failures are
// logged but don't block the next hand.
export async function updateSuperState({ botId, ownerUserId, state }) {
  await query(
    `UPDATE bots
        SET super_state = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND is_super = TRUE`,
    [botId, ownerUserId, JSON.stringify(state)]
  )
}

// Persist a new neural state blob. Called after every hand a neural bot
// plays. We never read-modify-write here — the caller (BotPlayer) already
// holds the latest in-memory state; this is just a fire-and-forget save.
export async function updateNeuralState({ botId, ownerUserId, state }) {
  await query(
    `UPDATE bots
        SET neural_state = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND is_neural = TRUE`,
    [botId, ownerUserId, JSON.stringify(state)]
  )
}

// Hard reset: wipe weights back to fresh random init + zero the training
// counters. Used by the "Reset weights" button on the NN edit page. The
// fresh state is keyed to the bot's variant — MLP gets MLP weights back,
// Q-learning gets Q-values back, etc.
// Full reset of a neural bot back to its day-1 state:
//   - weights → fresh initial policy state (random init)
//   - ELO → STARTING_RATING (matches the column DEFAULT)
//   - lifetime stats (hands_played, hands_won, showdowns, bluff_wins,
//     chips_won_total, etc.) → all zeroed
//   - bot_hand_results rows for this bot → deleted (so the ELO history
//     chart and head-to-head stats are wiped too)
// All four steps run in one transaction so a partial failure can't
// leave the bot with cleared weights but a stale 4k-hand stat trail
// dangling behind it.
export async function resetNeuralBot({ botId, ownerUserId }) {
  return withTransaction(async (client) => {
    const { rows: kindRows } = await client.query(
      'SELECT neural_kind FROM bots WHERE id = $1 AND owner_user_id = $2 AND is_neural = TRUE',
      [botId, ownerUserId]
    )
    if (kindRows.length === 0) return null
    const fresh = initialNeuralState(kindRows[0].neural_kind)

    // Zero every column the per-hand recorder writes to, plus the ELO
    // history audit table. Mirrors `record_bot_hand`'s UPDATE list
    // exactly so we don't drift if a new stat column gets added there
    // and not here.
    await client.query(
      `DELETE FROM bot_hand_results WHERE bot_id = $1`,
      [botId]
    )
    const { rows } = await client.query(
      `UPDATE bots
          SET neural_state     = $3::jsonb,
              elo              = $4,
              hands_played     = 0,
              hands_voluntary  = 0,
              hands_won        = 0,
              showdowns_played = 0,
              showdowns_won    = 0,
              bluffs_attempted = 0,
              bluffs_succeeded = 0,
              bluff_wins       = 0,
              chips_won_total  = 0,
              updated_at       = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND is_neural = TRUE
        RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}`,
      [botId, ownerUserId, JSON.stringify(fresh), STARTING_RATING]
    )
    return rows[0] ? toApi(rows[0]) : null
  })
}

// Stats-only reset. Works for ANY bot kind (rule, clone, neural,
// super) — wipes ELO + lifetime stat columns + the per-hand history
// rows that drive the ELO chart and head-to-head stats. Does NOT
// touch the user's JS code, the neural weights, or the super
// members. Used after the ELO overhaul so users can wipe inflated
// ratings without losing the bots themselves.
//
// Same transaction shape as resetNeuralBot. Caller must own the bot.
export async function resetBotStats({ botId, ownerUserId }) {
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM bot_hand_results WHERE bot_id = $1`,
      [botId]
    )
    const { rows } = await client.query(
      `UPDATE bots
          SET elo              = $3,
              hands_played     = 0,
              hands_voluntary  = 0,
              hands_won        = 0,
              showdowns_played = 0,
              showdowns_won    = 0,
              bluffs_attempted = 0,
              bluffs_succeeded = 0,
              bluff_wins       = 0,
              chips_won_total  = 0,
              updated_at       = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}`,
      [botId, ownerUserId, STARTING_RATING]
    )
    return rows[0] ? toApi(rows[0]) : null
  })
}

// Counts only the user's manual bots — excludes clones, neural slots,
// AND super bots (each is on its own quota). The name stays "NonClone"
// for backward compat with call sites; the predicate is the source of
// truth.
export async function countNonCloneBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM bots
       WHERE owner_user_id = $1 AND is_clone = FALSE
         AND is_neural = FALSE AND is_super = FALSE`,
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

// Super bots have their own 2-per-user slot count. Off-quota from the
// 10 manual bots so users always have room to assemble two ensembles.
export async function countSuperBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1 AND is_super = TRUE',
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

// Validate a proposed list of member-bot UUIDs against the rules:
//   - 3..5 entries, all unique
//   - every member must be visible to the owner (own or public)
//   - members cannot themselves be super bots (no recursion)
// Returns { ok, error?, members? }. On success, `members` is the
// fetched member rows in the same order as the input.
export async function validateSuperMembers(memberIds, ownerUserId) {
  if (!Array.isArray(memberIds)) return { ok: false, error: 'invalid_members' }
  const ids = memberIds.filter(id => typeof id === 'string')
  if (ids.length < 3 || ids.length > 5) return { ok: false, error: 'member_count' }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'duplicate_members' }
  const { rows } = await query(
    `SELECT id, is_super, is_public, owner_user_id
       FROM bots WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  if (rows.length !== ids.length) return { ok: false, error: 'member_not_found' }
  for (const r of rows) {
    if (r.is_super) return { ok: false, error: 'no_nested_super' }
    if (!r.is_public && r.owner_user_id !== ownerUserId) {
      return { ok: false, error: 'member_not_visible' }
    }
  }
  // Re-order to match the input order so the dispatch position is
  // stable. The DB doesn't guarantee result order for ANY().
  const byId = new Map(rows.map(r => [r.id, r]))
  return { ok: true, members: ids.map(id => byId.get(id)) }
}

// Bulk-load the full API shape for a list of member bot UUIDs. Used
// inside getBotById to hydrate `members` for super bots so the runtime
// can dispatch without a second roundtrip. Preserves input order.
export async function getMembersByIds(memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) return []
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.id = ANY($1::uuid[])
    `,
    [memberIds]
  )
  const byId = new Map(rows.map(r => [r.id, r]))
  return memberIds.map(id => byId.get(id)).filter(Boolean).map(r => toApi(r, r.owner_display_name))
}

export async function getCloneByTier(ownerUserId, cloneTier) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1 AND b.is_clone = TRUE AND b.clone_tier = $2
     LIMIT 1
    `,
    [ownerUserId, cloneTier]
  )
  return rows[0] ? toApi(rows[0], rows[0].owner_display_name) : null
}

// Replace the code/elo/profile of an existing clone in place. Used by the
// "Recalculate from last N hands" button. Returns the updated bot.
export async function replaceCloneCode({ botId, ownerUserId, code, elo, color, name }) {
  const { rows } = await query(
    `
    UPDATE bots
       SET code = COALESCE($3, code),
           elo  = COALESCE($4, elo),
           color = COALESCE($5, color),
           name = COALESCE($6, name),
           updated_at = NOW()
     WHERE id = $1 AND owner_user_id = $2 AND is_clone = TRUE
     RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [botId, ownerUserId, code ?? null, elo ?? null, color ?? null, name ?? null]
  )
  return rows[0] ? toApi(rows[0]) : null
}

export async function getBotById(botId, { viewerUserId = null } = {}) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.id = $1
    `,
    [botId]
  )
  const row = rows[0]
  if (!row) return null
  if (!row.is_public && row.owner_user_id !== viewerUserId) return null
  const bot = toApi(row, row.owner_display_name)
  // Super bots carry their member records inline so the runtime can
  // dispatch decisions without a second fetch + the edit page can show
  // the lineup. Hydration is a single bulk query — cheap.
  if (bot.isSuper && bot.superMemberIds?.length) {
    bot.members = await getMembersByIds(bot.superMemberIds)
  }
  return bot
}

export async function countBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1',
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

// Total public bots a user is currently sharing — drives the 10-public
// cap. Counts across all kinds (manual, clone, neural) since the cap is
// "how many of yours can anyone seat", not "how many of each type".
export async function countPublicBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1 AND is_public = TRUE',
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

export async function listBotsByOwner(ownerUserId) {
  // LIST_FIELDS excludes rules/phrases/code — saves ~5KB/row over the wire
  // and skips the JSONB parse on the client. Edit/Run paths use getBotById
  // which still returns the full shape.
  const { rows } = await query(
    `
    SELECT ${LIST_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1
     ORDER BY b.created_at DESC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

export async function listPublicBots({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0)
  // Leaderboard query — heaviest one in the system, runs anytime the public
  // bot list loads. With the partial covering index added in migration 007
  // (elo DESC, created_at DESC) WHERE is_public AND NOT is_clone, this scans
  // O(LIMIT) index entries instead of the full public set.
  const { rows } = await query(
    `
    SELECT ${LIST_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.is_public = TRUE AND b.is_clone = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT $1 OFFSET $2
    `,
    [safeLimit, safeOffset]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Top N bots by ELO with one bot per ELO tier — used by the arena's
// auto-fill tool. DISTINCT ON keeps the first row per b.elo according to
// the ORDER BY, so starting the ORDER BY with `b.elo DESC, b.created_at
// DESC` gives us the most recently created bot per ELO tier. LIMIT takes
// the top N tiers from that already-sorted stream. Single query, no N+1,
// no client-side dedup.
//
// (An earlier wrapped-subquery version referenced `b.*` columns in the
// outer SELECT where the alias was out of scope — Postgres rejected it
// and the engine silently fell back to "no bots available." Don't
// reintroduce the wrapper.)
export async function listTopUniqueEloBots({ limit = 5 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20)
  const { rows } = await query(
    `
    SELECT DISTINCT ON (b.elo) ${LIST_FIELDS},
           u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.is_public = TRUE AND b.is_clone = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT $1
    `,
    [safeLimit]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Head-to-head stats: for every opponent this bot has shared a hand with,
// return aggregate win-count / chips delta / hand count. We don't have an
// explicit `hand_id` column on bot_hand_results, so we join by table_id +
// a ~100ms time window around played_at — same hand's audit rows all land
// within a few ms of each other (Promise.all in _recordBotHandResults).
//
// Heavier than a single-bot ELO lookup but bounded by the hand-history
// retention window; LIMIT N opponents keeps the response payload modest.
export async function getBotHeadToHead(botId, { limit = 30, sampleHands = 2000 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)
  const safeSample = Math.min(Math.max(parseInt(sampleHands, 10) || 2000, 100), 10000)
  const { rows } = await query(
    `
    WITH my_hands AS (
      SELECT table_id, played_at, won, chips_delta
        FROM bot_hand_results
       WHERE bot_id = $1
       ORDER BY played_at DESC
       LIMIT $2
    ),
    pairings AS (
      SELECT o.bot_id AS opp_id,
             COUNT(*)::int                                 AS hands_together,
             SUM(CASE WHEN my.won THEN 1 ELSE 0 END)::int  AS my_wins,
             SUM(my.chips_delta)::bigint                   AS chips_delta_sum
        FROM my_hands my
        JOIN bot_hand_results o
          ON o.table_id = my.table_id
         AND o.played_at BETWEEN my.played_at - INTERVAL '150 milliseconds'
                             AND my.played_at + INTERVAL '150 milliseconds'
         AND o.bot_id <> $1
       GROUP BY o.bot_id
    )
    SELECT p.opp_id,
           p.hands_together,
           p.my_wins,
           p.chips_delta_sum,
           b.name  AS opp_name,
           b.color AS opp_color,
           b.text_color AS opp_text_color,
           b.avatar_url AS opp_avatar_url,
           b.elo   AS opp_elo,
           b.is_neural AS opp_is_neural,
           b.neural_kind AS opp_neural_kind,
           b.is_clone   AS opp_is_clone,
           u.display_name AS opp_owner_display_name
      FROM pairings p
      JOIN bots b ON b.id = p.opp_id
      JOIN users u ON u.id = b.owner_user_id
     ORDER BY p.hands_together DESC, p.my_wins DESC
     LIMIT $3
    `,
    [botId, safeSample, safeLimit]
  )
  return rows.map(r => ({
    opponentId: r.opp_id,
    name: r.opp_name,
    color: r.opp_color,
    textColor: r.opp_text_color,
    avatarUrl: r.opp_avatar_url,
    elo: r.opp_elo,
    isNeural: r.opp_is_neural,
    neuralKind: r.opp_neural_kind,
    isClone: r.opp_is_clone,
    ownerDisplayName: r.opp_owner_display_name,
    handsTogether: r.hands_together,
    myWins: r.my_wins,
    myLosses: r.hands_together - r.my_wins,
    chipsDelta: Number(r.chips_delta_sum)
  }))
}

// Manual / user-coded bots only (excludes clones + neural). Used by the
// "auto-fill with my custom bots" arena action.
export async function listManualBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1
       AND b.is_clone = FALSE
       AND b.is_neural = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Per-hand ELO time-series for the bot. Returns rows in chronological
// order with hand_no = position within the returned window. Filters out
// rows where elo_after is NULL (pre-migration-018 hands). The default
// limit is a thousand — enough for a long-tail trend; smaller than
// shipping every audit row of a power-user's bot.
export async function getBotEloHistory(botId, { limit = 1000 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 10), 5000)
  // Two-step query so we can keep the most-recent N (cheap via the
  // existing bot_id index) and then ORDER ASC for the chart. ROW_NUMBER
  // gives the X axis without the caller needing to enumerate client-side.
  const { rows } = await query(
    `
    SELECT played_at, elo_after,
           ROW_NUMBER() OVER (ORDER BY played_at ASC) AS hand_no
      FROM (
        SELECT played_at, elo_after
          FROM bot_hand_results
         WHERE bot_id = $1 AND elo_after IS NOT NULL
         ORDER BY played_at DESC
         LIMIT $2
      ) recent
     ORDER BY played_at ASC
    `,
    [botId, safeLimit]
  )
  return rows.map(r => ({
    handNo: Number(r.hand_no),
    elo: r.elo_after,
    playedAt: r.played_at
  }))
}

// Public bots owned by a given user — used by profile pages to show
// "the bots this person is sharing publicly". Excludes clones (private
// by default anyway) and neural bots (always private). Sorted by ELO so
// the strongest one shows first.
export async function listPublicBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${LIST_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1
       AND b.is_public = TRUE
       AND b.is_clone = FALSE
       AND b.is_neural = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT 30
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Owner's neural-bot squad in tier order (α → ε). Used by the "auto-fill
// with my NN squad" action to seat the user's own 5 neural bots in tier
// order so the arena lineup is consistent across sessions. Owner-only;
// returns [] if the user hasn't been provisioned yet (caller can decide
// whether to provision-then-retry or surface a "play once first" error).
export async function listNeuralBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1 AND b.is_neural = TRUE
     ORDER BY b.neural_tier ASC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Just the deep-MLP tier (tiers 6-10: Neuron ζ-κ). Used by
// POKER_AUTO_FILL_MLP to seat the user's 5 deep-MLP variants without
// dragging the baseline α-ε along. Same shape as listNeuralBotsByOwner.
export async function listDeepMlpBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1 AND b.is_neural = TRUE AND b.neural_tier >= 6
     ORDER BY b.neural_tier ASC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Atomic per-hand update for a bot at a poker table. Inserts the hand result
// row + bumps every aggregate counter on `bots`. ELO floor is 300 (matches
// eloEngine.RATING_FLOOR) — a bot stuck on a losing streak still has room
// to claw back without falling off the bottom of the scale.
//
// New since the ELO revamp: also records preflop hand score, was-this-a-
// bluff-win, and the computed performance score for that hand. These let us
// recompute ratings offline if the formula changes.
export async function recordHandResult({
  botId,
  tableId,
  chipsDelta,
  wentToShowdown,
  won,
  foldedPreflop,
  voluntarilyIn,
  eloChange,
  bluffWin = false,
  preflopScore = null,
  performanceScore = null
}) {
  if (!botId) return
  // Stored procedure does the INSERT + UPDATE in one statement (migration 007).
  // Replaces a 4-roundtrip transaction (BEGIN, INSERT, UPDATE, COMMIT) with
  // one. With 4 bots at a table that's 16 RTTs → 4 per hand.
  await query(
    `SELECT record_bot_hand($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      botId,
      String(tableId).slice(0, 64),
      Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.floor(chipsDelta || 0))),
      Boolean(wentToShowdown),
      Boolean(won),
      Boolean(foldedPreflop),
      Boolean(voluntarilyIn),
      Math.floor(eloChange || 0),
      Boolean(bluffWin),
      preflopScore != null ? Number(preflopScore) : null,
      performanceScore != null ? Number(performanceScore) : null
    ]
  )
}

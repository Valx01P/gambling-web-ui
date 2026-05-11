import { query } from '../db/pool.js'

const PUBLIC_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.rules, b.phrases, b.is_public,
  b.code, b.code_enabled,
  b.is_clone, b.clone_tier, b.clone_hands_used,
  b.elo, b.hands_played, b.hands_voluntary, b.hands_won,
  b.showdowns_played, b.showdowns_won,
  b.bluffs_attempted, b.bluffs_succeeded, b.bluff_wins, b.chips_won_total,
  b.created_at, b.updated_at
`

// Slim shape for list endpoints. Excludes the heavy fields (rules, phrases,
// code) which the leaderboard and "my bots" page never display. With ~5KB
// average code size × 50 rows that's 250KB saved per leaderboard hit.
const LIST_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.is_public,
  b.code_enabled,
  b.is_clone, b.clone_tier, b.clone_hands_used,
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
    codeEnabled: Boolean(row.code_enabled),
    isPublic: row.is_public,
    elo: row.elo,
    isClone: Boolean(row.is_clone),
    cloneTier: row.clone_tier ?? null,
    cloneHandsUsed: row.clone_hands_used ?? null,
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
// play data. Returns { ok, reason } so the caller can render a sensible
// error rather than a generic 404.
export async function deleteBot({ botId, ownerUserId }) {
  const { rows } = await query(
    'SELECT is_clone FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  if (rows.length === 0) return { ok: false, reason: 'not_found' }
  if (rows[0].is_clone) return { ok: false, reason: 'clone_locked' }
  const { rowCount } = await query(
    'DELETE FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  return { ok: rowCount > 0, reason: rowCount > 0 ? null : 'not_found' }
}

// Counts only the user's manual (non-clone) bots — drives the 10-bot cap.
export async function countNonCloneBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1 AND is_clone = FALSE',
    [ownerUserId]
  )
  return rows[0]?.count || 0
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
  return toApi(row, row.owner_display_name)
}

export async function countBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1',
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

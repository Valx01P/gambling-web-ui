import { query, withTransaction } from '../db/pool.js'

const PUBLIC_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.rules, b.phrases, b.is_public,
  b.code, b.code_enabled,
  b.elo, b.hands_played, b.hands_won, b.showdowns_played, b.showdowns_won,
  b.bluffs_attempted, b.bluffs_succeeded, b.chips_won_total,
  b.created_at, b.updated_at
`

function toApi(row, ownerName = null) {
  if (!row) return null
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: ownerName,
    name: row.name,
    color: row.color,
    textColor: row.text_color || 'auto',
    rules: row.rules,
    phrases: row.phrases,
    code: row.code || '',
    codeEnabled: Boolean(row.code_enabled),
    isPublic: row.is_public,
    elo: row.elo,
    stats: {
      handsPlayed: row.hands_played,
      handsWon: row.hands_won,
      showdownsPlayed: row.showdowns_played,
      showdownsWon: row.showdowns_won,
      bluffsAttempted: row.bluffs_attempted,
      bluffsSucceeded: row.bluffs_succeeded,
      chipsWonTotal: Number(row.chips_won_total)
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export async function createBot({ ownerUserId, name, color, textColor, rules, phrases, isPublic, code, codeEnabled }) {
  const { rows } = await query(
    `
    INSERT INTO bots (owner_user_id, name, color, text_color, rules, phrases, is_public, code, code_enabled)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
    RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [
      ownerUserId, name, color,
      textColor || 'auto',
      JSON.stringify(rules),
      JSON.stringify(phrases ?? {}),
      isPublic ?? true,
      code ?? '',
      Boolean(codeEnabled)
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

export async function deleteBot({ botId, ownerUserId }) {
  const { rowCount } = await query(
    'DELETE FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  return rowCount > 0
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
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
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
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.is_public = TRUE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT $1 OFFSET $2
    `,
    [safeLimit, safeOffset]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Atomic per-hand update for a bot at a poker table. Inserts the hand result
// row + bumps every aggregate counter on `bots`. ELO floor is 100 — so a bot
// on a long losing streak doesn't bottom out below the rating of an angry
// rock at the casino.
export async function recordHandResult({
  botId,
  tableId,
  chipsDelta,
  wentToShowdown,
  won,
  foldedPreflop,
  voluntarilyIn,
  eloChange
}) {
  if (!botId) return
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO bot_hand_results
         (bot_id, table_id, chips_delta, went_to_showdown, won, folded_preflop, voluntarily_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        botId,
        String(tableId).slice(0, 64),
        Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.floor(chipsDelta || 0))),
        Boolean(wentToShowdown),
        Boolean(won),
        Boolean(foldedPreflop),
        Boolean(voluntarilyIn)
      ]
    )
    await client.query(
      `UPDATE bots
          SET hands_played    = hands_played    + 1,
              hands_won       = hands_won       + $2,
              showdowns_played= showdowns_played+ $3,
              showdowns_won   = showdowns_won   + $4,
              chips_won_total = chips_won_total + $5,
              elo             = GREATEST(100, elo + $6),
              updated_at      = NOW()
        WHERE id = $1`,
      [
        botId,
        won ? 1 : 0,
        wentToShowdown ? 1 : 0,
        (wentToShowdown && won) ? 1 : 0,
        Math.floor(chipsDelta || 0),
        Math.floor(eloChange || 0)
      ]
    )
  })
}

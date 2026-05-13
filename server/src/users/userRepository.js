import { query } from '../db/pool.js'

export async function upsertGoogleUser({ sub, email, name, picture }) {
  const { rows } = await query(
    `
    INSERT INTO users (google_sub, email, display_name, avatar_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = NOW()
    RETURNING id, google_sub, email, display_name, avatar_url, created_at,
              elo, hands_played, hands_won
    `,
    [sub, email, name, picture]
  )
  return rows[0]
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, email, display_name, avatar_url, description, created_at, last_active_at,
            elo, hands_played, hands_won,
            side_bets_won, side_bets_lost, side_bet_longshot_wins,
            side_bet_chip_pl, all_in_showdowns, all_in_underdog_wins,
            dailies_completed, daily_date_key, daily_progress,
            daily_completed_at, achievements, skin_id, custom_skin
       FROM users WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

// Bump `last_active_at` without touching anything else. Called from
// auth_hello on every WS reconnect so the social presence indicator
// reflects when the user last opened the app. Best-effort — failures
// are logged but never bubble up.
export async function touchLastActive(id) {
  if (!id) return
  await query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [id])
}

export async function updateUserProfile(id, { displayName, avatarUrl, description }) {
  // COALESCE pattern lets each field be patched independently — pass
  // null/undefined to keep the existing value. For description we want
  // distinct "leave unchanged" (undefined) vs. "clear it" (empty string),
  // so we treat empty/explicit-null as "clear" via a sentinel.
  const descParam = description === undefined ? null : (description === '' ? '' : description)
  const descTouched = description !== undefined
  const { rows } = await query(
    `
    UPDATE users
       SET display_name = COALESCE($2, display_name),
           avatar_url   = COALESCE($3, avatar_url),
           description  = CASE WHEN $5::boolean THEN $4 ELSE description END,
           updated_at   = NOW()
     WHERE id = $1
     RETURNING id, email, display_name, avatar_url, description, elo, hands_played, hands_won
    `,
    [id, displayName ?? null, avatarUrl ?? null, descParam, descTouched]
  )
  return rows[0] || null
}

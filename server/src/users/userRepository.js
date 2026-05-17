import { query } from '../db/pool.js'

// Upsert by google_sub OR by email — if a native-auth user already
// exists with the same email, we link the Google identity onto their
// row instead of creating a duplicate account. Mirrors the "log in
// with Google after signing up natively" path the user asked for.
export async function upsertGoogleUser({ sub, email, name, picture }) {
  // First try to link onto an existing native account by email.
  const linked = await query(
    `UPDATE users
        SET google_sub = COALESCE(google_sub, $1),
            -- Don't overwrite a user-chosen display_name; only fill in
            -- if the existing one was blank (defensive — display_name is
            -- NOT NULL today but might be empty for legacy rows).
            display_name = COALESCE(NULLIF(display_name, ''), $3),
            avatar_url = COALESCE(avatar_url, $4),
            updated_at = NOW()
      WHERE LOWER(email) = LOWER($2)
        AND (google_sub IS NULL OR google_sub = $1)
      RETURNING id, google_sub, email, display_name, avatar_url, created_at,
                elo, hands_played, hands_won, username, email_verified_at`,
    [sub, email, name, picture]
  )
  if (linked.rows[0]) return linked.rows[0]
  // Otherwise insert/update by google_sub.
  const { rows } = await query(
    `
    INSERT INTO users (google_sub, email, display_name, avatar_url, email_verified_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = NOW()
    RETURNING id, google_sub, email, display_name, avatar_url, created_at,
              elo, hands_played, hands_won, username, email_verified_at
    `,
    [sub, email, name, picture]
  )
  return rows[0]
}

// Native-auth signup. Returns the new row; caller is responsible for
// issuing the 6-digit verification code and emailing it.
export async function createNativeUser({ email, passwordHash, username, displayName }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, username, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name, username, email_verified_at`,
    [email, passwordHash, username, displayName || username]
  )
  return rows[0]
}

export async function findUserByEmail(email) {
  if (!email) return null
  const { rows } = await query(
    `SELECT id, google_sub, email, password_hash, display_name, username,
            avatar_url, email_verified_at, elo, hands_played, hands_won
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email]
  )
  return rows[0] || null
}

export async function findUserByUsername(username) {
  if (!username) return null
  const { rows } = await query(
    `SELECT id, email, display_name, username, avatar_url
       FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1`,
    [username]
  )
  return rows[0] || null
}

export async function markEmailVerified(userId) {
  await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`,
    [userId]
  )
}

export async function setPasswordHash(userId, passwordHash) {
  await query(
    `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash]
  )
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, email, display_name, avatar_url, description, created_at, last_active_at,
            elo, hands_played, hands_won,
            side_bets_won, side_bets_lost, side_bet_longshot_wins,
            side_bet_chip_pl, all_in_showdowns, all_in_underdog_wins,
            dailies_completed, daily_date_key, daily_progress,
            daily_completed_at, achievements, skin_id, custom_skin,
            felt_color_id, felt_custom_colors
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

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
    RETURNING id, google_sub, email, display_name, avatar_url, created_at
    `,
    [sub, email, name, picture]
  )
  return rows[0]
}

export async function findUserById(id) {
  const { rows } = await query(
    'SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = $1',
    [id]
  )
  return rows[0] || null
}

export async function updateUserProfile(id, { displayName, avatarUrl }) {
  const { rows } = await query(
    `
    UPDATE users
       SET display_name = COALESCE($2, display_name),
           avatar_url   = COALESCE($3, avatar_url),
           updated_at   = NOW()
     WHERE id = $1
     RETURNING id, email, display_name, avatar_url
    `,
    [id, displayName ?? null, avatarUrl ?? null]
  )
  return rows[0] || null
}

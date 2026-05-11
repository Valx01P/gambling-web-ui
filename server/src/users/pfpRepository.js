import { query } from '../db/pool.js'

// All queries return the API shape (camelCase + only the fields we want to
// expose) so route handlers can just `res.json(...)` whatever this returns.
function toApi(row) {
  if (!row) return null
  return {
    id: row.id,
    s3Key: row.s3_key,
    publicUrl: row.public_url,
    contentType: row.content_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

export async function listForUser(userId) {
  const { rows } = await query(
    `SELECT id, s3_key, public_url, content_type, byte_size, created_at, last_used_at
       FROM user_pfps
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [userId]
  )
  return rows.map(toApi)
}

export async function getById(id, userId) {
  const { rows } = await query(
    `SELECT id, s3_key, public_url, content_type, byte_size, created_at, last_used_at
       FROM user_pfps
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return toApi(rows[0])
}

export async function create(userId, { s3Key, publicUrl, contentType, byteSize }) {
  const { rows } = await query(
    `INSERT INTO user_pfps (user_id, s3_key, public_url, content_type, byte_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, s3_key, public_url, content_type, byte_size, created_at, last_used_at`,
    [userId, s3Key, publicUrl, contentType, byteSize]
  )
  return toApi(rows[0])
}

// Mark the PFP as recently used. Called when a signed-in user picks a
// saved PFP as their active avatar — lets us sort the history "most
// recently used" if we want a second view.
export async function touchUsed(id, userId) {
  await query(
    `UPDATE user_pfps SET last_used_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
}

// Returns the s3_key of the deleted row so the caller can clean up the
// S3 object. We delete the DB row first (best-effort cleanup of S3
// afterwards) so a failed S3 delete doesn't leave an orphan row blocking
// the user — orphan S3 objects can be reaped by lifecycle later.
export async function deleteForUser(id, userId) {
  const { rows } = await query(
    `DELETE FROM user_pfps
      WHERE id = $1 AND user_id = $2
      RETURNING s3_key`,
    [id, userId]
  )
  return rows[0]?.s3_key || null
}

// Caps the user's history at `limit` rows (newest first). Used right after
// a new PFP is inserted so the roster stays compact and old uploads get
// auto-evicted. Returns the s3_keys of any rows that got dropped so the
// caller can fire-and-forget the S3 cleanup. If nothing was dropped (user
// has <= limit), returns an empty array.
export async function pruneToLimit(userId, limit) {
  const { rows } = await query(
    `DELETE FROM user_pfps
      WHERE id IN (
        SELECT id FROM user_pfps
         WHERE user_id = $1
         ORDER BY created_at DESC
         OFFSET $2
      )
      RETURNING s3_key`,
    [userId, limit]
  )
  return rows.map(r => r.s3_key)
}

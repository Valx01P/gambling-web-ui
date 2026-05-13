import { query } from '../db/pool.js'

// All known notification kinds. Keeping them as a single export so
// callers (route + WS pushers + the client) reference a single source.
// `dm` is a thin "you got a message" — the actual conversation lives
// in the DM tables; the notification just nudges the bell.
export const KINDS = {
  MENTION:       'mention',
  POST_REPLY:    'post_reply',
  COMMENT_REPLY: 'comment_reply',
  FOLLOW:        'follow',
  DM:            'dm',
  TABLE_INVITE:  'table_invite',
  SYSTEM:        'system'
}

// Create a notification. Returns the inserted row in API shape so the
// caller can push it onto the recipient's open WS without a second
// roundtrip. Caller is responsible for the WS push (this module only
// touches DB).
export async function createNotification({ userId, kind, payload, senderUserId = null }) {
  if (!userId || !kind) throw new Error('notification: userId + kind required')
  const { rows } = await query(
    `
    INSERT INTO notifications (user_id, kind, payload, sender_user_id)
    VALUES ($1, $2, $3::jsonb, $4)
    RETURNING id, user_id, kind, payload, sender_user_id, read_at, created_at
    `,
    [userId, kind, JSON.stringify(payload || {}), senderUserId]
  )
  return toApi(rows[0])
}

// Inbox feed for the bell dropdown. Includes the sender's display_name
// + avatar so the client can render "X mentioned you" without a second
// users fetch.
export async function listForUser(userId, { limit = 30, beforeId = null } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)
  const params = [userId, safeLimit]
  let where = 'WHERE n.user_id = $1'
  if (beforeId) {
    params.push(beforeId)
    where += ` AND n.created_at < (SELECT created_at FROM notifications WHERE id = $${params.length})`
  }
  const { rows } = await query(
    `
    SELECT n.id, n.user_id, n.kind, n.payload, n.sender_user_id,
           n.read_at, n.created_at,
           s.display_name AS sender_display_name,
           s.username     AS sender_username,
           s.avatar_url   AS sender_avatar_url
      FROM notifications n
      LEFT JOIN users s ON s.id = n.sender_user_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT $2
    `,
    params
  )
  return rows.map(toApi)
}

// Cheap unread-count for the bell badge. The partial index makes this
// a constant-time lookup even with hundreds of thousands of rows.
export async function countUnread(userId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  )
  return rows[0]?.count || 0
}

// Mark a single notification read. Idempotent; re-running on an already-
// read row is a no-op. Returns true if a row was flipped (caller can
// use this to gate WS push of the new unread count).
export async function markRead(notificationId, userId) {
  const { rowCount } = await query(
    `UPDATE notifications
        SET read_at = NOW()
      WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId]
  )
  return rowCount > 0
}

// Bulk "mark everything I have as read" — the dropdown's main action.
export async function markAllRead(userId) {
  const { rowCount } = await query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  )
  return rowCount
}

function toApi(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload || {},
    senderUserId: row.sender_user_id ?? null,
    sender: row.sender_user_id ? {
      id: row.sender_user_id,
      displayName: row.sender_display_name,
      username: row.sender_username,
      avatarUrl: row.sender_avatar_url
    } : null,
    readAt: row.read_at,
    createdAt: row.created_at
  }
}

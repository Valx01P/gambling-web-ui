import { query } from '../db/pool.js'

export const MAX_BODY_LENGTH = 4000

// Canonical pair ordering. UUIDs sort lexicographically — every pair
// has exactly one (a, b) form regardless of who messages first.
function canonicalPair(uA, uB) {
  return uA < uB ? [uA, uB] : [uB, uA]
}

// Get-or-create the conversation row for (me, them). Idempotent thanks
// to the unique constraint + ON CONFLICT.
export async function ensureConversation(meId, themId) {
  if (!meId || !themId || meId === themId) return null
  const [a, b] = canonicalPair(meId, themId)
  const { rows } = await query(
    `INSERT INTO dm_conversations (user_a_id, user_b_id)
     VALUES ($1, $2)
     ON CONFLICT (user_a_id, user_b_id) DO UPDATE
       SET user_a_id = EXCLUDED.user_a_id  -- no-op so RETURNING fires
     RETURNING id, user_a_id, user_b_id, last_message_at`,
    [a, b]
  )
  return rows[0]
}

// Send a message. Returns the inserted row + the conversation id so the
// caller can include it in the WS push without a second roundtrip.
export async function sendMessage({ fromUserId, toUserId, body, kind = null, metadata = null }) {
  if (!fromUserId || !toUserId || fromUserId === toUserId) throw new Error('invalid_parties')
  if (typeof body !== 'string') throw new Error('invalid_body')
  const clean = body.trim()
  if (clean.length === 0) throw new Error('invalid_body')
  if (clean.length > MAX_BODY_LENGTH) throw new Error('body_too_long')

  const conv = await ensureConversation(fromUserId, toUserId)
  if (!conv) throw new Error('invalid_parties')
  const { rows } = await query(
    `INSERT INTO dm_messages (conversation_id, sender_user_id, body, kind, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, conversation_id, sender_user_id, body, kind, metadata, read_at, created_at`,
    [conv.id, fromUserId, clean, kind, metadata ? JSON.stringify(metadata) : null]
  )
  // Bump the conversation's last_message_at so the inbox sort is fresh.
  await query(
    `UPDATE dm_conversations SET last_message_at = NOW() WHERE id = $1`,
    [conv.id]
  )
  return { conversation: conv, message: rows[0] }
}

// Inbox: every conversation the user has, newest-message-first, with
// the last message body inlined + an unread count. Single query so the
// list opens fast — joins are cheap with the canonical-pair index.
export async function listConversations(userId, { limit = 30 } = {}) {
  if (!userId) return []
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)
  const { rows } = await query(
    `
    WITH my_conversations AS (
      SELECT id, user_a_id, user_b_id, last_message_at,
             CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS other_id
        FROM dm_conversations
       WHERE (user_a_id = $1 OR user_b_id = $1)
         AND last_message_at IS NOT NULL
       ORDER BY last_message_at DESC
       LIMIT $2
    )
    SELECT c.id, c.last_message_at, c.other_id,
           u.username AS other_username,
           u.display_name AS other_display_name,
           u.avatar_url AS other_avatar_url,
           m.body AS last_body,
           m.kind AS last_kind,
           m.sender_user_id AS last_sender_id,
           m.created_at AS last_message_created_at,
           (
             SELECT COUNT(*)::int FROM dm_messages mu
              WHERE mu.conversation_id = c.id
                AND mu.sender_user_id <> $1
                AND mu.read_at IS NULL
           ) AS unread
      FROM my_conversations c
      JOIN users u ON u.id = c.other_id
      LEFT JOIN LATERAL (
        SELECT body, kind, sender_user_id, created_at
          FROM dm_messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
      ) m ON true
    `,
    [userId, safeLimit]
  )
  return rows.map(r => ({
    conversationId: r.id,
    other: {
      id: r.other_id,
      username: r.other_username,
      displayName: r.other_display_name,
      avatarUrl: r.other_avatar_url
    },
    lastMessageAt: r.last_message_at,
    lastBody: r.last_body,
    lastKind: r.last_kind,
    lastSenderId: r.last_sender_id,
    unread: r.unread || 0
  }))
}

// Page of messages between (me, them). Cursor on `beforeId` (DESC chronological).
export async function listMessages(meId, themId, { limit = 50, beforeId = null } = {}) {
  if (!meId || !themId) return { messages: [], conversationId: null }
  const [a, b] = canonicalPair(meId, themId)
  const { rows: convRows } = await query(
    `SELECT id FROM dm_conversations WHERE user_a_id = $1 AND user_b_id = $2`,
    [a, b]
  )
  const conversationId = convRows[0]?.id || null
  if (!conversationId) return { messages: [], conversationId: null }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
  const params = [conversationId, safeLimit]
  let where = 'WHERE conversation_id = $1'
  if (beforeId) {
    params.push(beforeId)
    where += ` AND created_at < (SELECT created_at FROM dm_messages WHERE id = $${params.length})`
  }
  const { rows } = await query(
    `SELECT id, conversation_id, sender_user_id, body, kind, metadata, read_at, created_at
       FROM dm_messages
       ${where}
       ORDER BY created_at DESC
       LIMIT $2`,
    params
  )
  // Reverse so the caller renders oldest-first (chat scroll default).
  return { messages: rows.reverse(), conversationId }
}

// Mark every message in this conversation that was sent by the OTHER
// party as read. Returns the count flipped so the caller can decide
// whether to push a `dm:read` to the original sender.
export async function markConversationRead(meId, themId) {
  if (!meId || !themId) return 0
  const [a, b] = canonicalPair(meId, themId)
  const { rowCount } = await query(
    `UPDATE dm_messages
        SET read_at = NOW()
      WHERE conversation_id = (
              SELECT id FROM dm_conversations WHERE user_a_id = $1 AND user_b_id = $2
            )
        AND sender_user_id = $3
        AND read_at IS NULL`,
    [a, b, themId]
  )
  return rowCount
}

// Cheap unread-conversation count for the nav badge (number of distinct
// conversations with anything unread from the other party). Constant
// time thanks to the partial index on dm_messages.
export async function countUnreadConversations(userId) {
  if (!userId) return 0
  const { rows } = await query(
    `SELECT COUNT(DISTINCT m.conversation_id)::int AS count
       FROM dm_messages m
       JOIN dm_conversations c ON c.id = m.conversation_id
      WHERE m.read_at IS NULL
        AND m.sender_user_id <> $1
        AND (c.user_a_id = $1 OR c.user_b_id = $1)`,
    [userId]
  )
  return rows[0]?.count || 0
}

// Delete every table_invite DM the sender ever sent for this tableId.
// Fired when the sender leaves the room — the invite is dead the moment
// they walk away, so we evict it from every recipient's inbox rather
// than leaving them with a "join the host's empty table" footgun.
// Returns the list of (messageId, conversationId, recipientUserId) the
// caller can use to push live "dm:deleted" frames so open inboxes
// re-render without a refresh. Matches metadata.tableId verbatim.
export async function deleteTableInvitesFromSender(senderUserId, tableId) {
  if (!senderUserId || !tableId) return []
  const { rows } = await query(
    `
    WITH deleted AS (
      DELETE FROM dm_messages m
       USING dm_conversations c
       WHERE m.conversation_id = c.id
         AND m.sender_user_id = $1
         AND m.kind = 'table_invite'
         AND m.metadata ->> 'tableId' = $2
       RETURNING m.id AS message_id,
                 m.conversation_id,
                 CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS recipient_user_id
    )
    SELECT * FROM deleted
    `,
    [senderUserId, tableId]
  )
  return rows.map(r => ({
    messageId: Number(r.message_id),
    conversationId: r.conversation_id,
    recipientUserId: r.recipient_user_id
  }))
}

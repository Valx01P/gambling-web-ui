import { query } from '../db/pool.js'

export const MAX_BODY_LENGTH = 2000

// Shared SELECT shape so list + detail return the same fields. Includes
// author info inline so the client doesn't need a follow-up users
// lookup. `like_by_me` is computed in the caller's CTE.
const POST_FIELDS = `
  p.id, p.user_id, p.body, p.image_url, p.table_id,
  p.like_count, p.comment_count,
  p.created_at, p.updated_at,
  u.username AS author_username,
  u.display_name AS author_display_name,
  u.avatar_url AS author_avatar_url
`

function toPostApi(row, { likedByMe = false } = {}) {
  return {
    id: row.id,
    authorId: row.user_id,
    author: {
      id: row.user_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url
    },
    body: row.body || '',
    imageUrl: row.image_url || null,
    tableId: row.table_id || null,
    likeCount: row.like_count || 0,
    commentCount: row.comment_count || 0,
    likedByMe: Boolean(row.liked_by_me ?? likedByMe),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toCommentApi(row) {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.user_id,
    author: {
      id: row.user_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url
    },
    body: row.body,
    parentCommentId: row.parent_comment_id,
    likeCount: row.like_count || 0,
    createdAt: row.created_at
  }
}

export async function createPost({ userId, body, imageUrl = null, tableId = null }) {
  const clean = (body || '').trim()
  if (clean.length === 0 && !imageUrl) throw new Error('empty_post')
  if (clean.length > MAX_BODY_LENGTH) throw new Error('body_too_long')
  const { rows } = await query(
    `INSERT INTO posts (user_id, body, image_url, table_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, clean, imageUrl, tableId]
  )
  return getPostById(rows[0].id, { viewerUserId: userId })
}

export async function deletePost({ postId, userId }) {
  const { rowCount } = await query(
    `UPDATE posts SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [postId, userId]
  )
  return rowCount > 0
}

export async function getPostById(postId, { viewerUserId = null } = {}) {
  const { rows } = await query(
    `SELECT ${POST_FIELDS},
            ($2::uuid IS NOT NULL AND EXISTS (
              SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $2
            )) AS liked_by_me
       FROM posts p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [postId, viewerUserId]
  )
  return rows[0] ? toPostApi(rows[0]) : null
}

// Feed list. Newest first, cursor on `beforeId`. With a `userId` arg
// the list is scoped to that author's timeline; without it, the global
// feed. `viewerUserId` drives the liked_by_me flag for the heart icon.
export async function listPosts({ viewerUserId = null, authorId = null, beforeId = null, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50)
  const params = [viewerUserId, safeLimit]
  let where = 'WHERE p.deleted_at IS NULL'
  if (authorId) {
    params.push(authorId)
    where += ` AND p.user_id = $${params.length}`
  }
  if (beforeId) {
    params.push(beforeId)
    where += ` AND p.created_at < (SELECT created_at FROM posts WHERE id = $${params.length})`
  }
  const { rows } = await query(
    `SELECT ${POST_FIELDS},
            ($1::uuid IS NOT NULL AND EXISTS (
              SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1
            )) AS liked_by_me
       FROM posts p
       JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $2`,
    params
  )
  return rows.map(r => toPostApi(r))
}

export async function likePost({ postId, userId }) {
  const { rowCount } = await query(
    `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
    [postId, userId]
  )
  if (rowCount > 0) {
    await query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [postId])
  }
  return rowCount > 0
}

export async function unlikePost({ postId, userId }) {
  const { rowCount } = await query(
    `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,
    [postId, userId]
  )
  if (rowCount > 0) {
    await query('UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id = $1', [postId])
  }
  return rowCount > 0
}

export async function addComment({ postId, userId, body, parentCommentId = null }) {
  const clean = (body || '').trim()
  if (clean.length === 0) throw new Error('empty_comment')
  if (clean.length > MAX_BODY_LENGTH) throw new Error('body_too_long')
  const { rows } = await query(
    `INSERT INTO post_comments (post_id, user_id, body, parent_comment_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [postId, userId, clean, parentCommentId]
  )
  await query('UPDATE posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = $1', [postId])
  return getCommentById(rows[0].id)
}

export async function getCommentById(commentId) {
  const { rows } = await query(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.parent_comment_id,
            c.like_count, c.created_at,
            u.username AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url
       FROM post_comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [commentId]
  )
  return rows[0] ? toCommentApi(rows[0]) : null
}

export async function listComments(postId) {
  const { rows } = await query(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.parent_comment_id,
            c.like_count, c.created_at,
            u.username AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar_url
       FROM post_comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
      LIMIT 500`,
    [postId]
  )
  return rows.map(toCommentApi)
}

export async function deleteComment({ commentId, userId }) {
  const { rows } = await query(
    `UPDATE post_comments SET deleted_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING post_id`,
    [commentId, userId]
  )
  if (rows[0]?.post_id) {
    await query('UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1', [rows[0].post_id])
    return true
  }
  return false
}

// --- @mention parsing ---------------------------------------------------
// Extract @usernames from a post/comment body. The username pattern
// matches the schema validator (3–24 chars, lowercase letters/digits/_).
// Returns a Set of unique usernames (without the @).
const MENTION_RE = /@([a-z0-9_]{3,24})/g
export function extractMentionUsernames(text) {
  if (typeof text !== 'string' || !text.length) return new Set()
  const out = new Set()
  let m
  while ((m = MENTION_RE.exec(text.toLowerCase())) !== null) {
    out.add(m[1])
  }
  return out
}

// Resolve a set of usernames to (id, username, displayName). Skips
// unknown handles so feature code can just dispatchNotification across
// the result. Caps at 10 so a @-wall doesn't fan-out unboundedly.
export async function resolveMentions(usernames) {
  const list = [...usernames].slice(0, 10)
  if (list.length === 0) return []
  const { rows } = await query(
    `SELECT id, username, display_name
       FROM users
      WHERE LOWER(username) = ANY($1::text[])`,
    [list]
  )
  return rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name }))
}

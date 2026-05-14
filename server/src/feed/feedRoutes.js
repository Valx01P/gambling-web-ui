import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired, authOptional } from '../auth/middleware.js'
import {
  createPost, deletePost, getPostById, listPosts,
  likePost, unlikePost,
  addComment, listComments, deleteComment, getCommentById,
  extractMentionUsernames, resolveMentions,
  MAX_BODY_LENGTH
} from './feedRepository.js'
import { dispatchNotification } from '../notifications/dispatcher.js'
import { KINDS as NOTIF } from '../notifications/notificationsRepository.js'

const readLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip)
})
// Writes are the spam-prone path. 30/min per user covers any honest
// posting cadence (a post + a comment every 2s is already chatty).
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 30,
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Slow down on posts/comments.' }
})

function isUuid(s) { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) }

// Resolve mention handles → user ids and dispatch one notification per
// unique user. Skip self-mentions (don't notify yourself). Fire-and-
// forget — failures are logged but never block the post/comment.
async function fanoutMentions({ body, authorId, postId, commentId = null, kind = NOTIF.MENTION, context = 'post' }) {
  try {
    const handles = extractMentionUsernames(body)
    if (handles.size === 0) return
    const targets = await resolveMentions(handles)
    for (const t of targets) {
      if (t.id === authorId) continue
      dispatchNotification({
        userId: t.id,
        kind,
        senderUserId: authorId,
        payload: { postId, commentId, context, preview: body.slice(0, 120) }
      }).catch(err => console.warn('[feed] mention notify failed:', err.message))
    }
  } catch (err) {
    console.warn('[feed] mention fanout failed:', err.message)
  }
}

export function feedRoutes() {
  const router = Router()

  // GET /api/feed?authorId=… — global feed or a single author's timeline.
  // Newest first, cursor on beforeId.
  router.get('/', authOptional, readLimiter, async (req, res) => {
    const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId : null
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const rawAuthor = typeof req.query.authorId === 'string' ? req.query.authorId : null
    // Defensive — reject any value that doesn't look like a UUID, rather
    // than passing junk through to the SQL parameterized query.
    const authorId = rawAuthor && isUuid(rawAuthor) ? rawAuthor : null
    const posts = await listPosts({
      viewerUserId: req.user?.id ?? null,
      authorId,
      beforeId,
      limit
    })
    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ posts })
  })

  // GET /api/feed/:postId — single post with comments.
  router.get('/:postId', authOptional, readLimiter, async (req, res) => {
    if (!isUuid(req.params.postId)) return res.status(400).json({ error: 'invalid_id' })
    const post = await getPostById(req.params.postId, { viewerUserId: req.user?.id ?? null })
    if (!post) return res.status(404).json({ error: 'not_found' })
    const comments = await listComments(req.params.postId)
    res.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
    res.json({ post, comments })
  })

  // POST /api/feed — create. Body: { body, imageUrl?, tableId? }
  router.post('/', authRequired, writeLimiter, async (req, res) => {
    const { body, imageUrl, tableId } = req.body || {}
    if (typeof body !== 'string') return res.status(400).json({ error: 'invalid_body' })
    if (body.length > MAX_BODY_LENGTH) return res.status(400).json({ error: 'body_too_long', detail: `Max ${MAX_BODY_LENGTH} characters.` })
    // Image URL must come from our own CloudFront — same gate as bot
    // avatars so a poster can't point the feed at a third-party host.
    if (imageUrl != null) {
      if (typeof imageUrl !== 'string' || imageUrl.length > 512) {
        return res.status(400).json({ error: 'invalid_image_url' })
      }
      try {
        const parsed = new URL(imageUrl)
        const baseHost = process.env.S3_PUBLIC_BASE_URL ? new URL(process.env.S3_PUBLIC_BASE_URL).hostname : null
        if (!baseHost || parsed.hostname !== baseHost) {
          return res.status(400).json({ error: 'invalid_image_url', detail: 'Images must be uploaded through this app.' })
        }
      } catch { return res.status(400).json({ error: 'invalid_image_url' }) }
    }
    if (tableId != null && (typeof tableId !== 'string' || tableId.length > 64)) {
      return res.status(400).json({ error: 'invalid_table_id' })
    }
    try {
      const post = await createPost({
        userId: req.user.id,
        body,
        imageUrl: imageUrl || null,
        tableId: tableId || null
      })
      fanoutMentions({ body, authorId: req.user.id, postId: post.id, context: 'post' })
      res.status(201).json({ post })
    } catch (err) {
      if (err.message === 'empty_post' || err.message === 'body_too_long') {
        return res.status(400).json({ error: err.message })
      }
      console.error('[feed] create failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.delete('/:postId', authRequired, writeLimiter, async (req, res) => {
    if (!isUuid(req.params.postId)) return res.status(400).json({ error: 'invalid_id' })
    const ok = await deletePost({ postId: req.params.postId, userId: req.user.id })
    if (!ok) return res.status(404).json({ error: 'not_found' })
    res.status(204).end()
  })

  router.post('/:postId/like', authRequired, writeLimiter, async (req, res) => {
    if (!isUuid(req.params.postId)) return res.status(400).json({ error: 'invalid_id' })
    const wasNew = await likePost({ postId: req.params.postId, userId: req.user.id })
    // Re-read the row so concurrent likes don't ship stale counts to
    // the client. The like INSERT is atomic but the count we report
    // back has to reflect the post-write state, not a pre-write snapshot.
    const post = await getPostById(req.params.postId, { viewerUserId: req.user.id })
    if (!post) return res.status(404).json({ error: 'not_found' })
    // Notify the author — but only on the first like (idempotent re-likes
    // would spam) and never on a self-like. Fire-and-forget; the like
    // itself already happened.
    if (wasNew && post.authorId && post.authorId !== req.user.id) {
      dispatchNotification({
        userId: post.authorId,
        kind: NOTIF.POST_LIKE,
        senderUserId: req.user.id,
        payload: { postId: post.id }
      }).catch(err => console.warn('[feed] like notify failed:', err.message))
    }
    res.json({ ok: true, liked: true, likeCount: post.likeCount })
  })

  router.delete('/:postId/like', authRequired, writeLimiter, async (req, res) => {
    if (!isUuid(req.params.postId)) return res.status(400).json({ error: 'invalid_id' })
    await unlikePost({ postId: req.params.postId, userId: req.user.id })
    const post = await getPostById(req.params.postId, { viewerUserId: req.user.id })
    if (!post) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, liked: false, likeCount: post.likeCount })
  })

  router.post('/:postId/comments', authRequired, writeLimiter, async (req, res) => {
    if (!isUuid(req.params.postId)) return res.status(400).json({ error: 'invalid_id' })
    const { body, parentCommentId } = req.body || {}
    if (typeof body !== 'string') return res.status(400).json({ error: 'invalid_body' })
    if (parentCommentId != null && !isUuid(parentCommentId)) return res.status(400).json({ error: 'invalid_parent' })
    const post = await getPostById(req.params.postId, { viewerUserId: req.user.id })
    if (!post) return res.status(404).json({ error: 'not_found' })
    try {
      const comment = await addComment({
        postId: req.params.postId,
        userId: req.user.id,
        body,
        parentCommentId: parentCommentId || null
      })

      // Notify the post author about the reply — unless they replied
      // to themselves, and dedupe against the @mention fanout (a
      // mention to the author already covers that case).
      const mentionedHandles = extractMentionUsernames(body)
      const mentionedUsers = await resolveMentions(mentionedHandles)
      const mentionedIds = new Set(mentionedUsers.map(u => u.id))
      if (post.authorId !== req.user.id && !mentionedIds.has(post.authorId)) {
        dispatchNotification({
          userId: post.authorId,
          kind: NOTIF.POST_REPLY,
          senderUserId: req.user.id,
          payload: { postId: post.id, commentId: comment.id, preview: body.slice(0, 120) }
        }).catch(err => console.warn('[feed] reply notify failed:', err.message))
      }
      // Notify the parent-comment author (if it's a thread reply, not
      // top-level, and not the same person who's being replied to via
      // the post author or a mention).
      if (parentCommentId) {
        const parent = await getCommentById(parentCommentId)
        if (parent && parent.authorId !== req.user.id && parent.authorId !== post.authorId && !mentionedIds.has(parent.authorId)) {
          dispatchNotification({
            userId: parent.authorId,
            kind: NOTIF.COMMENT_REPLY,
            senderUserId: req.user.id,
            payload: { postId: post.id, commentId: comment.id, preview: body.slice(0, 120) }
          }).catch(err => console.warn('[feed] comment-reply notify failed:', err.message))
        }
      }
      // Mentions
      for (const u of mentionedUsers) {
        if (u.id === req.user.id) continue
        dispatchNotification({
          userId: u.id,
          kind: NOTIF.MENTION,
          senderUserId: req.user.id,
          payload: { postId: post.id, commentId: comment.id, context: 'comment', preview: body.slice(0, 120) }
        }).catch(err => console.warn('[feed] comment mention notify failed:', err.message))
      }

      res.status(201).json({ comment })
    } catch (err) {
      if (err.message === 'empty_comment' || err.message === 'body_too_long') {
        return res.status(400).json({ error: err.message })
      }
      console.error('[feed] comment failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.delete('/comments/:commentId', authRequired, writeLimiter, async (req, res) => {
    if (!isUuid(req.params.commentId)) return res.status(400).json({ error: 'invalid_id' })
    const ok = await deleteComment({ commentId: req.params.commentId, userId: req.user.id })
    if (!ok) return res.status(404).json({ error: 'not_found' })
    res.status(204).end()
  })

  return router
}

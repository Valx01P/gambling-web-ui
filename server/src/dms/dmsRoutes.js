import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired } from '../auth/middleware.js'
import {
  ensureConversation,
  sendMessage,
  listConversations,
  listMessages,
  markConversationRead,
  countUnreadConversations,
  MAX_BODY_LENGTH
} from './dmsRepository.js'
import { findUserById } from '../users/userRepository.js'
import { pushToUser } from '../notifications/dispatcher.js'

const readLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip)
})
// Sending is the spam-prone path. 30/min is well above any honest
// conversation cadence (~one message every 2s) without enabling abuse.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 30,
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Slow down on messages.' }
})

function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export function dmsRoutes() {
  const router = Router()

  // GET /api/dms — conversation list, newest-message-first.
  router.get('/', authRequired, readLimiter, async (req, res) => {
    const [conversations, unread] = await Promise.all([
      listConversations(req.user.id, { limit: req.query.limit ? Number(req.query.limit) : undefined }),
      countUnreadConversations(req.user.id)
    ])
    res.setHeader('Cache-Control', 'no-store')
    res.json({ conversations, unread })
  })

  // GET /api/dms/unread-count — lightweight badge poll.
  router.get('/unread-count', authRequired, readLimiter, async (req, res) => {
    const unread = await countUnreadConversations(req.user.id)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ unread })
  })

  // GET /api/dms/:userId — messages with one specific user.
  router.get('/:userId', authRequired, readLimiter, async (req, res) => {
    const otherId = req.params.userId
    if (!isUuid(otherId)) return res.status(400).json({ error: 'invalid_user_id' })
    if (otherId === req.user.id) return res.status(400).json({ error: 'cannot_dm_self' })
    const other = await findUserById(otherId)
    if (!other) return res.status(404).json({ error: 'user_not_found' })
    const result = await listMessages(req.user.id, otherId, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      beforeId: typeof req.query.beforeId === 'string' ? req.query.beforeId : null
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      ...result,
      other: {
        id: other.id,
        username: other.username,
        displayName: other.display_name,
        avatarUrl: other.avatar_url
      }
    })
  })

  // POST /api/dms/:userId — send a message. Optional body.kind + metadata
  // for typed messages (table_invite etc).
  router.post('/:userId', authRequired, sendLimiter, async (req, res) => {
    const otherId = req.params.userId
    if (!isUuid(otherId)) return res.status(400).json({ error: 'invalid_user_id' })
    if (otherId === req.user.id) return res.status(400).json({ error: 'cannot_dm_self' })
    const { body, kind, metadata } = req.body || {}
    if (typeof body !== 'string' || body.length === 0) {
      return res.status(400).json({ error: 'invalid_body' })
    }
    if (body.length > MAX_BODY_LENGTH) {
      return res.status(400).json({ error: 'body_too_long', detail: `Max ${MAX_BODY_LENGTH} characters.` })
    }
    const otherUser = await findUserById(otherId)
    if (!otherUser) return res.status(404).json({ error: 'user_not_found' })
    try {
      const { conversation, message } = await sendMessage({
        fromUserId: req.user.id,
        toUserId: otherId,
        body,
        kind: typeof kind === 'string' ? kind : null,
        metadata: metadata && typeof metadata === 'object' ? metadata : null
      })

      // Live push the new message to the recipient + the sender's other
      // tabs (so a second laptop window shows the same chat updating).
      const pushPayload = {
        type: 'dm:new',
        data: { conversationId: conversation.id, message, otherId: req.user.id }
      }
      pushToUser(otherId, pushPayload)
      // For the sender, push with otherId = recipient so their own
      // inbox lifts the conversation to the top.
      pushToUser(req.user.id, {
        type: 'dm:new',
        data: { conversationId: conversation.id, message, otherId }
      })

      // Notifications intentionally OMIT DMs: the bell is reserved for
      // social signals (post replies, likes, follows, achievements). DMs
      // already have their own surfaces — the inbox icon's unread count,
      // the live `dm:new` push, and the conversation popover — so a bell
      // notification would just duplicate noise. Same for table invites
      // (which are DM-typed under the hood).

      res.status(201).json({ conversationId: conversation.id, message })
    } catch (err) {
      console.error('[dms] send failed:', err.message)
      if (err.message === 'body_too_long' || err.message === 'invalid_body' || err.message === 'invalid_parties') {
        return res.status(400).json({ error: err.message })
      }
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // POST /api/dms/:userId/read — mark every message FROM that user as
  // read. Returns the new unread-conversations count so the client can
  // refresh its badge without a follow-up GET.
  router.post('/:userId/read', authRequired, readLimiter, async (req, res) => {
    const otherId = req.params.userId
    if (!isUuid(otherId)) return res.status(400).json({ error: 'invalid_user_id' })
    const flipped = await markConversationRead(req.user.id, otherId)
    const unread = await countUnreadConversations(req.user.id)
    // Echo to other tabs so the badge drops everywhere.
    pushToUser(req.user.id, { type: 'dm:unread', data: { unread } })
    // Tell the original sender their messages have been read (delivery
    // receipt for the chat panel).
    if (flipped > 0) {
      pushToUser(otherId, { type: 'dm:read', data: { byUserId: req.user.id } })
    }
    res.json({ ok: true, flipped, unread })
  })

  return router
}

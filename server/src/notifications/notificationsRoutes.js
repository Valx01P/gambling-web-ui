import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired } from '../auth/middleware.js'
import {
  listForUser,
  countUnread,
  markRead,
  markAllRead
} from './notificationsRepository.js'
import { pushToUser } from './dispatcher.js'

// Read paths are cheap (indexed); the bell can poll for back-up after WS
// push, so the limit is generous. Write paths (mark-read) sit tighter
// since they're DB updates.
const readLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip)
})
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 60,
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip)
})

export function notificationsRoutes() {
  const router = Router()

  // GET /api/notifications — recent inbox, newest first. Paginate with
  // `beforeId` (cursor on the row's created_at). 30 per page is plenty
  // for a dropdown; full-page views can fetch more by passing `limit`.
  router.get('/', authRequired, readLimiter, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId : null
    const [notifications, unread] = await Promise.all([
      listForUser(req.user.id, { limit, beforeId }),
      countUnread(req.user.id)
    ])
    // No CDN cache — this is the most "right now" surface in the app.
    res.setHeader('Cache-Control', 'no-store')
    res.json({ notifications, unread })
  })

  // GET /api/notifications/unread-count — light pulse for the bell badge.
  // Used by the periodic poll fallback when a tab woke from background
  // and missed a WS push.
  router.get('/unread-count', authRequired, readLimiter, async (req, res) => {
    const unread = await countUnread(req.user.id)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ unread })
  })

  router.post('/:id/read', authRequired, writeLimiter, async (req, res) => {
    const ok = await markRead(req.params.id, req.user.id)
    const unread = await countUnread(req.user.id)
    // Echo the new count to the user's other tabs so a read on one tab
    // updates the badge on every tab without a poll cycle.
    pushToUser(req.user.id, {
      type: 'notif:unread',
      data: { unread }
    })
    res.json({ ok, unread })
  })

  router.post('/read-all', authRequired, writeLimiter, async (req, res) => {
    const flipped = await markAllRead(req.user.id)
    pushToUser(req.user.id, {
      type: 'notif:unread',
      data: { unread: 0 }
    })
    res.json({ ok: true, count: flipped })
  })

  return router
}

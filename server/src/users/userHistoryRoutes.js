// Profile-history endpoints — calendar view, day drill-down, hand export,
// and rivalries. Mounted under /api/users/me/* (see api/index.js).
//
// Read-only on the play data — writes happen on the WS-side of the game
// engine (PokerRoom._recordHumanHandResults). Tight rate limits because
// the export endpoint can stream large ranges; we don't want anyone
// pulling thousands of rows in a tight loop.

import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired } from '../auth/middleware.js'
import { findUserById } from './userRepository.js'
import {
  getPlayStats,
  listDailyActivity,
  listHandsForDay,
  iterateArchive,
  getTopRivals
} from './playHistoryRepository.js'
import { summarizeHand } from './handSummary.js'
import { countFollowsForUser, listFollows } from './followsRepository.js'

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Slow down — try again in a moment.' }
})

// Export is expensive (streaming N rows). Cap tightly. A user wanting more
// than 10 exports a minute is almost certainly a script.
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Export limit reached. Wait a minute and try again.' }
})

// Validate a YYYY-MM-DD string and return it normalized, or null. Postgres
// accepts the ISO date format directly, so we just guard the shape.
function parseDay(s) {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020 || y > 2200) return null
  return s
}

export function userHistoryRoutes() {
  const router = Router()

  // GET /api/users/me/summary — single-shot profile-page payload.
  // Bundles user + play stats + top rival + follow counts so the profile
  // screen renders in one round trip instead of 4-5 fetches.
  router.get('/summary', authRequired, readLimiter, async (req, res) => {
    const [user, stats, rivals, counts] = await Promise.all([
      findUserById(req.user.id),
      getPlayStats(req.user.id),
      getTopRivals(req.user.id, { limit: 1 }),
      countFollowsForUser(req.user.id)
    ])
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        elo: user.elo ?? 500,
        handsPlayed: user.hands_played ?? 0,
        handsWon: user.hands_won ?? 0,
        lastActiveAt: user.last_active_at,
        followersCount: counts.followers,
        followingCount: counts.following
      },
      stats,
      rival: rivals[0] || null
    })
  })

  // GET /api/users/me/follows?direction=following|followers&limit=N
  // Powers the small follow lists rendered on the profile page.
  router.get('/follows', authRequired, readLimiter, async (req, res) => {
    const direction = req.query?.direction === 'followers' ? 'followers' : 'following'
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50))
    const follows = await listFollows(req.user.id, { direction, limit })
    res.json({ direction, follows })
  })

  // GET /api/users/me/activity?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Daily summary list. Defaults to the trailing 90 days when no range is
  // supplied; max range is 365 days (matches the SQL LIMIT). Used by the
  // profile calendar to render which days had activity + the ELO trace.
  router.get('/activity', authRequired, readLimiter, async (req, res) => {
    const from = parseDay(req.query?.from) || null
    const to = parseDay(req.query?.to) || null
    const days = await listDailyActivity(req.user.id, { from, to })
    res.json({ days })
  })

  // GET /api/users/me/hands?day=YYYY-MM-DD&offset=N&limit=N
  // Paginated hands for a day, in time order. Default page = 40, max 200.
  // Each row includes a short `summary` (e.g. "Won — Full House, …") so
  // the calendar list can render without the client re-parsing cards.
  router.get('/hands', authRequired, readLimiter, async (req, res) => {
    const day = parseDay(req.query?.day)
    if (!day) return res.status(400).json({ error: 'invalid_day' })
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 40))
    const offset = Math.max(0, Number(req.query?.offset) || 0)
    const { hands, total } = await listHandsForDay(req.user.id, day, { limit, offset, viewerIsSelf: true })
    // Decorate each row with the headline summary. Synchronous; bounded
    // by `limit` (max 200 evaluations per request).
    for (const h of hands) {
      h.summary = summarizeHand(h)
    }
    res.json({ day, hands, total, offset, limit })
  })

  // GET /api/users/me/hands/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=jsonl|csv
  // Streams the user's hand archive between two dates. JSONL (newline-
  // delimited JSON) is the recommended format for ML/training datasets;
  // CSV is offered as a friendlier alternative for spreadsheet review.
  //
  // The user (or anyone with their auth token) can pull ALL their hands;
  // we don't expose other users' hands at any URL. Range cap = 366 days
  // to keep a single request bounded.
  router.get('/hands/export', authRequired, exportLimiter, async (req, res) => {
    const from = parseDay(req.query?.from) || null
    const to = parseDay(req.query?.to) || null
    const format = (req.query?.format || 'jsonl').toLowerCase()
    if (format !== 'jsonl' && format !== 'csv') {
      return res.status(400).json({ error: 'invalid_format' })
    }
    // Sanity cap on the range so a runaway request can't stream years.
    if (from && to) {
      const ms = new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')
      if (ms < 0 || ms > 366 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'range_too_large', detail: 'Max 366 days per export.' })
      }
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const baseName = `hands-${req.user.id.slice(0, 8)}-${stamp}`

    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.jsonl"`)
      // Page through the archive and write one JSON row per line. Stream
      // straight to the response — no full buffering — so a 10k-hand
      // export uses bounded server memory.
      try {
        for await (const hand of iterateArchive(req.user.id, {
          from: from ? `${from}T00:00:00Z` : null,
          to: to ? `${to}T23:59:59Z` : null
        })) {
          res.write(JSON.stringify({
            id: hand.id,
            playedAt: hand.playedAt,
            tableId: hand.tableId,
            chipsDelta: hand.chipsDelta,
            won: hand.won,
            wentToShowdown: hand.wentToShowdown,
            voluntarilyIn: hand.voluntarilyIn,
            foldedPreflop: hand.foldedPreflop,
            eloBefore: hand.eloBefore,
            eloAfter: hand.eloAfter,
            eloDelta: hand.eloDelta,
            data: hand.data
          }) + '\n')
        }
        res.end()
      } catch (err) {
        console.error('[history] jsonl export failed:', err)
        if (!res.headersSent) res.status(500).json({ error: 'export_failed' })
        else res.end()
      }
      return
    }

    // CSV — flat, no nested fields. The hole/board cards and action list
    // are encoded as compact strings so spreadsheet tools handle them.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`)
    res.write('id,playedAt,tableId,chipsDelta,won,wentToShowdown,voluntarilyIn,foldedPreflop,eloBefore,eloAfter,eloDelta,position,potBB,bigBlind,holeCards,boardCards,actions\n')
    try {
      for await (const hand of iterateArchive(req.user.id, {
        from: from ? `${from}T00:00:00Z` : null,
        to: to ? `${to}T23:59:59Z` : null
      })) {
        const d = hand.data || {}
        const hole = Array.isArray(d.hc) ? d.hc.join('|') : ''
        const board = Array.isArray(d.bd) ? d.bd.join('|') : ''
        const acts = Array.isArray(d.a) ? d.a.map(x => Array.isArray(x) ? x.join(':') : String(x)).join('|') : ''
        const row = [
          hand.id,
          new Date(hand.playedAt).toISOString(),
          csvEscape(hand.tableId),
          hand.chipsDelta,
          hand.won ? 1 : 0,
          hand.wentToShowdown ? 1 : 0,
          hand.voluntarilyIn ? 1 : 0,
          hand.foldedPreflop ? 1 : 0,
          hand.eloBefore,
          hand.eloAfter,
          hand.eloDelta,
          csvEscape(d.pos || ''),
          d.bb && d.pot ? Math.round(d.pot / d.bb) : '',
          d.bb || '',
          csvEscape(hole),
          csvEscape(board),
          csvEscape(acts)
        ].join(',')
        res.write(row + '\n')
      }
      res.end()
    } catch (err) {
      console.error('[history] csv export failed:', err)
      if (!res.headersSent) res.status(500).json({ error: 'export_failed' })
      else res.end()
    }
  })

  // GET /api/users/me/rivals?limit=5
  // Top opponents you're losing money to. Returns up to `limit` entries
  // (max 50), ordered worst-rivalry first.
  router.get('/rivals', authRequired, readLimiter, async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 5))
    const rivals = await getTopRivals(req.user.id, { limit })
    res.json({ rivals })
  })

  return router
}

// Minimal CSV escaper. Wraps in quotes if the field contains a comma,
// newline, or quote character, and escapes inner quotes by doubling them.
function csvEscape(value) {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

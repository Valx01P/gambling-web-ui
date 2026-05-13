// Public-facing user routes — anything keyed by a *target* userId rather
// than the authenticated /me. Two surfaces:
//   * Public profile slice  — what the seat-click popover shows.
//   * Follow / unfollow     — toggle the relationship from the viewer.
//
// Privacy gate: we never expose any user's userId unless they made it
// public somewhere (via "Play as YOU" at the table). The popover only
// opens with a userId the seat owner already published on the wire,
// so this route trusts the requested :userId at face value.

import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired, authOptional } from '../auth/middleware.js'
import { findUserById, findUserByUsername } from './userRepository.js'
import { listPublicBotsByOwner } from '../bots/botRepository.js'
import { dispatchNotification } from '../notifications/dispatcher.js'
import { KINDS as NOTIF } from '../notifications/notificationsRepository.js'
import {
  followUser,
  unfollowUser,
  isFollowing,
  countFollowsForUser
} from './followsRepository.js'
import { deriveStatus } from './presence.js'
import { deriveLuckProfile } from './luckStats.js'

// Public-profile reads are cheap (one indexed lookup + a count) but the
// popover can fire on every seat click, so cap to 120/min per viewer.
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Slow down — try again in a moment.' }
})

// Mutating follow actions are tighter — 30/min covers any honest user
// (rapid follow/unfollow toggling is rare); anything beyond is bot
// behavior that we'd rather block.
const followWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Too many follow updates. Wait a minute.' }
})

// Basic UUID shape check before we hit the DB. Stops obvious junk early.
function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

// Resolve a route param that may be either a UUID or a username (the
// public handle). Returns the full users row or null. Lets the same
// /users/:handle/* URL space work for either form — @-mention links use
// usernames, seat popovers use UUIDs.
async function resolveHandle(handle) {
  if (typeof handle !== 'string' || handle.length === 0) return null
  if (isUuid(handle)) return findUserById(handle)
  // Usernames are stored lowercased; tolerate any case on the wire.
  return findUserByUsername(handle.toLowerCase())
}

export function userPublicRoutes() {
  const router = Router()

  // GET /api/users/:userId/public
  // The seat-click popover's data source. Auth-optional — anonymous
  // viewers see the same public stats but `isFollowedByMe` is false.
  router.get('/:userId/public', authOptional, publicReadLimiter, async (req, res) => {
    // `:userId` is the historical name; this route now accepts a UUID
    // OR a username handle so @-mention links work via /users/{username}.
    const user = await resolveHandle(req.params.userId)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    const target = user.id

    const [counts, viewerFollows] = await Promise.all([
      countFollowsForUser(target),
      req.user?.id ? isFollowing(req.user.id, target) : Promise.resolve(false)
    ])

    const lastActiveMs = user.last_active_at ? new Date(user.last_active_at).getTime() : null
    const status = deriveStatus(target, lastActiveMs)

    const luck = deriveLuckProfile(user)
    res.json({
      user: {
        id: user.id,
        username: user.username || null,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        description: user.description ?? null,
        elo: user.elo ?? 500,
        handsPlayed: user.hands_played ?? 0,
        handsWon: user.hands_won ?? 0,
        // last-active is exposed but coarse — we don't surface anything
        // finer than the ISO timestamp; the client formats "5 minutes ago".
        lastActiveAt: user.last_active_at,
        status,                 // 'online' | 'recent' | 'offline'
        followersCount: counts.followers,
        followingCount: counts.following,
        isFollowedByMe: !!viewerFollows,
        isSelf: req.user?.id === user.id,
        // Luck snapshot — sideBetsWon is the headline counter; luckScore
        // is the 0-10 derived value. New users see 5 (neutral) until they
        // accumulate a few resolved events.
        luckScore: luck?.luckScore ?? 5,
        sideBetsWon: luck?.sideBetsWon ?? 0,
        sideBetsLost: luck?.sideBetsLost ?? 0,
        sideBetLongshotWins: luck?.sideBetLongshotWins ?? 0,
        sideBetChipPl: luck?.sideBetChipPl ?? 0,
        allInShowdowns: luck?.allInShowdowns ?? 0,
        allInUnderdogWins: luck?.allInUnderdogWins ?? 0
      }
    })
  })

  // GET /api/users/search?q=PREFIX
  // Type-ahead user lookup for the @-mention picker and the DM
  // "new conversation" search box. Matches against username (the
  // stable handle) and display_name (more discoverable). Returns up
  // to 10 results so the dropdown stays scannable.
  router.get('/search', authRequired, publicReadLimiter, async (req, res) => {
    const raw = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (raw.length < 2) return res.json({ users: [] })
    if (raw.length > 32) return res.status(400).json({ error: 'query_too_long' })
    const q = raw.toLowerCase()
    const { rows } = await import('../db/pool.js').then(m => m.query(
      `SELECT id, username, display_name, avatar_url
         FROM users
        WHERE LOWER(COALESCE(username, '')) LIKE $1
           OR LOWER(display_name) LIKE $1
        ORDER BY
          -- Exact-prefix matches on username rank higher.
          (LOWER(username) = $2) DESC,
          (LOWER(username) LIKE $2 || '%') DESC,
          username NULLS LAST,
          display_name
        LIMIT 10`,
      [`%${q}%`, q]
    ))
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      users: rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        avatarUrl: r.avatar_url
      }))
    })
  })

  // GET /api/users/:userId/public-bots
  // Public bots owned by the user — surfaced on the profile page so a
  // visitor can sit one of their bots at a table without bouncing to
  // the leaderboard and scrolling. Private bots (clones, neural) are
  // never returned regardless of who's asking.
  router.get('/:userId/public-bots', authOptional, publicReadLimiter, async (req, res) => {
    const user = await resolveHandle(req.params.userId)
    if (!user) return res.json({ bots: [] })
    const bots = await listPublicBotsByOwner(user.id)
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
    res.json({ bots })
  })

  // POST /api/users/:userId/follow
  // Idempotent — re-following is a no-op. Self-follow blocked.
  router.post('/:userId/follow', authRequired, followWriteLimiter, async (req, res) => {
    const target = req.params.userId
    if (!isUuid(target)) return res.status(400).json({ error: 'invalid_user_id' })
    if (target === req.user.id) return res.status(400).json({ error: 'cannot_follow_self' })
    const targetUser = await findUserById(target)
    if (!targetUser) return res.status(404).json({ error: 'user_not_found' })
    const wasNew = await followUser(req.user.id, target)
    // Notify the followee — but only on the actual new follow, not on
    // an idempotent re-follow (would spam them if a client retries).
    if (wasNew) {
      dispatchNotification({
        userId: target,
        kind: NOTIF.FOLLOW,
        senderUserId: req.user.id,
        payload: {}
      }).catch(err => console.warn('[follow-notif] failed:', err.message))
    }
    res.status(204).end()
  })

  // DELETE /api/users/:userId/follow
  router.delete('/:userId/follow', authRequired, followWriteLimiter, async (req, res) => {
    const target = req.params.userId
    if (!isUuid(target)) return res.status(400).json({ error: 'invalid_user_id' })
    await unfollowUser(req.user.id, target)
    res.status(204).end()
  })

  return router
}

// Daily + skin REST routes. Tiny surface — most state flows through the
// WS broadcasts already (Player.toJSON exposes dailyProgress / skinId /
// achievements on every room_update).
//
//   GET  /api/dailies/today        Anonymous OK. Returns the daily for
//                                  today's UTC date + maybe the caller's
//                                  in-DB progress if signed-in.
//   POST /api/me/skin              Auth required. Sets skin_id (0..10);
//                                  for skin_id 10 the custom_skin JSON
//                                  is validated and persisted alongside.

import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired, authOptional } from '../auth/middleware.js'
import { query } from '../db/pool.js'
import { getTodayDaily, todayDateKey } from './dailyPicker.js'
import { ACHIEVEMENTS } from '../achievements/catalog.js'

// Skin tiers: which lifetime-daily counts unlock each preset. Index 0 is
// the default and is always unlocked. Keep this list in lockstep with
// client/app/lib/skinPresets.js — the client renders the lock state.
// 2026-05: cosmetics are no longer gated by daily completions. All
// preset ids are open to everyone. The array is sized to length 12
// (slot 10 = custom gradient, slot 11 = custom solid color) so the
// index check below (`tier = SKIN_UNLOCK_TIERS[skinId]`) still
// rejects out-of-range ids with `undefined → bad_skin_id`.
const SKIN_UNLOCK_TIERS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

function publicDaily(daily, progress) {
  if (!daily) return null
  return {
    id: daily.id,
    title: daily.title,
    description: daily.description,
    target: daily.target,
    progress: progress || 0,
    completed: (progress || 0) >= daily.target
  }
}

export function dailiesRoutes() {
  const router = Router()

  router.get('/today', authOptional, async (req, res) => {
    const daily = getTodayDaily()
    if (!daily) return res.status(503).json({ error: 'no_daily' })

    let progress = 0
    let completed = false
    let lifetime = 0
    if (req.user?.id) {
      // Pull just the daily slice + lifetime count. If date_key !== today,
      // progress is 0 (yesterday's daily, fresh slate today).
      const { rows } = await query(
        `SELECT daily_date_key, daily_progress, daily_completed_at, dailies_completed
           FROM users WHERE id = $1`,
        [req.user.id]
      )
      const row = rows[0]
      if (row && row.daily_date_key === todayDateKey()) {
        progress = row.daily_progress || 0
        completed = !!row.daily_completed_at
          && new Date(row.daily_completed_at).toISOString().slice(0, 10) === todayDateKey()
      }
      lifetime = row?.dailies_completed || 0
    }

    res.json({
      daily: publicDaily(daily, progress),
      dateKey: todayDateKey(),
      lifetime,
      unlockTiers: SKIN_UNLOCK_TIERS
    })
  })

  // List of every achievement the catalog knows about, with the caller's
  // unlock state. Used by the profile trophies grid. Auth-optional so
  // anonymous users see the catalog (locked) and can browse what's there.
  router.get('/achievements', authOptional, async (req, res) => {
    let owned = new Set()
    if (req.user?.id) {
      const { rows } = await query(`SELECT achievements FROM users WHERE id = $1`, [req.user.id])
      const list = rows[0]?.achievements
      if (Array.isArray(list)) owned = new Set(list)
    }
    res.json({
      achievements: ACHIEVEMENTS.map(a => ({
        id: a.id,
        title: a.title,
        blurb: a.blurb,
        unlocked: owned.has(a.id)
      }))
    })
  })

  // Skin selection. The client validates against its presets list; the
  // server re-validates the id range and shape of any custom payload.
  // Two custom shapes coexist:
  //   slot 10 → { colors: ['#hex', '#hex', ...], direction: 'to right' }
  //   slot 11 → { color: '#hex' }   (solid, no gradient)
  // The customSkin column is JSONB so it stores either shape. The
  // client's resolveSkinCss branches on skinId to pick the renderer.
  router.post('/me/skin', authRequired, async (req, res) => {
    const skinId = Math.max(0, Math.min(11, Math.floor(Number(req.body?.skinId))))
    if (!Number.isFinite(skinId)) return res.status(400).json({ error: 'bad_skin_id' })

    // Unlock gate: server-side validation of the tier requirement so the
    // client can't sneak a higher-tier preset before they've earned it.
    const { rows } = await query(`SELECT dailies_completed FROM users WHERE id = $1`, [req.user.id])
    const completed = rows[0]?.dailies_completed || 0
    const tier = SKIN_UNLOCK_TIERS[skinId]
    if (tier === undefined) return res.status(400).json({ error: 'bad_skin_id' })
    if (completed < tier) return res.status(403).json({ error: 'skin_locked', requires: tier })

    let custom = null
    if (skinId === 10) {
      const colors = Array.isArray(req.body?.colors)
        ? req.body.colors.filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)).slice(0, 3)
        : []
      const direction = typeof req.body?.direction === 'string' && req.body.direction.length <= 16
        ? req.body.direction
        : 'to right'
      if (colors.length < 2) return res.status(400).json({ error: 'need_two_colors' })
      custom = { colors, direction }
    } else if (skinId === 11) {
      const color = typeof req.body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color)
        ? req.body.color
        : null
      if (!color) return res.status(400).json({ error: 'need_color' })
      custom = { color }
    }

    await query(
      `UPDATE users SET skin_id = $2, custom_skin = $3::jsonb WHERE id = $1`,
      [req.user.id, skinId, custom ? JSON.stringify(custom) : null]
    )
    res.json({ skinId, customSkin: custom })
  })

  return router
}

// Achievement engine. Two kinds of triggers per catalog entry:
//   • Instant: `unlock(event)` returns true on the qualifying hand. The
//     id is added to the user's set immediately.
//   • Cumulative: `onEvent(player, event)` mutates a private counter on
//     the player object (e.g. `_raisesLifetime`); `cumulative(player)`
//     reports the current value; when it crosses `target`, the achievement
//     unlocks.
//
// Cumulative counters live on the in-memory Player. They reset on
// disconnect — that's intentional for "streak"-style achievements like
// Nit and Heater. The flag itself, once unlocked, persists in the DB
// `achievements` JSONB column so the trophy stays on the profile.

import { query } from '../db/pool.js'
import { ACHIEVEMENTS } from './catalog.js'
import { dispatchNotification } from '../notifications/dispatcher.js'
import { KINDS as NOTIF } from '../notifications/notificationsRepository.js'

export function evaluateAchievements(player, event) {
  if (!player || player.isBot || !event) return
  const owned = new Set(player.achievements || [])
  const newlyUnlocked = []

  for (const ach of ACHIEVEMENTS) {
    if (owned.has(ach.id)) continue

    // Cumulative path: tick the counter THEN check if the threshold was
    // crossed. Some entries (Nit) want both updating AND a per-event
    // reset path, so we always run onEvent if it exists.
    if (typeof ach.onEvent === 'function') {
      try { ach.onEvent(player, event) }
      catch (err) { console.warn('[ach] onEvent threw for', ach.id, err.message); continue }
    }
    if (typeof ach.cumulative === 'function' && typeof ach.target === 'number') {
      const v = ach.cumulative(player) || 0
      if (v >= ach.target) {
        newlyUnlocked.push(ach.id)
        owned.add(ach.id)
        continue
      }
    }

    // Instant path.
    if (typeof ach.unlock === 'function') {
      try {
        if (ach.unlock(event)) {
          newlyUnlocked.push(ach.id)
          owned.add(ach.id)
        }
      } catch (err) {
        console.warn('[ach] unlock threw for', ach.id, err.message)
      }
    }
  }

  if (newlyUnlocked.length === 0) return
  player.achievements = [...owned]
  if (player.userId) {
    persistAchievements(player.userId, player.achievements).catch(err =>
      console.warn('[ach] persist failed:', err.message)
    )
  }
  // Push a notification so the client can pop a toast per unlock. Uses
  // the existing "achievement" message type that AchievementToast already
  // listens for.
  if (typeof player.send === 'function') {
    for (const id of newlyUnlocked) {
      player.send({ type: 'achievement', data: { achievementId: id, kind: 'trophy' } })
    }
  }
  // Persist a bell row per unlock so the achievement also appears in the
  // notifications dropdown (the toast is ephemeral; the bell entry stays
  // until dismissed). Self-dispatch — no senderUserId.
  if (player.userId) {
    for (const id of newlyUnlocked) {
      dispatchNotification({
        userId: player.userId,
        kind: NOTIF.ACHIEVEMENT,
        senderUserId: null,
        payload: { achievementId: id }
      }).catch(err => console.warn('[ach] notify failed:', err.message))
    }
  }
}

async function persistAchievements(userId, ids) {
  await query(
    `UPDATE users SET achievements = $2::jsonb WHERE id = $1`,
    [userId, JSON.stringify(ids)]
  )
}

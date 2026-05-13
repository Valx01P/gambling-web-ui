// Notification + DM live-push glue. Imported by feature code that needs
// to "tell user X about Y in real time"; configured once at boot by
// WebSocketServer so it has a handle to the playerManager.
//
// The DB write is always the source of truth. WS push is a best-effort
// optimization — if the user is offline (no open WS), they'll see the
// notification on next /api/notifications fetch when they come back.

let playerManagerRef = null

export function configureDispatcher(playerManager) {
  playerManagerRef = playerManager
}

// Push a typed event to every open WS connection a given userId has.
// Returns the count of sockets we pushed to; 0 means the user is
// offline (don't sweat it — DB row still exists).
export function pushToUser(userId, message) {
  if (!playerManagerRef || !userId || !message) return 0
  const targets = playerManagerRef.getPlayersByUserId(userId)
  let sent = 0
  for (const p of targets) {
    try { p.send(message); sent++ }
    catch (err) { console.warn('[dispatcher] push failed:', err.message) }
  }
  return sent
}

// Convenience: persist a notification row AND push a live update in one
// call. Feature code (post-reply, follow, DM, table-invite) hits this so
// it doesn't have to remember the two-step ritual. Failures are caught
// here so the caller doesn't have to wrap; logged + returned for opt-in
// surfacing.
//
// We re-import lazily to dodge the circular-import shape (this module is
// imported by routes that share its repository).
export async function dispatchNotification({ userId, kind, payload, senderUserId = null }) {
  if (!userId) return null
  try {
    const { createNotification } = await import('./notificationsRepository.js')
    const notif = await createNotification({ userId, kind, payload, senderUserId })
    pushToUser(userId, { type: 'notif:new', data: notif })
    return notif
  } catch (err) {
    console.warn('[dispatcher] persist failed:', err.message)
    return null
  }
}

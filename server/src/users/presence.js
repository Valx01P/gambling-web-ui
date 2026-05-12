// In-memory presence registry. The DB's `users.last_active_at` is the
// durable fallback ("seen 12 minutes ago") — this module answers the
// liveness question ("is their WS open right now?") without hitting the DB.
//
// Two maps: userId → Set<playerId> for fast online checks, and playerId
// → userId for the reverse lookup needed when a WS disconnects. Both are
// kept in lockstep by track() / untrack(); the rest of the codebase
// reads via isOnline() / lastSeen() and never mutates directly.

const _userToPlayers = new Map()
const _playerToUser = new Map()
// Best-effort last-seen for users we've seen in this process. Survives a
// disconnect (so "left 30s ago" is computable without a DB read) but not
// a server restart — falls back to users.last_active_at then.
const _lastSeen = new Map()

// `playerId` here is the WS player id (not the userId). A signed-in user
// may have multiple open tabs → multiple playerIds → one userId.
export function track(userId, playerId) {
  if (!userId || !playerId) return
  // Defensive: if this playerId was already mapped to a different user
  // (rare, e.g. a re-auth on the same socket), untrack the prior first.
  const previousUser = _playerToUser.get(playerId)
  if (previousUser && previousUser !== userId) untrack(playerId)
  _playerToUser.set(playerId, userId)
  let set = _userToPlayers.get(userId)
  if (!set) { set = new Set(); _userToPlayers.set(userId, set) }
  set.add(playerId)
  _lastSeen.set(userId, Date.now())
}

export function untrack(playerId) {
  if (!playerId) return
  const userId = _playerToUser.get(playerId)
  if (!userId) return
  _playerToUser.delete(playerId)
  const set = _userToPlayers.get(userId)
  if (set) {
    set.delete(playerId)
    if (set.size === 0) _userToPlayers.delete(userId)
  }
  _lastSeen.set(userId, Date.now())
}

export function isOnline(userId) {
  if (!userId) return false
  const set = _userToPlayers.get(userId)
  return !!(set && set.size > 0)
}

// Returns the most recent in-process last-seen timestamp (ms epoch) if
// available, else null. Callers fall back to users.last_active_at.
export function lastSeenInProcess(userId) {
  if (!userId) return null
  return _lastSeen.get(userId) || null
}

// Combine the in-memory + DB signals into a Discord-style status.
// `dbLastActiveMs` is the users.last_active_at column converted to ms.
// Returns 'online' | 'recent' | 'offline'.
//   online:  WS open right now
//   recent:  last activity within RECENT_WINDOW_MS (default 10 min)
//   offline: older than that
const RECENT_WINDOW_MS = 10 * 60 * 1000
export function deriveStatus(userId, dbLastActiveMs = null) {
  if (isOnline(userId)) return 'online'
  const inProc = lastSeenInProcess(userId)
  const best = Math.max(inProc || 0, dbLastActiveMs || 0)
  if (best && Date.now() - best <= RECENT_WINDOW_MS) return 'recent'
  return 'offline'
}

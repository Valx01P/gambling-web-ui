'use client'

import { useSyncExternalStore } from 'react'
import { api, getStoredToken } from './api'

// Per-window zoom percentages. Each FloatingWindow with a storageKey
// reads/writes through this store instead of touching localStorage
// directly, so the value is shared by every mount and (for signed-in
// users) persisted to the DB via /api/auth/me/window-zoom.
//
// Anon users: localStorage only — keyed under `${storageKey}:zoom`.
// Signed-in users: localStorage (fast first paint) + DB (truth of
// record). Hydration is a two-phase dance same as feltColor: local
// first, server overwrite when /auth/me lands.

const ZOOM_DEFAULT = 100
const ZOOM_MIN = 50
const ZOOM_MAX = 200

function zoomKey(storageKey) {
  return storageKey ? `${storageKey}:zoom` : null
}

function loadLocal(storageKey) {
  if (typeof window === 'undefined' || !storageKey) return ZOOM_DEFAULT
  try {
    const raw = window.localStorage.getItem(zoomKey(storageKey))
    if (raw == null) return ZOOM_DEFAULT
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) return ZOOM_DEFAULT
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n))
  } catch { return ZOOM_DEFAULT }
}

function saveLocal(storageKey, zoom) {
  if (typeof window === 'undefined' || !storageKey) return
  try {
    if (zoom === ZOOM_DEFAULT) window.localStorage.removeItem(zoomKey(storageKey))
    else window.localStorage.setItem(zoomKey(storageKey), String(zoom))
  } catch {}
}

// ─── Module-level store ──────────────────────────────────────────────
// Map of storageKey → percent. We populate lazily — a window with no
// entry resolves to ZOOM_DEFAULT. Reference equality on _state is
// preserved across no-op writes so useSyncExternalStore doesn't re-
// render every consumer for every other window's update.
let _state = new Map()
const _listeners = new Set()
function _emit() { for (const l of _listeners) l() }
function _subscribe(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

// useSyncExternalStore's getSnapshot must return the same reference if
// nothing changed. We return the resolved number for ONE key per hook
// instance, so a stable closure does the comparison for us.
function _snapshotFor(storageKey) {
  return _state.get(storageKey) ?? ZOOM_DEFAULT
}

export function useWindowZoom(storageKey) {
  return useSyncExternalStore(
    _subscribe,
    () => _snapshotFor(storageKey),
    () => ZOOM_DEFAULT
  )
}

export function getWindowZoom(storageKey) {
  return _snapshotFor(storageKey)
}

// ─── Server persistence (per-key, debounced) ─────────────────────────
// One pending POST per key — coalesce rapid +/- clicks so we don't
// blast the endpoint. The /me limiter would let it through but a tap
// dance produces 5 writes that all collapse to the same final value.
const _pendingTimers = new Map()
function _persistToServerLater(storageKey, zoom) {
  if (typeof window === 'undefined' || !storageKey) return
  if (!getStoredToken()) return
  const existing = _pendingTimers.get(storageKey)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    _pendingTimers.delete(storageKey)
    api.setWindowZoom({ key: storageKey, zoom }).catch(err => {
      // Best-effort — local state already updated. Just log so a real
      // failure (auth lost, server down) is visible during dev.
      if (typeof console !== 'undefined') {
        console.warn('[window-zoom] server save failed:', err?.message)
      }
    })
  }, 600)
  _pendingTimers.set(storageKey, timer)
}

// ─── Setter ──────────────────────────────────────────────────────────
export function setWindowZoom(storageKey, zoom) {
  if (!storageKey) return
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom)))
  const prev = _state.get(storageKey) ?? ZOOM_DEFAULT
  if (prev === clamped) return
  // Replace the Map so consumers using its identity see a change.
  const next = new Map(_state)
  if (clamped === ZOOM_DEFAULT) next.delete(storageKey)
  else next.set(storageKey, clamped)
  _state = next
  saveLocal(storageKey, clamped)
  _emit()
  _persistToServerLater(storageKey, clamped === ZOOM_DEFAULT ? null : clamped)
}

// ─── Hydration ───────────────────────────────────────────────────────
// hydrateOneFromLocal: read a single window's local value lazily on
// mount so the cold-start render uses the user's last pick. Called by
// FloatingWindow inside its first useEffect.
export function hydrateOneFromLocal(storageKey) {
  if (!storageKey) return
  if (_state.has(storageKey)) return // already populated by server or prior mount
  const local = loadLocal(storageKey)
  if (local === ZOOM_DEFAULT) return
  const next = new Map(_state)
  next.set(storageKey, local)
  _state = next
  _emit()
}

// hydrateFromServerUser: called when /auth/me lands with windowZooms.
// Replaces in-memory state with the server map (merged onto whatever
// is already there — the server is authoritative for keys it has, but
// we keep any local-only keys the user has touched in this session).
export function hydrateFromServerUser(user) {
  if (!user) return
  const serverMap = user.windowZooms
  if (!serverMap || typeof serverMap !== 'object') return
  const next = new Map(_state)
  let changed = false
  for (const [key, val] of Object.entries(serverMap)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) continue
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(val)))
    if (next.get(key) !== clamped) {
      next.set(key, clamped)
      saveLocal(key, clamped)
      changed = true
    }
  }
  if (changed) {
    _state = next
    _emit()
  }
}

export { ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX }

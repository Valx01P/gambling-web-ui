'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { api, getStoredToken } from './api'

// Site-wide felt color preference. Source of truth for:
//   • the poker table's felt gradient (radial center → mid → edge → vignette)
//   • the FuzzyBackground noise tint (bgRgb) on every other page
//   • the felt-color picker UI (Tools menu)
//
// Was originally local state inside poker/page.jsx that only applied
// while /poker was mounted. Promoted to a shared module so every route
// picks up the user's pick (the "this is your way to customize it" — the
// home page, feed, profile pages, /poker/bots all tint to match) and so
// the choice can persist server-side for signed-in users (DB column
// felt_color_id + felt_custom_colors, migration 031).
//
// Anonymous users: localStorage only.
// Signed-in users: localStorage (fast first paint) + DB (truth of record).

export const TABLE_COLOR_PALETTES = [
  { id: 'emerald',  label: 'Emerald',  swatch: '#14472c', center: '#1a5c3a', mid: '#14472c', edge: '#0f3521', vignette: '#0a2a18', border: 'rgba(6, 78, 59, 0.4)',   bgRgb: [31, 94, 64] },
  { id: 'forest',   label: 'Forest',   swatch: '#0a3d2a', center: '#0f4d35', mid: '#0a3d2a', edge: '#062a1d', vignette: '#031711', border: 'rgba(10, 61, 42, 0.45)', bgRgb: [14, 60, 40] },
  { id: 'sapphire', label: 'Sapphire', swatch: '#1e3a8a', center: '#2845b3', mid: '#1e3a8a', edge: '#172a66', vignette: '#0c1838', border: 'rgba(30, 58, 138, 0.4)', bgRgb: [22, 38, 96] },
  { id: 'crimson',  label: 'Crimson',  swatch: '#7a1d1d', center: '#a31d1d', mid: '#7a1d1d', edge: '#591212', vignette: '#3a0a0a', border: 'rgba(127, 29, 29, 0.4)', bgRgb: [92, 22, 22] },
  { id: 'royal',    label: 'Royal',    swatch: '#4c1d95', center: '#6324b8', mid: '#4c1d95', edge: '#371565', vignette: '#1f0a3d', border: 'rgba(76, 29, 149, 0.4)', bgRgb: [60, 23, 110] },
]

export const DEFAULT_TABLE_COLOR_ID = 'emerald'
export const TABLE_COLOR_STORAGE_KEY = 'poker_table_felt_color'
export const TABLE_CUSTOM_COLORS_KEY = 'poker_table_custom_colors'
export const TABLE_CUSTOM_SLOTS = 5
export const TABLE_CUSTOM_PREFIX = 'custom-'

const BUILTIN_IDS = new Set(TABLE_COLOR_PALETTES.map(p => p.id))

// Build a gradient stop set + bg tint from a user-picked hex. Mirrors
// the proportions used in the hand-tuned built-ins (center ~1.18×,
// edge ~0.72×, vignette ~0.45×). The bg noise sits a touch darker than
// the table itself so the page reads as one coherent tone.
function hexToRgb(hex) {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex || '')
  if (!m) return [20, 71, 44]
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
  return '#' + [r, g, b].map(n => clamp(n).toString(16).padStart(2, '0')).join('')
}
function scaleRgb(rgb, factor) {
  return rgb.map(c => Math.max(0, Math.min(255, c * factor)))
}
export function derivePaletteFromHex(hex, id, label) {
  const rgb = hexToRgb(hex)
  const center = scaleRgb(rgb, 1.18)
  const mid = rgb
  const edge = scaleRgb(rgb, 0.72)
  const vignette = scaleRgb(rgb, 0.45)
  const bg = scaleRgb(rgb, 0.72).map(Math.round)
  return {
    id, label: label || 'Custom',
    swatch: rgbToHex(...mid),
    center: rgbToHex(...center),
    mid: rgbToHex(...mid),
    edge: rgbToHex(...edge),
    vignette: rgbToHex(...vignette),
    border: `rgba(${rgb.join(', ')}, 0.4)`,
    bgRgb: bg,
  }
}

// Resolve any id (built-in or custom-N) to a fully-derived palette.
// Unknown ids or empty custom slots fall back to the default emerald
// palette so a stale storage payload can't dead-end the page.
export function tableColorPalette(id, customColors) {
  if (typeof id === 'string' && id.startsWith(TABLE_CUSTOM_PREFIX)) {
    const idx = parseInt(id.slice(TABLE_CUSTOM_PREFIX.length), 10)
    const entry = Array.isArray(customColors) ? customColors[idx] : null
    if (entry?.hex) return derivePaletteFromHex(entry.hex, id, entry.label || `Custom ${idx + 1}`)
    return TABLE_COLOR_PALETTES[0]
  }
  return TABLE_COLOR_PALETTES.find(p => p.id === id) || TABLE_COLOR_PALETTES[0]
}

function isValidColorId(id) {
  if (typeof id !== 'string') return false
  if (BUILTIN_IDS.has(id)) return true
  if (/^custom-[0-4]$/.test(id)) return true
  return false
}

function sanitizeCustomColors(arr) {
  if (!Array.isArray(arr)) return []
  return arr
    .slice(0, TABLE_CUSTOM_SLOTS)
    .map((e, i) => {
      if (!e || typeof e.hex !== 'string') return null
      const hex = e.hex.startsWith('#') ? e.hex : `#${e.hex}`
      if (!/^#[a-f0-9]{6}$/i.test(hex)) return null
      const label = typeof e.label === 'string' && e.label.length <= 24
        ? e.label
        : `Custom ${i + 1}`
      return { hex, label }
    })
    .filter(Boolean)
}

// ─── Module-level store + pub/sub ────────────────────────────────────
// useSyncExternalStore wants stable references for unchanged reads.
// `_state` is replaced (not mutated) every time something actually
// changes, so reference equality in the hook does the right thing.
let _state = { tableColorId: DEFAULT_TABLE_COLOR_ID, customColors: [] }
const _listeners = new Set()
function _emit() { for (const l of _listeners) l() }
function _subscribe(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}
function _get() { return _state }
// SSR path: there's no felt preference available before hydration, so
// give every server-rendered tree the default and let the client
// re-render with the real value once localStorage / /auth/me resolves.
function _getServer() { return _state }

export function getFeltState() { return _state }
export function getFeltPalette() {
  return tableColorPalette(_state.tableColorId, _state.customColors)
}

export function useFeltColor() {
  const state = useSyncExternalStore(_subscribe, _get, _getServer)
  const palette = useMemo(
    () => tableColorPalette(state.tableColorId, state.customColors),
    [state.tableColorId, state.customColors]
  )
  return {
    tableColorId: state.tableColorId,
    customColors: state.customColors,
    palette,
    setTableColorId,
    setCustomColors,
  }
}

// ─── Server persistence (debounced) ──────────────────────────────────
// Coalesce rapid changes (e.g. dragging the native color picker fires
// `change` continuously) into one POST. ~600ms feels invisible to the
// user but avoids hammering the API.
let _persistTimer = null
function _persistToServerLater() {
  if (typeof window === 'undefined') return
  // Only attempt the round-trip when we have a JWT cookie/token —
  // anon users are localStorage-only. The api layer enforces this too,
  // but checking up front skips a pointless fetch on every change.
  if (!getStoredToken()) return
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    api.setFelt({
      colorId: _state.tableColorId,
      customColors: _state.customColors,
    }).catch(err => {
      // Don't surface — felt color is best-effort. Log so a real
      // failure (auth lost, server down) is visible in devtools.
      if (typeof console !== 'undefined') {
        console.warn('[felt-color] server save failed:', err?.message)
      }
    })
  }, 600)
}

// ─── Setters (sync) ──────────────────────────────────────────────────
export function setTableColorId(id) {
  if (!isValidColorId(id)) return
  if (id === _state.tableColorId) return
  _state = { tableColorId: id, customColors: _state.customColors }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(TABLE_COLOR_STORAGE_KEY, id) } catch {}
  }
  _emit()
  _persistToServerLater()
}

export function setCustomColors(next) {
  const sanitized = sanitizeCustomColors(next)
  // Stringify-compare so we skip a needless emit when callers pass an
  // identical array (e.g. the felt picker's edit flow re-emits the
  // current colors on every render with no diff).
  if (JSON.stringify(sanitized) === JSON.stringify(_state.customColors)) return
  _state = { tableColorId: _state.tableColorId, customColors: sanitized }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(TABLE_CUSTOM_COLORS_KEY, JSON.stringify(sanitized)) } catch {}
  }
  _emit()
  _persistToServerLater()
}

// ─── Hydration ───────────────────────────────────────────────────────
// Two phases:
//   1. hydrateFromLocalStorage() — called once on first client mount.
//      Reads the user's last-known choice instantly so the page paints
//      with the right tint before /auth/me even resolves.
//   2. hydrateFromServerUser(user) — called when useAuth's /auth/me
//      result lands. Overrides localStorage with the DB value if the
//      user has one saved, then mirrors it back to localStorage so the
//      next reload is fast again.

let _hydratedFromStorage = false
export function hydrateFromLocalStorage() {
  if (typeof window === 'undefined' || _hydratedFromStorage) return
  _hydratedFromStorage = true
  let colorId = DEFAULT_TABLE_COLOR_ID
  let customColors = []
  try {
    const savedId = window.localStorage.getItem(TABLE_COLOR_STORAGE_KEY)
    if (savedId && isValidColorId(savedId)) colorId = savedId
  } catch {}
  try {
    const raw = window.localStorage.getItem(TABLE_CUSTOM_COLORS_KEY)
    if (raw) customColors = sanitizeCustomColors(JSON.parse(raw))
  } catch {}
  // Only emit if we actually moved off the default — avoids a stray
  // re-render on first paint for the (very common) "user hasn't picked
  // anything yet" case.
  if (colorId !== _state.tableColorId || customColors.length > 0) {
    _state = { tableColorId: colorId, customColors }
    _emit()
  }
}

export function hydrateFromServerUser(user) {
  if (!user) return
  const serverId = user.feltColorId
  const serverCustom = user.feltCustomColors
  // null in the DB column means "user never picked" — leave whatever
  // localStorage hydrated as the active state. Don't downgrade a local
  // pick just because the server happens to have nothing saved.
  if (serverId == null && serverCustom == null) return
  let nextId = _state.tableColorId
  let nextCustom = _state.customColors
  if (typeof serverId === 'string' && isValidColorId(serverId)) {
    nextId = serverId
  }
  if (Array.isArray(serverCustom)) {
    nextCustom = sanitizeCustomColors(serverCustom)
  }
  if (nextId === _state.tableColorId &&
      JSON.stringify(nextCustom) === JSON.stringify(_state.customColors)) {
    return
  }
  _state = { tableColorId: nextId, customColors: nextCustom }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(TABLE_COLOR_STORAGE_KEY, nextId)
      window.localStorage.setItem(TABLE_CUSTOM_COLORS_KEY, JSON.stringify(nextCustom))
    } catch {}
  }
  _emit()
}

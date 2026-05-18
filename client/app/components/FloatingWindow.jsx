'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  useWindowZoom,
  setWindowZoom,
  hydrateOneFromLocal,
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
} from '../lib/windowZooms'

// Reusable PiP-style floating window chrome. Drives drag, resize
// (top-left + bottom-right grips), position + size persistence,
// viewport clamping, click-to-raise z-ordering, per-window content
// zoom, and the title bar (drag handle + back/zoom/refresh/close).
// The body is whatever children you pass — markets, the feed, the
// mini table, anything that should be detachable from the page chrome.
//
// `storageKey` namespaces the persistence so two open windows don't
// step on each other's saved layouts. Pass null to opt out of
// persistence entirely (purely session-local).
//
// Cross-window features (Tab cycle, H hide-all) are implemented via a
// module-level registry that every mounted FloatingWindow joins. The
// poker page subscribes to it for the keyboard shortcuts.

const MIN_W = 260
const MIN_H = 240
const TITLE_H = 32
const BASE_Z = 260
// Click-raise floor: above the docked Tools menu (z-[800] in
// poker/page.jsx) so any pointerdown inside a floating window pops it
// in front of the menu. New mounts still use BASE_Z so a freshly-
// opened window keeps its natural slot — only the user's click bumps
// it above the docked chrome.
const RAISED_BASE_Z = 900

// Module-level counter so every pointerdown anywhere in a window
// bumps its z-index above every other window. Mirrors the Windows /
// macOS desktop "click to focus" convention.
let _floatingZSeq = 0
function nextZ() { _floatingZSeq += 1; return BASE_Z + _floatingZSeq }
function nextRaisedZ() { _floatingZSeq += 1; return RAISED_BASE_Z + _floatingZSeq }
// Exposed for non-FloatingWindow surfaces (e.g. the docked Tools
// menu) that want click-to-front parity with floating windows. Shares
// the same counter so relative ordering between the menu and the
// windows stays monotonic.
export function bumpRaisedZ() { return nextRaisedZ() }

// ─── Window registry (Tab cycle, Cmd shortcuts, H hide-all) ────────
// Each mounted FloatingWindow registers an entry. Three data
// structures hang off it:
//   * `_registry` — id → { raise, close, z, title }. The functional
//     handles the rest of the registry calls into.
//   * `_focusStack` — list of ids in focus order, most-recent at the
//     END. Lets Cmd+A jump back to the previously focused window
//     (Alt-Tab style toggle) without us having to invent a second
//     state variable.
//   * `_registrationOrder` — stable left-to-right list of currently
//     open ids, in the order they first opened. Drives Cmd+←/Cmd+→
//     so navigation feels predictable even as windows re-raise each
//     other in z.
// Tab still walks z-order (bottom-most first), so it remains a
// "cycle through the stack" gesture rather than an ordered traversal.
const _registry = new Map()
let _focusStack = []
let _registrationOrder = []
const _registrySubs = new Set()
let _hiddenAll = false
const _hiddenSubs = new Set()

function notifyRegistry() { _registrySubs.forEach(fn => { try { fn() } catch {} }) }
function notifyHidden() { _hiddenSubs.forEach(fn => { try { fn() } catch {} }) }

function recordFocus(id) {
  if (!id || !_registry.has(id)) return
  const top = _focusStack[_focusStack.length - 1]
  if (top === id) return
  _focusStack = _focusStack.filter(x => x !== id)
  _focusStack.push(id)
}

function registerWindow(id, api) {
  _registry.set(id, api)
  if (!_registrationOrder.includes(id)) _registrationOrder.push(id)
  // A newly opened window is on top of the z-stack (we just called
  // nextZ() to seed it), so it's also the focused one.
  recordFocus(id)
  notifyRegistry()
}
function unregisterWindow(id) {
  _registry.delete(id)
  _focusStack = _focusStack.filter(x => x !== id)
  _registrationOrder = _registrationOrder.filter(x => x !== id)
  notifyRegistry()
}
function updateWindowZ(id, z) {
  const entry = _registry.get(id)
  if (entry) entry.z = z
  // Any z bump = focus change. Tab / Cmd+← / Cmd+→ / a click all
  // route through here, so the focus stack stays in sync without
  // each callsite having to remember to update it.
  recordFocus(id)
}
function updateWindowPos(id, pos) {
  const entry = _registry.get(id)
  if (entry) entry.pos = pos
}

// When a window opens without a remembered layout, walk every other
// open window and step the new position down by TITLE_H for each
// existing window that already occupies the proposed slot. This gives
// the cascade-style stair-step (every header visible just below the
// previous one) instead of every fresh window stacking on top of the
// previous default. Wraps around if the cascade would run off the
// bottom of the viewport so the chain never disappears.
function pickCascadedPos(defaultPos, w, h) {
  if (typeof window === 'undefined') return defaultPos
  const vw = window.innerWidth
  const vh = window.innerHeight
  const taken = []
  for (const entry of _registry.values()) {
    if (entry?.pos) taken.push(entry.pos)
  }
  const overlaps = (a, b) => Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4
  let { x, y } = defaultPos
  let safety = 32
  while (safety-- > 0) {
    if (!taken.some(p => overlaps(p, { x, y }))) break
    y += TITLE_H
    // Cascading off the bottom: wrap to the top of the cascade band.
    if (y + TITLE_H * 2 > vh - 16) y = defaultPos.y
    // Cascading off the right (very tall stack on a narrow viewport):
    // give up and accept the first proposed slot — the user can still
    // drag from there.
    if (x + w > vw - 16) { x = defaultPos.x; y = defaultPos.y; break }
  }
  return { x, y }
}

export function cycleNextFloatingWindow() {
  if (_hiddenAll) return false
  if (_registry.size === 0) return false
  // Cycle through ALL open windows, not just the top two. Raising the
  // BOTTOM-most window each press makes repeated Tab walk down the
  // stack: 1→2→3→…→N→1. With only one window it's a no-op (still
  // bumps z so the focus indicator updates). The previous "raise
  // index 1" approach just toggled the top two forever once 3+
  // windows were open.
  const entries = Array.from(_registry.values()).sort((a, b) => (a.z || 0) - (b.z || 0))
  const target = entries[0]
  if (target?.raise) target.raise()
  return true
}

// Cmd+X — close the currently focused window (the one on top of the
// focus stack, i.e. the front-most in z that the user last touched).
// Returns true if something was closed so the keydown handler can
// preventDefault.
export function closeCurrentFloatingWindow() {
  if (_hiddenAll) return false
  const id = _focusStack[_focusStack.length - 1]
  const entry = id ? _registry.get(id) : null
  if (!entry?.close) return false
  entry.close()
  return true
}

// Cmd+A — focus the window that was focused before the current one.
// Pressing it twice just bounces between two windows, like the
// macOS Cmd+` cycle.
export function focusLastFloatingWindow() {
  if (_hiddenAll) return false
  const id = _focusStack[_focusStack.length - 2]
  const entry = id ? _registry.get(id) : null
  if (!entry?.raise) return false
  entry.raise()
  return true
}

// Cmd+← / Cmd+→ — walk the stable registration order. The "current"
// is whichever id is on top of the focus stack; wrap at both ends.
function _stepInRegistration(delta) {
  if (_hiddenAll) return false
  if (_registry.size < 2) return false
  const cur = _focusStack[_focusStack.length - 1]
  const idx = _registrationOrder.indexOf(cur)
  if (idx === -1) return false
  const next = (idx + delta + _registrationOrder.length) % _registrationOrder.length
  const target = _registry.get(_registrationOrder[next])
  if (!target?.raise) return false
  target.raise()
  return true
}
export function prevFloatingWindow() { return _stepInRegistration(-1) }
export function nextFloatingWindow() { return _stepInRegistration(+1) }

export function toggleHideAllFloatingWindows() {
  _hiddenAll = !_hiddenAll
  notifyHidden()
  return _hiddenAll
}

// Force-un-hide (no-op if not currently hidden). Used by the Tools
// button so clicking Tools when popups are stashed reveals them too —
// avoids opening Tools over an empty-looking screen where the user's
// windows actually still exist, just off-screen.
export function showAllFloatingWindows() {
  if (!_hiddenAll) return false
  _hiddenAll = false
  notifyHidden()
  return true
}

export function areFloatingWindowsHidden() { return _hiddenAll }
export function countOpenFloatingWindows() { return _registry.size }

// ─── Session-scoped layout memory ────────────────────────────────────
// Per-storageKey { pos, size } cache. Lets a closed popup reopen at
// the spot/size the user left it — but ONLY for this play session.
// Nothing here touches localStorage; clearAllFloatingWindowLayouts is
// called on join_game so the next table starts with a fresh slate
// (avoids carrying a desktop layout into a phone session).
const _sessionLayouts = new Map()

export function clearAllFloatingWindowLayouts() {
  _sessionLayouts.clear()
}

function rememberLayout(storageKey, pos, size) {
  if (!storageKey) return
  _sessionLayouts.set(storageKey, { pos: { ...pos }, size: { ...size } })
}
function recallLayout(storageKey) {
  if (!storageKey) return null
  return _sessionLayouts.get(storageKey) || null
}

// Strip any legacy pos/size entries left over from an earlier build
// that did persist them. Runs once per page so a returning user's
// localStorage doesn't keep them pinned to whatever desktop layout
// they had last week. Position + size are now session-only.
let _stripped = false
function stripLegacyLayoutKeys() {
  if (_stripped || typeof window === 'undefined') return
  _stripped = true
  try {
    const ls = window.localStorage
    for (let i = ls.length - 1; i >= 0; i -= 1) {
      const key = ls.key(i)
      if (!key) continue
      if (key.endsWith(':pos') || key.endsWith(':size')) ls.removeItem(key)
    }
  } catch {}
}

function clamp({ x, y, w, h }, minW, minH) {
  if (typeof window === 'undefined') return { x, y, w, h }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cw = Math.max(minW, Math.min(w, vw - 16))
  const ch = Math.max(minH, Math.min(h, vh - 16))
  // Keep at least 40px of the title bar reachable so the user can
  // always grab the window back even if they drag it almost off
  // screen.
  const cx = Math.max(40 - cw, Math.min(x, vw - 40))
  const cy = Math.max(0, Math.min(y, vh - TITLE_H))
  return { x: cx, y: cy, w: cw, h: ch }
}

function pickDefault({ width = 360, height = 460 } = {}) {
  if (typeof window === 'undefined') return { x: 80, y: 80, w: width, h: height }
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Cap defaults to 85% of viewport so a window opened on a tablet
  // doesn't blanket the table. Floor at the min sizes so the body
  // is always usable.
  const w = Math.max(MIN_W, Math.min(width, Math.floor(vw * 0.85)))
  const h = Math.max(MIN_H, Math.min(height, Math.floor(vh * 0.85)))
  const x = Math.max(16, Math.min(96, vw - w - 16))
  const y = Math.max(16, Math.min(80, vh - h - 16))
  return { x, y, w, h }
}

// ── Content zoom ──────────────────────────────────────────────────
// Per-window, scales the body only via CSS `zoom`. Bounds + storage
// live in lib/windowZooms.js so the value is shared across mounts and
// (for signed-in users) persisted to the DB via /api/auth/me/window-zoom.
const ZOOM_STEP = 5

export default function FloatingWindow({
  open,
  onClose,
  onBack,
  backLabel = 'Tools',
  onRefresh,
  refreshing = false,
  title = 'Window',
  icon = '✦',
  accent = 'emerald',
  storageKey,
  defaultWidth = 360,
  defaultHeight = 460,
  minWidth = MIN_W,
  minHeight = MIN_H,
  dataAttr = 'pokerwin',
  // Initial z-index. Most consumers don't pass this — the module-level
  // counter takes over after the first pointerdown anyway.
  zIndex,
  children,
}) {
  // Position + size are SESSION-ONLY: we don't write them to
  // localStorage, but we DO keep a module-level memory map so a
  // closed popup reopens at the spot/size the user left it for the
  // rest of the play session. join_game clears the map (handled in
  // poker/page.jsx) so the next table starts fresh — a desktop
  // layout shouldn't follow the user onto their phone.
  if (typeof window !== 'undefined') stripLegacyLayoutKeys()
  const def = pickDefault({ width: defaultWidth, height: defaultHeight })
  const [pos, setPos] = useState(() => {
    const memo = recallLayout(storageKey)
    // Re-clamp the recalled position against the current viewport so
    // a resized browser / rotated phone doesn't land the popup off-
    // screen.
    if (memo) {
      const clamped = clamp({ ...memo.pos, ...memo.size }, minWidth, minHeight)
      return { x: clamped.x, y: clamped.y }
    }
    // No saved layout — cascade the default down by one title-bar
    // height for each currently-open window already at the proposed
    // slot, so spam-opening windows leaves every header visible.
    return pickCascadedPos({ x: def.x, y: def.y }, def.w, def.h)
  })
  const [size, setSize] = useState(() => {
    const memo = recallLayout(storageKey)
    if (memo) {
      const clamped = clamp({ ...memo.pos, ...memo.size }, minWidth, minHeight)
      return { w: clamped.w, h: clamped.h }
    }
    return { w: def.w, h: def.h }
  })
  // Content zoom comes from the shared store (localStorage + DB for
  // signed-in users via /api/auth/me/window-zoom). The chrome stays
  // at 100% so the title bar / close button never change size.
  const zoom = useWindowZoom(storageKey)
  // Hydrate this window's saved zoom out of localStorage on the first
  // open — the auth-driven hydration runs from FeltBootstrap when
  // /auth/me lands and will subsequently overwrite this if the user
  // has a DB-saved value.
  useEffect(() => { hydrateOneFromLocal(storageKey) }, [storageKey])
  const [drag, setDrag] = useState(null)
  // resize.grip identifies which edge/corner the user grabbed. One of:
  //   't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br'
  // The unmoved edges stay anchored. The math is encoded in the move
  // handler — see the `useEffect` below — which derives "does this
  // grip move the top? bottom? left? right?" from the grip code.
  const [resize, setResize] = useState(null)
  // Per-window z-index, bumped to a fresh max on every pointerdown so
  // clicking an underlying window raises it above its siblings. New
  // mounts seed in the same click-raise band as the docked Tools menu
  // (RAISED_BASE_Z = 900) — a freshly-opened window lands above every
  // already-open window without needing an extra click. The docked
  // Tools menu re-bumps its own z above the new window after mount so
  // it stays the topmost surface; see poker/page.jsx.
  const [z, setZ] = useState(() => zIndex ?? nextRaisedZ())
  // Global hide-all subscription — when the H shortcut flips the
  // module flag, every mounted FloatingWindow re-renders into a
  // `display: none` state without losing its DOM / state.
  const [hiddenAll, setHiddenAll] = useState(_hiddenAll)
  useEffect(() => {
    const sub = () => setHiddenAll(_hiddenAll)
    _hiddenSubs.add(sub)
    return () => { _hiddenSubs.delete(sub) }
  }, [])

  // Stable id for the window registry. Prefer the storageKey when
  // present so the same logical window keeps its id across remounts
  // (e.g. when toggled closed and reopened).
  const reactId = useId()
  const registryId = storageKey || reactId

  function raise() {
    const next = nextRaisedZ()
    setZ(next)
    updateWindowZ(registryId, next)
  }

  // Re-seed z every time the window transitions to open. The useState
  // initializer above only fires on first mount, so a window toggled
  // closed → open (mini-table, social feed) keeps its stale z and
  // fails to land on top of newer windows. useLayoutEffect commits the
  // new z before paint so there's no flicker.
  //
  // Also re-cascade pos here: persistently-mounted windows like the
  // mini-table and social feed stay in React's tree across close/open
  // toggles, so their pos useState init only ran once. Without this,
  // closing one and re-opening it would land it back on top of whatever
  // is currently at its old spot. We feed the current pos through
  // pickCascadedPos — if nothing else is there, it returns unchanged
  // (the user's last position is preserved); if a collision is
  // detected, it cascades down by TITLE_H until clear.
  const posRef = useRef(pos)
  useEffect(() => { posRef.current = pos }, [pos.x, pos.y])
  useLayoutEffect(() => {
    if (!open) return
    const next = nextRaisedZ()
    setZ(next)
    updateWindowZ(registryId, next)
    const cur = posRef.current
    const cascaded = pickCascadedPos(cur, size.w, size.h)
    if (cascaded.x !== cur.x || cascaded.y !== cur.y) setPos(cascaded)
    // registryId / size are stable enough for this purpose; we only
    // want to fire on open transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the latest onClose accessible to the registry without
  // re-registering on every render. The Cmd+X shortcut closes the
  // currently focused window by calling the entry's `close` from
  // outside the React tree — it needs the up-to-date callback.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // Register with the module registry whenever the window is open. The
  // entry exposes `raise` (Tab / Cmd+←/→ / Cmd+A use it) and `close`
  // (Cmd+X) so the keyboard shortcuts can drive this window from
  // outside the React tree.
  useEffect(() => {
    if (!open) return
    const api = {
      raise,
      z,
      pos,
      title,
      close: () => onCloseRef.current?.(),
    }
    registerWindow(registryId, api)
    return () => { unregisterWindow(registryId) }
    // raise is recreated each render — registering on every render
    // would thrash subscribers. Identity stays in the registry entry;
    // we update the z field directly via updateWindowZ in raise().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, registryId])

  // ── Drag handling ─────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const next = clamp(
        { x: e.clientX - drag.dx, y: e.clientY - drag.dy, w: size.w, h: size.h },
        minWidth, minHeight,
      )
      setPos({ x: next.x, y: next.y })
    }
    function onUp() { setDrag(null) }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [drag, size.w, size.h, minWidth, minHeight])

  useEffect(() => {
    if (!resize) return
    function onMove(e) {
      const dx = e.clientX - resize.x0
      const dy = e.clientY - resize.y0
      const grip = resize.grip
      // Grip-code → which edges move. First char picks vertical edge
      // ('t' top / 'b' bottom), last char picks horizontal ('l' left
      // / 'r' right). Single-char codes ('t','b','l','r') only touch
      // one edge; the orthogonal edges stay anchored.
      const movesTop    = grip[0] === 't'
      const movesBottom = grip[0] === 'b'
      const movesLeft   = grip[grip.length - 1] === 'l'
      const movesRight  = grip[grip.length - 1] === 'r'
      // Raw new size from pointer delta.
      let newW = resize.w0
      let newH = resize.h0
      if (movesRight) newW = resize.w0 + dx
      if (movesLeft)  newW = resize.w0 - dx
      if (movesBottom) newH = resize.h0 + dy
      if (movesTop)    newH = resize.h0 - dy
      // Floor at min — the anchored-edge pos compensates so the
      // opposite edge doesn't drift when the user yanks past the
      // floor. clamp() below handles the viewport bounds.
      const wantedW = Math.max(minWidth, newW)
      const wantedH = Math.max(minHeight, newH)
      const newX = movesLeft ? resize.posX0 + (resize.w0 - wantedW) : resize.posX0
      const newY = movesTop  ? resize.posY0 + (resize.h0 - wantedH) : resize.posY0
      const next = clamp({ x: newX, y: newY, w: wantedW, h: wantedH }, minWidth, minHeight)
      setPos({ x: next.x, y: next.y })
      setSize({ w: next.w, h: next.h })
    }
    function onUp() { setResize(null) }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [resize, minWidth, minHeight])

  // Persist on settle (not during drag) so we don't thrash localStorage.
  // Only writes when the user has actually customized that axis — a
  // fresh mount must not save its computed defaults, or the next
  // reload would falsely flip *Customized=true.
  // Session-scoped layout memory: on every settle (drag/resize end),
  // stash the current pos+size keyed by storageKey so that closing
  // and reopening the popup during this play session lands it back in
  // the same spot. Cleared wholesale on join_game.
  useEffect(() => {
    if (drag || resize) return
    rememberLayout(storageKey, pos, size)
  }, [storageKey, pos, size, drag, resize])

  // Mirror pos into the registry so the next freshly-opened window's
  // pickCascadedPos can see where this one currently sits.
  useEffect(() => {
    if (!open) return
    updateWindowPos(registryId, pos)
  }, [open, registryId, pos.x, pos.y])

  // Re-clamp on viewport resize — keeps the window grabbable when the
  // browser shrinks below its current size.
  useEffect(() => {
    function onResize() {
      const next = clamp({ ...pos, ...size }, minWidth, minHeight)
      setPos({ x: next.x, y: next.y })
      setSize({ w: next.w, h: next.h })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos.x, pos.y, size.w, size.h, minWidth, minHeight])

  if (!open) return null
  if (typeof document === 'undefined') return null

  function onTitleDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    raise()
    setDrag({ dx: e.clientX - pos.x, dy: e.clientY - pos.y })
  }
  function onResizeDown(e, grip) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.stopPropagation()
    raise()
    setResize({ grip, x0: e.clientX, y0: e.clientY, w0: size.w, h0: size.h, posX0: pos.x, posY0: pos.y })
  }
  function adjustZoom(delta) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta))
    setWindowZoom(storageKey, next)
  }

  const accentCls = ACCENT_CLASSES[accent] || ACCENT_CLASSES.emerald
  const dataProps = dataAttr ? { [`data-${dataAttr}`]: '1' } : {}

  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      {...dataProps}
      onPointerDownCapture={raise}
      className={`fixed flex flex-col rounded-lg border ${accentCls.border} bg-zinc-900/98 shadow-2xl backdrop-blur-md`}
      // When the global hide-all flag is set, we keep the window
      // mounted (preserving DOM, scroll, internal state) but hide it
      // from view + remove it from the hit-test grid.
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: z,
        display: hiddenAll ? 'none' : undefined,
      }}
    >
      <div
        onPointerDown={onTitleDown}
        className="flex shrink-0 items-center justify-between gap-2 rounded-t-lg border-b border-zinc-700 bg-zinc-950/60 px-2 py-1 cursor-move select-none"
        style={{ height: TITLE_H }}
      >
        <div className={`flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${accentCls.label}`}>
          {onBack && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onBack() }}
              aria-label={`Back to ${backLabel}`}
              title={`Back to ${backLabel}`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-zinc-600/70 bg-zinc-800 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-100 transition-colors hover:bg-zinc-700"
            >
              <span aria-hidden className="text-[11px] leading-none">←</span>
              {backLabel}
            </button>
          )}
          <span aria-hidden className="shrink-0">{icon}</span>
          <span className="truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Per-window content zoom — chrome stays at 100% so the
              controls themselves don't grow/shrink as you zoom. */}
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 rounded-md border border-zinc-700/70 bg-zinc-900/60 px-1 py-0.5"
            title={`Zoom window content (${zoom}%)`}
          >
            <button
              type="button"
              onClick={() => adjustZoom(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              className="h-4 w-4 rounded text-[11px] leading-none text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >−</button>
            <span className="min-w-[28px] text-center text-[9px] font-black tabular-nums text-zinc-400">{zoom}%</span>
            <button
              type="button"
              onClick={() => adjustZoom(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              className="h-4 w-4 rounded text-[11px] leading-none text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >+</button>
          </div>
          {onRefresh && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRefresh() }}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
              className={`rounded px-1.5 py-0.5 text-[11px] leading-none text-zinc-400 hover:bg-zinc-800 ${accentCls.iconHover} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <span aria-hidden className={refreshing ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
            </button>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose?.() }}
            aria-label={`Close ${title}`}
            className="rounded px-1.5 text-base leading-none text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >×</button>
        </div>
      </div>
      {/* Body. min-h-0 + flex-1 + overflow-y-auto keeps the window
          from ballooning past its allotted size on tall content.
          min-w-0 + overflow-x-hidden prevents long words / wide rows
          from blowing the flex-child out and forcing a horizontal
          scrollbar instead of wrapping.
          The CSS `zoom` is applied at the content layer ONLY — title
          bar / grips stay at 100% so the controls remain stable. */}
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
        style={zoom !== ZOOM_DEFAULT ? { zoom: `${zoom}%` } : undefined}
      >
        {children}
      </div>
      {/* Resize handles — 8 in total. 4 edges (top/right/bottom/left)
          plus 4 corners. Edges are thin strips along each side,
          inset from the corners so they don't fight the corner
          grabbers. Corners are small squares; TL and BR keep the
          gradient triangle so the window has visible corner
          affordances. TR and BL are invisible but functional. */}
      {/* Edges */}
      <div
        onPointerDown={(e) => onResizeDown(e, 't')}
        className="absolute top-0 left-3 right-3 h-1 cursor-ns-resize select-none"
        aria-label="Resize from top edge"
      />
      <div
        onPointerDown={(e) => onResizeDown(e, 'b')}
        className="absolute bottom-0 left-3 right-3 h-1 cursor-ns-resize select-none"
        aria-label="Resize from bottom edge"
      />
      <div
        onPointerDown={(e) => onResizeDown(e, 'l')}
        className="absolute left-0 top-3 bottom-3 w-1 cursor-ew-resize select-none"
        aria-label="Resize from left edge"
      />
      <div
        onPointerDown={(e) => onResizeDown(e, 'r')}
        className="absolute right-0 top-3 bottom-3 w-1 cursor-ew-resize select-none"
        aria-label="Resize from right edge"
      />
      {/* Corners */}
      <div
        onPointerDown={(e) => onResizeDown(e, 'tl')}
        className="absolute top-0 left-0 h-3 w-3 cursor-nwse-resize select-none rounded-tl-lg"
        style={{
          background: 'linear-gradient(315deg, transparent 0%, transparent 50%, rgb(82 82 91 / 0.7) 50%, rgb(82 82 91 / 0.7) 100%)'
        }}
        aria-label="Resize from top-left"
      />
      <div
        onPointerDown={(e) => onResizeDown(e, 'tr')}
        className="absolute top-0 right-0 h-3 w-3 cursor-nesw-resize select-none rounded-tr-lg"
        aria-label="Resize from top-right"
      />
      <div
        onPointerDown={(e) => onResizeDown(e, 'bl')}
        className="absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize select-none rounded-bl-lg"
        aria-label="Resize from bottom-left"
      />
      <div
        onPointerDown={(e) => onResizeDown(e, 'br')}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize select-none rounded-br-lg"
        style={{
          background: 'linear-gradient(135deg, transparent 0%, transparent 50%, rgb(82 82 91 / 0.7) 50%, rgb(82 82 91 / 0.7) 100%)'
        }}
        aria-label="Resize from bottom-right"
      />
    </div>,
    document.body,
  )
}

const ACCENT_CLASSES = {
  emerald: { border: 'border-emerald-400/40', label: 'text-emerald-200', iconHover: 'hover:text-emerald-200' },
  violet:  { border: 'border-violet-400/40',  label: 'text-violet-200',  iconHover: 'hover:text-violet-200' },
  sky:     { border: 'border-sky-400/40',     label: 'text-sky-200',     iconHover: 'hover:text-sky-200' },
  fuchsia: { border: 'border-fuchsia-400/40', label: 'text-fuchsia-200', iconHover: 'hover:text-fuchsia-200' },
  rose:    { border: 'border-rose-400/40',    label: 'text-rose-200',    iconHover: 'hover:text-rose-200' },
  amber:   { border: 'border-amber-400/40',   label: 'text-amber-200',   iconHover: 'hover:text-amber-200' },
  cyan:    { border: 'border-cyan-400/40',    label: 'text-cyan-200',    iconHover: 'hover:text-cyan-200' },
  purple:  { border: 'border-purple-400/40',  label: 'text-purple-200',  iconHover: 'hover:text-purple-200' },
  orange:  { border: 'border-orange-400/40',  label: 'text-orange-200',  iconHover: 'hover:text-orange-200' },
  zinc:    { border: 'border-zinc-500/40',    label: 'text-zinc-200',    iconHover: 'hover:text-zinc-200' },
}

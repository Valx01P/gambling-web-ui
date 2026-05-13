'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import PostComposer from './PostComposer'
import PostCard from './PostCard'

// Persistence keys — position + size survive across sessions so a user
// who likes the feed window in the bottom-right doesn't have to drag
// it there on every page load.
const POS_KEY = 'pokerxyz:feedwin:pos'
const SIZE_KEY = 'pokerxyz:feedwin:size'

const MIN_W = 320
const MIN_H = 320
const TITLE_H = 36

function loadJson(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch { return fallback }
}
function saveJson(key, value) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// Clamp a (x, y, w, h) so the window stays mostly on-screen. Pulls the
// box back inside the viewport leaving at least 40px of the title bar
// visible at the edge so the user can always grab it back.
function clamp({ x, y, w, h }) {
  if (typeof window === 'undefined') return { x, y, w, h }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cw = Math.max(MIN_W, Math.min(w, vw - 16))
  const ch = Math.max(MIN_H, Math.min(h, vh - 16))
  const cx = Math.max(40 - cw, Math.min(x, vw - 40))
  const cy = Math.max(0, Math.min(y, vh - TITLE_H))
  return { x: cx, y: cy, w: cw, h: ch }
}

// Floating, movable, resizable feed window. Renders via portal so the
// table chrome can't trap it inside a stacking context. The viewport
// edge gates ensure it can't be dragged completely off-screen.
// `onBack` is optional. When provided, the title bar renders a left-
// arrow button that closes the window AND fires `onBack` — the poker
// page uses it to reopen the Tools menu after the user opened the
// feed via the ★ Social Media entry, so they can navigate back instead
// of having to click Tools again from scratch.
export default function FeedWindow({ open, onClose, onBack }) {
  const { user } = useAuth()
  const wrapRef = useRef(null)
  const [pos, setPos] = useState(() => loadJson(POS_KEY, { x: 80, y: 72 }))
  const [size, setSize] = useState(() => loadJson(SIZE_KEY, { w: 440, h: 600 }))
  const [drag, setDrag] = useState(null) // { dx, dy }
  const [resize, setResize] = useState(null) // { x0, y0, w0, h0 }

  // Feed state.
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [endReached, setEndReached] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  // `loadedOnce` gates the auto-fetch effect. Without it, an empty feed
  // (posts.length === 0 after a successful fetch) would retrigger the
  // effect every render because the dependencies still match — causing
  // the visible "Loading… / Nothing here yet" flicker.
  const [loadedOnce, setLoadedOnce] = useState(false)

  const fetchInitial = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { posts } = await api.listFeed({ limit: 20 })
      setPosts(posts || [])
      setEndReached((posts || []).length < 20)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load feed')
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [])

  // Lazy-fetch only on the FIRST open. After that, the empty-state UI
  // gives the user a Reload button instead of auto-retrying.
  useEffect(() => {
    if (open && !loadedOnce && !loading) fetchInitial()
  }, [open, loadedOnce, loading, fetchInitial])

  const loadMore = useCallback(async () => {
    if (loadingMore || endReached || posts.length === 0) return
    setLoadingMore(true)
    try {
      const last = posts[posts.length - 1]
      const { posts: more } = await api.listFeed({ beforeId: last.id, limit: 20 })
      setPosts(prev => [...prev, ...(more || [])])
      if ((more || []).length < 20) setEndReached(true)
    } catch {} finally { setLoadingMore(false) }
  }, [posts, loadingMore, endReached])

  // ── Drag handlers ───────────────────────────────────────────────────
  // Pointer events instead of mouse events so touch + stylus work out
  // of the box. We capture on the title bar at pointerdown; document-
  // level move/up listeners drive the rest until release.
  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const next = clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy, w: size.w, h: size.h })
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
  }, [drag, size.w, size.h])

  useEffect(() => {
    if (!resize) return
    function onMove(e) {
      const dx = e.clientX - resize.x0
      const dy = e.clientY - resize.y0
      const next = clamp({ x: pos.x, y: pos.y, w: resize.w0 + dx, h: resize.h0 + dy })
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
  }, [resize, pos.x, pos.y])

  // Persist on settle (not during drag) so we don't thrash localStorage.
  useEffect(() => { if (!drag) saveJson(POS_KEY, pos) }, [pos, drag])
  useEffect(() => { if (!resize) saveJson(SIZE_KEY, size) }, [size, resize])

  // Re-clamp on viewport resize — keeps the window grabbable if the
  // user shrinks the browser to a width smaller than its current size.
  useEffect(() => {
    function onResize() {
      const next = clamp({ ...pos, ...size })
      setPos({ x: next.x, y: next.y })
      setSize({ w: next.w, h: next.h })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos.x, pos.y, size.w, size.h])

  if (!open) return null
  if (typeof document === 'undefined') return null

  function onTitleDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    setDrag({ dx: e.clientX - pos.x, dy: e.clientY - pos.y })
  }
  function onResizeDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    setResize({ x0: e.clientX, y0: e.clientY, w0: size.w, h0: size.h })
  }

  return createPortal(
    <div
      ref={wrapRef}
      role="dialog"
      aria-label="Feed"
      className="fixed z-[260] flex flex-col rounded-lg border border-violet-400/40 bg-zinc-900/98 shadow-2xl backdrop-blur-md"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Title bar — drag handle + close. Cursor flips to move when
          hovering so the affordance is obvious. */}
      <div
        onPointerDown={onTitleDown}
        className="flex items-center justify-between gap-2 rounded-t-lg border-b border-zinc-700 bg-zinc-950/60 px-3 py-1.5 cursor-move select-none"
        style={{ height: TITLE_H }}
      >
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-violet-200">
          {onBack && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onBack() }}
              aria-label="Back to Tools menu"
              title="Back to Tools menu"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-600/70 bg-zinc-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-100 transition-colors hover:bg-zinc-700"
            >
              <span aria-hidden className="text-[12px] leading-none">←</span>
              Tools
            </button>
          )}
          <span aria-hidden>★</span>
          <span>Social Media</span>
        </div>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClose() }}
          aria-label="Close feed window"
          className="rounded px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >×</button>
      </div>

      {/* Body — composer + scrollable post list. The scroll container's
          flex-1 lets the composer pin to the top and the list fill the
          rest of the window. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-white">
        {user && <PostComposer onPosted={(p) => setPosts(prev => [p, ...prev])} />}
        {loading && (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/40 p-4 text-center text-xs font-bold text-zinc-400">
            Loading the feed…
          </div>
        )}
        {error && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={fetchInitial}
              className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-rose-100 hover:bg-rose-500/20"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && posts.length === 0 && !error && loadedOnce && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-900/40 p-4 text-center text-xs font-bold text-zinc-400">
            <span>Nothing here yet.</span>
            <button
              type="button"
              onClick={fetchInitial}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-800"
            >
              Reload
            </button>
          </div>
        )}
        {posts.map(p => (
          <PostCard
            key={p.id}
            post={p}
            viewerId={user?.id}
            onDeleted={(id) => setPosts(prev => prev.filter(x => x.id !== id))}
            dense
          />
        ))}
        {!endReached && posts.length > 0 && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="self-center rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>

      {/* Resize handle — bottom-right corner grip. Pointer-events on the
          grip itself stop the underlying body from intercepting the
          pointerdown that starts the resize. */}
      <div
        onPointerDown={onResizeDown}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize select-none rounded-br-lg"
        style={{
          background: 'linear-gradient(135deg, transparent 0%, transparent 50%, rgb(82 82 91 / 0.7) 50%, rgb(82 82 91 / 0.7) 100%)'
        }}
        aria-label="Resize feed window"
      />
    </div>,
    document.body
  )
}

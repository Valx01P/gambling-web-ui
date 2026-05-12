'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Single source of truth for the page-zoom feature. localStorage holds the
// canonical value; a custom `gwu:zoom-changed` event broadcasts updates to
// every mounted consumer so a change in the AccountMenu reflects in the
// poker-page tools menu (and vice versa) without prop drilling.
//
// ZoomLayer in app/layout.jsx applies the actual CSS `zoom` style — this
// hook is purely for the read/write/sync side.

export const ZOOM_STORAGE_KEY = 'poker_zoom'
export const ZOOM_EVENT = 'gwu:zoom-changed'
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10

function readStoredZoom() {
  if (typeof window === 'undefined') return 100
  try {
    const saved = parseInt(window.localStorage.getItem(ZOOM_STORAGE_KEY) || '100', 10)
    if (Number.isFinite(saved) && saved >= ZOOM_MIN && saved <= ZOOM_MAX) return saved
  } catch {}
  return 100
}

export function useZoom() {
  const [zoom, setZoom] = useState(100)
  // Hydrated gate so the post-state-change effect doesn't fire during
  // the initial render (which would overwrite the stored value with 100
  // before the hydrate effect runs).
  const hydratedRef = useRef(false)

  // Hydrate from storage + subscribe to live updates from other consumers.
  // The hydrate-setZoom runs once on mount; subsequent listener-triggered
  // setZoom calls are how cross-consumer sync works.
  useEffect(() => {
    setZoom(readStoredZoom())
    hydratedRef.current = true
    function refresh() { setZoom(readStoredZoom()) }
    function onStorage(e) { if (!e || e.key === ZOOM_STORAGE_KEY) refresh() }
    window.addEventListener(ZOOM_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(ZOOM_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // Persist + broadcast AFTER the render commits. Doing the dispatch
  // inside a setState updater would synchronously fire other
  // components' listeners while still mid-render — React 19 catches
  // that and logs "Cannot update a component while rendering a
  // different component". useEffect runs post-commit, so we're safe.
  //
  // The localStorage-equality guard breaks the would-be event loop:
  // when our own setZoom was triggered by *receiving* someone else's
  // dispatch, storage already matches the new value and we bail.
  useEffect(() => {
    if (!hydratedRef.current) return
    if (typeof window === 'undefined') return
    try {
      if (window.localStorage.getItem(ZOOM_STORAGE_KEY) === String(zoom)) return
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom))
      window.dispatchEvent(new Event(ZOOM_EVENT))
    } catch {}
  }, [zoom])

  // Pure state updaters — no side effects. The persist-effect above
  // handles propagation.
  const adjust = useCallback((delta) => {
    setZoom(prev => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(prev + delta))))
  }, [])
  const reset = useCallback(() => setZoom(100), [])

  return { zoom, adjust, reset, MIN: ZOOM_MIN, MAX: ZOOM_MAX, STEP: ZOOM_STEP }
}

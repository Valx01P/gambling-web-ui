'use client'

import { useEffect, useState } from 'react'

const ZOOM_STORAGE_KEY = 'poker_zoom'
const ZOOM_EVENT = 'gwu:zoom-changed'
const MIN = 50
const MAX = 200

// Wraps the entire app's content (children) — zooms only what's inside, never
// the FuzzyBackground canvas that sits as a sibling. Reads/writes the same
// localStorage key the poker page's zoom controls use, plus listens for a
// custom event so changes propagate without a page reload.
export default function ZoomLayer({ children }) {
  const [zoom, setZoom] = useState(100)

  useEffect(() => {
    function read() {
      try {
        const saved = parseInt(window.localStorage.getItem(ZOOM_STORAGE_KEY) || '100', 10)
        if (Number.isFinite(saved) && saved >= MIN && saved <= MAX) setZoom(saved)
        else setZoom(100)
      } catch {
        setZoom(100)
      }
    }
    read()
    function onStorage(e) {
      if (!e || e.key === ZOOM_STORAGE_KEY) read()
    }
    function onCustom() { read() }
    window.addEventListener('storage', onStorage)
    window.addEventListener(ZOOM_EVENT, onCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(ZOOM_EVENT, onCustom)
    }
  }, [])

  return (
    <div
      style={{ zoom: `${zoom}%` }}
      className="min-h-[100dvh]"
    >
      {children}
    </div>
  )
}

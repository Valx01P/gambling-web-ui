'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'

// Module-level pub/sub for the active felt tint. The poker page sets a
// `[r, g, b]` base when its table-color state changes, and clears it on
// unmount. FuzzyBackground subscribes here and re-renders its static
// noise around that base. Lives outside React state so the background
// — which is mounted at the root layout — can respond to a deep child
// (the poker page) without prop-drilling or context.
let _feltRgb = null
const _listeners = new Set()
export function setBackgroundFelt(rgb) {
  // Accept either [r, g, b] or null (reset to default).
  if (!rgb || !Array.isArray(rgb) || rgb.length < 3) _feltRgb = null
  else _feltRgb = [Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0]
  for (const l of _listeners) l()
}
function _subscribe(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}
function _get() { return _feltRgb }
function _getServer() { return null }

// Default base — same emerald-tinted noise the page originally shipped.
// Kept in sync with TABLE_COLOR_PALETTES.emerald.bgRgb in poker/page.jsx
// so the felt and background match when the user never picks a color.
const DEFAULT_RGB = [31, 94, 64]

export default function FuzzyBackground() {
  const canvasRef = useRef(null)
  const rgb = useSyncExternalStore(_subscribe, _get, _getServer) || DEFAULT_RGB

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 2560
    const H = 1440
    canvas.width = W
    canvas.height = H

    // Same ±30 noise envelope as before; only the BASE color changes
    // per active table color. Keeping the noise mechanic identical
    // means the "static" feel the user wants survives every recolor.
    const [r0, g0, b0] = rgb
    const imageData = ctx.createImageData(W, H)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random() * 60 - 30
      data[i]     = Math.max(0, Math.min(255, r0 + noise))
      data[i + 1] = Math.max(0, Math.min(255, g0 + noise))
      data[i + 2] = Math.max(0, Math.min(255, b0 + noise))
      data[i + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
  }, [rgb[0], rgb[1], rgb[2]])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10 h-[100dvh] w-screen"
      style={{ objectFit: 'cover' }}
    />
  )
}

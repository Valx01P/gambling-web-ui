'use client'

import { useEffect, useRef } from 'react'
import { useFeltColor } from '../lib/feltColor'

// Renders the noise canvas that sits behind every page. Reads the
// site-wide felt color directly from feltColor.js — the same store the
// poker felt-picker writes to and that the layout's FeltBootstrap
// hydrates from localStorage + /auth/me. That means switching colors
// from inside the Tools menu on /poker tints every other route too.

export default function FuzzyBackground() {
  const canvasRef = useRef(null)
  const { palette } = useFeltColor()
  const rgb = palette.bgRgb

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

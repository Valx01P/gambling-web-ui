'use client'

import { useEffect, useRef } from 'react'

export default function FuzzyBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 2560
    const H = 1440
    canvas.width = W
    canvas.height = H

    const imageData = ctx.createImageData(W, H)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random() * 60 - 30
      data[i]     = Math.max(0, Math.min(255, 31 + noise))
      data[i + 1] = Math.max(0, Math.min(255, 94 + noise))
      data[i + 2] = Math.max(0, Math.min(255, 64 + noise))
      data[i + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10 h-[100dvh] w-screen"
      style={{ objectFit: 'cover' }}
    />
  )
}

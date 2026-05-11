'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Square cropper for profile images. Canvas-based with pointer + wheel
// gestures, no external library. Output is a 512×512 JPEG blob —  small
// enough to keep storage costs trivial, large enough to look sharp on
// retina seat avatars (which top out around 56×56 logical px).
//
// The user picks a file → we render it to an offscreen image, then draw
// a fitted preview to the visible canvas. They pan (drag) and zoom (wheel
// or pinch on touch — `gesturechange` doesn't fire on iOS Safari for
// non-Apple element bindings so we use a slider as a guaranteed fallback).
// On confirm we render the visible square to a 512×512 canvas and emit a
// blob via canvas.toBlob(jpeg, 0.92).

const OUTPUT_SIZE = 512   // px on each side of the exported square
const PREVIEW_SIZE = 280  // px on each side of the in-modal preview canvas

export default function AvatarCropper({ open, file, onCancel, onConfirm, busy = false }) {
  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  // Drawing transform — image is centered at (offsetX, offsetY) and scaled
  // by `scale`. Initial fit-cover scale is computed on image load.
  const [scale, setScale] = useState(1)
  const [minScale, setMinScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const draggingRef = useRef(null)

  // Load the file into an offscreen Image() whenever a new one is picked.
  useEffect(() => {
    if (!open || !file) return
    setLoaded(false)
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        imageRef.current = img
        // Fit-cover scale: smallest scale that fills the preview square.
        const fit = Math.max(PREVIEW_SIZE / img.width, PREVIEW_SIZE / img.height)
        setMinScale(fit)
        setScale(fit)
        setOffset({ x: 0, y: 0 })
        setLoaded(true)
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }, [file, open])

  // Redraw whenever transform changes.
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
    ctx.save()
    ctx.translate(PREVIEW_SIZE / 2 + offset.x, PREVIEW_SIZE / 2 + offset.y)
    ctx.scale(scale, scale)
    ctx.drawImage(img, -img.width / 2, -img.height / 2)
    ctx.restore()
  }, [scale, offset])

  useEffect(() => { if (loaded) draw() }, [loaded, draw])

  // Drag-to-pan, with offsets clamped so the image always covers the
  // square (otherwise a small image at min scale could be panned out of
  // view, leaving an ugly transparent crop).
  function clampOffset(rawOffset, currentScale) {
    const img = imageRef.current
    if (!img) return rawOffset
    const halfW = (img.width * currentScale) / 2
    const halfH = (img.height * currentScale) / 2
    const maxX = Math.max(0, halfW - PREVIEW_SIZE / 2)
    const maxY = Math.max(0, halfH - PREVIEW_SIZE / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, rawOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, rawOffset.y)),
    }
  }

  function onPointerDown(e) {
    if (busy) return
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y }
  }
  function onPointerMove(e) {
    const d = draggingRef.current
    if (!d) return
    const next = clampOffset(
      { x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) },
      scale
    )
    setOffset(next)
  }
  function onPointerUp(e) {
    draggingRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  function onWheel(e) {
    if (busy) return
    e.preventDefault()
    const direction = e.deltaY < 0 ? 1.05 : 1 / 1.05
    const next = Math.max(minScale, Math.min(minScale * 6, scale * direction))
    setScale(next)
    setOffset(prev => clampOffset(prev, next))
  }

  function onSliderChange(e) {
    const value = Number(e.target.value)
    const next = Math.max(minScale, Math.min(minScale * 6, value))
    setScale(next)
    setOffset(prev => clampOffset(prev, next))
  }

  // Build the 512x512 export blob. Same transform as the preview, just
  // scaled to the larger output canvas.
  function exportBlob() {
    return new Promise((resolve, reject) => {
      const img = imageRef.current
      if (!img) return reject(new Error('No image loaded'))
      const out = document.createElement('canvas')
      out.width = OUTPUT_SIZE
      out.height = OUTPUT_SIZE
      const ctx = out.getContext('2d')
      // Filling with white avoids a black background bleeding through
      // any transparent edges of the source (e.g. cropping a PNG).
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      // Same transform recipe as the preview, scaled by OUTPUT/PREVIEW so
      // the visible crop matches what gets exported.
      const k = OUTPUT_SIZE / PREVIEW_SIZE
      ctx.translate(OUTPUT_SIZE / 2 + offset.x * k, OUTPUT_SIZE / 2 + offset.y * k)
      ctx.scale(scale * k, scale * k)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      out.toBlob(
        (b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
        'image/jpeg',
        0.92
      )
    })
  }

  // ESC + body-scroll-lock mirror ConfirmModal so the overlay feels native.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape' && !busy) onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, busy, onCancel])

  if (!open) return null
  if (typeof document === 'undefined') return null

  // Portal to document.body. Without this, any ancestor with `z-index` or
  // `transform`/`filter`/`backdrop-blur` would trap the cropper inside
  // that stacking context — so z-[320] could end up *below* a z-10
  // sibling. Portal hoists the DOM to the root so z values are honest.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop your profile image"
      className="fixed inset-0 z-[320] flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onCancel?.()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4">
          <div className="mb-1 text-sm font-black text-white">Crop your image</div>
          <div className="mb-3 text-[11px] font-bold text-zinc-400">
            Drag to reposition · scroll or use the slider to zoom.
          </div>
          <div className="mx-auto flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              className="rounded-full bg-zinc-950 ring-2 ring-amber-300/60 cursor-grab touch-none select-none"
              style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span aria-hidden="true" className="text-xs font-black text-zinc-500">−</span>
            <input
              type="range"
              min={minScale}
              max={minScale * 6}
              step={minScale / 100}
              value={scale}
              onChange={onSliderChange}
              disabled={busy || !loaded}
              className="flex-1 accent-amber-300"
              aria-label="Zoom"
            />
            <span aria-hidden="true" className="text-xs font-black text-zinc-500">+</span>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => !busy && onCancel?.()}
              disabled={busy}
              className="rounded-md border border-zinc-500/50 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (busy) return
                try {
                  const blob = await exportBlob()
                  onConfirm?.(blob)
                } catch (err) {
                  console.error('crop export failed', err)
                }
              }}
              disabled={busy || !loaded}
              className="rounded-md border border-amber-400/60 bg-amber-500/25 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/40 disabled:opacity-50"
            >
              {busy ? 'Uploading…' : 'Use this'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

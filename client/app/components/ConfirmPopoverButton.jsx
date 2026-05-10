'use client'

import { useEffect, useRef, useState } from 'react'

// Trigger button + small confirmation popover, all in one. Replaces the
// fullscreen confirm dialog for low-stakes actions like "recalculate clone".
//
// Behavior:
//   1. First click toggles the popover open (anchored below the button).
//   2. Inside, the user sees a one-line description, an optional "Don't show
//      this again" checkbox, and Cancel / Confirm.
//   3. If the checkbox was ticked when they confirm, we set
//      `localStorage[persistKey] = '1'`.
//   4. Subsequent clicks check that key — if set, the popover is skipped and
//      `onConfirm` runs immediately. The user can re-enable the prompt by
//      clearing site storage; we don't expose an in-app "show me prompts
//      again" panel because nobody asks for that until they need it.
//
// Click-outside and Escape close the popover.
//
// Props:
//   triggerLabel       — string or function (busy) => string for the button.
//   triggerClassName   — Tailwind classes for the trigger button.
//   description        — short body shown inside the popover.
//   confirmLabel       — confirm button copy (default "Confirm").
//   align              — "right" | "left" — which edge of the button the
//                        popover aligns to. Defaults to right (works for
//                        action buttons living on the right side of a row).
//   persistKey         — localStorage key for "don't show again". Optional.
//   busy               — disables the trigger; replaces label with "Working…".
//   onConfirm          — sync or async callback fired on confirm OR direct
//                        click when persistKey is already skipped.
export default function ConfirmPopoverButton({
  triggerLabel,
  triggerClassName,
  description,
  confirmLabel = 'Confirm',
  align = 'right',
  persistKey,
  busy = false,
  onConfirm,
}) {
  const [open, setOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const wrapperRef = useRef(null)

  function shouldSkip() {
    if (!persistKey || typeof window === 'undefined') return false
    try { return window.localStorage.getItem(persistKey) === '1' } catch { return false }
  }

  function handleTrigger(e) {
    e?.preventDefault()
    e?.stopPropagation()
    if (busy) return
    if (shouldSkip()) {
      onConfirm?.()
      return
    }
    setDontShowAgain(false)
    setOpen(prev => !prev)
  }

  function close() {
    setOpen(false)
  }

  function handleConfirm() {
    if (persistKey && dontShowAgain) {
      try { window.localStorage.setItem(persistKey, '1') } catch {}
    }
    setOpen(false)
    onConfirm?.()
  }

  // Click-outside + Escape to close. Only wire when open so we don't leave
  // listeners around the rest of the time.
  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (wrapperRef.current?.contains(e.target)) return
      close()
    }
    function onKey(e) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const labelText = typeof triggerLabel === 'function'
    ? triggerLabel(busy)
    : (busy ? 'Working…' : triggerLabel)

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleTrigger}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={triggerClassName}
      >
        {labelText}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Confirm"
          className={`absolute top-[calc(100%+6px)] z-[150] w-72 rounded-lg border border-amber-300/60 bg-zinc-900/98 shadow-2xl ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          {/* Top accent stripe — matches the rest of the app's "this is a
              real action" treatment. */}
          <div className="h-[3px] w-full rounded-t-lg bg-amber-300" />
          <div className="p-3">
            {description && (
              <div className="text-[11px] font-bold leading-snug text-zinc-200">
                {description}
              </div>
            )}

            {persistKey && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px] font-bold text-zinc-400">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={e => setDontShowAgain(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-amber-300"
                />
                Don&apos;t show this again
              </label>
            )}

            <div className="mt-3 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-[10px] font-bold text-white transition-colors hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-md border border-amber-400/60 bg-amber-500/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/40"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

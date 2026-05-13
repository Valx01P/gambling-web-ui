'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
//   busy               — async in-flight signal. Disables the trigger AND
//                        replaces the label with "Working…". Use this for
//                        callbacks that take time (e.g. an API write).
//   disabled           — generic disabled state. Disables the trigger but
//                        KEEPS the label intact. Use for "not currently
//                        applicable" cases (e.g. "★ Auto-Fill · Full" when
//                        no seats are available).
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
  disabled = false,
  onConfirm,
}) {
  const [open, setOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  // Anchor rect snapped at open time + refreshed on resize/scroll so
  // the portaled popover tracks the trigger button. Without portaling,
  // the popover was clipped by ancestor `overflow-y-auto` containers
  // (the Tools menu is the worst offender) — the user saw a sliver of
  // a popup or nothing at all.
  const [anchorRect, setAnchorRect] = useState(null)
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)

  function shouldSkip() {
    if (!persistKey || typeof window === 'undefined') return false
    try { return window.localStorage.getItem(persistKey) === '1' } catch { return false }
  }

  function handleTrigger(e) {
    e?.preventDefault()
    e?.stopPropagation()
    if (busy || disabled) return
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

  // Click-outside + Escape to close. Only wire when open so we don't
  // leave listeners around the rest of the time. The check is against
  // BOTH the trigger button and the portaled popover, since they're
  // no longer DOM-siblings (the popover lives on document.body).
  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (buttonRef.current?.contains(e.target)) return
      if (popoverRef.current?.contains(e.target)) return
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

  // Track the trigger button's screen position so the portaled popover
  // can pin to it. Recomputed on every resize + any ancestor scroll
  // (capture phase, to catch scrolls inside containers like the Tools
  // menu's `overflow-y-auto`).
  useEffect(() => {
    if (!open) return
    function reposition() {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r) {
        setAnchorRect({
          top: r.bottom,
          left: r.left,
          right: window.innerWidth - r.right,
          width: r.width
        })
      }
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const labelText = typeof triggerLabel === 'function'
    ? triggerLabel(busy)
    : (busy ? 'Working…' : triggerLabel)

  // Portal style props derived from the live anchor rect. align='left'
  // pins the popover to the trigger's left edge; align='right' pins to
  // the right edge (the default — works for action buttons living on
  // the right side of a row).
  const popoverStyle = anchorRect
    ? align === 'left'
      ? { top: anchorRect.top + 6, left: anchorRect.left }
      : { top: anchorRect.top + 6, right: anchorRect.right }
    : null

  const popover = open && anchorRect && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Confirm"
          className="fixed z-[210] w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-amber-300/60 bg-zinc-900/98 shadow-2xl"
          style={popoverStyle}
          // Stop pointerdown (in addition to click) so the Tools menu's
          // click-outside-to-close handler — which listens on
          // pointerdown — doesn't fire when the user interacts with
          // this portaled popover. Without this, the popup is on
          // document.body and looks "outside" to the Tools menu.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
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
                ← Back
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
        </div>,
        document.body
      )
    : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleTrigger}
        disabled={busy || disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={triggerClassName}
      >
        {labelText}
      </button>
      {popover}
    </>
  )
}

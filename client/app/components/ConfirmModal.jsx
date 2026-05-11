'use client'

import { useEffect } from 'react'

// Small themed confirm dialog that replaces the native window.confirm().
// Two reasons we don't use the browser dialog:
//   * Styling — matches the rest of the app (zinc/amber palette, rounded
//     corners, FuzzyBackground-friendly).
//   * It can describe "what's about to happen" with structured copy + a
//     bullet list, which a one-line confirm() can't do.
//
// Props:
//   open       — boolean, mounts/unmounts the dialog.
//   title      — short headline, e.g. "Recalculate clone bot?".
//   description — short paragraph describing the action.
//   bullets    — optional string[] rendered as a bullet list under description.
//   confirmLabel / cancelLabel — button copy. Defaults: "Confirm" / "Cancel".
//   tone       — "primary" (amber) | "danger" (red). Drives the confirm style.
//   busy       — disables the confirm button (e.g. while the request is in flight).
//   onConfirm  — async callback the parent runs when the user confirms.
//   onClose    — fired on cancel, backdrop click, or after a successful confirm.
export default function ConfirmModal({
  open,
  title = 'Are you sure?',
  description,
  bullets,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onClose,
}) {
  // Body scroll lock + ESC handling while the dialog is open. Has to be
  // declared before the early return so the hook order stays stable
  // across renders.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(e) {
      if (e.key === 'Escape' && !busy) onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, busy, onClose])

  if (!open) return null

  const confirmClasses = tone === 'danger'
    ? 'border-red-400/60 bg-red-500/25 text-red-100 hover:bg-red-500/40'
    : 'border-amber-400/60 bg-amber-500/25 text-amber-100 hover:bg-amber-500/40'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[310] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose?.()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl"
        style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent stripe — keeps the dialog feeling like a deliberate action */}
        <div className={`h-1 w-full ${tone === 'danger' ? 'bg-red-400' : 'bg-amber-300'}`} />
        <div className="p-4">
          <div className="text-sm font-black text-white">{title}</div>
          {description && (
            <div className="mt-2 text-[12px] font-medium leading-relaxed text-zinc-300">
              {description}
            </div>
          )}
          {Array.isArray(bullets) && bullets.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-md border border-zinc-700/70 bg-zinc-950/40 p-2 text-[11px] font-bold text-zinc-300">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="text-amber-300">·</span>
                  <span className="flex-1">{b}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => !busy && onClose?.()}
              disabled={busy}
              className="rounded-md border border-zinc-500/50 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`rounded-md border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${confirmClasses}`}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

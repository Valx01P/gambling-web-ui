'use client'

import { useEffect, useRef, useState } from 'react'

// Right-side icon button that opens a small popover with the bot
// think-delay slider. Lives below the global AccountDock stack
// (avatar / DMs / notifications) and only mounts when there's at
// least one bot at the table — no bots means there's nothing for
// the slider to control.
//
// Style matches NotificationsBell + DmsPopup: h-9 w-9 rounded-full
// dark backdrop. Server clamps to [800, 3000] ms; we mirror those
// bounds on the slider so the displayed value can't escape them.
const MIN_DELAY = 800
const MAX_DELAY = 3000
const STEP_DELAY = 100

export default function BotSpeedDock({ value, onChange, visible = true }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (wrapRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!visible) return null

  const clamped = Math.max(MIN_DELAY, Math.min(MAX_DELAY, Number(value) || MIN_DELAY))

  return (
    <div ref={wrapRef} className="pointer-events-auto relative inline-flex h-9 items-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Bot speed"
        title="Bot think-delay"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-500/50 bg-zinc-800/80 text-zinc-200 shadow-sm transition-colors hover:bg-zinc-700/90 hover:text-white"
      >
        {/* Robot face glyph — kept as SVG so it tints with the
            currentColor swap on hover, matching the bell/messages
            icons next to it in the dock. */}
        <svg
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="h-5 w-5" aria-hidden
        >
          <rect x="4" y="7" width="16" height="12" rx="2" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <circle cx="12" cy="5" r="1" />
          <line x1="8" y1="12" x2="8" y2="13" />
          <line x1="16" y1="12" x2="16" y2="13" />
          <line x1="9" y1="16" x2="15" y2="16" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[200] mt-2 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
          <div className="border-b border-zinc-800/80 px-3 py-2">
            <div className="text-[11px] font-black uppercase tracking-widest text-emerald-200/80">Bot speed</div>
            <div className="mt-0.5 text-[10px] font-bold text-zinc-500">
              How long bots wait before each action. Synced for everyone at the table.
            </div>
          </div>
          <div className="px-3 py-3 flex items-center gap-3">
            <input
              type="range"
              min={MIN_DELAY}
              max={MAX_DELAY}
              step={STEP_DELAY}
              value={clamped}
              onChange={(e) => onChange?.(Number(e.target.value))}
              aria-label="Bot move delay"
              className="flex-1 h-1.5 accent-emerald-400 cursor-pointer touch-pan-y"
            />
            <span className="text-xs font-black tabular-nums text-emerald-100 w-12 text-right shrink-0">
              {(clamped / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'

// Two-phase popup for the pin_hack item.
//
//   Phase 1 (memorize, 2s):  shows a 4-digit PIN with a fake "remember
//                            this" framing. Bright + frictionless to read.
//   Phase 2 (input, 10s):    switches to a fake "account compromised"
//                            panel demanding the same PIN. The user has
//                            10s + the 2s already burned in phase 1
//                            (server-side timeout is 12s total).
//
// Submit resolves immediately. If the user wins the recall, no money
// moves. If they fumble or run out the clock, the server drains the
// captured slice (10-50% of their bank balance at trigger time) into
// the hacker's bank.

const PHASE_SHOW_MS = 2000
const PHASE_INPUT_MS = 10_000

export default function PinHackModal({ senderUsername, pin, amount, onSubmit }) {
  const [phase, setPhase] = useState('show')   // 'show' | 'input'
  const [guess, setGuess] = useState('')
  const [remainingMs, setRemainingMs] = useState(PHASE_INPUT_MS)
  const inputRef = useRef(null)
  const submittedRef = useRef(false)

  // Phase transition. Switch to the input panel after PHASE_SHOW_MS.
  useEffect(() => {
    const t = setTimeout(() => setPhase('input'), PHASE_SHOW_MS)
    return () => clearTimeout(t)
  }, [])

  // Input-phase countdown. Updates display every ~100ms so the bar
  // reads as live; the server is what actually enforces the deadline
  // (12s from popup push) so this is purely cosmetic.
  useEffect(() => {
    if (phase !== 'input') return
    const start = Date.now()
    const id = setInterval(() => {
      const left = Math.max(0, PHASE_INPUT_MS - (Date.now() - start))
      setRemainingMs(left)
      if (left <= 0) clearInterval(id)
    }, 100)
    return () => clearInterval(id)
  }, [phase])

  // Auto-focus the input the moment phase 2 starts so the user can
  // start typing immediately without hunting for the box.
  useEffect(() => {
    if (phase !== 'input') return
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [phase])

  function submit(guessOverride) {
    if (submittedRef.current) return
    submittedRef.current = true
    onSubmit?.(typeof guessOverride === 'string' ? guessOverride : guess)
  }

  // Phase 1 — memorize. No interaction; the dramatic 2s reveal is the
  // whole point. The text is intentionally chill ("here's your PIN")
  // so the panic shift to phase 2 lands harder.
  if (phase === 'show') {
    return (
      <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/85 backdrop-blur-sm">
        <div className="w-[min(94vw,420px)] rounded-2xl border border-emerald-400/60 bg-zinc-950/95 px-6 py-7 shadow-2xl">
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Account security</div>
            <div className="mt-1 text-base font-black text-white leading-snug">
              Here&apos;s your PIN — <span className="text-emerald-200">remember it</span>.
            </div>
            <div className="mt-5 select-all rounded-xl border border-emerald-400/60 bg-emerald-500/15 px-4 py-5 font-mono text-[40px] font-black tracking-[0.5em] text-emerald-100 tabular-nums">
              {pin}
            </div>
            <div className="mt-3 text-[11px] font-bold text-zinc-500">
              You may need it in a moment.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Phase 2 — fake compromise. Aggressive framing, countdown bar.
  const secondsLeft = Math.ceil(remainingMs / 1000)
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-red-950/70 backdrop-blur-sm">
      <div className="w-[min(94vw,440px)] rounded-2xl border-2 border-red-500/80 bg-zinc-950/97 px-6 py-6 shadow-[0_0_40px_rgba(239,68,68,0.3)]">
        <div className="text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-red-300 animate-pulse">⚠ Security Alert</div>
          <div className="mt-1 text-base font-black text-red-100 leading-snug">
            Your account has been compromised.
          </div>
          <div className="mt-1 text-[12px] font-bold text-zinc-300 leading-snug">
            Input your <span className="text-amber-200">4-digit PIN</span> to lock attackers out — or they&apos;ll
            walk with <span className="text-amber-200">${(amount || 0).toLocaleString()}</span> from your bank.
          </div>
        </div>

        <form
          className="mt-4 flex flex-col items-center gap-3"
          onSubmit={(e) => { e.preventDefault(); submit() }}
        >
          <input
            ref={inputRef}
            value={guess}
            onChange={e => {
              // Digits only, max 4. Auto-submit when the 4th digit lands.
              const next = e.target.value.replace(/\D/g, '').slice(0, 4)
              setGuess(next)
              if (next.length === 4) submit(next)
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            className="w-full max-w-[220px] rounded-xl border-2 border-red-500/60 bg-zinc-900 px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.5em] text-amber-100 outline-none focus:border-amber-300"
            aria-label="PIN"
          />
          <button
            type="submit"
            disabled={guess.length !== 4}
            className="rounded-md border border-amber-400/60 bg-amber-500/20 px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm PIN
          </button>
        </form>

        <div className="mt-4 space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-red-500 transition-all"
              style={{ width: `${(remainingMs / PHASE_INPUT_MS) * 100}%` }}
            />
          </div>
          <div className="text-center text-[10px] font-black uppercase tracking-widest text-red-300">
            {secondsLeft}s left · From: {senderUsername}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../lib/api'

// Steam-style achievement toast. The parent owns the open/closed state via
// `achievement` prop; pass null to hide. We auto-dismiss after a generous
// 12s but the user can also click the CTA (which routes to the bot editor)
// or the close × to dismiss early.
//
// The toast slides in from the bottom-right and uses the same zinc/amber
// palette the rest of the app uses so it doesn't feel grafted on.
export default function AchievementToast({ achievement, onDismiss }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!achievement) return
    setError(null)
    const t = setTimeout(() => onDismiss?.(), 12_000)
    return () => clearTimeout(t)
  }, [achievement, onDismiss])

  if (!achievement) return null

  async function buildBot() {
    setBusy(true)
    setError(null)
    try {
      const { bot } = await api.buildMyBot()
      onDismiss?.()
      router.push(`/poker/bots/${bot.id}`)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to build bot')
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[200] w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-xl border border-amber-300/60 bg-zinc-950/95 shadow-2xl backdrop-blur-md sm:bottom-5 sm:right-5"
      style={{ animation: 'achievementSlideIn 320ms ease-out forwards' }}
    >
      {/* Trophy stripe — keeps the toast feeling like a "you earned this" event */}
      <div className="h-1 w-full bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500" />
      <div className="flex items-start gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-300/60 bg-amber-400/15 text-lg">
          <span aria-hidden="true">🏆</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-200">
            Achievement unlocked
          </div>
          <div className="mt-0.5 text-sm font-black text-white">{achievement.title}</div>
          <div className="mt-1 text-[11px] font-medium leading-snug text-zinc-300">
            {achievement.body}
          </div>
          {error && (
            <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200">
              {error}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={buildBot}
              disabled={busy}
              className="rounded-md border border-amber-400/60 bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
            >
              {busy ? 'Building…' : (achievement.cta || 'Build my bot')}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-[11px] font-bold text-zinc-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
          aria-label="Close achievement"
        >
          ×
        </button>
      </div>

      {/* Tiny inline keyframes — no global CSS edit needed for a one-off toast */}
      <style jsx>{`
        @keyframes achievementSlideIn {
          from {
            transform: translate(20%, 20%) scale(0.95);
            opacity: 0;
          }
          to {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

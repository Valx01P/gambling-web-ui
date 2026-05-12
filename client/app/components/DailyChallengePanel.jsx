'use client'

import { memo, useEffect, useState } from 'react'
import { api } from '../lib/api'

// Daily challenge tool. Single panel that fetches today's challenge from
// the server and renders the user's progress bar. The same challenge
// shows for everyone in the world for the current UTC date — the server
// picks deterministically from the date string (no cron needed).
//
// Progress is server-authoritative: when `selfProgress` (from the live
// room_update payload) changes, the bar updates without re-fetching.

function fmtCount(n) {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return Math.round(n).toString()
}

const DailyChallengePanel = memo(function DailyChallengePanel({
  selfProgress = 0,
  selfCompleted = false,
  dailiesCompleted = 0,
}) {
  const [todays, setTodays] = useState(null)  // { daily, dateKey, lifetime, unlockTiers }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetch on mount. The daily rolls over at midnight UTC; for a long-lived
  // session we could poll, but a refresh on next hand is usually enough.
  // Uses api.dailiesToday() so the request hits the right host (API server
  // on :3001 in dev, env-driven in prod) with Bearer-token auth — raw
  // `fetch('/api/...')` would hit the Next.js dev server's :3000 origin.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.dailiesToday()
      .then(payload => { if (!cancelled) setTodays(payload) })
      .catch(err => { if (!cancelled) setError(err?.detail || err?.message || 'failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="px-3 py-4 text-xs text-zinc-500 italic">Loading today's challenge…</div>
  }
  if (error || !todays?.daily) {
    return <div className="px-3 py-4 text-xs text-red-300">Couldn't load today's challenge.</div>
  }

  const d = todays.daily
  // Prefer live broadcast (selfProgress) over the snapshot from the GET
  // request — the GET fires once on mount, the WS keeps updating.
  const progress = Math.max(d.progress || 0, selfProgress || 0)
  const completed = selfCompleted || progress >= d.target
  const pct = Math.min(100, Math.round((progress / d.target) * 100))

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Today's challenge</div>
        <div className="mt-0.5 text-sm font-black text-white">{d.title}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-zinc-400">{d.description}</div>
      </div>

      <div>
        <div className="flex items-baseline justify-between text-[10px]">
          <span className="font-bold text-zinc-300">
            {completed ? 'Completed!' : `${fmtCount(progress)} / ${fmtCount(d.target)}`}
          </span>
          <span className="text-zinc-500">+1,000 chips</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800 ring-1 ring-zinc-700/60">
          <div
            className={`h-full transition-all duration-500 ${completed ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="rounded-md border border-zinc-700/50 bg-zinc-900/40 px-2.5 py-2 text-[10px] text-zinc-400">
        <div>
          <span className="font-bold text-zinc-200">{dailiesCompleted || 0}</span>
          {' '}dailies completed lifetime
        </div>
        <div className="mt-0.5 text-zinc-500">
          Unlocks new player skins at 1, 5, 10, 15, 20, 25, 30, 35, 40, 50.
        </div>
      </div>
    </div>
  )
})

export default DailyChallengePanel

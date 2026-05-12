'use client'

import { memo, useEffect, useState } from 'react'
import { api } from '../lib/api'

// Trophy grid for the profile popover. Fetches the full catalog (with
// per-user unlock flags) once on mount. Locked trophies render dimmed
// with the title hidden — they show as silhouettes so the user knows
// what's there to chase without spoiling the full set.

const AchievementsGrid = memo(function AchievementsGrid({ userIdHint }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let cancelled = false
    api.achievementsList()
      .then(json => { if (!cancelled) setItems(json?.achievements || []) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [userIdHint])

  if (!items) return <div className="text-[10px] text-zinc-500 italic">Loading…</div>
  if (!items.length) return null

  const unlocked = items.filter(a => a.unlocked)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Trophies</span>
        <span className="text-[10px] text-zinc-500">{unlocked.length} / {items.length}</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {items.map(a => (
          <div
            key={a.id}
            title={a.unlocked ? `${a.title} — ${a.blurb}` : 'Locked'}
            className={`relative aspect-square rounded-md border text-[8px] font-black uppercase text-center flex items-center justify-center px-0.5 leading-tight ${
              a.unlocked
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-700'
            }`}
          >
            {a.unlocked ? a.title.slice(0, 18) : '?'}
          </div>
        ))}
      </div>
    </div>
  )
})

export default AchievementsGrid

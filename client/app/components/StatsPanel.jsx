'use client'

import { memo } from 'react'
import { formatPercent } from '../lib/pokerOdds'

// 2026-05: collapsed to a single compact state. The Details / Less /
// minimize / restore controls were removed at the user's request —
// most players only care about the equity %, and the extra options
// were just noise. Only a close (×) button remains. The widget's
// width now matches the Tools + Lobby cluster's natural width.
function StatsPanelImpl({ statistics, onClose }) {
  const hero = statistics?.hero
  const equityLabel = hero?.equity ? formatPercent(hero.equity.equity) : '—'
  const phaseLabel = statistics?.phase ? statistics.phase.toUpperCase() : 'WAITING'
  return (
    <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-3 py-1.5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[9px] font-black uppercase tracking-widest text-zinc-400">Equity · {phaseLabel}</div>
          <div className="text-sm font-black text-white tabular-nums">{equityLabel}</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close stats"
            title="Close"
            className="shrink-0 rounded-md border border-zinc-600/50 bg-zinc-900/70 px-1.5 py-0.5 text-[10px] font-black text-zinc-300 hover:bg-zinc-700"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// Memoized: parent re-renders on every WS tick, but StatsPanel only needs
// to repaint when the derived statistics object actually changes.
// statistics is already useMemo'd in the parent so shallow comparison
// is the right boundary here.
const StatsPanel = memo(StatsPanelImpl)
export default StatsPanel

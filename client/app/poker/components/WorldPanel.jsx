'use client'

import { useState } from 'react'
import CatalogIcon from './CatalogIcon'
import WorldMapView from './WorldMapView'

// World-map tycoon panel. Two views: a flat grid Map View where
// territories are laid out by region with owner colors painted on
// the cells, and a List View with full per-territory details.

function fmtCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

// Region groups for the flat map layout — order top-to-bottom.
// "orbital" floats above earth; polar regions bracket the world.
const REGION_GROUPS = [
  { id: 'orbital',   label: 'Off-World' },
  { id: 'polar',     label: 'Polar' },
  { id: 'americas',  label: 'Americas' },
  { id: 'eurasia',   label: 'Eurasia' },
  { id: 'africa',    label: 'Africa' },
  { id: 'oceania',   label: 'Oceania / Pacific' },
  { id: 'other',     label: 'Other' },
]

export default function WorldPanel({ worldState, myChips, joined, myPlayerId, onClaim, onPandemic }) {
  // 'globe' = real SVG world map with country borders
  // 'map'   = stylized regional grid (faster, no network for the topojson)
  // 'list'  = full detail per territory
  const [view, setView] = useState('globe')
  const territories = worldState?.territories || []
  const myOwned = territories.filter(t => t.isMine).length
  const yieldMul = worldState?.yieldMultiplier ?? 1
  const myYield = territories
    .filter(t => t.isMine)
    .reduce((s, t) => s + Math.floor((t.yieldBase || 0) * yieldMul), 0)
  const pandemicCost = Math.max(100_000,
    Math.floor(territories.reduce((s, t) => s + (t.currentCost || 0), 0) * 0.05))
  const myColor = worldState?.myColor || '#10b981'

  // Group by region for the map layout. Empty regions are skipped so
  // the layout doesn't show ghost headers.
  const byRegion = new Map()
  for (const t of territories) {
    const r = t.region || 'other'
    if (!byRegion.has(r)) byRegion.set(r, [])
    byRegion.get(r).push(t)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Your Empire</div>
            <div className="text-sm font-black text-white flex items-center gap-2">
              {myOwned > 0 && (
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: myColor }} title="Your territory color" />
              )}
              <span>{myOwned} {myOwned === 1 ? 'territory' : 'territories'}</span>
              {myOwned > 0 && (
                <span className="text-emerald-300">+${fmtCompact(myYield)}/hand</span>
              )}
            </div>
          </div>
          <div className={`text-[10px] font-black uppercase tracking-widest ${worldState?.pandemicActive ? 'text-red-300' : 'text-zinc-500'}`}>
            {worldState?.pandemicActive ? `Pandemic · ${worldState.pandemicEndsInHands ?? '?'}h` : 'World stable'}
          </div>
        </div>
        {worldState?.pandemicActive && (
          <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200 leading-snug">
            Yields cut to {(worldState.yieldMultiplier * 100).toFixed(0)}%. Real-estate + stocks also crashed.
          </div>
        )}
      </div>

      <div className="flex gap-1.5 text-[10px] font-black uppercase tracking-widest">
        <button
          type="button"
          onClick={() => setView('globe')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${view === 'globe' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Globe
        </button>
        <button
          type="button"
          onClick={() => setView('map')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${view === 'map' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Regions
        </button>
        <button
          type="button"
          onClick={() => setView('list')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${view === 'list' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          List
        </button>
      </div>

      <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-red-200">☣️ Release Pandemic</div>
            <div className="text-[10px] font-bold text-red-100/80 leading-snug">
              Crash worldwide yields + real-estate + stocks for 6 hands. Cost: ${fmtCompact(pandemicCost)}.
            </div>
          </div>
          <button
            type="button"
            onClick={onPandemic}
            disabled={!joined || worldState?.pandemicActive || (myChips || 0) < pandemicCost}
            className="shrink-0 rounded-md border border-red-400/60 bg-red-500/30 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-50 hover:bg-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Release
          </button>
        </div>
      </div>

      {view === 'globe' ? (
        <WorldMapView
          territories={territories}
          myChips={myChips}
          joined={joined}
          yieldMultiplier={yieldMul}
          onClaim={onClaim}
        />
      ) : view === 'map' ? (
        <div className="space-y-2">
          {REGION_GROUPS.map(group => {
            const tiles = byRegion.get(group.id) || []
            if (tiles.length === 0) return null
            return (
              <div key={group.id} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2">
                <div className="px-1 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">{group.label}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {tiles.map(t => {
                    const owned = !!t.ownerId
                    const fillColor = t.ownerColor || (owned ? '#475569' : 'transparent')
                    const canAfford = (myChips || 0) >= t.currentCost
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onClaim(t.id)}
                        disabled={!joined || t.isMine}
                        title={owned
                          ? (t.isMine ? 'Yours' : `Held by ${t.ownerName} · ${fmtCompact(t.currentCost)} to take`)
                          : !canAfford
                            ? `Costs ${fmtCompact(t.currentCost)} — you can't afford it yet`
                            : `Claim for ${fmtCompact(t.currentCost)}`}
                        className={`relative overflow-hidden rounded-md border px-2 py-2 text-left transition-all disabled:opacity-70 ${
                          t.isMine ? 'border-emerald-400/70' : owned ? 'border-amber-400/40' : 'border-zinc-700/70 hover:border-zinc-500'
                        }`}
                        style={owned
                          ? { background: `linear-gradient(to right, ${fillColor}80, ${fillColor}30)` }
                          : undefined}
                      >
                        <div className="text-[11px] font-black text-white truncate leading-tight">{t.name}</div>
                        <div className="mt-0.5 text-[9px] font-bold leading-tight">
                          <span className="text-emerald-200">+${fmtCompact(Math.floor(t.yieldBase * yieldMul))}/h</span>
                          <span className="ml-1 text-zinc-200">· ${fmtCompact(t.currentCost)}</span>
                        </div>
                        {owned && (
                          <div className="mt-0.5 text-[9px] font-bold truncate">
                            {t.isMine ? (
                              <span className="text-emerald-300">★ YOURS</span>
                            ) : (
                              <span className="text-amber-200">{t.ownerName}</span>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {territories.map(t => {
            const owned = !!t.ownerId
            const canAfford = (myChips || 0) >= t.currentCost
            return (
              <div
                key={t.id}
                className={`rounded-lg border p-3 ${t.isMine ? 'border-emerald-500/50 bg-emerald-950/30' : 'border-zinc-700/70 bg-zinc-950/45'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <CatalogIcon
                      id={t.id}
                      name={t.name}
                      color={t.ownerColor || undefined}
                      className="h-14 w-20 shrink-0 sm:h-16 sm:w-24"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-white truncate">{t.name}</div>
                      <div className="text-[10px] font-bold">
                        <span className="text-zinc-300">Yield </span>
                        <span className="text-emerald-300">+${fmtCompact(Math.floor(t.yieldBase * yieldMul))}/hand</span>
                        <span className="ml-2 text-zinc-300">Cost </span>
                        <span className="text-white">${fmtCompact(t.currentCost)}</span>
                      </div>
                      {owned && (
                        <div className="text-[10px] font-bold text-zinc-400 flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: t.ownerColor || '#94a3b8' }} />
                          Held by {t.isMine ? <span className="text-emerald-300">you</span> : <span className="text-amber-300">{t.ownerName}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onClaim(t.id)}
                    disabled={!joined || t.isMine}
                    title={t.isMine ? 'You already own this' : !canAfford ? `Costs $${fmtCompact(t.currentCost)} — click to see the affordability message` : owned ? `Hostile takeover from ${t.ownerName}` : `Claim ${t.name}`}
                    className={`shrink-0 rounded-md border px-3 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed ${
                      owned
                        ? 'border-red-400/60 bg-red-500/15 text-red-100 hover:bg-red-500/25'
                        : 'border-purple-400/60 bg-purple-500/15 text-purple-100 hover:bg-purple-500/25'
                    }`}
                  >
                    {t.isMine ? 'Owned' : owned ? 'Take' : 'Claim'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

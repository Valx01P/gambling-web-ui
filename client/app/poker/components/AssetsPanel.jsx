'use client'

import { useState } from 'react'
import CatalogIcon from './CatalogIcon'

// Real-estate / appreciating-assets panel. Server is the source of
// truth for the catalog + per-player positions; this component just
// renders them and dispatches buy/sell.
//
// Compact helper duplicated from poker/page.jsx — the panel is self-
// contained on purpose so a future redesign can swap it without
// reaching back into the page-level formatter.
function fmtChipsCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

export default function AssetsPanel({ assetsState, myChips, onBuy, onSell, joined }) {
  const [tab, setTab] = useState('market')
  const catalog = assetsState?.catalog || []
  const positions = assetsState?.myPositions || []
  const marketMul = assetsState?.marketMultiplier ?? 1
  const portfolioValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0)
  const yieldPerHand = positions.reduce((sum, p) => {
    const e = catalog.find(c => c.id === p.assetId)
    return sum + (e?.yieldPerHand || 0) * (p.units || 0)
  }, 0)

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Portfolio</div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Value</div>
            <div className="text-sm font-black text-white">${fmtChipsCompact(portfolioValue)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Yield / hand</div>
            <div className="text-sm font-black text-emerald-300">+${fmtChipsCompact(yieldPerHand)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Market</div>
            <div className={`text-sm font-black ${marketMul < 1 ? 'text-red-300' : 'text-emerald-300'}`}>
              ×{marketMul.toFixed(2)}
            </div>
          </div>
        </div>
        {marketMul < 1 && (
          <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200">
            Market is depressed by an active shock (pandemic / sabotage). Recovers ~4%/hand.
          </div>
        )}
      </div>

      <div className="flex gap-1.5 text-[10px] font-black uppercase tracking-widest">
        <button
          type="button"
          onClick={() => setTab('market')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'market' ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setTab('holdings')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'holdings' ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Holdings ({positions.length})
        </button>
      </div>

      {tab === 'market' && (
        <div className="space-y-1.5">
          {catalog.map(entry => {
            const owned = positions.find(p => p.assetId === entry.id)?.units || 0
            const canAfford = (myChips || 0) >= entry.price
            return (
              <div key={entry.id} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="flex items-start gap-3">
                  <CatalogIcon
                    id={entry.id}
                    name={entry.name}
                    className="h-14 w-20 shrink-0 sm:h-16 sm:w-24"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-white truncate">{entry.name}</div>
                    <div className="text-[10px] font-medium text-zinc-400 leading-snug">{entry.blurb}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-bold">
                      <span className="text-zinc-300">Price <span className="text-white">${fmtChipsCompact(entry.price)}</span></span>
                      <span className="text-zinc-300">Yield/hand <span className="text-emerald-300">+${fmtChipsCompact(entry.yieldPerHand)}</span></span>
                      <span className="text-zinc-300">App. <span className="text-emerald-300">+{(entry.appreciation * 100).toFixed(2)}%</span></span>
                      {owned > 0 && <span className="text-amber-300">Own ×{owned}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onBuy(entry.id, 1)}
                    disabled={!joined || !canAfford}
                    title={!canAfford ? 'Not enough chips' : `Buy 1 × ${entry.name} for $${entry.price.toLocaleString()}`}
                    className="shrink-0 rounded-md border border-emerald-400/60 bg-emerald-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Buy
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'holdings' && (
        <div className="space-y-1.5">
          {positions.length === 0 ? (
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-6 text-center text-[11px] font-bold text-zinc-500">
              No holdings yet. Buy something to start earning passive yield.
            </div>
          ) : (
            positions.map(pos => {
              const entry = catalog.find(c => c.id === pos.assetId)
              if (!entry) return null
              return (
                <div key={pos.assetId} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="flex items-start gap-3">
                    <CatalogIcon
                      id={entry.id}
                      name={entry.name}
                      className="h-14 w-20 shrink-0 sm:h-16 sm:w-24"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-white truncate">{entry.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-bold">
                        <span className="text-zinc-300">Units <span className="text-white">×{pos.units}</span></span>
                        <span className="text-zinc-300">Value <span className="text-white">${fmtChipsCompact(pos.currentValue)}</span></span>
                        <span className="text-zinc-300">Yield/hand <span className="text-emerald-300">+${fmtChipsCompact(entry.yieldPerHand * pos.units)}</span></span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSell(entry.id, 1)}
                      className="shrink-0 rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25"
                    >
                      Sell 1
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

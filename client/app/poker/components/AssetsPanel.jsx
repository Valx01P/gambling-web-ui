'use client'

import { useState } from 'react'
import InfluenceOpsTab, { INFLUENCE_OPS_BY_MARKET } from './InfluenceOpsTab'
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

export default function AssetsPanel({
  assetsState, myChips, onBuy, onSell, joined,
  // Influence-ops integration — real-estate-relevant ops (pandemic)
  // appear as a tab. Optional; not wired in legacy callers.
  influenceState = null, onRunInfluence,
}) {
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
        {/* Bank balance always visible — buys spend from bank, so the
            player needs to know what they can actually afford without
            having to flip back to another tab. */}
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-800/80 pt-2 text-[10px] font-bold text-zinc-400">
          <span>Bank balance: <span className="tabular-nums text-white">${fmtChipsCompact(myChips)}</span></span>
          <span className="text-zinc-500">Purchases spend from your bank.</span>
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
        {influenceState && onRunInfluence && (
          <button
            type="button"
            onClick={() => setTab('influence')}
            className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'influence' ? 'border-violet-500/60 bg-violet-500/20 text-violet-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
            title="Ops that hit real-estate"
          >
            Influence
          </button>
        )}
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
                      {/* Yield: rate + dollar amount on one line so
                          the two numbers can't disagree. The rate is
                          the 3-9% slice of basePrice rolled at server
                          construction (entry.yieldPct); the dollar
                          number is that rate × basePrice. Falls back
                          to a computed approximation if yieldPct is
                          missing from a stale broadcast. */}
                      <span className="text-zinc-300">
                        Yield <span className="text-emerald-300">
                          {entry.yieldPct != null
                            ? `${(entry.yieldPct * 100).toFixed(1)}%`
                            : entry.price > 0
                              ? `${((entry.yieldPerHand / entry.price) * 100).toFixed(1)}%`
                              : '—'}
                        </span> <span className="text-emerald-300">+${fmtChipsCompact(entry.yieldPerHand)}</span><span className="text-zinc-500">/hand</span>
                      </span>
                      {owned > 0 && <span className="text-amber-300">Own ×{owned}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onBuy(entry.id, 1)}
                    disabled={!joined || !canAfford}
                    title={!canAfford ? `Need $${entry.price.toLocaleString()} — short $${(entry.price - (myChips || 0)).toLocaleString()}` : `Buy 1 × ${entry.name} for $${entry.price.toLocaleString()}`}
                    className="shrink-0 rounded-md border border-emerald-400/60 bg-emerald-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {canAfford ? 'Buy' : `Need $${fmtChipsCompact(entry.price - (myChips || 0))}`}
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

      {tab === 'influence' && influenceState && onRunInfluence && (
        <InfluenceOpsTab
          opIds={INFLUENCE_OPS_BY_MARKET.assets}
          influenceState={influenceState}
          myChips={myChips}
          onRun={onRunInfluence}
          joined={joined}
          accent="emerald"
          intro="Real-estate-disrupting ops. A pandemic crashes territory yields globally and tanks property values — buy the dip if you can stomach it."
        />
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'

// Influence Ops panel — pay-to-manipulate-markets meta layer.
// Each op shows its cost, cooldown, and effect summary. Ops that
// require a target (CEO Scandal, Insider Tip) expand an inline
// stock-picker; the rest fire immediately.

function fmtCost(amount) {
  const n = Number(amount) || 0
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

export default function InfluencePanel({ influenceState, stocksState, myChips, onRun, joined }) {
  const ops = influenceState?.ops || []
  const stocks = stocksState?.stocks || []
  const [pickerFor, setPickerFor] = useState(null)

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-violet-700/60 bg-violet-950/30 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">Influence ops</div>
        <div className="mt-1 text-[11px] font-bold text-zinc-300 leading-snug">
          Pay chips to move markets at scale. Most ops are <span className="text-amber-300">anonymous</span> — the room sees a market event, not who triggered it. Engineered crises are global; insider tips stay private to you.
        </div>
      </div>

      {ops.map(op => {
        const showPicker = pickerFor === op.id
        const canAfford = (myChips || 0) >= op.cost
        const disabled = !joined || !op.ready || !canAfford
        return (
          <div key={op.id} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-900 text-lg">
                {op.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-black text-white">{op.title}</span>
                  {op.attribution === 'global' && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/20 rounded px-1.5 py-0.5">Global</span>
                  )}
                  {op.attribution === 'private' && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-sky-300 bg-sky-500/20 rounded px-1.5 py-0.5">Private</span>
                  )}
                  {op.ready ? (
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />Ready
                    </span>
                  ) : (
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                      {op.cooldownRemaining}h cooldown
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-medium text-zinc-400 leading-snug">{op.blurb}</div>
                <div className="mt-1 text-[10px] font-bold">
                  <span className="text-zinc-300">Cost </span>
                  <span className="text-white">{fmtCost(op.cost)}</span>
                  <span className="ml-2 text-zinc-300">Cooldown </span>
                  <span className="text-white">{op.cooldownHands}h</span>
                </div>

                {showPicker ? (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Pick a target ticker</div>
                    <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto">
                      {stocks.map(s => (
                        <button
                          key={s.symbol}
                          type="button"
                          onClick={() => { onRun(op.id, s.symbol); setPickerFor(null) }}
                          className="rounded-md border border-violet-400/60 bg-violet-500/15 px-2 py-1.5 text-[10px] font-black text-violet-100 hover:bg-violet-500/25 text-left truncate"
                        >
                          ${s.symbol}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setPickerFor(null)}
                      className="block w-full rounded-md border border-zinc-700/60 bg-zinc-900 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => op.requiresTarget ? setPickerFor(op.id) : onRun(op.id, null)}
                    className="mt-2 w-full rounded-md border border-violet-400/60 bg-violet-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-violet-100 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {!op.ready
                      ? `Wait ${op.cooldownRemaining}h`
                      : !canAfford
                      ? `Need ${fmtCost(op.cost)}`
                      : op.requiresTarget ? 'Run → pick target' : 'Run'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

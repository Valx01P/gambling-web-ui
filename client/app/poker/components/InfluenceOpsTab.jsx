'use client'

import { useState } from 'react'

// Influence Ops, displayed as a TAB inside whatever market they affect
// (StocksPanel / WorldPanel / AssetsPanel). The catalog of all ops
// lives server-side; this component just filters by id and renders
// the same UI the legacy InfluencePanel had.
//
// Each call site passes:
//   - `opIds`: which op ids belong to this market's tab
//   - `influenceState`: the full server snapshot (cooldowns, ready, etc.)
//   - `stocksState`: only needed for ops that require a stock target
//   - `myChips`: viewer's available chips for cost gating (bank, in practice)
//   - `onRun(opId, targetSymbol|null)`
//   - `joined`: gates the Run button while not seated

function fmtCost(amount) {
  const n = Number(amount) || 0
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

export default function InfluenceOpsTab({
  opIds,
  influenceState,
  stocksState,
  myChips,
  onRun,
  joined = true,
  // Optional intro blurb tuned to the host panel (e.g. "Stock-market
  // influence ops below…"). Falls back to a generic line.
  intro = null,
  // Tailwind accent — sets the title/intro chrome color so a panel's
  // tab content matches the rest of the panel. Defaults to violet (the
  // legacy influence accent).
  accent = 'violet',
}) {
  const allOps = influenceState?.ops || []
  const visible = allOps.filter(op => opIds.includes(op.id))
  const stocks = stocksState?.stocks || []
  const [pickerFor, setPickerFor] = useState(null)

  const accentBorder = ACCENT_BORDER[accent] || ACCENT_BORDER.violet
  const accentBg = ACCENT_BG[accent] || ACCENT_BG.violet
  const accentText = ACCENT_TEXT[accent] || ACCENT_TEXT.violet
  const accentButton = ACCENT_BUTTON[accent] || ACCENT_BUTTON.violet

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3 text-[11px] font-bold text-zinc-500">
        No influence ops available here.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border ${accentBorder} ${accentBg} p-3`}>
        <div className={`text-[10px] font-black uppercase tracking-widest ${accentText}`}>Influence ops</div>
        <div className="mt-1 text-[11px] font-bold text-zinc-300 leading-snug">
          {intro || 'Pay chips to move markets at scale. Most ops are anonymous — the room sees a market event, not who triggered it.'}
        </div>
      </div>

      {visible.map(op => {
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
                          className={`rounded-md border ${accentButton} px-2 py-1.5 text-[10px] font-black text-left truncate`}
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
                    className={`mt-2 w-full rounded-md border ${accentButton} px-3 py-1.5 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed`}
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

// Per-accent color sets — pre-baked Tailwind class strings so the
// JIT can pick them up. Adding a new accent? Add a row to every map.
const ACCENT_BORDER = {
  violet: 'border-violet-700/60',
  sky:    'border-sky-700/60',
  purple: 'border-purple-700/60',
  emerald:'border-emerald-700/60',
}
const ACCENT_BG = {
  violet: 'bg-violet-950/30',
  sky:    'bg-sky-950/30',
  purple: 'bg-purple-950/30',
  emerald:'bg-emerald-950/30',
}
const ACCENT_TEXT = {
  violet: 'text-violet-300',
  sky:    'text-sky-300',
  purple: 'text-purple-300',
  emerald:'text-emerald-300',
}
const ACCENT_BUTTON = {
  violet: 'border-violet-400/60 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25',
  sky:    'border-sky-400/60 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25',
  purple: 'border-purple-400/60 bg-purple-500/15 text-purple-100 hover:bg-purple-500/25',
  emerald:'border-emerald-400/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25',
}

// Op-id buckets — which market each op belongs to. Centralised here so
// callers don't have to know the catalog by heart.
export const INFLUENCE_OPS_BY_MARKET = {
  stocks: ['fake_bullish_news', 'fake_bearish_news', 'ceo_scandal', 'insider_tip', 'engineered_crisis'],
  world:  ['release_virus'],
  assets: ['release_virus'],
}

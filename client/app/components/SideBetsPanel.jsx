'use client'

import { memo, useMemo, useState, useEffect, useRef } from 'react'

// Polymarket-style in-hand prop bets panel. Always-on tool that sits beside
// the chat dock. Receives `sideBets` from the server (broadcast on every
// state change: hand start, action, phase advance, resolution) and renders
// each open prop as a card with YES/NO buy buttons, an inline bet form, and
// a "your position" section showing live mark-to-market value.
//
// Resolution model (matches sideBetEngine.js):
//   - Each share pays 1 chip if its side resolves true, 0 otherwise.
//   - Buy price = clamp(fair + edge/2). Sell price = clamp(fair - edge/2).
//   - "Void" outcome on card-runout props that never reached the river
//     (fold-out) refunds the original stake.

function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return '—'
  return `${Math.round(p * 100)}%`
}

function fmtChips(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Math.round(n).toString()
}

// Panel renders into whatever height the parent gives it. `expanded` is
// parent-controlled — the parent swaps the wrapper's height class (h-72 →
// taller) and we just paint the resulting space. The expand button toggles
// parent state via onToggleExpanded.
const SideBetsPanel = memo(function SideBetsPanel({
  sideBets,
  myPlayerId,
  myStack,
  onPlace,
  onSell,
  expanded = false,
  onToggleExpanded,
  // Optional close-the-dock handler. When provided, an × button appears
  // in the header so users can dismiss the panel without hunting in the
  // Tools menu. Toggled state persists in page.jsx's localStorage hook.
  onClose,
}) {
  const props = sideBets?.props || []
  const positions = sideBets?.positions || []

  const myPositionsByProp = useMemo(() => {
    const map = new Map()
    for (const pos of positions) {
      if (pos.playerId !== myPlayerId) continue
      const list = map.get(pos.propId) || []
      list.push(pos)
      map.set(pos.propId, list)
    }
    return map
  }, [positions, myPlayerId])

  const volumeByProp = useMemo(() => {
    const map = new Map()
    for (const pos of positions) {
      map.set(pos.propId, (map.get(pos.propId) || 0) + (pos.costPaid || 0))
    }
    return map
  }, [positions])

  const liveCount = props.filter(p => p.status === 'open').length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">Side Bets</span>
          <span className="text-[10px] text-zinc-500">vs. House · 4% edge</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-zinc-400">{liveCount} live</span>
          {onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-label={expanded ? 'Collapse side bets' : 'Expand side bets'}
              title={expanded ? 'Collapse' : 'Expand to see all bets'}
              className="rounded-md border border-zinc-600/60 bg-zinc-800/80 px-1.5 py-0.5 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-700 active:scale-95"
            >
              {expanded ? '↙' : '⤢'}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close side bets"
              title="Close (re-open from Tools)"
              className="rounded-md border border-zinc-600/60 bg-zinc-800/80 px-1.5 py-0.5 text-xs font-bold text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white active:scale-95"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className={`flex-1 overflow-y-auto overscroll-contain px-2 py-2 ${props.length === 0 ? 'flex items-center justify-center' : 'space-y-2'}`}>
        {props.length === 0 && (
          <div className="max-w-[220px] px-2 text-center">
            <div className="text-xs font-semibold text-zinc-300">No markets yet</div>
            <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              Bets spawn when the next hand starts — up to 4 live markets per hand.
            </div>
          </div>
        )}
        {props.map(prop => (
          <PropCard
            key={prop.id}
            prop={prop}
            myPositions={myPositionsByProp.get(prop.id) || []}
            myStack={myStack}
            volume={volumeByProp.get(prop.id) || 0}
            onPlace={onPlace}
            onSell={onSell}
            expanded={expanded}
          />
        ))}
      </div>
    </div>
  )
})

export default SideBetsPanel

const PropCard = memo(function PropCard({ prop, myPositions, myStack, volume, onPlace, onSell, expanded: panelExpanded }) {
  const [expanded, setExpanded] = useState(null)  // null | 'yes' | 'no'
  const [amount, setAmount] = useState(50)
  const lastYesRef = useRef(prop.fairYes)
  const [flash, setFlash] = useState(null)  // 'up' | 'down' | null

  // Flash the YES price tint when fair probability swings — gives the panel
  // its "live ticker" feel as the runout plays out.
  useEffect(() => {
    const prev = lastYesRef.current
    if (typeof prev === 'number' && typeof prop.fairYes === 'number') {
      const delta = prop.fairYes - prev
      if (Math.abs(delta) >= 0.02) {
        setFlash(delta > 0 ? 'up' : 'down')
        const t = setTimeout(() => setFlash(null), 700)
        return () => clearTimeout(t)
      }
    }
    lastYesRef.current = prop.fairYes
  }, [prop.fairYes])

  const isResolved = prop.status !== 'open'
  const outcome = prop.outcome
  const yesPx = prop.buyYesPrice
  const noPx = prop.buyNoPrice
  const yesSellPx = prop.sellYesPrice
  const noSellPx = prop.sellNoPrice

  // Cap the bet form input by what the user has on hand. Bet form jumps to
  // min(stack, 1000) by default so a normal-sized bankroll has a reasonable
  // slider, but the user can always type higher.
  useEffect(() => {
    if (!expanded) return
    setAmount(curr => {
      const target = Math.min(myStack || 0, Math.max(50, curr || 50))
      return target
    })
  }, [expanded, myStack])

  function placeBet() {
    const stake = Math.max(10, Math.min(myStack || 0, Math.floor(amount || 0)))
    if (!expanded || stake < 10) return
    onPlace?.(prop.id, expanded, stake)
    setExpanded(null)
  }

  function sellAll(propId) {
    onSell?.(propId, 0)  // 0 = sell entire position
  }

  const buyPrice = expanded === 'yes' ? yesPx : expanded === 'no' ? noPx : null
  const projShares = buyPrice && amount > 0 ? amount / buyPrice : 0
  const projPayout = Math.round(projShares)
  const projProfit = projPayout - amount

  // Compact resolved row: when the prop has resolved AND the local user has
  // no position, the card collapses to a single line (label · question ·
  // outcome) — both in the dock and the expanded view. The full card adds
  // no information here (no buttons, no positions), so the compact row is
  // the only sensible rendering.
  if (isResolved && myPositions.length === 0) {
    return (
      <div
        className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 animate-sidebet-enter ${
          outcome === 'yes'
            ? 'border-emerald-500/40 bg-emerald-900/15'
            : outcome === 'no'
              ? 'border-red-500/40 bg-red-900/15'
              : 'border-zinc-600/40 bg-zinc-900/60'
        }`}
      >
        <div className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
          <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {prop.shortLabel}
          </span>
          {prop.question}
        </div>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            outcome === 'yes'
              ? 'bg-emerald-500 text-emerald-950'
              : outcome === 'no'
                ? 'bg-red-500 text-red-950'
                : 'bg-zinc-500 text-zinc-950'
          }`}
        >
          {outcome === 'void' ? 'Void' : outcome === 'yes' ? 'Yes' : 'No'}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`rounded-lg border bg-zinc-900/80 transition-all ${
        isResolved
          ? outcome === 'yes'
            ? 'border-emerald-500/60 bg-emerald-900/20'
            : outcome === 'no'
              ? 'border-red-500/60 bg-red-900/20'
              : 'border-zinc-600/60'
          : 'border-zinc-700/60 hover:border-zinc-600'
      } animate-sidebet-enter`}
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {prop.shortLabel}
          </div>
          <div className="mt-0.5 text-xs font-bold leading-tight text-zinc-100">
            {prop.question}
          </div>
        </div>
        {isResolved ? (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
              outcome === 'yes'
                ? 'bg-emerald-500 text-emerald-950'
                : outcome === 'no'
                  ? 'bg-red-500 text-red-950'
                  : 'bg-zinc-500 text-zinc-950'
            }`}
          >
            {outcome === 'void' ? 'Void' : outcome === 'yes' ? 'Yes' : 'No'}
          </span>
        ) : (
          <span
            className={`shrink-0 text-base font-black tabular-nums transition-colors ${
              flash === 'up'
                ? 'text-emerald-400'
                : flash === 'down'
                  ? 'text-red-400'
                  : 'text-zinc-100'
            }`}
          >
            {fmtPct(prop.fairYes)}
          </span>
        )}
      </div>

      {!isResolved && expanded === null && (
        <div className="flex items-stretch gap-1.5 px-2 pb-2 pt-1.5">
          <button
            type="button"
            onClick={() => setExpanded('yes')}
            className="flex-1 rounded-md border border-emerald-500/40 bg-emerald-700/30 px-2 py-1 text-xs font-black text-emerald-200 transition-colors hover:bg-emerald-600/40 active:scale-95"
          >
            Yes · {fmtPct(yesPx)}
          </button>
          <button
            type="button"
            onClick={() => setExpanded('no')}
            className="flex-1 rounded-md border border-red-500/40 bg-red-700/30 px-2 py-1 text-xs font-black text-red-200 transition-colors hover:bg-red-600/40 active:scale-95"
          >
            No · {fmtPct(noPx)}
          </button>
        </div>
      )}

      {!isResolved && expanded !== null && (
        <div className="border-t border-zinc-700/60 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400">
            <span>
              Buying{' '}
              <span className={expanded === 'yes' ? 'text-emerald-300' : 'text-red-300'}>
                {expanded.toUpperCase()}
              </span>{' '}
              at {fmtPct(buyPrice)}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(null)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              min={10}
              max={myStack || 0}
              step={10}
              className="w-20 rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-1 text-sm font-bold text-white outline-none focus:border-amber-400/60"
            />
            <input
              type="range"
              min={10}
              max={Math.max(10, myStack || 10)}
              step={10}
              value={Math.min(amount, myStack || 10)}
              onChange={e => setAmount(parseInt(e.target.value, 10))}
              className="flex-1 accent-amber-400"
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span>
              {projPayout} shares · win{' '}
              <span className="font-bold text-emerald-300">+{projProfit}</span>
            </span>
            <span>
              {amount > (myStack || 0) ? (
                <span className="text-red-400">over stack</span>
              ) : (
                <>stack: {fmtChips(myStack || 0)}</>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={placeBet}
            disabled={!amount || amount < 10 || amount > (myStack || 0)}
            className={`w-full rounded-md px-2 py-1.5 text-xs font-black text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              expanded === 'yes'
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            Place {expanded.toUpperCase()} bet — {amount} chips
          </button>
        </div>
      )}

      {myPositions.length > 0 && (
        <div className="border-t border-zinc-700/60 bg-zinc-900/50 px-3 py-1.5 space-y-1">
          {myPositions.map((pos, idx) => {
            const sellPx = pos.side === 'yes' ? yesSellPx : noSellPx
            const currentValue = Math.round(pos.shares * sellPx)
            const pl = currentValue - pos.costPaid
            const plPct = pos.costPaid > 0 ? Math.round((pl / pos.costPaid) * 100) : 0
            const isWin = isResolved && outcome === pos.side
            const isVoid = isResolved && outcome === 'void'
            return (
              <div key={`${pos.propId}-${pos.side}-${idx}`} className="flex items-center justify-between gap-2 text-[10px]">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">
                    <span className={pos.side === 'yes' ? 'text-emerald-300' : 'text-red-300'}>
                      {pos.side.toUpperCase()}
                    </span>{' '}
                    <span className="text-zinc-300">
                      · {Math.round(pos.shares)} shares
                    </span>
                  </div>
                  <div className="text-zinc-500">
                    {isResolved ? (
                      isWin
                        ? <span className="text-emerald-400 font-bold">+{Math.round(pos.shares) - pos.costPaid} 🎉</span>
                        : isVoid
                          ? <span className="text-zinc-400 font-bold">refunded {pos.costPaid}</span>
                          : <span className="text-red-400 font-bold">−{pos.costPaid}</span>
                    ) : (
                      <>
                        paid {pos.costPaid} · now {currentValue}{' '}
                        <span className={pl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          ({pl >= 0 ? '+' : ''}{plPct}%)
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {!isResolved && (
                  <button
                    type="button"
                    onClick={() => sellAll(pos.propId)}
                    className="shrink-0 rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700 active:scale-95"
                  >
                    Sell
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {volume > 0 && !myPositions.length && !isResolved && (
        <div className="border-t border-zinc-700/60 bg-zinc-900/30 px-3 py-1 text-[10px] text-zinc-500">
          Vol: {fmtChips(volume)} chips
        </div>
      )}
    </div>
  )
})

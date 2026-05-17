'use client'

import { useState } from 'react'
import CatalogIcon from './CatalogIcon'
import Sparkline from './Sparkline'

// Accept K/M/B/T shorthand in the input fields so a player can type
// "5M" instead of "5,000,000". Mirrors the parser in poker/page.jsx.
function parseInputAmount(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(/^\$/, '').replace(/,/g, '').toUpperCase()
  if (!s) return null
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMBT]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const mul = { '': 1, K: 1_000, M: 1_000_000, B: 1_000_000_000, T: 1_000_000_000_000 }[m[2]] ?? 1
  return n * mul
}

// Stock market panel. Distinct from crypto: lower volatility, mean-
// reverting random walk, AND a sabotage button that burns chips to
// crash a target company's price. Three tabs: Market / Holdings /
// Sabotage. Server pushes `stocks:state` snapshots + cheap
// `stocks:tick` price-only updates between snapshots.

function fmtCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

function fmtPrice(n) {
  if (typeof n !== 'number') return '—'
  return n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString()
}

export default function StocksPanel({ stocksState, optionsState, myChips, onBuy, onSell, onSabotage, onBuyOption, onCloseOption, joined }) {
  const [tab, setTab] = useState('market')
  const [buyAmount, setBuyAmount] = useState('')
  // Stock buys are always entered in dollars — non-traders don't know
  // what "Sh" means and the dollar-amount mental model ("yolo $50M
  // into TECH") matches the rest of the casino's economy. The share
  // count is computed + shown beneath the input as feedback.
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  // Pending option order — set when the user taps a call/put price in
  // the chain. Holds the contract picked plus the user-chosen
  // contract count so we can show cost + scenarios + confirm without
  // firing the buy yet. Cleared after Confirm or Cancel.
  const [pendingOption, setPendingOption] = useState(null)
  const stocks = stocksState?.stocks || []
  const positions = stocksState?.myPositions || []
  const portfolioValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0)
  const portfolioCost = positions.reduce((sum, p) => sum + (p.costBasis || 0), 0)
  const pl = portfolioValue - portfolioCost

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Portfolio</div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Value</div>
            <div className="text-sm font-black text-white">${fmtCompact(portfolioValue)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Cost</div>
            <div className="text-sm font-black text-zinc-300">${fmtCompact(portfolioCost)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">P/L</div>
            <div className={`text-sm font-black ${pl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {pl >= 0 ? '+' : '−'}${fmtCompact(Math.abs(pl))}
            </div>
          </div>
        </div>
        {/* Bank balance + a plain-English hint about what the percent
            buttons mean. New players were getting confused — % of
            what? — so we spell it out once at the top of the panel. */}
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-800/80 pt-2 text-[10px] font-bold text-zinc-400">
          <span>Bank balance: <span className="tabular-nums text-white">${fmtCompact(myChips)}</span></span>
          <span className="text-zinc-500">Buy buttons spend a % of your bank balance.</span>
        </div>
        {positions.length > 0 && (
          <div className="mt-2 border-t border-zinc-800/80 pt-2">
            <button
              type="button"
              disabled={!joined}
              onClick={() => {
                // Sweep every open long into the bank in one shot. The
                // server handles each `stock:sell` independently — no
                // batch endpoint, so we fire one per symbol.
                positions.forEach(p => {
                  if (p.shares > 0) onSell(p.symbol, p.shares)
                })
              }}
              title={`Sell all ${positions.length} position${positions.length === 1 ? '' : 's'} at market`}
              className="w-full rounded-md border border-red-400/60 bg-red-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              💥 Sell all shares ({positions.length}) — ${fmtCompact(portfolioValue)}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-[10px] font-black uppercase tracking-widest sm:grid-cols-5">
        <button
          type="button"
          onClick={() => setTab('market')}
          className={`rounded-md border px-2 py-1.5 ${tab === 'market' ? 'border-sky-500/60 bg-sky-500/20 text-sky-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setTab('holdings')}
          className={`rounded-md border px-2 py-1.5 ${tab === 'holdings' ? 'border-sky-500/60 bg-sky-500/20 text-sky-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Holdings ({positions.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('options')}
          className={`rounded-md border px-2 py-1.5 ${tab === 'options' ? 'border-amber-500/60 bg-amber-500/20 text-amber-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Options ({(optionsState?.myPositions || []).length})
        </button>
        <button
          type="button"
          onClick={() => setTab('earnings')}
          className={`rounded-md border px-2 py-1.5 ${tab === 'earnings' ? 'border-fuchsia-500/60 bg-fuchsia-500/20 text-fuchsia-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
          title="Upcoming earnings — gamble on the next print"
        >
          Earnings{(() => {
            const e = stocksState?.upcomingEarnings
            const n = Array.isArray(e) ? e.length : (e ? 1 : 0)
            return n > 0 ? ` 🔔${n}` : ''
          })()}
        </button>
        <button
          type="button"
          onClick={() => setTab('sabotage')}
          className={`rounded-md border px-2 py-1.5 ${tab === 'sabotage' ? 'border-red-500/60 bg-red-500/20 text-red-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Sabotage
        </button>
      </div>

      {tab === 'market' && (
        <div className="space-y-1.5">
          {stocks.map(stock => {
            const expanded = selectedSymbol === stock.symbol
            const prev = stock.history?.[stock.history.length - 2]?.p
            const delta = prev ? ((stock.price - prev) / prev) * 100 : 0
            return (
              <div key={stock.symbol} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <button type="button" onClick={() => setSelectedSymbol(expanded ? null : stock.symbol)} className="flex w-full items-center justify-between gap-2 text-left">
                  <CatalogIcon
                    id={stock.symbol}
                    name={stock.name}
                    className="h-10 w-12 shrink-0 sm:h-12 sm:w-14"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-white truncate">
                      ${stock.symbol} <span className="text-zinc-400 text-[10px] font-bold">{stock.name}</span>
                    </div>
                    <div className="text-[10px] font-bold text-zinc-500">{stock.sector}</div>
                  </div>
                  {/* Sparkline showing the last ~60 ticks — a quick
                      visual cue for trend direction. Fades into the
                      card so it doesn't dominate. */}
                  <div className="shrink-0 self-center hidden xs:block sm:block">
                    <Sparkline history={stock.history} width={64} height={22} />
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-black text-white tabular-nums">${fmtPrice(stock.price)}</div>
                    <div className={`text-[10px] font-bold tabular-nums ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(2)}%
                    </div>
                  </div>
                </button>
                {stock.sabotaged && (
                  <div className="mt-1 text-[10px] font-bold text-red-300">⚠️ Under active sabotage</div>
                )}
                {expanded && (() => {
                  // Long-only. Matches the crypto-market layout: one
                  // flat row of action buttons, no inputs, no confirm
                  // dialogs. 10/25/50 % buys (green) → Sell ½ / Sell
                  // all (amber/red) when a position is open.
                  // Shorting removed entirely per design.
                  const myPosition = positions.find(p => p.symbol === stock.symbol)
                  const buyAtPct = (pct) => {
                    const dollars = Math.floor(((myChips || 0) * pct) / 100)
                    if (dollars <= 0) return
                    onBuy(stock.symbol, dollars)
                  }
                  return (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {[10, 25, 50].map(pct => (
                        <button
                          key={`buy${pct}`}
                          type="button"
                          onClick={() => buyAtPct(pct)}
                          disabled={!joined || (myChips || 0) <= 0}
                          title={`Buy with ${pct}% of bank`}
                          className="rounded border border-emerald-500/60 bg-emerald-700/70 px-2 py-1 text-[11px] font-black text-white hover:bg-emerald-600/80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {pct}%
                        </button>
                      ))}
                      {myPosition && myPosition.shares > 0 && (
                        <>
                          <button type="button" disabled={!joined} onClick={() => onSell(stock.symbol, myPosition.shares / 2)} className="rounded border border-amber-500/60 bg-amber-700/60 px-2 py-1 text-[11px] font-black text-white hover:bg-amber-600/70">
                            Sell ½
                          </button>
                          <button type="button" disabled={!joined} onClick={() => onSell(stock.symbol, myPosition.shares)} className="rounded border border-red-500/60 bg-red-700/60 px-2 py-1 text-[11px] font-black text-white hover:bg-red-600/70">
                            Sell all
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          // Stop the parent expand-toggle from collapsing
                          // the card right after we navigate away — feels
                          // janky to have the tab change *and* the picker
                          // collapse the symbol you just clicked into.
                          e.stopPropagation()
                          setSelectedSymbol(stock.symbol)
                          setTab('options')
                        }}
                        title={`Open ${stock.symbol} options chain`}
                        className="ml-auto rounded border border-amber-400/60 bg-amber-500/20 px-2 py-1 text-[11px] font-black text-amber-100 hover:bg-amber-500/30"
                      >
                        Options →
                      </button>
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'holdings' && (
        <div className="space-y-1.5">
          {positions.length === 0 ? (
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-6 text-center text-[11px] font-bold text-zinc-500">
              No positions yet.
            </div>
          ) : (
            positions.map(pos => {
              const stock = stocks.find(s => s.symbol === pos.symbol)
              if (!stock) return null
              const pnl = pos.currentValue - pos.costBasis
              return (
                <div key={pos.symbol} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-white">${pos.symbol}</div>
                      <div className="text-[10px] font-bold text-zinc-300">
                        {pos.shares.toFixed(2)} shares · cost ${fmtCompact(pos.costBasis)}
                      </div>
                      <div className="text-[10px] font-bold">
                        Value <span className="text-white">${fmtCompact(pos.currentValue)}</span>
                        <span className={pnl >= 0 ? 'ml-2 text-emerald-300' : 'ml-2 text-red-300'}>
                          {pnl >= 0 ? '+' : ''}${fmtCompact(pnl)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSell(pos.symbol, pos.shares)}
                      className="shrink-0 rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25"
                    >
                      Sell All
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'options' && (() => {
        const myOpts = optionsState?.myPositions || []
        const expiryHands = optionsState?.expiryHands ?? 3
        // Find the active stock from the URL state OR default to first.
        const pickedStock = stocks.find(s => s.symbol === selectedSymbol) || stocks[0]
        const chainForStock = (optionsState?.chain || []).filter(c => c.symbol === pickedStock?.symbol)
        // Group by strike so call + put for the same strike sit side by side.
        const strikes = [...new Set(chainForStock.map(c => c.strike))].sort((a, b) => a - b)
        return (
          <div className="space-y-2">
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">Short-dated options</div>
              <div className="mt-1 text-[11px] font-bold text-zinc-300 leading-snug">
                Pick a strike, pay the premium, settle in <span className="text-amber-200">{expiryHands} hands</span>. Each contract controls 100 underlying shares. Lose the premium if OTM; payouts scale linearly when ITM.
              </div>
            </div>

            {myOpts.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Your open positions</div>
                {myOpts.map(opt => {
                  const itm = opt.intrinsic > 0
                  const closeValue = typeof opt.closeValue === 'number' ? opt.closeValue : 0
                  const costBasis = (opt.premium || 0) * (opt.contracts || 0)
                  const pnl = closeValue - costBasis
                  return (
                    <div key={opt.id} className={`rounded-md border p-2 text-[11px] font-bold ${itm ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-zinc-700/60 bg-zinc-950/45'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <span className={opt.type === 'call' ? 'text-emerald-300' : 'text-red-300'}>{opt.type.toUpperCase()}</span>
                          <span className="text-white"> ${opt.symbol}</span>
                          <span className="text-zinc-400"> @ ${fmtPrice(opt.strike)} × {opt.contracts}</span>
                        </span>
                        <span className={itm ? 'text-emerald-300' : 'text-zinc-400'}>
                          {itm ? `ITM +${fmtCompact(opt.markValue)}` : 'OTM'}
                        </span>
                      </div>
                      {/* Contract value: what you'd net by closing right
                          now (mark - haircut), plus the P&L vs cost basis.
                          Lets the player decide whether to ride to expiry
                          or take profits early. */}
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-zinc-400">
                          Value <span className="text-white">${fmtCompact(closeValue)}</span>
                          <span className={`ml-1 ${pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                            {pnl >= 0 ? '+' : '−'}${fmtCompact(Math.abs(pnl))}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onCloseOption?.({ id: opt.id })}
                          disabled={!joined}
                          title={`Close for $${closeValue.toLocaleString()} (8% spread)`}
                          className="rounded-md border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Close
                        </button>
                      </div>
                      <div className="mt-0.5 text-[10px] text-zinc-500">
                        Premium ${fmtCompact(costBasis)} · settles next 1-{expiryHands} hands
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div>
              <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">Buy options on</div>
              <div className="flex flex-wrap gap-1">
                {stocks.map(s => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => setSelectedSymbol(s.symbol)}
                    className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-widest border ${pickedStock?.symbol === s.symbol ? 'border-amber-400/60 bg-amber-500/20 text-amber-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                  >
                    ${s.symbol}
                  </button>
                ))}
              </div>
            </div>

            {pickedStock && (
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-black text-white">${pickedStock.symbol} <span className="text-[10px] text-zinc-400">spot</span></span>
                  <span className="text-sm font-black text-white tabular-nums">${fmtPrice(pickedStock.price)}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 text-[10px] font-bold">
                  <div className="text-center text-emerald-300">CALL</div>
                  <div className="text-center text-zinc-500">STRIKE</div>
                  <div className="text-center text-red-300">PUT</div>
                </div>
                {strikes.map(strike => {
                  const call = chainForStock.find(c => c.strike === strike && c.type === 'call')
                  const put  = chainForStock.find(c => c.strike === strike && c.type === 'put')
                  const otmCall = strike > pickedStock.price
                  const otmPut  = strike < pickedStock.price
                  return (
                    <div key={strike} className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center">
                      <button
                        type="button"
                        disabled={!joined || !call}
                        onClick={() => call && setPendingOption({
                          symbol: pickedStock.symbol,
                          type: 'call',
                          strike: call.strike,
                          premium: call.premium,
                          contracts: 1,
                        })}
                        title={call ? `Configure a ${pickedStock.symbol} ${call.strike} call buy` : ''}
                        className={`rounded-md border px-2 py-1.5 text-[11px] font-black ${otmCall ? 'border-emerald-400/30 bg-emerald-500/5 text-emerald-200/80' : 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'} hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        ${call ? fmtCompact(call.premium) : '—'}
                      </button>
                      <div className="text-center text-[11px] font-black text-zinc-200 tabular-nums w-14">${fmtPrice(strike)}</div>
                      <button
                        type="button"
                        disabled={!joined || !put}
                        onClick={() => put && setPendingOption({
                          symbol: pickedStock.symbol,
                          type: 'put',
                          strike: put.strike,
                          premium: put.premium,
                          contracts: 1,
                        })}
                        title={put ? `Configure a ${pickedStock.symbol} ${put.strike} put buy` : ''}
                        className={`rounded-md border px-2 py-1.5 text-[11px] font-black ${otmPut ? 'border-red-400/30 bg-red-500/5 text-red-200/80' : 'border-red-400/60 bg-red-500/15 text-red-100'} hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        ${put ? fmtCompact(put.premium) : '—'}
                      </button>
                    </div>
                  )
                })}
                <div className="pt-1 text-[9px] text-zinc-500 leading-snug">
                  Premium shown is per contract (100 shares). Tap a price to <span className="text-zinc-300">configure</span> the buy — quantity, cost, and scenarios show in the next step before anything's charged. Settle in {expiryHands} hands.
                </div>
              </div>
            )}

            {/* Confirm-buy panel for the pending option order. Renders
                inline when the user taps a price in the chain above.
                Shows: contracts picker, total cost, affordability, the
                breakeven price (strike + premium/100 for calls, minus
                for puts), and three scenario rows so non-options
                players can see what the contract might be worth at
                various underlying prices on expiry. Nothing is
                charged until they click Confirm. */}
            {pendingOption && (() => {
              const stock = stocks.find(s => s.symbol === pendingOption.symbol)
              if (!stock) return null
              const spot = stock.price
              const isCall = pendingOption.type === 'call'
              const SHARES_PER_CONTRACT = 100
              const premium = pendingOption.premium || 0
              // Max contracts the player can actually afford. If they
              // can't afford even one, the whole configurator collapses
              // into a single "you can't afford this" notice (no slider,
              // no scenarios, no confirm button).
              const maxAffordable = premium > 0 ? Math.floor((myChips || 0) / premium) : 0
              const cannotAffordOne = maxAffordable < 1
              // Cap requested contracts at the affordable max so the
              // slider can't be dragged into a state the server would
              // reject — UI honesty trumps letting them try.
              const contracts = Math.max(1, Math.min(
                maxAffordable || 1,
                Math.floor(pendingOption.contracts || 1)
              ))
              const totalCost = premium * contracts
              const canAfford = (myChips || 0) >= totalCost && !cannotAffordOne
              const shortBy = Math.max(0, totalCost - (myChips || 0))
              // Breakeven on expiry: for a call you need spot to exit
              // ≥ strike + premium/100; for a put, spot must drop to
              // strike − premium/100. Premium is per CONTRACT, so we
              // divide by 100 shares per contract to get the per-share
              // breakeven move the underlying has to make.
              const perSharePremium = (pendingOption.premium || 0) / SHARES_PER_CONTRACT
              const breakeven = isCall
                ? pendingOption.strike + perSharePremium
                : pendingOption.strike - perSharePremium
              // Scenario rows: pick a few representative spot prices
              // (favorable side of the strike) so the user sees the
              // payout curve. Value of an ITM call/put at expiry is
              // max(0, spot - strike) * 100 * contracts (calls), or
              // max(0, strike - spot) * 100 * contracts (puts).
              const valueAt = (spotPrice) => {
                const intrinsic = isCall
                  ? Math.max(0, spotPrice - pendingOption.strike)
                  : Math.max(0, pendingOption.strike - spotPrice)
                return intrinsic * SHARES_PER_CONTRACT * contracts
              }
              const scenarios = isCall
                ? [
                    { label: 'Stays at spot',  spot: spot,          note: spot < pendingOption.strike ? 'OTM — lose premium' : null },
                    { label: '+5% move',        spot: spot * 1.05 },
                    { label: '+15% move',       spot: spot * 1.15 },
                    { label: '+30% move',       spot: spot * 1.30 },
                  ]
                : [
                    { label: 'Stays at spot',  spot: spot,          note: spot > pendingOption.strike ? 'OTM — lose premium' : null },
                    { label: '−5% move',        spot: spot * 0.95 },
                    { label: '−15% move',       spot: spot * 0.85 },
                    { label: '−30% move',       spot: spot * 0.70 },
                  ]
              if (cannotAffordOne) {
                // Can't even afford ONE contract — collapse the whole
                // configurator to a single explanatory notice. No
                // slider (a 0-max slider is just confusing), no
                // scenarios (they'd all be hypothetical), no Confirm.
                return (
                  <div className="rounded-lg border-2 border-red-500/50 bg-red-950/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-black text-white">
                        <span className={isCall ? 'text-emerald-300' : 'text-red-300'}>{pendingOption.type.toUpperCase()}</span>
                        <span className="ml-1">${pendingOption.symbol}</span>
                        <span className="ml-1 text-zinc-300">@ ${fmtPrice(pendingOption.strike)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingOption(null)}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="mt-3 rounded-md border border-red-500/50 bg-red-950/40 px-2 py-2 text-[12px] font-black text-red-100">
                      You can't afford this contract.
                      <div className="mt-1 text-[11px] font-bold text-red-200/90">
                        One contract costs <span className="tabular-nums">${fmtCompact(premium)}</span>; you have <span className="tabular-nums">${fmtCompact(myChips || 0)}</span> in the bank. Short by <span className="tabular-nums">${fmtCompact(premium - (myChips || 0))}</span>.
                      </div>
                      <div className="mt-1 text-[10px] font-bold text-zinc-300">
                        Pick a cheaper strike, grind a few more hands, or sell something to free up bank.
                      </div>
                    </div>
                  </div>
                )
              }
              const sliderId = `opt-slider-${pendingOption.symbol}-${pendingOption.type}-${pendingOption.strike}`
              return (
                <div className={`rounded-lg border-2 p-3 ${canAfford ? 'border-amber-400/60 bg-amber-950/30' : 'border-red-500/50 bg-red-950/30'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-black text-white">
                      Buy <span className={isCall ? 'text-emerald-300' : 'text-red-300'}>{pendingOption.type.toUpperCase()}</span>
                      <span className="ml-1">${pendingOption.symbol}</span>
                      <span className="ml-1 text-zinc-300">@ ${fmtPrice(pendingOption.strike)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingOption(null)}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="mt-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <label htmlFor={sliderId} className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        Contracts
                      </label>
                      <div className="text-[10px] font-bold text-zinc-400 tabular-nums">
                        <span className="text-white text-base">{contracts}</span>
                        <span className="mx-1 text-zinc-500">/</span>
                        <span>max {maxAffordable}</span>
                      </div>
                    </div>
                    {/* Range slider — max is whatever the bank can afford,
                        so the player can see at a glance how many they
                        could buy if they went all-in. Min is 1. */}
                    <input
                      id={sliderId}
                      type="range"
                      min={1}
                      max={maxAffordable}
                      step={1}
                      value={contracts}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(maxAffordable, Math.floor(Number(e.target.value) || 1)))
                        setPendingOption(prev => prev && ({ ...prev, contracts: v }))
                      }}
                      className="mt-1 w-full accent-amber-400"
                    />
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-zinc-500 tabular-nums">
                      <button
                        type="button"
                        onClick={() => setPendingOption(prev => prev && ({ ...prev, contracts: 1 }))}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
                      >Min 1</button>
                      <button
                        type="button"
                        onClick={() => setPendingOption(prev => prev && ({ ...prev, contracts: maxAffordable }))}
                        className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-black uppercase tracking-widest text-amber-200 hover:bg-amber-500/20"
                      >Max {maxAffordable}</button>
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-500">
                      {contracts} × 100 shares = <span className="text-zinc-300 tabular-nums">{(contracts * SHARES_PER_CONTRACT).toLocaleString()}</span> shares of ${pendingOption.symbol} controlled
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2 text-[11px] font-bold sm:grid-cols-4">
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500">Per contract</div>
                      <div className="text-white tabular-nums">${fmtCompact(premium)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500">Total cost</div>
                      <div className={`tabular-nums ${canAfford ? 'text-white' : 'text-red-300'}`}>${fmtCompact(totalCost)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500">Max loss</div>
                      <div className="text-red-300 tabular-nums">−${fmtCompact(totalCost)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-zinc-500">You have</div>
                      <div className="text-zinc-300 tabular-nums">${fmtCompact(myChips || 0)}</div>
                    </div>
                  </div>

                  {!canAfford && (
                    <div className="mt-2 rounded-md border border-red-500/50 bg-red-950/40 px-2 py-1.5 text-[11px] font-black text-red-100">
                      Not enough money — short by <span className="text-red-200">${fmtCompact(shortBy)}</span>. Lower the contract count or pick a cheaper strike.
                    </div>
                  )}

                  <div className="mt-2 rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                      Break-even at expiry
                    </div>
                    <div className="text-[11px] font-bold text-zinc-300 leading-snug">
                      ${pendingOption.symbol} must {isCall ? 'close above' : 'close below'} <span className="text-amber-200 tabular-nums">${fmtPrice(breakeven)}</span> for this trade to profit. Spot is <span className="text-white tabular-nums">${fmtPrice(spot)}</span> right now.
                    </div>
                  </div>

                  <div className="mt-2 rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">
                      What it could be worth at expiry
                    </div>
                    <div className="space-y-0.5 text-[11px] font-bold">
                      {scenarios.map((sc, i) => {
                        const v = valueAt(sc.spot)
                        const pnl = v - totalCost
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 tabular-nums">
                            <span className="text-zinc-300">
                              {sc.label} (${fmtPrice(sc.spot)})
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-zinc-200">worth ${fmtCompact(v)}</span>
                              <span className={`min-w-[64px] text-right ${pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                {pnl >= 0 ? '+' : '−'}${fmtCompact(Math.abs(pnl))}
                              </span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-1 text-[9px] text-zinc-500 leading-snug">
                      Each contract pays out (spot − strike) × 100 if {isCall ? 'spot closes above the strike' : '(for a put) the strike beats the spot'}; otherwise it expires worthless and you lose the premium.
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingOption(null)}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!joined || !canAfford}
                      onClick={() => {
                        onBuyOption?.({
                          symbol: pendingOption.symbol,
                          type: pendingOption.type,
                          strike: pendingOption.strike,
                          contracts,
                        })
                        setPendingOption(null)
                      }}
                      className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed ${
                        canAfford
                          ? 'border-amber-400/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
                          : 'border-red-500/60 bg-red-950/40 text-red-200 opacity-90'
                      }`}
                    >
                      {canAfford ? `Confirm — Pay $${fmtCompact(totalCost)}` : 'Not enough money'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })()}

      {tab === 'earnings' && (() => {
        // Earnings tab. Server now sends `stocksState.upcomingEarnings`
        // as an ARRAY of events (2-6 per hand, drawn from a no-repeat
        // rotation across the whole catalog). Each event:
        //   { symbol, name, sector, kind, beatOdds, ivUp, ivDown,
        //     spotAtAnnouncement, announcedAtHand, resolvesAtHand }
        const raw = stocksState?.upcomingEarnings
        const events = Array.isArray(raw)
          ? raw
          // Backwards compat for the old single-object snapshot.
          : (raw && typeof raw === 'object') ? [raw] : []
        if (events.length === 0) {
          return (
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3 text-center">
              <div className="text-[11px] font-bold text-zinc-400">No earnings events queued yet.</div>
              <div className="mt-1 text-[10px] text-zinc-500">A fresh batch of 2-6 tickers prints every hand — sit tight.</div>
            </div>
          )
        }
        return (
          <div className="space-y-2">
            <div className="rounded-lg border-2 border-fuchsia-500/50 bg-fuchsia-950/30 p-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-fuchsia-300">📢 Upcoming earnings</div>
              <div className="mt-0.5 text-[11px] font-bold text-zinc-300">
                {events.length} {events.length === 1 ? 'company reports' : 'companies report'} at the end of this hand. Browse and position before the candles land.
              </div>
              <div className="mt-1 text-[10px] text-zinc-500">
                Every stock reports once before any repeats. Options on these tickers are IV-pumped — premiums crush the moment the slot rolls to the next batch.
              </div>
            </div>

            {events.map(evt => {
              const stock = stocks.find(s => s.symbol === evt.symbol)
              const spot = stock?.price ?? evt.spotAtAnnouncement ?? 0
              const beatOdds = Math.max(0, Math.min(1, evt.beatOdds ?? 0.5))
              const oddsPct = Math.round(beatOdds * 100)
              const strategyText = beatOdds >= 0.70
                ? 'Market expects a beat — small candle on a beat (priced-in), big crash on a miss.'
                : beatOdds <= 0.35
                  ? 'Market expects a miss — big rally on a beat (surprise), small drop on a miss (priced-in).'
                  : 'Analysts split — surprise factor is highest either way.'
              const ivUp = evt.ivUp ?? 0.10
              const ivDown = evt.ivDown ?? 0.10
              const highPrice = spot * (1 + ivUp)
              const lowPrice  = spot * (1 - ivDown)
              const myHolding = positions.find(p => p.symbol === evt.symbol)
              const parsed = parseInputAmount(buyAmount)
              const dollarsToSpend = parsed == null ? 0 : Math.floor(parsed)
              const sharesToGet = parsed == null ? 0 : dollarsToSpend / spot
              const insufficient = dollarsToSpend > 0 && (myChips || 0) < dollarsToSpend
              return (
                <div key={evt.symbol} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-white">${evt.symbol}</div>
                      <div className="text-[10px] font-bold text-zinc-400 truncate">{evt.name}{evt.sector ? ` · ${evt.sector}` : ''}{evt.kind && evt.kind !== 'main' ? ` · ${evt.kind === 'meme' ? 'meme' : 'penny'}` : ''}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Spot</div>
                      <div className="text-sm font-black text-white tabular-nums">${fmtPrice(spot)}</div>
                    </div>
                  </div>

                  <div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400"
                        style={{ width: `${oddsPct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold tabular-nums">
                      <span><span className="text-emerald-300">{oddsPct}%</span> beat · <span className="text-red-300">{100 - oddsPct}% miss</span></span>
                      <span className="text-zinc-500">analyst odds</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[11px] font-bold">
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-950/30 px-2 py-1.5">
                      <div className="text-[9px] font-black uppercase tracking-wider text-emerald-300">IV up to</div>
                      <div className="text-white tabular-nums">+{(ivUp * 100).toFixed(0)}% → ${fmtPrice(highPrice)}</div>
                    </div>
                    <div className="rounded-md border border-red-500/40 bg-red-950/30 px-2 py-1.5">
                      <div className="text-[9px] font-black uppercase tracking-wider text-red-300">IV down to</div>
                      <div className="text-white tabular-nums">−{(ivDown * 100).toFixed(0)}% → ${fmtPrice(lowPrice)}</div>
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1.5 text-[10px] font-bold text-zinc-300 leading-snug">
                    {strategyText}
                  </div>

                  {myHolding && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 px-2 py-1 text-[10px] font-bold text-zinc-300">
                      You hold <span className="text-emerald-300 tabular-nums">{myHolding.shares.toFixed(2)} shares</span> ($<span className="tabular-nums">{fmtCompact(myHolding.currentValue)}</span>).{' '}
                      <button
                        type="button"
                        onClick={() => onSell?.(evt.symbol, myHolding.shares)}
                        className="font-black text-red-300 underline-offset-2 hover:underline"
                      >
                        Sell all to lock in.
                      </button>
                    </div>
                  )}

                  {/* Quick stock buy — preset-% buttons. Each fires a
                      direct buy at that fraction of the bank balance
                      (no input, no confirm modal, just tap). Mirrors
                      the crypto-market spam-buy UX. */}
                  <div className="space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Buy ${evt.symbol} from bank</div>
                    <div className="grid grid-cols-4 gap-1">
                      {[10, 25, 50, 100].map(pct => {
                        const dollars = Math.floor(((myChips || 0) * pct) / 100)
                        const shares = spot > 0 ? dollars / spot : 0
                        const disabled = !joined || dollars <= 0
                        return (
                          <button
                            key={pct}
                            type="button"
                            disabled={disabled}
                            onClick={() => onBuy(evt.symbol, dollars)}
                            title={disabled ? 'Not enough in bank' : `Spend $${dollars.toLocaleString()} (~${shares.toFixed(2)} sh)`}
                            className="rounded-md border border-emerald-400/60 bg-emerald-500/15 px-1.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <div>{pct === 100 ? 'Max' : `${pct}%`}</div>
                            <div className="text-[8px] font-bold text-emerald-200/80 tabular-nums">${fmtCompact(dollars)}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setSelectedSymbol(evt.symbol); setTab('options') }}
                      className="flex-1 rounded-md border border-emerald-400/60 bg-emerald-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25"
                    >
                      Calls
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSelectedSymbol(evt.symbol); setTab('options') }}
                      className="flex-1 rounded-md border border-red-400/60 bg-red-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25"
                    >
                      Puts
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {tab === 'sabotage' && (
        <div className="space-y-1.5">
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-200 leading-snug">
            Burn 10% of a company's market cap (from your bank) to crash its price 18-42%. 3-hand cooldown.
          </div>
          {stocks.map(stock => {
            const cost = Math.max(500, Math.floor(stock.price * 10000 * 0.10))
            return (
              <div key={stock.symbol} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-white">${stock.symbol}</div>
                    <div className="text-[10px] font-bold text-zinc-300">Current ${fmtPrice(stock.price)} · Burn ${fmtCompact(cost)}</div>
                  </div>
                  {(() => {
                    const insufficient = (myChips || 0) < cost
                    return (
                      <button
                        type="button"
                        onClick={() => onSabotage(stock.symbol)}
                        disabled={!joined || insufficient}
                        title={insufficient ? `Need $${cost.toLocaleString()} — short $${(cost - (myChips || 0)).toLocaleString()}` : `Burn $${cost.toLocaleString()} to crash ${stock.symbol}`}
                        className="shrink-0 rounded-md border border-red-400/60 bg-red-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {insufficient ? `Need $${fmtCompact(cost - (myChips || 0))}` : 'Sabotage'}
                      </button>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

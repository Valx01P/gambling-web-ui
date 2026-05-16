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

export default function StocksPanel({ stocksState, optionsState, myChips, onBuy, onSell, onSabotage, onBuyOption, joined }) {
  const [tab, setTab] = useState('market')
  const [buyAmount, setBuyAmount] = useState('')
  // Toggle between dollar-amount mode and share-count mode. Shares mode
  // is what stock-jockeys think in ("buy 100 shares of NXAI"); dollar
  // mode is what a degen-trader thinks in ("yolo $50M into TECH").
  // Server only takes dollar amounts, so shares-mode multiplies by
  // price client-side before sending.
  const [buyMode, setBuyMode] = useState('dollars')   // 'dollars' | 'shares'
  const [selectedSymbol, setSelectedSymbol] = useState(null)
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
      </div>

      <div className="flex gap-1.5 text-[10px] font-black uppercase tracking-widest">
        <button
          type="button"
          onClick={() => setTab('market')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'market' ? 'border-sky-500/60 bg-sky-500/20 text-sky-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setTab('holdings')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'holdings' ? 'border-sky-500/60 bg-sky-500/20 text-sky-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Holdings ({positions.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('options')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'options' ? 'border-amber-500/60 bg-amber-500/20 text-amber-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Options ({(optionsState?.myPositions || []).length})
        </button>
        <button
          type="button"
          onClick={() => setTab('sabotage')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${tab === 'sabotage' ? 'border-red-500/60 bg-red-500/20 text-red-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
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
                  // Resolve the typed amount to dollars regardless of
                  // mode. Shares mode multiplies by current price.
                  const parsed = parseInputAmount(buyAmount)
                  const dollarsToSpend = parsed == null ? 0
                    : buyMode === 'shares' ? Math.floor(parsed * stock.price)
                    : Math.floor(parsed)
                  const sharesToGet = parsed == null ? 0
                    : buyMode === 'shares' ? parsed
                    : parsed / stock.price
                  return (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={buyMode === 'shares' ? `Shares (try "100" or "1K")` : `Spend $ (try "$5M" or "1B")`}
                          value={buyAmount}
                          onChange={e => setBuyAmount(e.target.value)}
                          className="flex-1 min-w-0 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-xs font-bold text-white outline-none focus:border-zinc-400 tabular-nums"
                        />
                        {/* Mode toggle — sits beside the input so the
                            unit context is always visible. */}
                        <div className="shrink-0 inline-flex rounded-md border border-zinc-700 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setBuyMode('dollars')}
                            className={`px-2 py-1.5 text-[10px] font-black uppercase tracking-widest ${buyMode === 'dollars' ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-200'}`}
                          >
                            $
                          </button>
                          <button
                            type="button"
                            onClick={() => setBuyMode('shares')}
                            className={`px-2 py-1.5 text-[10px] font-black uppercase tracking-widest ${buyMode === 'shares' ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-200'}`}
                          >
                            Sh
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={!joined || !buyAmount || dollarsToSpend <= 0}
                          onClick={() => { onBuy(stock.symbol, dollarsToSpend); setBuyAmount('') }}
                          className="shrink-0 rounded-md border border-emerald-400/60 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40"
                        >
                          Buy
                        </button>
                      </div>
                      {/* Live conversion preview so the player sees
                          exactly what they're buying before pressing. */}
                      {parsed != null && (
                        <div className="text-[10px] font-bold text-zinc-400 tabular-nums">
                          {buyMode === 'shares'
                            ? <>≈ <span className="text-zinc-200">${fmtCompact(dollarsToSpend)}</span> · {sharesToGet.toFixed(2)} shares</>
                            : <>≈ <span className="text-zinc-200">{sharesToGet.toFixed(2)} shares</span> · ${fmtCompact(dollarsToSpend)}</>}
                        </div>
                      )}
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
                      onClick={() => onSell(pos.symbol)}
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
                  return (
                    <div key={opt.id} className={`rounded-md border p-2 text-[11px] font-bold ${itm ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-zinc-700/60 bg-zinc-950/45'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <span className={opt.type === 'call' ? 'text-emerald-300' : 'text-red-300'}>{opt.type.toUpperCase()}</span>
                          <span className="text-white"> ${opt.symbol}</span>
                          <span className="text-zinc-400"> @ ${fmtPrice(opt.strike)} × {opt.contracts}</span>
                        </span>
                        <span className={itm ? 'text-emerald-300' : 'text-zinc-500'}>
                          {itm ? `+${fmtCompact(opt.markValue)}` : 'OTM'}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Premium ${fmtCompact(opt.premium * opt.contracts)} · settles next 1-{expiryHands} hands
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
                        disabled={!joined || !call || (myChips || 0) < call.premium}
                        onClick={() => call && onBuyOption({ symbol: pickedStock.symbol, type: 'call', strike: call.strike, contracts: 1 })}
                        title={call ? `Buy 1 ${pickedStock.symbol} ${call.strike} call for $${call.premium.toLocaleString()}` : ''}
                        className={`rounded-md border px-2 py-1.5 text-[11px] font-black ${otmCall ? 'border-emerald-400/30 bg-emerald-500/5 text-emerald-200/80' : 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'} hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        ${call ? fmtCompact(call.premium) : '—'}
                      </button>
                      <div className="text-center text-[11px] font-black text-zinc-200 tabular-nums w-14">${fmtPrice(strike)}</div>
                      <button
                        type="button"
                        disabled={!joined || !put || (myChips || 0) < put.premium}
                        onClick={() => put && onBuyOption({ symbol: pickedStock.symbol, type: 'put', strike: put.strike, contracts: 1 })}
                        title={put ? `Buy 1 ${pickedStock.symbol} ${put.strike} put for $${put.premium.toLocaleString()}` : ''}
                        className={`rounded-md border px-2 py-1.5 text-[11px] font-black ${otmPut ? 'border-red-400/30 bg-red-500/5 text-red-200/80' : 'border-red-400/60 bg-red-500/15 text-red-100'} hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        ${put ? fmtCompact(put.premium) : '—'}
                      </button>
                    </div>
                  )
                })}
                <div className="pt-1 text-[9px] text-zinc-500 leading-snug">
                  Premium shown is per contract (100 shares). Tap a price to buy 1 contract. Settle in {expiryHands} hands.
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {tab === 'sabotage' && (
        <div className="space-y-1.5">
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-200 leading-snug">
            Burn 10% of a company's market cap to crash its price 18-42%. 3-hand cooldown. Short the stock first for max profit.
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
                  <button
                    type="button"
                    onClick={() => onSabotage(stock.symbol)}
                    disabled={!joined || (myChips || 0) < cost}
                    className="shrink-0 rounded-md border border-red-400/60 bg-red-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Sabotage
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

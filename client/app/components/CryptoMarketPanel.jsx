'use client'

// Crypto market popup. Three tabs: Market / Holdings / Create. Renders
// inside the existing activePokerPanel container in poker/page.jsx so we
// inherit the global popup chrome (close button, ESC handler).
//
// Server is authoritative — every action is a one-shot WS send and the
// resulting state echoes back via 'crypto:state'. We don't optimistically
// mutate local state; the ticks come fast enough (2s) that latency feels
// negligible.

import { memo, useMemo, useState } from 'react'
import MiniChart from './MiniChart'

const TABS = [
  { id: 'market',   label: 'Market' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'create',   label: 'Create' }
]

function fmtPrice(p) {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (p >= 1)    return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 0.01) return p.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return p.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

function fmtChips(c) {
  if (!Number.isFinite(c)) return '0'
  return Math.round(c).toLocaleString()
}

function pctChange(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return 0
  const a = prices[0]
  const b = prices[prices.length - 1]
  if (!Number.isFinite(a) || a === 0) return 0
  return ((b - a) / a) * 100
}

function CoinKindBadge({ kind }) {
  if (kind === 'base') return <span className="rounded bg-sky-700/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-200">Major</span>
  if (kind === 'scam') return <span className="rounded bg-fuchsia-700/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-fuchsia-200">Meme</span>
  return <span className="rounded bg-amber-700/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-200">Player</span>
}

function CoinRow({ coin, position, myChips, onBuy, onSell, onRug, canTrade, myCoinId }) {
  const [amount, setAmount] = useState('')
  const change = pctChange(coin.history)
  const changeColor = change > 0.5 ? 'text-emerald-300' : change < -0.5 ? 'text-red-300' : 'text-zinc-400'
  const isMine = coin.ownerId && coin.id === myCoinId
  const positionValue = position ? position.shares * coin.price : 0
  const positionPnl = position ? positionValue - position.costBasis : 0

  const handleBuy = () => {
    const n = Math.floor(Number(amount) || 0)
    if (n <= 0) return
    onBuy(coin.id, n)
    setAmount('')
  }
  const handleSellAll = () => {
    if (!position || position.shares <= 0) return
    onSell(coin.id, position.shares)
  }
  const handleSellHalf = () => {
    if (!position || position.shares <= 0) return
    onSell(coin.id, position.shares / 2)
  }

  return (
    <div className={`rounded-lg border p-2 ${coin.rugged ? 'border-red-800/60 bg-red-950/30' : isMine ? 'border-amber-500/60 bg-amber-950/20' : 'border-zinc-700/60 bg-zinc-950/40'}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-black text-white">{coin.symbol}</span>
            <CoinKindBadge kind={coin.kind} />
            {coin.rugged && <span className="rounded bg-red-700/60 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-100">Rugged</span>}
          </div>
          <div className="truncate text-[10px] font-bold text-zinc-400">{coin.name}{coin.ownerName ? ` · by ${coin.ownerName}` : ''}</div>
        </div>
        <MiniChart prices={coin.history} width={64} height={24} />
        <div className="text-right">
          <div className="text-xs font-black text-white tabular-nums">${fmtPrice(coin.price)}</div>
          <div className={`text-[10px] font-bold tabular-nums ${changeColor}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</div>
        </div>
      </div>

      {position && position.shares > 0 && (
        <div className="mt-1.5 flex items-center justify-between rounded border border-zinc-700/40 bg-zinc-900/60 px-2 py-1 text-[10px] font-bold">
          <span className="text-zinc-400">You: <span className="tabular-nums text-zinc-100">{position.shares < 1 ? position.shares.toFixed(4) : position.shares.toFixed(2)}</span> sh</span>
          <span className="tabular-nums text-zinc-300">≈ ${fmtChips(positionValue)}</span>
          <span className={`tabular-nums font-black ${positionPnl > 0 ? 'text-emerald-300' : positionPnl < 0 ? 'text-red-300' : 'text-zinc-300'}`}>
            {positionPnl >= 0 ? '+' : ''}${fmtChips(positionPnl)}
          </span>
        </div>
      )}

      {canTrade && !coin.rugged && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            placeholder="chips"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            min="1"
            className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-bold text-white outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={handleBuy}
            disabled={!amount || Number(amount) <= 0 || Number(amount) > myChips}
            className="rounded border border-emerald-500/60 bg-emerald-700/70 px-2 py-1 text-[11px] font-black text-white hover:bg-emerald-600/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Buy
          </button>
          {[10, 25, 50].map(pct => (
            <button
              key={pct}
              type="button"
              onClick={() => setAmount(String(Math.floor(myChips * pct / 100)))}
              disabled={myChips <= 0}
              className="rounded border border-zinc-600 px-1.5 py-1 text-[10px] font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              {pct}%
            </button>
          ))}
          {position && position.shares > 0 && (
            <>
              <button type="button" onClick={handleSellHalf} className="rounded border border-amber-500/60 bg-amber-700/60 px-2 py-1 text-[11px] font-black text-white hover:bg-amber-600/70">
                Sell ½
              </button>
              <button type="button" onClick={handleSellAll} className="rounded border border-red-500/60 bg-red-700/60 px-2 py-1 text-[11px] font-black text-white hover:bg-red-600/70">
                Sell all
              </button>
            </>
          )}
          {isMine && (
            <button
              type="button"
              onClick={() => onRug(coin.id)}
              className="ml-auto rounded border border-red-400/70 bg-red-700/80 px-2 py-1 text-[11px] font-black text-white hover:bg-red-600/90"
              title="Rug pull: cash out your supply and extract a cut from other holders. Burns the coin."
            >
              🪤 Rug Pull
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CreateForm({ canMint, liveCoin, mintFee, myChips, onCreate }) {
  const [name, setName] = useState('')
  const [startPrice, setStartPrice] = useState(1)
  const [keepPercent, setKeepPercent] = useState(80)

  // If the player's previous coin is still live (un-rugged), short-circuit
  // the whole form — minting a second coin while the first is live was
  // confusing for users who didn't realize their old one was still trading.
  // Rugged coins free the slot, so we fall through to the normal form when
  // liveCoin is null/undefined.
  if (liveCoin) {
    return (
      <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/30 p-3 text-xs font-bold text-emerald-200">
        Your coin <span className="text-white">${liveCoin.symbol}</span> is live — find it in the Market tab.
        Rug it first if you want to mint a fresh one.
      </div>
    )
  }

  const disabled = !canMint || myChips < mintFee

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3 text-xs font-bold text-zinc-300">
        Mint your own coin. Mint fee is <span className="text-amber-300">{mintFee.toLocaleString()}</span> chips. You can only have one live at a time.
        The more of the supply you keep, the more stable the price stays — until you rug-pull it.
      </div>
      <div>
        <label className="text-[11px] font-black uppercase tracking-wider text-zinc-400">Ticker</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="(auto-generated meme name if blank)"
          maxLength={12}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm font-bold text-white outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
          Start price: <span className="tabular-nums text-white">${startPrice}</span>
        </label>
        <input
          type="range"
          min="0.01"
          max="100"
          step="0.01"
          value={startPrice}
          onChange={e => setStartPrice(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </div>
      <div>
        <label className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
          Keep supply: <span className="tabular-nums text-white">{keepPercent}%</span> · float for others: {100 - keepPercent}%
        </label>
        <input
          type="range"
          min="50"
          max="99"
          step="1"
          value={keepPercent}
          onChange={e => setKeepPercent(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </div>
      <button
        type="button"
        onClick={() => onCreate({
          name: name.trim(),
          startPrice,
          keepPercent: keepPercent / 100
        })}
        disabled={disabled}
        className="w-full rounded-md border border-emerald-400/60 bg-emerald-700/80 px-3 py-2 text-sm font-black text-white hover:bg-emerald-600/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {myChips < mintFee ? `Need ${mintFee} chips` : `Mint coin (-${mintFee} chips)`}
      </button>
    </div>
  )
}

function CryptoMarketPanelImpl({
  crypto,
  myChips,
  canTrade,
  onBuy,
  onSell,
  onCreate,
  onRug
}) {
  const [tab, setTab] = useState('market')

  const coins = crypto?.coins || []
  const myPositions = crypto?.myPositions || []
  const myCoinId = crypto?.myCoinId || null
  const mintFee = crypto?.config?.mintFee ?? 500
  // The player's own coin object, if it's still trading. A rugged coin
  // doesn't block a fresh mint per the engine (createCoin rejects only
  // on a *live* slot), so the form respects that here.
  const myLiveCoin = useMemo(() => {
    if (!myCoinId) return null
    const found = coins.find(c => c.id === myCoinId)
    if (!found || found.rugged) return null
    return found
  }, [coins, myCoinId])

  const positionsByCoin = useMemo(() => {
    const m = new Map()
    for (const p of myPositions) m.set(p.coinId, p)
    return m
  }, [myPositions])

  // Surface the player's own coin first, then their positions, then majors,
  // then memes. Keeps the most "you-relevant" rows at the top on mobile.
  const sortedCoins = useMemo(() => {
    const score = (c) => {
      if (c.id === myCoinId) return 0
      if (positionsByCoin.has(c.id)) return 1
      if (c.kind === 'base') return 2
      if (c.kind === 'player') return 3
      return 4
    }
    return [...coins].sort((a, b) => score(a) - score(b) || a.symbol.localeCompare(b.symbol))
  }, [coins, myCoinId, positionsByCoin])

  const heldRows = useMemo(() => {
    return sortedCoins.filter(c => {
      const pos = positionsByCoin.get(c.id)
      return pos && pos.shares > 0
    })
  }, [sortedCoins, positionsByCoin])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-black transition-colors ${tab === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400">
        <span>Your stack: <span className="tabular-nums text-white">${fmtChips(myChips)}</span></span>
        <span>Updates every {((crypto?.config?.tickMs ?? 2000) / 1000).toFixed(1)}s</span>
      </div>

      {tab === 'market' && (
        <div className="space-y-1.5">
          {sortedCoins.map(coin => (
            <CoinRow
              key={coin.id}
              coin={coin}
              position={positionsByCoin.get(coin.id)}
              myChips={myChips}
              myCoinId={myCoinId}
              canTrade={canTrade}
              onBuy={onBuy}
              onSell={onSell}
              onRug={onRug}
            />
          ))}
        </div>
      )}

      {tab === 'holdings' && (
        <div className="space-y-1.5">
          {heldRows.length === 0 && (
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3 text-center text-xs font-bold text-zinc-500">
              No open positions. Buy something from the Market tab.
            </div>
          )}
          {heldRows.map(coin => (
            <CoinRow
              key={coin.id}
              coin={coin}
              position={positionsByCoin.get(coin.id)}
              myChips={myChips}
              myCoinId={myCoinId}
              canTrade={canTrade}
              onBuy={onBuy}
              onSell={onSell}
              onRug={onRug}
            />
          ))}
        </div>
      )}

      {tab === 'create' && (
        <CreateForm
          canMint={canTrade}
          liveCoin={myLiveCoin}
          mintFee={mintFee}
          myChips={myChips}
          onCreate={onCreate}
        />
      )}
    </div>
  )
}

export default memo(CryptoMarketPanelImpl)

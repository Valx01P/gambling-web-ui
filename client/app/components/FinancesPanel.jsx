'use client'

// Full-breakdown finances popup. Computes the table-wide unrealized P/L:
//
//   bank debt        — sum of owed across all bank loans
//   side bet stake   — chips parked in unresolved props (mark-to-market hidden)
//   peer loans       — net of money lent out minus money owed to other players
//   crypto holdings  — sum(shares × current price) - cost basis
//
//   stack             — chips currently on the table
//   total unrealized  — stack + parked stake + lent_out + crypto_value
//                     - bank_debt - peer_owed - crypto_cost_basis
//
// Numbers come from props (parent threads through the bank state + crypto
// snapshot it already keeps); we don't fetch anything ourselves.

import { memo, useMemo } from 'react'

function fmtChips(n) {
  if (!Number.isFinite(n)) return '0'
  const v = Math.round(n)
  return v.toLocaleString()
}

function Row({ label, value, valueClass = '', hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs font-black text-zinc-200">{label}</div>
        {hint && <div className="text-[10px] font-bold text-zinc-500">{hint}</div>}
      </div>
      <div className={`shrink-0 text-sm font-black tabular-nums ${valueClass}`}>{value}</div>
    </div>
  )
}

function FinancesPanelImpl({
  myPlayerId,
  myChips = 0,
  loans = [],
  openSideBetStake = 0,
  peerLoans = [],
  crypto = null
}) {
  // Bank debt
  const bankDebt = useMemo(() => loans.reduce((s, l) => s + (l.owed || 0), 0), [loans])

  // Peer loans: split into "I owe out" vs "they owe me", net it for the
  // summary line, show both sides in the detail rows.
  const peer = useMemo(() => {
    let owedOut = 0
    let owedIn = 0
    for (const l of peerLoans) {
      if (l.borrowerId === myPlayerId) owedOut += l.owed || 0
      else if (l.lenderId === myPlayerId) owedIn += l.owed || 0
    }
    return { owedOut, owedIn, net: owedIn - owedOut }
  }, [peerLoans, myPlayerId])

  // Crypto holdings — mark-to-market using the latest broadcast prices.
  const cryptoTotals = useMemo(() => {
    const positions = crypto?.myPositions || []
    const coinIndex = new Map((crypto?.coins || []).map(c => [c.id, c]))
    let value = 0
    let cost = 0
    for (const p of positions) {
      const coin = coinIndex.get(p.coinId)
      if (!coin) continue
      value += (p.shares || 0) * (coin.price || 0)
      cost += p.costBasis || 0
    }
    return { value, cost, pnl: value - cost }
  }, [crypto])

  // "If everything settles now" stack value:
  //   chips + parked + lent_out + crypto_value − bank_owed − peer_owed
  //
  // chips ALREADY reflect chips paid for crypto positions (buy deducted)
  // and chips parked in side bets (buy moved to openSideBetStake) —
  // subtracting cost basis here would double-count. Bank/peer debts are
  // known liabilities, not P/L: taking a loan should NOT turn the panel
  // red, since the chips went up by the same amount.
  const stackIfLiquidated = myChips
    + openSideBetStake
    + peer.owedIn
    + cryptoTotals.value
    - bankDebt
    - peer.owedOut

  // True "unrealized" pool — only positions that mark-to-market and could
  // flip sign before they close. Side-bet stake is hidden by the engine
  // (the spec specifically says don't surface mark-to-market until settle).
  // Bank + peer loans are *known* obligations, not unrealized P/L.
  const unrealizedPnl = cryptoTotals.pnl

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-3">
        <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">If everything settles now</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-2xl font-black tabular-nums text-white">
            ${fmtChips(stackIfLiquidated)}
          </div>
          <div className="text-xs font-bold text-zinc-400">est. liquidated stack</div>
        </div>
        {(cryptoTotals.value > 0 || cryptoTotals.cost > 0) && (
          <div className="mt-1 text-[11px] font-bold text-zinc-400">
            Unrealized P/L:{' '}
            <span className={`tabular-nums font-black ${unrealizedPnl > 0 ? 'text-emerald-300' : unrealizedPnl < 0 ? 'text-red-300' : 'text-zinc-300'}`}>
              {unrealizedPnl >= 0 ? '+' : ''}${fmtChips(unrealizedPnl)}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3">
        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">Current chips</div>
        <Row label="On the table" value={`$${fmtChips(myChips)}`} valueClass="text-white" />
        <Row
          label="Parked in side bets"
          value={`$${fmtChips(openSideBetStake)}`}
          valueClass={openSideBetStake > 0 ? 'text-amber-200' : 'text-zinc-500'}
          hint="Chips locked until each prop resolves"
        />
      </div>

      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3">
        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">Liabilities</div>
        {loans.length === 0 ? (
          <div className="py-1 text-xs font-bold text-zinc-500">No bank loans.</div>
        ) : (
          loans.map((l, i) => (
            <Row
              key={i}
              label={l.bankName || `Loan ${i + 1}`}
              value={`$${fmtChips(l.owed)}`}
              valueClass="text-red-300"
              hint={`Principal $${fmtChips(l.principal)} · ${(l.interestRate * 100).toFixed(1)}% APR`}
            />
          ))
        )}
        <Row
          label="Total bank debt"
          value={`-$${fmtChips(bankDebt)}`}
          valueClass={bankDebt > 0 ? 'text-red-300' : 'text-zinc-500'}
        />
      </div>

      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3">
        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">Peer loans</div>
        <Row
          label="They owe you"
          value={`+$${fmtChips(peer.owedIn)}`}
          valueClass={peer.owedIn > 0 ? 'text-emerald-300' : 'text-zinc-500'}
        />
        <Row
          label="You owe them"
          value={`-$${fmtChips(peer.owedOut)}`}
          valueClass={peer.owedOut > 0 ? 'text-red-300' : 'text-zinc-500'}
        />
        <Row
          label="Net"
          value={`${peer.net >= 0 ? '+' : ''}$${fmtChips(peer.net)}`}
          valueClass={peer.net > 0 ? 'text-emerald-300' : peer.net < 0 ? 'text-red-300' : 'text-zinc-500'}
        />
      </div>

      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3">
        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">Crypto holdings</div>
        <Row
          label="Current value"
          value={`$${fmtChips(cryptoTotals.value)}`}
          valueClass={cryptoTotals.value > 0 ? 'text-white' : 'text-zinc-500'}
        />
        <Row
          label="Cost basis"
          value={`-$${fmtChips(cryptoTotals.cost)}`}
          valueClass={cryptoTotals.cost > 0 ? 'text-zinc-400' : 'text-zinc-500'}
        />
        <Row
          label="Unrealized P/L"
          value={`${cryptoTotals.pnl >= 0 ? '+' : ''}$${fmtChips(cryptoTotals.pnl)}`}
          valueClass={cryptoTotals.pnl > 0 ? 'text-emerald-300' : cryptoTotals.pnl < 0 ? 'text-red-300' : 'text-zinc-500'}
        />
      </div>

      <div className="text-[10px] font-bold leading-relaxed text-zinc-500">
        Net-now treats every unresolved bet, peer loan, and crypto position as if it settled at the current market.
        Real P/L is whatever lands in your chip stack once each one closes.
      </div>
    </div>
  )
}

export default memo(FinancesPanelImpl)

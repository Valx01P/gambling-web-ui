'use client'

import { memo, useEffect, useMemo, useState } from 'react'

// Peer-loan UI that hangs off the player-profile popover. Three states:
//
//   1. No negotiation, no loan with this counterparty
//      → "Offer loan / Request loan" form (single set of inputs;
//        server infers your role from chip counts).
//   2. Negotiation open with this counterparty
//      → Shows the latest proposed amount + rate. Counter button (only if
//        the OTHER side proposed last), accept/decline, cancel.
//   3. Active loan with this counterparty
//      → Amount owed, rate, repay button (borrower only).
//
// The component is "dumb" — all state comes in via props (negotiations,
// my peer loans, my chips, target seat). It just emits send() calls.

function fmtRate(r) { return `${((r || 0) * 100).toFixed(1)}%` }
function fmtChips(n) { return `$${Math.max(0, Math.round(n)).toLocaleString()}` }

const PeerLoanPanel = memo(function PeerLoanPanel({
  myId,
  myChips = 0,
  targetSeat,           // { id, username, chips, isBot, ... } — the popover's seat
  negotiations = [],    // room-wide list, we filter by pair
  myPeerLoans = [],     // viewer's array
  onSend,               // (type, data) => void
}) {
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')

  // Identify the active negotiation between me ↔ target (server enforces
  // at most one per pair). And the active loan, if any.
  const activeNeg = useMemo(() => {
    if (!myId || !targetSeat?.id) return null
    return negotiations.find(n =>
      (n.lenderId === myId && n.borrowerId === targetSeat.id) ||
      (n.lenderId === targetSeat.id && n.borrowerId === myId)
    ) || null
  }, [negotiations, myId, targetSeat?.id])
  const activeLoans = useMemo(() => {
    if (!myId || !targetSeat?.id) return []
    return (myPeerLoans || []).filter(l =>
      (l.lenderId === myId && l.borrowerId === targetSeat.id) ||
      (l.lenderId === targetSeat.id && l.borrowerId === myId)
    )
  }, [myPeerLoans, myId, targetSeat?.id])

  if (!targetSeat || targetSeat.id === myId || targetSeat.isBot) return null

  // ─── Active loans (already accepted) ────────────────────────────────
  // Rendered above any open negotiation so the user sees the state of
  // their existing commitment first.
  const loanRows = activeLoans.map(loan => {
    const iLent = loan.lenderId === myId
    return (
      <div key={loan.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]">
        <div className="font-bold text-amber-200">
          {iLent ? `You lent ${loan.borrowerName}` : `You borrowed from ${loan.lenderName}`}
        </div>
        <div className="mt-0.5 text-zinc-300">
          {fmtChips(loan.principal)} principal · owed {fmtChips(loan.owed)} · {fmtRate(loan.rate)}/turn
        </div>
        {!iLent && (
          <button
            type="button"
            onClick={() => onSend?.('peer_loan:repay', { loanId: loan.id })}
            disabled={myChips <= 0}
            className="mt-1.5 w-full rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-black text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Repay {fmtChips(Math.min(loan.owed, myChips))}
          </button>
        )}
      </div>
    )
  })

  // ─── Open negotiation row ──────────────────────────────────────────
  let negRow = null
  if (activeNeg) {
    const iAmLender = activeNeg.lenderId === myId
    // The side that proposed last is waiting on the OTHER to act. The
    // proposing side sees only "Cancel"; the other side sees Accept +
    // Counter + Decline.
    const iProposedLast = activeNeg.lastProposedBy === myId
    negRow = (
      <div className="rounded-md border border-zinc-700/60 bg-zinc-900/50 p-2 space-y-1.5 text-[11px]">
        <div className="text-[9px] font-black uppercase tracking-wider text-amber-300">
          {iAmLender ? 'You\'re lending' : 'You\'re borrowing'}
        </div>
        <div className="text-zinc-100">
          {fmtChips(activeNeg.amount)} at {fmtRate(activeNeg.rate)}/turn
        </div>
        <div className="text-[10px] text-zinc-500">
          {iProposedLast ? 'Waiting on the other player…' : 'Their move — you can accept, counter, or decline.'}
        </div>
        {iProposedLast ? (
          <button
            type="button"
            onClick={() => onSend?.('peer_loan:cancel', { negotiationId: activeNeg.id })}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700"
          >
            Cancel offer
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onSend?.('peer_loan:accept', { negotiationId: activeNeg.id })}
              className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-black text-white hover:bg-emerald-500"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onSend?.('peer_loan:decline', { negotiationId: activeNeg.id })}
              className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200 hover:bg-red-500/20"
            >
              Decline
            </button>
            <div className="col-span-2 mt-1 space-y-1">
              <div className="flex items-center gap-1">
                <input
                  type="number" min={100}
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="Counter $"
                  className="min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-white outline-none"
                />
                <input
                  type="number" min={0} max={10} step={0.1}
                  value={rate} onChange={e => setRate(e.target.value)}
                  placeholder="%"
                  className="w-12 rounded-md border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const a = Math.floor(Number(amount) || activeNeg.amount)
                    const r = Number(rate)
                    const safeRate = Number.isFinite(r) ? r / 100 : activeNeg.rate
                    onSend?.('peer_loan:counter', { negotiationId: activeNeg.id, amount: a, rate: safeRate })
                    setAmount(''); setRate('')
                  }}
                  className="shrink-0 rounded-md bg-amber-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-amber-500"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Open-new-loan form ────────────────────────────────────────────
  // Visible only when no negotiation is in flight with this counterparty.
  // The server figures out which side is the lender from the chip counts.
  let openForm = null
  if (!activeNeg) {
    const iHaveMore = myChips > (targetSeat.chips || 0)
    const verb = iHaveMore ? 'Offer loan' : 'Request loan'
    openForm = (
      <div className="rounded-md border border-zinc-700/60 bg-zinc-900/50 p-2 text-[11px] space-y-1.5">
        <div className="text-[9px] font-black uppercase tracking-wider text-amber-300">{verb}</div>
        <div className="flex items-center gap-1">
          <input
            type="number" min={100}
            value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Amount"
            className="min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-800 px-1.5 py-1 text-[11px] text-white outline-none"
          />
          <input
            type="number" min={0} max={10} step={0.1}
            value={rate} onChange={e => setRate(e.target.value)}
            placeholder="% / turn"
            className="w-16 rounded-md border border-zinc-600 bg-zinc-800 px-1.5 py-1 text-[11px] text-white outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const a = Math.floor(Number(amount) || 0)
            const r = Number(rate)
            if (!a || a < 100) return
            const safeRate = Math.max(0, Math.min(0.10, Number.isFinite(r) ? r / 100 : 0.01))
            onSend?.('peer_loan:open', { targetId: targetSeat.id, amount: a, rate: safeRate })
            setAmount(''); setRate('')
          }}
          className="w-full rounded-md bg-amber-600 px-2 py-1 text-[10px] font-black text-white hover:bg-amber-500"
        >
          {verb}
        </button>
        <div className="text-[10px] text-zinc-500">
          Cap: 50% of the lender's current stack. Interest accrues per hand.
        </div>
      </div>
    )
  }

  if (!loanRows.length && !negRow && !openForm) return null
  return (
    <div className="mt-3 space-y-2">
      {loanRows}
      {negRow}
      {openForm}
    </div>
  )
})

export default PeerLoanPanel

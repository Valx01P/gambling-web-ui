// Peer-to-peer loan engine. Lives on PokerRoom and owns:
//   • Open negotiations (one side proposed an offer; counters allowed)
//   • Active loans (accepted; tracked on each Player's peerLoans array)
//   • Per-turn interest accrual (called once per hand from PokerRoom)
//   • Settle-on-leave (called from PokerRoom.removePlayer)
//
// The engine never touches bots — it gates every action on `!p.isBot`. The
// existing bank-loan system is separate; peer loans don't mix with bank
// loans except that they all eat into the player's chips.
//
// Negotiation rules:
//   • Initiator role inferred from chip counts. If initiator has more
//     chips than the target, they're OFFERING to lend. Otherwise they're
//     REQUESTING to borrow.
//   • Loan amount capped at 50% of the lender's current stack at
//     accept-time (re-validated on accept since stacks move).
//   • Either side can counter (any value/rate within limits) which resets
//     the "last proposed by" so the OTHER side now has to act.
//   • Either side can decline / cancel at any time.
//   • 5-minute negotiation timeout — auto-expires.
//
// Interest model:
//   • Rate is per-turn (per hand at the table). Capped to MAX_RATE.
//   • Owed grows by `floor(principal * rate)` per tick. Cumulative cap
//     of 3× principal so a forgotten loan can't spiral to infinity.

import { MESSAGE_TYPES } from '../config/constants.js'

const MIN_LOAN_AMOUNT       = 100        // can't loan trivial sums
// 2026-05: rate cap raised to 5x (500%/turn). Per the design ask, peer
// loans should be able to run at "any interest" the parties agree to —
// loan-sharking is part of the game. We keep a sanity ceiling (5x is
// already absurd) so a typo can't lock a player into infinite debt;
// the owed-cap multiplier below still bounds total exposure.
const MAX_RATE              = 5.0        // 500%/turn ceiling — effectively "any rate"
const MIN_RATE              = 0          // gift loans (0%) allowed
const LENDER_STAKE_CAP_PCT  = 0.50       // amount ≤ 50% of lender's stack
const NEG_TIMEOUT_MS        = 5 * 60_000 // 5-minute negotiation timeout
const OWED_MAX_MULTIPLIER   = 3          // owed caps at 3× principal

let _nextId = 1
function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${_nextId++}`
}

export class PeerLoanEngine {
  constructor({ room }) {
    this.room = room
    // negotiationId → { id, borrowerId, lenderId, amount, rate, lastProposedBy,
    //                   status, createdAt, expiresAt, timer }
    this.negotiations = new Map()
  }

  // ─── Public actions ──────────────────────────────────────────────────

  // Open a new negotiation. The initiator's chip count vs target's
  // decides who's the lender and who's the borrower.
  open(initiatorId, { targetId, amount, rate }) {
    const valid = this._validateParties(initiatorId, targetId)
    if (!valid.ok) return valid
    const { initiator, target } = valid

    const initiatorIsLender = initiator.chips > target.chips
    const lender   = initiatorIsLender ? initiator : target
    const borrower = initiatorIsLender ? target    : initiator

    const validAmount = this._validateAmount(amount, lender)
    if (!validAmount.ok) return validAmount
    const validRate = this._validateRate(rate)
    if (!validRate.ok) return validRate

    // One active negotiation per pair. Re-opening replaces the old one
    // (auto-cancels) so the UI doesn't fill with stale rows.
    for (const [id, n] of this.negotiations) {
      const samePair = (n.lenderId === lender.id && n.borrowerId === borrower.id)
                    || (n.lenderId === borrower.id && n.borrowerId === lender.id)
      if (samePair) this._cancelNegotiation(id, 'replaced')
    }

    const id = nextId('neg')
    const now = Date.now()
    const neg = {
      id,
      lenderId: lender.id,
      borrowerId: borrower.id,
      lenderName: lender.username,
      borrowerName: borrower.username,
      amount: validAmount.value,
      rate: validRate.value,
      // Whoever just proposed terms isn't who needs to act next.
      lastProposedBy: initiatorId,
      status: 'pending',
      createdAt: now,
      expiresAt: now + NEG_TIMEOUT_MS,
      timer: null,
    }
    neg.timer = setTimeout(() => this._cancelNegotiation(id, 'expired'),
                           NEG_TIMEOUT_MS)
    this.negotiations.set(id, neg)
    this._broadcast()
    this._pingRecipient(neg, initiator.id, 'offer')
    return { success: true, negotiation: this._publicNegotiation(neg) }
  }

  // Push a SESSION_NOTIF to whichever side of the negotiation is NOT
  // the actor — they're the one who needs to act next. `event` toggles
  // the body text: 'offer' for the first message, 'counter' for a
  // re-pitch after a counter, 'accepted' / 'declined' for terminal
  // events (let the panel handle those instead — caller decides).
  _pingRecipient(neg, actorId, event = 'offer') {
    try {
      const recipientId = actorId === neg.lenderId ? neg.borrowerId : neg.lenderId
      const recipient = this.room.players?.get?.(recipientId) || this.room.spectators?.get?.(recipientId)
      if (!recipient || recipient.isBot) return
      const actorName = (actorId === neg.lenderId ? neg.lenderName : neg.borrowerName) || 'A player'
      const offeringToLend = actorId === neg.lenderId
      const ratePct = Math.round(neg.rate * 1000) / 10
      const verb = event === 'counter'
        ? (offeringToLend ? 'countered with' : 'wants')
        : (offeringToLend ? 'offered to lend' : 'wants to borrow')
      const direction = event === 'counter' && offeringToLend
        ? `lend you $${neg.amount.toLocaleString()} at ${ratePct}%/hand`
        : `$${neg.amount.toLocaleString()} at ${ratePct}%/hand`
      recipient.send({
        type: MESSAGE_TYPES.SESSION_NOTIF,
        data: {
          kind: event === 'counter' ? 'peer_loan_counter' : 'peer_loan_offer',
          fromId: actorId,
          fromName: actorName,
          body: `${actorName} ${verb} ${direction}`,
          negotiationId: neg.id,
          createdAt: Date.now(),
        }
      })
    } catch (err) {
      console.warn('[peer-loan] session notif push failed:', err.message)
    }
  }

  counter(actorId, { negotiationId, amount, rate }) {
    const neg = this.negotiations.get(negotiationId)
    if (!neg || neg.status !== 'pending') return { success: false, error: 'No active negotiation.' }
    if (actorId !== neg.lenderId && actorId !== neg.borrowerId) {
      return { success: false, error: 'Not your negotiation.' }
    }
    // Whoever proposed last has to wait — the other side counters.
    if (actorId === neg.lastProposedBy) {
      return { success: false, error: 'Waiting on the other player.' }
    }
    const lender = this.room.players.get(neg.lenderId)
    if (!lender) return { success: false, error: 'Lender left the table.' }

    const validAmount = this._validateAmount(amount, lender)
    if (!validAmount.ok) return validAmount
    const validRate = this._validateRate(rate)
    if (!validRate.ok) return validRate

    neg.amount = validAmount.value
    neg.rate   = validRate.value
    neg.lastProposedBy = actorId
    // Reset the timer on activity — keeps the negotiation alive while
    // both sides are still talking; only true silence expires it.
    if (neg.timer) clearTimeout(neg.timer)
    neg.expiresAt = Date.now() + NEG_TIMEOUT_MS
    neg.timer = setTimeout(() => this._cancelNegotiation(neg.id, 'expired'),
                           NEG_TIMEOUT_MS)
    this._broadcast()
    // Counter is the new "ball is in your court" event for the other
    // side — ping them so the panel doesn't sit ignored.
    this._pingRecipient(neg, actorId, 'counter')
    return { success: true }
  }

  accept(actorId, { negotiationId }) {
    const neg = this.negotiations.get(negotiationId)
    if (!neg || neg.status !== 'pending') return { success: false, error: 'No active negotiation.' }
    if (actorId !== neg.lenderId && actorId !== neg.borrowerId) {
      return { success: false, error: 'Not your negotiation.' }
    }
    // The side that just proposed can't also accept — they've already
    // committed to those terms, the OTHER side needs to accept.
    if (actorId === neg.lastProposedBy) {
      return { success: false, error: 'Waiting on the other player to accept.' }
    }

    const lender   = this.room.players.get(neg.lenderId)
    const borrower = this.room.players.get(neg.borrowerId)
    if (!lender || !borrower) {
      this._cancelNegotiation(neg.id, 'party_left')
      return { success: false, error: 'A party has left the table.' }
    }
    // Re-validate amount against current stacks — they may have changed
    // while the offer was on the table.
    const validAmount = this._validateAmount(neg.amount, lender)
    if (!validAmount.ok) {
      // Auto-cancel and surface the same error.
      this._cancelNegotiation(neg.id, 'amount_invalid')
      return validAmount
    }

    // Move the chips and record the loan on BOTH players so each side
    // sees their copy in the broadcast without a server lookup.
    const loan = {
      id: nextId('loan'),
      lenderId: lender.id,
      borrowerId: borrower.id,
      lenderName: lender.username,
      borrowerName: borrower.username,
      principal: neg.amount,
      rate: neg.rate,
      owed: neg.amount,
      takenAtHand: this.room.game?.handIndex || 0,
    }
    lender.chips   = Math.max(0, lender.chips - neg.amount)
    borrower.chips = (borrower.chips || 0) + neg.amount
    lender.peerLoans   = [...(lender.peerLoans || []), loan]
    borrower.peerLoans = [...(borrower.peerLoans || []), loan]

    this._cancelNegotiation(neg.id, 'accepted', { silent: true })
    this._broadcast()
    this._systemMessage(`${lender.username} loaned ${borrower.username} $${neg.amount.toLocaleString()} at ${(neg.rate * 100).toFixed(1)}%/turn.`)
    return { success: true, loan }
  }

  decline(actorId, { negotiationId }) {
    const neg = this.negotiations.get(negotiationId)
    if (!neg || neg.status !== 'pending') return { success: false, error: 'No active negotiation.' }
    if (actorId !== neg.lenderId && actorId !== neg.borrowerId) {
      return { success: false, error: 'Not your negotiation.' }
    }
    this._cancelNegotiation(neg.id, 'declined')
    return { success: true }
  }

  cancel(actorId, { negotiationId }) {
    // "Cancel" = the proposing side withdraws. Functionally same as decline
    // but more accurately named in the broadcast outcome.
    return this.decline(actorId, { negotiationId })
  }

  // Borrower-initiated early repayment. Amount may be partial — caps at
  // the smaller of (owed, borrower.chips). The loan is removed once owed
  // hits 0; surplus stays with the borrower.
  repay(actorId, { loanId, amount }) {
    const borrower = this.room.players.get(actorId)
    if (!borrower) return { success: false, error: 'Not at the table.' }
    const loan = (borrower.peerLoans || []).find(l => l.id === loanId)
    if (!loan) return { success: false, error: 'Loan not found.' }
    if (loan.borrowerId !== actorId) return { success: false, error: 'Only the borrower can repay.' }
    const lender = this.room.players.get(loan.lenderId)
    // Default to paying the full owed balance if amount is missing/0.
    const want = Math.floor(Number(amount) || loan.owed)
    const pay  = Math.max(0, Math.min(want, loan.owed, borrower.chips))
    if (pay <= 0) return { success: false, error: 'Need chips to repay.' }

    borrower.chips -= pay
    if (lender) lender.chips += pay  // lender may have left — chips just disappear
    loan.owed -= pay

    if (loan.owed <= 0) this._removeLoan(loan.id)
    else this._syncLoanAcrossParties(loan)
    this._broadcast()
    if (lender) {
      this._systemMessage(`${borrower.username} repaid $${pay.toLocaleString()} to ${lender.username}.`)
    }
    return { success: true, paid: pay, owed: loan.owed }
  }

  // ─── Lifecycle hooks (called by PokerRoom) ─────────────────────────

  // Per-hand interest accrual. Adds floor(principal * rate) to each
  // active loan's `owed`, capped at OWED_MAX_MULTIPLIER × principal so a
  // forgotten loan can't spiral.
  tickInterest() {
    let touched = false
    const seenLoans = new Set()
    for (const p of this.room.players.values()) {
      for (const loan of (p.peerLoans || [])) {
        if (seenLoans.has(loan.id)) continue
        seenLoans.add(loan.id)
        const cap = loan.principal * OWED_MAX_MULTIPLIER
        const before = loan.owed
        const next = Math.min(cap, loan.owed + Math.max(1, Math.round(loan.principal * loan.rate)))
        if (next !== before) {
          loan.owed = next
          touched = true
        }
      }
    }
    if (touched) {
      // Sync each loan's copy across both parties so the borrower's view
      // and the lender's view stay consistent.
      const all = new Map()
      for (const p of this.room.players.values()) {
        for (const loan of (p.peerLoans || [])) all.set(loan.id, loan)
      }
      for (const loan of all.values()) this._syncLoanAcrossParties(loan)
      this._broadcast()
    }
  }

  // Called from PokerRoom.removePlayer BEFORE the seat is removed. For
  // each loan touching this player, transfer min(borrower.chips, owed)
  // from borrower → lender and delete the loan. Works in both directions:
  // the leaver can be the borrower OR the lender.
  handlePlayerLeave(playerId) {
    const player = this.room.players.get(playerId)
    if (!player) return
    const myLoans = [...(player.peerLoans || [])]
    if (!myLoans.length) return

    for (const loan of myLoans) {
      const lender   = this.room.players.get(loan.lenderId)
      const borrower = this.room.players.get(loan.borrowerId)
      if (!borrower) {
        // Borrower is already gone (shouldn't happen if we hook leaves
        // properly, but guard anyway). Lender just absorbs the loss.
        this._removeLoan(loan.id)
        continue
      }
      const take = Math.min(loan.owed, borrower.chips || 0)
      borrower.chips = Math.max(0, (borrower.chips || 0) - take)
      if (lender) lender.chips += take
      this._removeLoan(loan.id)
      if (lender && borrower && take > 0) {
        this._systemMessage(`${borrower.username} left — $${take.toLocaleString()} settled to ${lender.username}.`)
      }
    }
    // Also cancel any negotiations this player was party to.
    for (const [id, neg] of this.negotiations) {
      if (neg.lenderId === playerId || neg.borrowerId === playerId) {
        this._cancelNegotiation(id, 'party_left')
      }
    }
    this._broadcast()
  }

  // ─── Internals ──────────────────────────────────────────────────────

  _validateParties(initiatorId, targetId) {
    if (!initiatorId || !targetId || initiatorId === targetId) {
      return { ok: false, error: 'Pick another player.' }
    }
    const initiator = this.room.players.get(initiatorId)
    const target    = this.room.players.get(targetId)
    if (!initiator || !target) return { ok: false, error: 'Both players must be seated.' }
    if (initiator.isBot || target.isBot) return { ok: false, error: 'Bots can\'t do peer loans.' }
    return { ok: true, initiator, target }
  }

  _validateAmount(amount, lender) {
    const n = Math.floor(Number(amount) || 0)
    if (!Number.isFinite(n) || n < MIN_LOAN_AMOUNT) {
      return { ok: false, error: `Minimum loan is $${MIN_LOAN_AMOUNT}.` }
    }
    const cap = Math.floor((lender.chips || 0) * LENDER_STAKE_CAP_PCT)
    if (n > cap) {
      return {
        ok: false,
        error: `Lender (${lender.username}) can only loan up to $${cap.toLocaleString()} (50% of their stack).`,
      }
    }
    return { ok: true, value: n }
  }

  _validateRate(rate) {
    const r = Number(rate)
    if (!Number.isFinite(r) || r < MIN_RATE || r > MAX_RATE) {
      return { ok: false, error: `Rate must be between ${MIN_RATE}% and ${(MAX_RATE * 100).toFixed(0)}% per turn.` }
    }
    // Round to 0.1% increments to keep the wire numbers clean.
    return { ok: true, value: Math.round(r * 1000) / 1000 }
  }

  _publicNegotiation(neg) {
    return {
      id: neg.id,
      lenderId: neg.lenderId,   lenderName: neg.lenderName,
      borrowerId: neg.borrowerId, borrowerName: neg.borrowerName,
      amount: neg.amount, rate: neg.rate,
      lastProposedBy: neg.lastProposedBy,
      status: neg.status,
      createdAt: neg.createdAt, expiresAt: neg.expiresAt,
    }
  }

  _cancelNegotiation(id, reason, { silent = false } = {}) {
    const neg = this.negotiations.get(id)
    if (!neg) return
    if (neg.timer) clearTimeout(neg.timer)
    this.negotiations.delete(id)
    if (!silent) this._broadcast()
    if (!silent && reason && reason !== 'replaced') {
      this.room.broadcast({
        type: 'peer_loan:resolved',
        data: { negotiationId: id, outcome: reason }
      })
    }
  }

  _removeLoan(loanId) {
    for (const p of this.room.players.values()) {
      const idx = (p.peerLoans || []).findIndex(l => l.id === loanId)
      if (idx !== -1) p.peerLoans.splice(idx, 1)
    }
  }

  // Keep both sides' copies of a loan record in lockstep. Cheaper than
  // sharing a single object reference because the broadcast layer mutates
  // copies during serialization in some paths.
  _syncLoanAcrossParties(loan) {
    for (const p of this.room.players.values()) {
      const idx = (p.peerLoans || []).findIndex(l => l.id === loan.id)
      if (idx !== -1) p.peerLoans[idx] = { ...loan }
    }
  }

  _broadcast() {
    this.room.broadcast({
      type: 'peer_loan:state',
      data: {
        negotiations: [...this.negotiations.values()].map(n => this._publicNegotiation(n)),
      }
    })
    // Loan changes also affect player chips + the peerLoans seat field;
    // a room_update gets the rest of the table to re-render those.
    if (typeof this.room.broadcastRoomUpdate === 'function') {
      this.room.broadcastRoomUpdate()
    }
  }

  _systemMessage(message) {
    this.room.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message }
    })
  }
}

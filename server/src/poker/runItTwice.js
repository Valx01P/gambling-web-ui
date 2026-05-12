// Run-it-twice flow. Extracted from PokerGame.js to keep the core game loop
// (action handling, phase advance, showdown, broadcasts) at a sane size.
//
// Lifecycle as state transitions on the PokerGame instance:
//   pre-river all-in (2 humans, pot ≥ threshold)
//     └─ _shouldOfferRunItTwice → _startRunoutVote
//          └─ vote stored in this._runoutVote, 60s timer armed
//               └─ submitRunoutVote (per player)
//                    ├─ choice = 1            → _resolveRunoutVote('veto')  [instant]
//                    ├─ both same, choice > 1 → _resolveRunoutVote('agreement')
//                    ├─ both different > 1    → keep waiting (no resolve)
//                    └─ 60s elapsed           → _resolveRunoutVote('timeout')
//          └─ resolved
//               ├─ N = 1 → fall back to runOutBoard (normal single board)
//               └─ N > 1 → _executeMultiRunout → N × _executeRunoutStep
//                                              → _finalizeMultiRunout
//
// All methods here run with `this` bound to a PokerGame — attachRunItTwice()
// copies them onto the prototype at module load.

import {
  GAME_PHASES,
  MESSAGE_TYPES,
  RUN_IT_TWICE_MIN_POT,
  RUN_IT_TWICE_MAX_RUNS,
  RUN_IT_TWICE_VOTE_TIMEOUT_MS,
  RUN_IT_TWICE_STEP_DELAY_MS,
  RUN_IT_TWICE_SUMMARY_HOLD_MS
} from '../config/constants.js'
import { evaluateHand, compareHands, getHandName } from './handEvaluator.js'

// Trigger gate. Every dimension is independent so a regression in any one
// of them shows up as a focused test failure instead of "trigger didn't fire."
function _shouldOfferRunItTwice() {
  if (this._runoutInProgress) return false
  if (this._runoutVote) return false
  // Critical: only ONE vote per hand. After _resolveRunoutVote with
  // agreedRuns ≤ 1, the engine falls back into runOutBoard() — without
  // this flag, runOutBoard would re-detect the all-in trigger conditions
  // and start a brand new vote with a fresh timer. The veto path and the
  // timeout path would both perpetually re-open the modal.
  if (this._runoutVoteDone) return false
  if (this.phase === GAME_PHASES.RIVER ||
      this.phase === GAME_PHASES.SHOWDOWN ||
      this.phase === GAME_PHASES.WAITING) return false
  if (this.communityCards.length >= 5) return false
  if (this.pot < RUN_IT_TWICE_MIN_POT) return false

  const active = this.players.filter(p =>
    !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id)
  )
  if (active.length !== 2) return false
  if (!active.every(p => this.allInPlayers.has(p.id))) return false
  // Bots cannot vote. If either active seat is a bot, fall through to a
  // single normal runout — the feature is strictly between two humans.
  if (active.some(p => p.isBot)) return false
  return true
}

function _startRunoutVote() {
  const active = this.players.filter(p =>
    !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id)
  )
  const startedAt = Date.now()
  const expiresAt = startedAt + RUN_IT_TWICE_VOTE_TIMEOUT_MS
  const vote = {
    id: `rit-${this.handIndex}-${startedAt.toString(36)}`,
    startedAt,
    expiresAt,
    eligiblePlayers: active.map(p => ({ playerId: p.id, username: p.username })),
    choices: {},     // playerId → 1..N (set once a player confirms)
    resolved: false,
    pot: this.pot,
    timer: null
  }
  this._runoutVote = vote
  // Wall-clock timeout. Falls through to 1 run if not resolved by the time
  // it fires. Note: the timer is armed once here and NEVER reset on
  // submissions — disagreement doesn't extend the clock.
  vote.timer = setTimeout(() => {
    try { this._resolveRunoutVote('timeout') }
    catch (err) { console.error('[run-it-twice] timeout resolve failed:', err) }
  }, RUN_IT_TWICE_VOTE_TIMEOUT_MS)

  this.onBroadcast({
    type: MESSAGE_TYPES.RUNOUT_VOTE_START,
    data: {
      voteId: vote.id,
      startedAt: vote.startedAt,
      expiresAt: vote.expiresAt,
      timeoutMs: RUN_IT_TWICE_VOTE_TIMEOUT_MS,
      maxRuns: RUN_IT_TWICE_MAX_RUNS,
      eligiblePlayers: vote.eligiblePlayers,
      pot: this.pot
    }
  })
}

// Resolution rules (in priority order):
//   1. choice === 1                  → veto, run once. Unilateral terminator.
//   2. all submitted, all same (>1)  → agreement, run N.
//   3. all submitted, mismatched     → clear EVERYONE's lock so both can
//      try again. Re-broadcast the cleared state. Timer NEVER resets —
//      this protects against a malicious player trying to hold the vote
//      hostage by repeatedly mismatching.
//   4. timer fires                   → see _resolveRunoutVote('timeout'):
//      • neither locked → run once
//      • one locked     → use that player's N
//      • both locked    → only possible if they match (mismatch was
//        already cleared), so run N. If somehow not matching, default 1.
function submitRunoutVote(playerId, voteId, choice) {
  const vote = this._runoutVote
  if (!vote || vote.resolved) return { success: false, error: 'No active runout vote.' }
  if (vote.id !== voteId) return { success: false, error: 'Stale vote.' }
  if (!vote.eligiblePlayers.find(p => p.playerId === playerId)) {
    return { success: false, error: 'You can\'t vote on this runout.' }
  }
  const n = Math.floor(Number(choice) || 0)
  if (n < 1 || n > RUN_IT_TWICE_MAX_RUNS) {
    return { success: false, error: `Choose 1–${RUN_IT_TWICE_MAX_RUNS}.` }
  }

  vote.choices[playerId] = n
  this._broadcastVoteUpdate()

  // Rule 1: anyone picking "run once" terminates the vote immediately.
  if (n === 1) {
    setImmediate(() => {
      try { this._resolveRunoutVote('veto') }
      catch (err) { console.error('[run-it-twice] veto resolve failed:', err) }
    })
    return { success: true }
  }

  // Rules 2 / 3: only relevant once every eligible player has a lock in.
  const allSubmitted = vote.eligiblePlayers.every(p => vote.choices[p.playerId])
  if (!allSubmitted) return { success: true }

  const choices = vote.eligiblePlayers.map(p => vote.choices[p.playerId])
  const allSame = choices.every(c => c === choices[0])
  if (allSame) {
    // Rule 2: matched on >1, resolve.
    setImmediate(() => {
      try { this._resolveRunoutVote('agreement') }
      catch (err) { console.error('[run-it-twice] agreement resolve failed:', err) }
    })
    return { success: true }
  }

  // Rule 3: mismatch with everyone locked in. Wipe every choice slot so
  // both players have to actively reselect — this is the user-facing
  // "your answers got unlocked, try again" behavior. Timer NOT reset
  // (intentional: a hostile player can't grief by mismatching forever).
  for (const p of vote.eligiblePlayers) delete vote.choices[p.playerId]
  this._broadcastVoteUpdate()
  return { success: true }
}

function _broadcastVoteUpdate() {
  const vote = this._runoutVote
  if (!vote) return
  this.onBroadcast({
    type: MESSAGE_TYPES.RUNOUT_VOTE_UPDATE,
    data: {
      voteId: vote.id,
      submissions: vote.eligiblePlayers.map(p => ({
        playerId: p.playerId,
        username: p.username,
        choice: vote.choices[p.playerId] ?? null,
        confirmed: vote.choices[p.playerId] != null
      }))
    }
  })
}

function _resolveRunoutVote(reason = 'agreement') {
  const vote = this._runoutVote
  if (!vote || vote.resolved) return
  // Belt-and-suspenders: this clearTimeout is intentional even though the
  // timer callback's first thing is also _resolveRunoutVote — handles the
  // case where the timer is being torn down explicitly (veto / agreement
  // / cancel) and we don't want a stray fire later.
  if (vote.timer) { clearTimeout(vote.timer); vote.timer = null }
  vote.resolved = true

  let agreedRuns = 1
  const outcome = reason

  if (reason === 'agreement') {
    // Everyone locked the same value. Pull from any seat.
    agreedRuns = vote.choices[vote.eligiblePlayers[0].playerId] || 1
  } else if (reason === 'timeout') {
    // Timer fired with no veto and no agreement. Per spec:
    //   • neither locked → run TWICE (the friendly default — both players
    //     are already all-in, so they presumably both want some variance
    //     reduction; sitting silent shouldn't punish them with single
    //     runout odds).
    //   • exactly one locked at N → run N (honor the locked-in choice).
    //   • both locked at the same N (only reachable via guard, since the
    //     submission path clears on mismatch) → run N.
    const locked = vote.eligiblePlayers
      .map(p => vote.choices[p.playerId])
      .filter(c => c != null)
    if (locked.length === 0) {
      agreedRuns = 2
    } else if (locked.length === 1) {
      agreedRuns = locked[0]
    } else if (locked.every(c => c === locked[0])) {
      agreedRuns = locked[0]
    } else {
      agreedRuns = 1
    }
  }
  // veto / cancelled both fall through to 1.

  this.onBroadcast({
    type: MESSAGE_TYPES.RUNOUT_VOTE_RESOLVED,
    data: { voteId: vote.id, agreedRuns, outcome }
  })

  this._runoutVote = null
  // Done-for-this-hand sentinel. _shouldOfferRunItTwice short-circuits on
  // this so the runOutBoard fall-through below (and any subsequent state
  // broadcasts that re-enter runOutBoard) can't restart the vote. Cleared
  // by startHand at the top of the next hand.
  this._runoutVoteDone = true

  if (agreedRuns <= 1) {
    // Continue with the normal single-board runout.
    this.runOutBoard()
  } else {
    this._executeMultiRunout(agreedRuns)
  }
}

function _cancelRunoutVote() {
  const vote = this._runoutVote
  if (!vote) return
  if (vote.timer) clearTimeout(vote.timer)
  this._runoutVote = null
  if (!vote.resolved) {
    // Surface a "cancelled" resolution so any open vote panels close on the
    // client. The agreedRuns value is informational — no runout follows.
    this.onBroadcast({
      type: MESSAGE_TYPES.RUNOUT_VOTE_RESOLVED,
      data: { voteId: vote.id, agreedRuns: 1, outcome: 'cancelled' }
    })
  }
}

function _clearRunoutInProgress() {
  this._runoutInProgress = false
  this._runoutSnapshot = null
  this._runoutTotal = 0
  this._runoutIndex = 0
  this._runoutBoardsRevealed = []
  this._runoutPerPlayerTotal = new Map()
}

// Snapshot the deck + board + pot structure at the moment of trigger, then
// run N independent reveals. Each step re-shuffles from the same starting
// deck so outcomes are uncorrelated, splits floor(pot/N) of every pot to
// THAT step's winner, and finalize sums totals + fires a single showdown.
function _executeMultiRunout(N) {
  if (N < 2) { this.runOutBoard(); return }

  this._runoutInProgress = true
  this._runoutTotal = N
  this._runoutIndex = 0
  this._runoutBoardsRevealed = []
  this._runoutPerPlayerTotal = new Map()

  this._runoutSnapshot = {
    baseBoard: [...this.communityCards],
    baseDeck: [...this.deck.cards],
    // calculatePots MUTATES playerTotalBets → only call once.
    pots: this.calculatePots()
  }

  this._executeRunoutStep()
}

function _executeRunoutStep() {
  if (!this._runoutSnapshot || this._runoutIndex >= this._runoutTotal) {
    this._finalizeMultiRunout()
    return
  }

  const i = this._runoutIndex
  const N = this._runoutTotal
  const { baseBoard, baseDeck, pots } = this._runoutSnapshot

  // Fresh shuffle of the snapshot deck for *this* runout.
  const runDeck = [...baseDeck]
  for (let j = runDeck.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1))
    ;[runDeck[j], runDeck[k]] = [runDeck[k], runDeck[j]]
  }

  // Build the full 5-card board for this runout.
  const runBoard = [...baseBoard]
  while (runBoard.length < 5) runBoard.push(runDeck.pop())
  this.communityCards = runBoard
  this._runoutBoardsRevealed.push([...runBoard])

  // Evaluate every still-active hand against this runout's board.
  const active = this.players.filter(p =>
    !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id)
  )
  const evaluated = active.map(p => ({
    playerId: p.id,
    hand: evaluateHand([...(this.playerHands.get(p.id) || []), ...runBoard])
  }))

  // Award each pot's per-step share. Last step absorbs rounding remainder
  // so total chips reconcile exactly with the original pot.
  const stepWinners = []
  const isLastStep = i === N - 1
  for (const pot of pots) {
    const eligibleEvals = evaluated.filter(e => pot.eligiblePlayers.includes(e.playerId))
    if (eligibleEvals.length === 0) continue

    const baseShare = Math.floor(pot.amount / N)
    const shareForThisRun = isLastStep
      ? pot.amount - baseShare * (N - 1)
      : baseShare
    if (shareForThisRun <= 0) continue

    eligibleEvals.sort((a, b) => compareHands(b.hand, a.hand))
    const best = eligibleEvals[0]
    const tied = eligibleEvals.filter(e => compareHands(e.hand, best.hand) === 0)
    const perWinner = Math.floor(shareForThisRun / tied.length)
    let remainder = shareForThisRun - perWinner * tied.length

    for (const w of tied) {
      const player = this.players.find(p => p.id === w.playerId)
      if (!player) continue
      const wonAmount = perWinner + (remainder > 0 ? 1 : 0)
      remainder = Math.max(0, remainder - 1)
      player.chips += wonAmount
      this._runoutPerPlayerTotal.set(
        w.playerId,
        (this._runoutPerPlayerTotal.get(w.playerId) || 0) + wonAmount
      )
      stepWinners.push({
        playerId: w.playerId,
        username: player.username,
        chips: wonAmount,
        handName: getHandName(w.hand),
        winningCards: w.hand.bestCards
      })
    }
  }

  this.onBroadcast({
    type: MESSAGE_TYPES.RUNOUT_STEP,
    data: {
      runIndex: i,
      totalRuns: N,
      communityCards: [...runBoard],
      winners: stepWinners,
      hands: Object.fromEntries(active.map(p => [p.id, this.playerHands.get(p.id)])),
      playerHandNames: Object.fromEntries(
        evaluated.map(e => [e.playerId, getHandName(e.hand)])
      )
    }
  })
  this.broadcastState()

  this._runoutIndex += 1
  this._gameTimeout(() => this._executeRunoutStep(), RUN_IT_TWICE_STEP_DELAY_MS)
}

function _finalizeMultiRunout() {
  if (!this._runoutSnapshot) return  // already finalized

  const N = this._runoutTotal
  const boards = [...this._runoutBoardsRevealed]
  const totals = this._runoutPerPlayerTotal
  this._runoutSnapshot = null
  this._runoutInProgress = false
  this._runoutTotal = 0
  this._runoutIndex = 0
  this._runoutBoardsRevealed = []
  this._runoutPerPlayerTotal = new Map()

  // Build the unified winners list from the per-player total across all
  // runouts. The hand-name overlay just shows the multiplier — naming a
  // single hand doesn't fit when there were N independent boards.
  const winners = []
  for (const [playerId, totalChips] of totals) {
    const player = this.players.find(p => p.id === playerId)
    if (!player || totalChips <= 0) continue
    winners.push({
      playerId,
      username: player.username,
      chips: totalChips,
      handName: `Run ×${N}`,
      winningCards: []
    })
  }

  const active = this.players.filter(p =>
    !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id)
  )
  const playerHandNames = {}
  for (const p of active) playerHandNames[p.id] = `Run ×${N}`

  this.phase = GAME_PHASES.SHOWDOWN
  this._clearTurnTimeout()
  // Same luck-stat hook as resolveShowdown: every signed-in all-in player
  // gets one all_in_showdowns tick + maybe an underdog_win, based on their
  // equity at the moment of the latest all-in. "Won" here = took chips
  // across any of the N runouts.
  const winnersSet = new Set(
    [...totals.entries()].filter(([, chips]) => chips > 0).map(([id]) => id)
  )
  this._recordAllInLuckForShowdown(active, winnersSet)
  this.recordCompletedHand({ type: 'showdown', winners, playerHandNames })
  this.broadcastState()

  this.onBroadcast({
    type: 'showdown',
    data: {
      winners,
      hands: Object.fromEntries(active.map(p => [p.id, this.playerHands.get(p.id)])),
      playerHandNames,
      potBreakdown: [],
      runItTwice: { runs: N, boards }
    }
  })

  // Same post-showdown reset shape as resolveShowdown, just with the
  // run-it-twice summary hold so players have a beat to read the result.
  this._gameTimeout(() => {
    const oldDealerId = this.players[this.dealerIndex]?.id
    this.players.forEach(p => this.rebuyIfNeeded(p))
    this.players = this.getSeatedPlayers()
    this.removedPlayers.clear()
    if (this.players.length > 0) {
      const prevIdx = this.players.findIndex(p => p.id === oldDealerId)
      this.dealerIndex = prevIdx !== -1
        ? (prevIdx + 1) % this.players.length
        : this.dealerIndex % this.players.length
    } else {
      this.dealerIndex = 0
    }

    this.phase = GAME_PHASES.WAITING
    this.communityCards = []
    this.pot = 0
    this.currentBet = 0
    this.activeIndex = 0
    this.playerHands.clear()
    this.playerBets.clear()
    this.playerTotalBets.clear()
    this.playerActions.clear()
    this.foldedPlayers.clear()
    this.allInPlayers.clear()
    this.roundActed.clear()
    this.waitingNextHand.clear()
    this.actionStarted = false
    this.currentBetContext = null
    this.exposeRunoutHands = false
    this.broadcastState()
    this.scheduleNextHand()
  }, RUN_IT_TWICE_SUMMARY_HOLD_MS)
}

// Attach the module's methods to PokerGame's prototype so they run with
// the right `this` binding without duplicating the constructor state.
export function attachRunItTwice(PokerGameClass) {
  Object.assign(PokerGameClass.prototype, {
    _shouldOfferRunItTwice,
    _startRunoutVote,
    submitRunoutVote,
    _broadcastVoteUpdate,
    _resolveRunoutVote,
    _cancelRunoutVote,
    _clearRunoutInProgress,
    _executeMultiRunout,
    _executeRunoutStep,
    _finalizeMultiRunout
  })
}

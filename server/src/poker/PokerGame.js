import { Deck } from './deck.js'
import { GAME_PHASES, POKER_CONFIG, MESSAGE_TYPES } from '../config/constants.js'
import { evaluateHand, compareHands, getHandName } from './handEvaluator.js'
import { attachRunItTwice } from './runItTwice.js'
import { recordAllInShowdown, computeAllInEquity } from '../users/luckStats.js'

// Phase → number of community cards visible. Used to reconstruct the
// board state at the moment of an all-in for the luck-stat equity calc.
const PHASE_BOARD_SIZE = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 }

export class PokerGame {
  constructor(onBroadcast, onStateBroadcast = null, onTurnTimeout = null) {
    this.deck = new Deck()
    this.phase = GAME_PHASES.WAITING
    this.communityCards = []
    this.pot = 0
    this.currentBet = 0
    this.smallBlind = POKER_CONFIG.SMALL_BLIND
    this.bigBlind = POKER_CONFIG.BIG_BLIND
    this.dealerIndex = 0
    this.activeIndex = 0
    this.lastTurnChange = Date.now()
    this.players = []
    this.playerHands = new Map()
    this.playerBets = new Map()
    this.playerTotalBets = new Map()
    this.playerActions = new Map()
    this.foldedPlayers = new Set()
    this.allInPlayers = new Set()
    this.roundActed = new Set()
    this.waitingNextHand = new Set()
    this.removedPlayers = new Set()
    this.actionStarted = false
    this.aggressionCount = 0
    this.currentBetContext = null
    this.actionSequence = 0
    this.exposeRunoutHands = false
    this.runOutBoardTimeout = null
    this.nextHandTimeout = null
    // Arena pause: when true, every auto-advance setTimeout used by the game
    // (runout, post-showdown reset, post-fold reset, schedule-next-hand) is
    // halted. Pending callbacks are stashed in `_pausedDeferred` and replayed
    // when pause is released. Bots also gate on this via the room flag.
    this.paused = false
    this._pausedDeferred = []
    // Every active game-driven setTimeout we've started, keyed by its handle
    // so we can cancel and defer them when paused mid-flight (post-showdown
    // 15s reset, between-runout 2.2s deals, etc.).
    this._activeGameTimers = new Map()
    this.onBroadcast = onBroadcast || (() => {})
    this.onStateBroadcast = onStateBroadcast
    // Per-turn inactivity timer. Replaces the old 1s global polling sweep —
    // we now schedule one setTimeout when a turn begins and fire the callback
    // exactly once at the limit. Paused arenas defer; handleAction clears.
    this.onTurnTimeout = onTurnTimeout
    this._turnTimeoutHandle = null

    // Bot/strategy intelligence: history of actions in the current hand and a
    // ring buffer of recent completed hands. Per-player aggregated stats live
    // here too so bots can reason about opponent tendencies across many hands.
    this.handIndex = 0
    this.handStartChips = new Map()
    this.handActionHistory = []
    this.handHistory = []
    this.playerStats = new Map() // playerId -> { handsPlayed, vpip, aggressive, foldedToBet, profit }

    // Cached deep-clone of the last 25 completed hands, shared across every
    // bot decision until the next hand finishes. Without this, each bot at
    // the table re-clones the same hand-history payload (cards, actions,
    // winners, profits) on every turn — same data, repeated work. Reset to
    // null whenever handHistory mutates; signals.js fills it on first read.
    this._handHistorySnapshot = null
    this._boardTextureCache = null

    // Run-it-twice state. Lifecycle:
    //   _runoutVote: vote in progress → set when 2 humans both all-in
    //     pre-river with pot ≥ threshold. Cleared on resolve.
    //   _runoutVoteDone: latched true once a vote resolves (any outcome).
    //     Prevents re-firing the vote on the same hand. Cleared in
    //     startHand for the next hand.
    //   _runoutInProgress: true between vote-resolve and final showdown
    //     when running ≥ 2 boards. Blocks normal runOutBoard re-entry.
    //   _runoutSnapshot: cached deck + board + pots at trigger time,
    //     reused for every runout step so each is independently shuffled
    //     from the same starting deck.
    this._runoutVote = null
    this._runoutVoteDone = false
    this._runoutInProgress = false
    this._runoutSnapshot = null
    this._runoutTotal = 0
    this._runoutIndex = 0
    this._runoutBoardsRevealed = []
    this._runoutPerPlayerTotal = new Map()

    // ─── Deck-rig state (powers #22/#23/#35) ─────────────────────────
    // Powers can pre-script specific cards. None of these are state the
    // game machinery TRUSTS — every consumer re-validates the chosen
    // card is still in the deck at deal-time and silently falls back to
    // a normal random draw if it isn't (someone else used the same card
    // somehow, or the script is stale).
    //
    //   _pendingRigHand     { holeCards: Map<playerId, [card,card]>,
    //                         board: [c0..c4] | null }  — the rig_hand
    //                       QUEUE. Set by setRiggedHand the moment the
    //                       power fires; held untouched until the very
    //                       next startHand promotes it into the armed
    //                       fields. Crucial: rig_hand fired mid-hand
    //                       must NOT affect the in-progress hand, so we
    //                       deliberately stage it here instead of
    //                       writing to _riggedBoardSlots (which
    //                       advancePhaseCards consumes).
    //   _riggedHoleCards    Map<playerId, [card,card]>  — armed by
    //                       startHand from _pendingRigHand. One-shot;
    //                       cleared once cards are dealt.
    //   _riggedBoardSlots   [c0,c1,c2,c3,c4] (flop/flop/flop/turn/river)
    //                       — armed by startHand from _pendingRigHand.
    //                       Each slot is either a card or null. Used
    //                       by advancePhaseCards. One-shot per hand.
    //   _riggedNextCard     A single card that the NEXT
    //                       advancePhaseCards call will use as its first
    //                       draw. Cleared after use.
    //   _riggedRiverCard    A single card forced into the river slot.
    //                       Outranked by _riggedBoardSlots[4] if both
    //                       are set (rig_hand wins over river_card).
    //   _handIsRigged       True while any of the above are active for
    //                       the current hand. Future ELO/rating code
    //                       can consult this to skip rating rigged
    //                       hands without breaking on the rig itself.
    this._pendingRigHand = null
    this._riggedHoleCards = null
    this._riggedBoardSlots = null
    this._riggedNextCard = null
    this._riggedRiverCard = null
    this._handIsRigged = false
  }

  // Validation helper for cards arriving from the item-engine. Returns
  // a canonical {rank, suit} or null if the input doesn't match the deck
  // shape. Re-used by every rig setter so item handlers don't have to
  // duplicate the check.
  _normalizeRiggedCard(c) {
    if (!c || typeof c !== 'object') return null
    const VALID_RANKS = new Set(['2','3','4','5','6','7','8','9','10','J','Q','K','A'])
    const VALID_SUITS = new Set(['hearts','diamonds','clubs','spades'])
    if (!VALID_RANKS.has(c.rank) || !VALID_SUITS.has(c.suit)) return null
    return { rank: c.rank, suit: c.suit }
  }

  // Set the river-card rig (#22). Lore: the player pulls the card
  // "from their pocket" — it doesn't have to still be in the deck.
  // We attempt removeCard so that, if the card *is* in the deck, no
  // random draw can later produce the same card a second time on
  // another street. But if removeCard returns null (the card was
  // already dealt to the board, to a hole, or claimed by a rig_hand
  // pre-extract), we still stage the rig: the card lands on the
  // river at advance time even though it duplicates one already in
  // play. That's the whole point of the meme — 5-of-a-kind and
  // higher are reachable, and the hand evaluator ranks them above
  // royal flush.
  setRiggedRiverCard(card) {
    const norm = this._normalizeRiggedCard(card)
    if (!norm) return { success: false, error: 'invalid_card' }
    this.deck.removeCard(norm.rank, norm.suit)
    this._riggedRiverCard = norm
    this._handIsRigged = true
    return { success: true }
  }

  // Set the next-community-card rig (#23). Same "from your pocket"
  // semantics as river_card — we try to reserve from the deck, but
  // the rig fires regardless of whether the card was still there.
  setRiggedNextCard(card) {
    const norm = this._normalizeRiggedCard(card)
    if (!norm) return { success: false, error: 'invalid_card' }
    this.deck.removeCard(norm.rank, norm.suit)
    this._riggedNextCard = norm
    this._handIsRigged = true
    return { success: true }
  }

  // Set the full-hand rig (#35). The script can specify any subset of:
  //   holeCards: Map<playerId, [card,card]>
  //   board:     [c0,c1,c2,c3,c4]  (any can be null)
  // Unspecified slots get a normal random draw at deal-time. Players
  // who aren't seated when the script lands get random cards too —
  // late joiners don't break the plan. The script takes effect on the
  // NEXT startHand (queued, not retroactive) — even if rig_hand fires
  // mid-hand, the in-progress board/hole cards are NEVER touched.
  setRiggedHand({ holeCards = null, board = null } = {}) {
    // First-rigger-wins on a given hand. Last-write-wins would silently
    // burn the first user's 14-hand cooldown — unfair when they paid the
    // cost. The cooldown is per-player so two players can both queue
    // ATTEMPTS in close succession; the second one gets a clear "already
    // rigged" rejection so they can keep their cooldown. The check
    // covers BOTH the staged queue and the currently-armed fields so a
    // second rigger can't double-rig the same hand by sneaking in
    // between startHand and the next hand-end.
    if (this._pendingRigHand || this._riggedHoleCards || this._riggedBoardSlots) {
      return { success: false, error: 'already_rigged' }
    }
    // Validate hole-card map. We accept either Map or plain object input.
    let holeMap = null
    if (holeCards) {
      holeMap = new Map()
      const entries = holeCards instanceof Map
        ? [...holeCards.entries()]
        : Object.entries(holeCards)
      for (const [pid, pair] of entries) {
        if (!Array.isArray(pair) || pair.length !== 2) continue
        const a = this._normalizeRiggedCard(pair[0])
        const b = this._normalizeRiggedCard(pair[1])
        if (!a || !b) continue
        if (a.rank === b.rank && a.suit === b.suit) continue
        holeMap.set(pid, [a, b])
      }
      if (holeMap.size === 0) holeMap = null
    }
    // Validate board. Pad to exactly 5 slots (nulls for unspecified).
    let boardSlots = null
    if (Array.isArray(board)) {
      boardSlots = new Array(5).fill(null)
      for (let i = 0; i < Math.min(5, board.length); i++) {
        const norm = this._normalizeRiggedCard(board[i])
        if (norm) boardSlots[i] = norm
      }
      if (boardSlots.every(s => s === null)) boardSlots = null
    }
    // Cross-collision check: every rigged card across hole+board must
    // be globally unique within the script. (Two scripts can pick the
    // same card across separate hands — that's fine. Just not within
    // the same script.)
    const seen = new Set()
    const claim = (c) => {
      const k = `${c.rank}-${c.suit}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }
    if (holeMap) {
      for (const pair of holeMap.values()) {
        if (!claim(pair[0]) || !claim(pair[1])) return { success: false, error: 'duplicate_card' }
      }
    }
    if (boardSlots) {
      for (const s of boardSlots) {
        if (s && !claim(s)) return { success: false, error: 'duplicate_card' }
      }
    }
    if (!holeMap && !boardSlots) return { success: false, error: 'empty_script' }
    // Stage on the pending field, NOT _riggedHoleCards/_riggedBoardSlots.
    // The latter are what advancePhaseCards consumes during a live hand
    // — writing to them now would inject our script into whatever board
    // is mid-deal. Promotion happens in startHand for the next hand.
    this._pendingRigHand = { holeCards: holeMap, board: boardSlots }
    // The script takes effect on the NEXT startHand; we don't flip
    // _handIsRigged until that hand actually begins, since the current
    // hand (if any) isn't the one being rigged. startHand sets it.
    return { success: true }
  }

  // Toggle the pause flag. When pausing we cancel every game-driven timer and
  // remember the callbacks so we can re-fire them on resume. When un-pausing
  // we replay them in the order they were registered.
  setPaused(paused) {
    const next = !!paused
    if (next === this.paused) return
    this.paused = next
    if (next) {
      // Cancel every in-flight game timer, stashing each callback for replay.
      // Covers runout deals, post-showdown reset, post-fold reset, schedule-
      // next-hand — anything that went through `_gameTimeout`.
      for (const [id, cb] of this._activeGameTimers) {
        clearTimeout(id)
        this._pausedDeferred.push(cb)
      }
      this._activeGameTimers.clear()
      this.runOutBoardTimeout = null
      this.nextHandTimeout = null
      // Also cancel the turn-inactivity timer — pause shouldn't auto-fold.
      this._clearTurnTimeout()
    } else {
      // Resume: drain everything we deferred. Each entry is a thunk that
      // re-runs the original auto-advance call. We fire them serially in
      // registration order.
      const drained = this._pausedDeferred
      this._pausedDeferred = []
      for (const fn of drained) {
        try { fn() } catch (err) { console.error('[poker-pause] resume error:', err) }
      }
      // Resume the per-turn timer with a fresh full window — pausing shouldn't
      // count against the active player's think time.
      this._scheduleTurnTimeout()
    }
  }

  // Either schedule a real timeout, or — if paused — stash the callback for
  // replay on resume. Tracks the live handle so setPaused can cancel and
  // defer in-flight timers, not just the ones registered after pause.
  _gameTimeout(callback, delay) {
    if (this.paused) {
      this._pausedDeferred.push(callback)
      return null
    }
    let handle = null
    const wrapped = () => {
      if (handle !== null) this._activeGameTimers.delete(handle)
      callback()
    }
    handle = setTimeout(wrapped, delay)
    this._activeGameTimers.set(handle, callback)
    return handle
  }

  // Update blind levels. Safe to call mid-hand — current hand keeps its own
  // posted blinds and the new values take effect on startHand().
  setBlinds(small, big) {
    this.smallBlind = Math.max(1, Math.floor(small))
    this.bigBlind = Math.max(this.smallBlind + 1, Math.floor(big))
  }

  ensurePlayerStats(playerId) {
    let s = this.playerStats.get(playerId)
    if (!s) {
      s = {
        handsObserved: 0,
        handsPlayed: 0,
        vpipHands: 0,
        aggressiveActions: 0,
        foldsToBet: 0,
        profit: 0,
        showdownsSeen: 0,
        showdownsWon: 0,
        recentBetSizes: [],
        lastHandIndex: -1
      }
      this.playerStats.set(playerId, s)
    }
    return s
  }

  setActiveIndex(index) {
    this.activeIndex = index
    this.lastTurnChange = Date.now()
    this._scheduleTurnTimeout()
  }

  _clearTurnTimeout() {
    if (this._turnTimeoutHandle) {
      clearTimeout(this._turnTimeoutHandle)
      this._turnTimeoutHandle = null
    }
  }

  // 2026-05: flat 5-minute turn cap, with heads-up exemption.
  //   • 3+ humans: 5-minute cap (long enough to grab a drink, short
  //     enough that an AFK doesn't pin the whole table)
  //   • 2 humans (heads-up): no timeout at all. With only one other
  //     person waiting on you, mutual patience is fine — and the
  //     pace of heads-up means thinking turns are part of the game.
  // Same timing surface drives both the auto-fold timer AND the
  // client's countdown ring (activeTurnExpiresAt + activeTurnLimitMs
  // in the broadcast envelope). Returning null disables the timer.
  _currentTurnLimitMs() {
    let humans = 0
    for (const p of this.players) {
      if (p && !p.isBot && p.isConnected) humans++
    }
    if (humans <= 2) return null
    return 5 * 60 * 1000
  }

  _scheduleTurnTimeout() {
    this._clearTurnTimeout()
    if (!this.onTurnTimeout) return
    if (this.paused) return
    if (this.phase === GAME_PHASES.WAITING || this.phase === GAME_PHASES.SHOWDOWN) return
    const player = this.players[this.activeIndex]
    if (!player) return
    const playerId = player.id
    const limitMs = this._currentTurnLimitMs()
    // null limit = heads-up exemption — don't arm any timer; the
    // broadcast envelope already nulls out the countdown ring fields.
    if (limitMs == null || limitMs <= 0) return
    this._turnTimeoutHandle = setTimeout(() => {
      this._turnTimeoutHandle = null
      // Stale check — only fire if it's still this player's turn.
      const stillActive = this.players[this.activeIndex]?.id === playerId
      if (!stillActive) return
      // Re-validate the "kick condition" AT FIRE TIME, not at arm time.
      // Bots always fire (stuck-fold safety net — they need the timeout
      // to recover if their decision scheduler hangs). Humans only fire
      // when another human is still at the table; otherwise the leftover
      // timer from a now-disconnected opponent would boot the remaining
      // solo human against bots, which violates the "no kicks vs bots"
      // rule. Checking at fire time means a mid-turn disconnect by the
      // last other human cleanly defuses the armed timer.
      const activePlayer = this.players[this.activeIndex]
      if (activePlayer && !activePlayer.isBot) {
        const otherHumanPresent = this.players.some(p =>
          p && p.id !== playerId && !p.isBot && p.isConnected
        )
        if (!otherHumanPresent) return
      }
      try { this.onTurnTimeout(playerId) } catch (err) {
        console.error('[poker] turn timeout cb:', err)
      }
    }, limitMs)
  }

  ensurePokerBankroll(player) {
    if (typeof player.pokerBuyIn !== 'number') player.pokerBuyIn = POKER_CONFIG.STARTING_CHIPS
  }

  rebuyIfNeeded(player) {
    this.ensurePokerBankroll(player)
    if (player.chips > 0) return false
    if (player.isBot) return false

    player.chips = POKER_CONFIG.STARTING_CHIPS
    player.pokerBuyIn += POKER_CONFIG.STARTING_CHIPS
    this.onBroadcast({
      type: 'system_message',
      data: { message: `${player.username} auto-rebought for ${POKER_CONFIG.STARTING_CHIPS} chips.` }
    })
    return true
  }

  getSeatedPlayers() {
    return this.players.filter(p => p.isConnected && !this.removedPlayers.has(p.id))
  }

  hasPlayerActionStarted() {
    return this.actionStarted
  }

  canJoinCurrentHand() {
    return this.phase === GAME_PHASES.WAITING ||
      (this.phase === GAME_PHASES.PREFLOP && !this.hasPlayerActionStarted())
  }

  clearPlayerState(playerId) {
    this.playerHands.delete(playerId)
    this.playerBets.delete(playerId)
    this.playerTotalBets.delete(playerId)
    this.playerActions.delete(playerId)
    this.foldedPlayers.delete(playerId)
    this.allInPlayers.delete(playerId)
    this.roundActed.delete(playerId)
    this.waitingNextHand.delete(playerId)
    this.removedPlayers.delete(playerId)
  }

  markWaitingForNextHand(player) {
    if (!this.playerBets.has(player.id)) this.playerBets.set(player.id, 0)
    if (!this.playerTotalBets.has(player.id)) this.playerTotalBets.set(player.id, 0)
    if (!this.playerActions.has(player.id)) {
      this.playerActions.set(player.id, { action: '', amount: 0, text: '' })
    }
    if (!this.playerHands.has(player.id)) this.playerHands.set(player.id, [])

    this.foldedPlayers.add(player.id)
    this.waitingNextHand.add(player.id)
    this.allInPlayers.delete(player.id)
    this.roundActed.delete(player.id)
  }

  scheduleNextHand(delay = 1500) {
    if (this.nextHandTimeout || !this.canStart()) return

    const fire = () => {
      this.nextHandTimeout = null
      this.startHand()
    }
    // _gameTimeout returns null when paused (it stashes the callback) so the
    // nextHandTimeout assignment naturally stays null in that case, which
    // matches the "no pending timer" sentinel.
    this.nextHandTimeout = this._gameTimeout(fire, delay)
  }

  resetToWaiting() {
    clearTimeout(this.runOutBoardTimeout)
    this._clearTurnTimeout()
    this._cancelRunoutVote()
    this._clearRunoutInProgress()
    this.players = this.getSeatedPlayers()
    this.communityCards = []
    this.pot = 0
    this.currentBet = 0
    this.activeIndex = 0
    this.phase = GAME_PHASES.WAITING
    this.playerHands.clear()
    this.playerBets.clear()
    this.playerTotalBets.clear()
    this.playerActions.clear()
    this.foldedPlayers.clear()
    this.allInPlayers.clear()
    this.roundActed.clear()
    this.waitingNextHand.clear()
    this.removedPlayers.clear()
    this.actionStarted = false
    this.currentBetContext = null
    this.exposeRunoutHands = false
    this.broadcastState()
    this.scheduleNextHand()
  }

  // Run-it-twice logic lives in ./runItTwice.js — _cancelRunoutVote,
  // _clearRunoutInProgress, submitRunoutVote, _executeMultiRunout and
  // friends are all attached to the prototype by attachRunItTwice() at the
  // bottom of this file.

  addPlayer(player) {
    const existingIndex = this.players.findIndex(p => p.id === player.id)
    const isReturningRemovedPlayer = existingIndex !== -1 && this.removedPlayers.has(player.id)

    if (existingIndex !== -1 && !isReturningRemovedPlayer) return false
    if (!isReturningRemovedPlayer && this.getSeatedPlayers().length >= POKER_CONFIG.MAX_PLAYERS) return false

    player.isConnected = true
    this.ensurePokerBankroll(player)

    if (existingIndex === -1) {
      this.players.push(player)
    } else {
      this.players[existingIndex] = player
      this.removedPlayers.delete(player.id)
    }

    if (this.phase !== GAME_PHASES.WAITING) {
      if (!this.playerBets.has(player.id)) this.playerBets.set(player.id, 0)
      if (!this.playerTotalBets.has(player.id)) this.playerTotalBets.set(player.id, 0)
      if (!this.playerActions.has(player.id)) {
        this.playerActions.set(player.id, { action: '', amount: 0, text: '' })
      }

      if (!isReturningRemovedPlayer && this.canJoinCurrentHand()) {
        this.playerHands.set(player.id, this.deck.drawMultiple(2))
        this.foldedPlayers.delete(player.id)
        this.waitingNextHand.delete(player.id)
      } else {
        this.markWaitingForNextHand(player)
      }
    }
    return true
  }

  removePlayer(playerId) {
    const playerIdx = this.players.findIndex(p => p.id === playerId)
    if (playerIdx === -1) return
    
    this.waitingNextHand.delete(playerId)

    if (this.phase !== GAME_PHASES.WAITING && this.phase !== GAME_PHASES.SHOWDOWN) {
      if (this.activeIndex === playerIdx) {
        const result = this.handleAction(playerId, 'fold')
        this.removedPlayers.add(playerId)
        if (result.success) this.broadcastState()
      } else {
        this.removedPlayers.add(playerId)
        this.foldedPlayers.add(playerId)
        this.checkHandOver()
        this.broadcastState()
      }
    } else {
      this.clearPlayerState(playerId)
      if (playerIdx < this.dealerIndex) {
        this.dealerIndex--
      }
      this.players.splice(playerIdx, 1)
      if (this.players.length > 0) {
        this.dealerIndex = this.dealerIndex % this.players.length
      } else {
        this.dealerIndex = 0
      }
    }
  }

  getActivePlayers() {
    return this.players.filter(p =>
      !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id) && p.isConnected
    )
  }

  getDecisionPlayers() {
    return this.players.filter(p =>
      !this.removedPlayers.has(p.id) &&
      !this.waitingNextHand.has(p.id) &&
      !this.foldedPlayers.has(p.id) &&
      !this.allInPlayers.has(p.id) &&
      p.isConnected
    )
  }

  canStart() {
    return this.getSeatedPlayers().length >= POKER_CONFIG.MIN_PLAYERS && this.phase === GAME_PHASES.WAITING
  }

  findNextDecisionIndex(startFrom) {
    for (let i = 0; i < this.players.length; i++) {
      const idx = (startFrom + i) % this.players.length
      const p = this.players[idx]
      if (
        p &&
        !this.removedPlayers.has(p.id) &&
        !this.waitingNextHand.has(p.id) &&
        !this.foldedPlayers.has(p.id) &&
        !this.allInPlayers.has(p.id) &&
        p.isConnected
      ) {
        return idx
      }
    }
    return -1
  }

  startHand() {
    if (!this.canStart()) return false

    clearTimeout(this.nextHandTimeout)
    this.nextHandTimeout = null
    this.players = this.getSeatedPlayers()
    this.removedPlayers.clear()
    this.deck.reset()
    this.communityCards = []
    this.pot = 0
    this.currentBet = 0
    this.foldedPlayers.clear()
    this.allInPlayers.clear()
    this.waitingNextHand.clear()
    this.playerHands.clear()
    this.playerBets.clear()
    this.playerTotalBets.clear()
    this.playerActions.clear()
    this.roundActed.clear()
    this.aggressionCount = 1
    this.currentBetContext = null
    this.actionStarted = false
    this.exposeRunoutHands = false
    this._cancelRunoutVote()
    this._clearRunoutInProgress()
    // Per-hand sentinel — cleared so the next hand is eligible for a fresh
    // vote. _resolveRunoutVote sets it true; this is the only place it gets
    // cleared. resetToWaiting on a hand-abort does NOT clear it (the abort
    // is the same hand from the engine's perspective).
    this._runoutVoteDone = false
    clearTimeout(this.runOutBoardTimeout)

    this.dealerIndex = this.dealerIndex % this.players.length

    // Defensive sweep before dealing. _riggedNextCard / _riggedRiverCard
    // are meant for the CURRENT hand only (set mid-hand by the river_card
    // / next_card powers). If the previous hand ended via fold-out before
    // those rigs could fire, advancePhaseCards never got to clear them —
    // so do it here so a stale rig can't bleed into a fresh hand.
    this._riggedNextCard = null
    this._riggedRiverCard = null
    // Promote the rig_hand queue (set at any point during the previous
    // hand) into the armed fields the dealer + advancePhaseCards
    // consume. Doing it here — not in setRiggedHand — is what makes
    // rig_hand a NEXT-HAND power: the in-progress hand never sees the
    // script. Clear the queue immediately so a second rig_hand call
    // during this hand stages cleanly for the *next* hand.
    if (this._pendingRigHand) {
      this._riggedHoleCards = this._pendingRigHand.holeCards
      this._riggedBoardSlots = this._pendingRigHand.board
      this._pendingRigHand = null
    } else {
      this._riggedHoleCards = null
      this._riggedBoardSlots = null
    }
    this._handIsRigged = !!(this._riggedHoleCards || this._riggedBoardSlots)

    // Pre-extract EVERY rigged card from the freshly-shuffled deck up
    // front, before any random draw happens. Without this, a player
    // who isn't in the script could randomly draw a card that's
    // reserved for someone else's hole cards or for a board slot —
    // the rig would then silently fall back to random for that slot.
    // Once a card is pre-extracted it's stashed in the rig map itself
    // (we overwrite the {rank,suit} input with the actual card object
    // returned by removeCard) so the consuming code uses the stash.
    if (this._riggedHoleCards) {
      const next = new Map()
      for (const [pid, pair] of this._riggedHoleCards) {
        if (!Array.isArray(pair) || pair.length !== 2) continue
        const a = this.deck.removeCard(pair[0].rank, pair[0].suit)
        const b = this.deck.removeCard(pair[1].rank, pair[1].suit)
        // Only keep the rig for this player if BOTH cards were
        // extractable — partial pairs would deal one rigged + one
        // random, which feels broken to the user.
        if (a && b) next.set(pid, [a, b])
      }
      this._riggedHoleCards = next.size > 0 ? next : null
    }
    if (this._riggedBoardSlots) {
      this._riggedBoardSlots = this._riggedBoardSlots.map(slot => {
        if (!slot) return null
        return this.deck.removeCard(slot.rank, slot.suit) || null
      })
      if (this._riggedBoardSlots.every(s => s === null)) {
        this._riggedBoardSlots = null
      }
    }

    for (const player of this.players) {
      const scripted = this._riggedHoleCards?.get?.(player.id)
      if (Array.isArray(scripted) && scripted.length === 2 && scripted[0] && scripted[1]) {
        // Already extracted from the deck above — just hand it over.
        this.playerHands.set(player.id, [scripted[0], scripted[1]])
      } else {
        this.playerHands.set(player.id, this.deck.drawMultiple(2))
      }
      this.playerBets.set(player.id, 0)
      this.playerTotalBets.set(player.id, 0)
    }
    // Hole-card rigs are one-shot — once consumed, drop the map so the
    // NEXT hand isn't accidentally rigged with the same script.
    this._riggedHoleCards = null

    this.handIndex += 1
    this.handActionHistory = []
    this.handStartChips = new Map(this.players.map(p => [p.id, p.chips]))
    for (const p of this.players) {
      const s = this.ensurePlayerStats(p.id)
      s.handsObserved += 1
      s.lastHandIndex = this.handIndex
    }

    let sbIdx, bbIdx
    if (this.players.length === 2) {
      sbIdx = this.dealerIndex
      bbIdx = (this.dealerIndex + 1) % 2
    } else {
      sbIdx = (this.dealerIndex + 1) % this.players.length
      bbIdx = (this.dealerIndex + 2) % this.players.length
    }

    this.postBlind(this.players[sbIdx], this.smallBlind)
    this.playerActions.set(this.players[sbIdx].id, { action: 'sb', amount: this.smallBlind, text: 'SB' })
    this.postBlind(this.players[bbIdx], this.bigBlind)
    this.playerActions.set(this.players[bbIdx].id, { action: 'bb', amount: this.bigBlind, text: 'BB' })
    this.currentBet = this.bigBlind

    const firstAct = this.findNextDecisionIndex((bbIdx + 1) % this.players.length)
    if (firstAct === -1) {
      this.phase = GAME_PHASES.PREFLOP
      this.runOutBoard()
      return true
    }
    
    this.setActiveIndex(firstAct)
    this.phase = GAME_PHASES.PREFLOP
    this.broadcastState()
    return true
  }

  postBlind(player, amount) {
    const actual = Math.min(amount, player.chips)
    player.chips -= actual
    this.pot += actual
    this.playerBets.set(player.id, actual)
    this.playerTotalBets.set(player.id, (this.playerTotalBets.get(player.id) || 0) + actual)
    if (player.chips === 0) this.allInPlayers.add(player.id)
  }

  shouldThrowChipsForCall(playerId) {
    return Boolean(
      this.currentBetContext &&
      this.currentBetContext.playerId !== playerId &&
      (this.currentBetContext.isReRaise || this.currentBetContext.isAllIn)
    )
  }

  createChipThrowEvent(playerId, amount, stackAmount = amount) {
    this.actionSequence += 1
    return {
      playerId,
      amount,
      stackAmount,
      actionId: this.actionSequence,
      seed: `${Date.now()}-${this.actionSequence}-${Math.floor(Math.random() * 1000000)}`
    }
  }

  getAggressionLabel(isAllIn) {
    let label = ''
    if (this.aggressionCount === 1) label = 'Bet'
    else if (this.aggressionCount === 2) label = 'Raise'
    else if (this.aggressionCount === 3) label = 'Re-raise'
    else label = `${this.aggressionCount}-Bet`

    return isAllIn ? `${label} All-In` : label
  }

  handleAction(playerId, action, amount = 0) {
    if (this.phase === GAME_PHASES.WAITING || this.phase === GAME_PHASES.SHOWDOWN) {
      return { success: false, error: 'No active hand' }
    }
    if (this.removedPlayers.has(playerId) || this.waitingNextHand.has(playerId)) {
      return { success: false, error: 'Not in this hand' }
    }

    const currentPlayer = this.players[this.activeIndex]
    if (!currentPlayer || currentPlayer.id !== playerId) {
      return { success: false, error: 'Not your turn' }
    }
    if (this.foldedPlayers.has(playerId) || this.allInPlayers.has(playerId)) {
      return { success: false, error: 'Cannot act' }
    }

    // Player acted in time — cancel the turn-inactivity timer. afterAction
    // calls setActiveIndex for the next player which schedules a fresh one.
    this._clearTurnTimeout()

    const playerBet = this.playerBets.get(playerId) || 0
    const toCall = this.currentBet - playerBet
    let chipThrowEvent = null

    switch (action) {
      case 'fold':
        this.foldedPlayers.add(playerId)
        this.playerActions.set(playerId, { action: 'fold', amount: 0, text: 'FOLD' })
        break

      case 'check':
        if (toCall > 0) return { success: false, error: 'Must call or raise' }
        this.playerActions.set(playerId, { action: 'check', amount: 0, text: 'CHECK' })
        break

      case 'call': {
        if (toCall <= 0) return { success: false, error: 'Nothing to call' }
        const callAmt = Math.min(toCall, currentPlayer.chips)
        const shouldThrowChips = this.shouldThrowChipsForCall(playerId)
        currentPlayer.chips -= callAmt
        this.pot += callAmt
        const newBet = playerBet + callAmt
        if (shouldThrowChips) {
          chipThrowEvent = this.createChipThrowEvent(playerId, callAmt, newBet)
        }
        this.playerBets.set(playerId, newBet)
        this.playerTotalBets.set(playerId, (this.playerTotalBets.get(playerId) || 0) + callAmt)
        this.playerActions.set(playerId, {
          action: 'call',
          amount: callAmt,
          text: 'CALL',
          chipThrow: shouldThrowChips,
          chipThrowActionId: chipThrowEvent?.actionId || null,
          chipThrowSeed: chipThrowEvent?.seed || null
        })
        if (currentPlayer.chips === 0) this.allInPlayers.add(playerId)
        break
      }

      case 'raise': {
        const minRaise = this.currentBet === 0 ? this.bigBlind : this.currentBet * 2;
        const raiseTarget = amount

        if (raiseTarget < minRaise && currentPlayer.chips > (raiseTarget - playerBet)) {
          return { success: false, error: `Min raise is ${minRaise}` }
        }

        const raiseAmt = Math.min(raiseTarget - playerBet, currentPlayer.chips)
        if (raiseAmt <= 0) return { success: false, error: 'Invalid raise' }
        currentPlayer.chips -= raiseAmt
        this.pot += raiseAmt
        const newBet = playerBet + raiseAmt
        this.playerBets.set(playerId, newBet)
        this.playerTotalBets.set(playerId, (this.playerTotalBets.get(playerId) || 0) + raiseAmt)
        const isRaise = newBet > this.currentBet
        const isAllIn = currentPlayer.chips === 0
        if (isRaise) {
          this.currentBet = newBet
          this.roundActed.clear()
          // Only a real raise counts as aggression. A short-stack player
          // submitting a "raise" amount they don't have chips for ends up
          // matching (or staying below) currentBet — that's a call (or a
          // call all-in), not a raise, and shouldn't bump aggressionCount
          // or update currentBetContext (which would mis-flag the next
          // caller as facing a re-raise).
          this.aggressionCount++
          this.currentBetContext = {
            playerId,
            isReRaise: this.aggressionCount >= 3,
            isAllIn
          }
        }

        // Action label: real raise → standard aggression label.
        // Forced call (raise amount ≤ currentBet): "Call All-In" if shoving
        // the rest of the stack, "CALL" if somehow it landed at exactly
        // currentBet without going all-in (e.g. raise amount equal to
        // current bet — odd but reachable).
        const text = isRaise
          ? this.getAggressionLabel(isAllIn)
          : (isAllIn ? 'Call All-In' : 'CALL')
        this.playerActions.set(playerId, { action: 'raise', amount: newBet, text })
        if (isAllIn) this.allInPlayers.add(playerId)
        break
      }

      case 'all_in': {
        const allAmt = currentPlayer.chips
        if (allAmt <= 0) return { success: false, error: 'No chips' }
        this.pot += allAmt
        const newBet = playerBet + allAmt
        this.playerBets.set(playerId, newBet)
        this.playerTotalBets.set(playerId, (this.playerTotalBets.get(playerId) || 0) + allAmt)
        
        let isRaise = newBet > this.currentBet
        if (isRaise) {
          this.currentBet = newBet
          this.roundActed.clear()
          this.aggressionCount++
          this.currentBetContext = {
            playerId,
            isReRaise: this.aggressionCount >= 3,
            isAllIn: true
          }
        }

        const label = isRaise ? this.getAggressionLabel(true) : 'Call All-In'

        this.playerActions.set(playerId, { action: 'all_in', amount: newBet, text: label })
        currentPlayer.chips = 0
        this.allInPlayers.add(playerId)
        break
      }

      default:
        return { success: false, error: 'Invalid action' }
    }

    this.actionStarted = true
    this.roundActed.add(playerId)
    if (chipThrowEvent) {
      this.onBroadcast({
        type: MESSAGE_TYPES.CHIP_THROW,
        data: chipThrowEvent
      })
    }

    // Record into the hand's action log so bots can reason about what's happened
    // so far. We keep this small and append-only.
    // Wall-clock timestamp + tookMs for bot timing analysis. tookMs is the
    // gap since the previous action's timestamp (or the turn-start time if
    // this is the first action of the hand) — useful for bots playing humans
    // since think-time correlates with hand strength on tells.
    const now = Date.now()
    const lastAt = this.handActionHistory.length > 0
      ? (this.handActionHistory[this.handActionHistory.length - 1].at || this.lastTurnChange)
      : this.lastTurnChange
    this.handActionHistory.push({
      seq: ++this.actionSequence,
      phase: this.phase,
      playerId,
      playerName: currentPlayer.username,
      action,
      amount: action === 'fold' || action === 'check' ? 0 : (this.playerBets.get(playerId) || 0),
      toCallBefore: toCall,
      potBefore: this.pot - (action === 'fold' || action === 'check' ? 0 : (this.playerBets.get(playerId) - playerBet)),
      at: now,
      tookMs: Math.max(0, now - lastAt)
    })

    // Per-player aggregated stats
    const stats = this.ensurePlayerStats(playerId)
    if (action === 'call' || action === 'raise' || action === 'all_in') {
      // VPIP = voluntarily put money in pot. Blinds aren't voluntary.
      if (this.phase === GAME_PHASES.PREFLOP && stats.vpipHands < this.handIndex) {
        const last = this.handActionHistory[this.handActionHistory.length - 2]
        const isBlind = last && (last.action === 'sb' || last.action === 'bb')
        // crude but workable: any preflop call/raise outside blind posting counts
        stats.vpipHands += 1
        stats.handsPlayed = stats.vpipHands
      }
      if (action === 'raise' || action === 'all_in') stats.aggressiveActions += 1
    }
    if (action === 'fold' && toCall > 0) stats.foldsToBet += 1
    // Track recent raise sizes for opponent profiling.
    if (action === 'raise' || action === 'all_in') {
      const arr = stats.recentBetSizes
      arr.push(this.playerBets.get(playerId) || 0)
      if (arr.length > 10) {
        // Avoid shift() — copy the tail in one go.
        stats.recentBetSizes = arr.slice(arr.length - 10)
      }
    }

    this.afterAction()
    return { success: true }
  }

  returnUncalledBets() {
    let highestBet = 0
    let secondHighestBet = 0
    let highestBettor = null

    for (const p of this.players) {
      const bet = this.playerTotalBets.get(p.id) || 0
      if (bet > highestBet) {
        secondHighestBet = highestBet
        highestBet = bet
        highestBettor = p
      } else if (bet > secondHighestBet) {
        secondHighestBet = bet
      }
    }

    if (highestBet > secondHighestBet && highestBettor) {
      const uncalled = highestBet - secondHighestBet
      highestBettor.chips += uncalled
      this.playerTotalBets.set(highestBettor.id, secondHighestBet)
      
      const currentRoundBet = this.playerBets.get(highestBettor.id) || 0
      this.playerBets.set(highestBettor.id, Math.max(0, currentRoundBet - uncalled))
      this.pot -= uncalled
    }
  }

  afterAction() {
    const notFolded = this.players.filter(p => !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id))
    if (notFolded.length <= 1) {
      if (notFolded.length === 1) {
        this.returnUncalledBets() 
        this.finishHand(notFolded[0].id)
      }
      return
    }

    const decision = this.getDecisionPlayers()

    if (decision.length === 0) {
      this.runOutBoard()
      return
    }

    if (decision.length === 1) {
      const p = decision[0]
      const pBet = this.playerBets.get(p.id) || 0
      const needsToAct = pBet < this.currentBet && !this.roundActed.has(p.id)
      if (needsToAct) {
        this.setActiveIndex(this.players.indexOf(p))
        this.broadcastState()
        return
      }
      this.runOutBoard()
      return
    }

    const allActed = decision.every(p => this.roundActed.has(p.id))
    const allEven = decision.every(p => (this.playerBets.get(p.id) || 0) >= this.currentBet)

    if (allActed && allEven) {
      this.advancePhase()

      if (this.phase === GAME_PHASES.SHOWDOWN) {
        this.resolveShowdown()
        return
      }

      const newDecision = this.getDecisionPlayers()
      if (newDecision.length <= 1) {
        if (newDecision.length === 1 && this.currentBet > 0 &&
            (this.playerBets.get(newDecision[0].id) || 0) < this.currentBet) {
          this.setActiveIndex(this.players.indexOf(newDecision[0]))
          this.broadcastState()
          return
        }
        if (this.phase !== GAME_PHASES.SHOWDOWN) {
          this.runOutBoard()
        }
        return
      }
      this.broadcastState()
      return
    }

    const nextIdx = this.findNextDecisionIndex((this.activeIndex + 1) % this.players.length)
    if (nextIdx === -1) {
      this.runOutBoard()
      return
    }
    
    this.setActiveIndex(nextIdx)
    this.broadcastState()
  }

  runOutBoard() {
    if (this.phase === GAME_PHASES.SHOWDOWN || this.phase === GAME_PHASES.WAITING) {
      return
    }

    // Multi-runout in flight: cards are being dealt by _executeRunoutStep,
    // the normal street-by-street advance is taken over. Bail out so the
    // automatic 2.2s timer can't fight that loop.
    if (this._runoutInProgress) return

    // Vote pending: pause the runout until the vote resolves. _resolveRunoutVote
    // re-enters runOutBoard (for N=1) or kicks off _executeMultiRunout (for N>1).
    if (this._runoutVote && !this._runoutVote.resolved) return

    if (!this.exposeRunoutHands && this.shouldExposeRunoutHands()) {
      this.exposeRunoutHands = true
      this.broadcastState()
      // Bumped 1200 → 2200ms so spectators can register the reveal before
      // the first runout card lands.
      this.runOutBoardTimeout = this._gameTimeout(() => this.runOutBoard(), 2200)
      return
    }

    // After hands have been exposed (or were already visible), check if
    // run-it-twice should be offered. The vote sits between the reveal and
    // the first community card of the runout so players see what they're
    // gambling on before they decide.
    if (this._shouldOfferRunItTwice()) {
      this._startRunoutVote()
      return
    }

    this.advancePhaseCards()
    this.broadcastState()

    if (this.phase === GAME_PHASES.SHOWDOWN) {
      this.resolveShowdown()
    } else {
      this.runOutBoardTimeout = this._gameTimeout(() => this.runOutBoard(), 2200)
    }
  }

  advancePhaseCards() {
    // Resolve a single community card with this precedence:
    //   1. rig_hand board slot for this index (most specific)
    //   2. river_card power (only when filling slot 4)
    //   3. next_card power (one-shot, fires on whatever's next)
    //   4. random draw
    // Each consumed rig source is nulled so it can't fire twice.
    // If any rig points to a card that's already been dealt (e.g. it
    // came out earlier in this hand), Deck.removeCard returns null and
    // we fall through to the next preference — no error to the user,
    // and crucially no information leak about what's still in the deck.
    const drawCommunity = (boardSlotIndex) => {
      // Each rigged source is ALREADY pre-extracted from the deck at
      // arm time (setRigged* / startHand), so we just hand the stash
      // card to the caller — no second removeCard call here. If a
      // rig source is missing (extraction failed at arm time because
      // the card was already dealt), we fall through to the next
      // source, ending in a normal random draw.
      const slotted = this._riggedBoardSlots?.[boardSlotIndex]
      if (slotted) {
        this._riggedBoardSlots[boardSlotIndex] = null
        return slotted
      }
      if (boardSlotIndex === 4 && this._riggedRiverCard) {
        const c = this._riggedRiverCard
        this._riggedRiverCard = null
        return c
      }
      if (this._riggedNextCard) {
        const c = this._riggedNextCard
        this._riggedNextCard = null
        return c
      }
      return this.deck.draw()
    }

    switch (this.phase) {
      case GAME_PHASES.PREFLOP:
        // Flop: three cards consume slots 0,1,2 in order.
        this.communityCards.push(drawCommunity(0))
        this.communityCards.push(drawCommunity(1))
        this.communityCards.push(drawCommunity(2))
        this.phase = GAME_PHASES.FLOP
        break
      case GAME_PHASES.FLOP:
        this.communityCards.push(drawCommunity(3))
        this.phase = GAME_PHASES.TURN
        break
      case GAME_PHASES.TURN:
        this.communityCards.push(drawCommunity(4))
        this.phase = GAME_PHASES.RIVER
        break
      case GAME_PHASES.RIVER:
        this.phase = GAME_PHASES.SHOWDOWN
        // River played out — drop the rig-source state so a fresh hand
        // doesn't accidentally re-use it. We intentionally do NOT clear
        // _handIsRigged here: resolveShowdown still needs to snapshot
        // it into handSummary so ELO recorders can skip rating rigged
        // hands. startHand of the next hand resets the flag.
        this._riggedBoardSlots = null
        this._riggedNextCard = null
        this._riggedRiverCard = null
        break
    }
    // Board changed → bot signals derived from the board must be recomputed
    // on the next decision.
    this._boardTextureCache = null
  }

  advancePhase() {
    this.returnUncalledBets() 

    this.roundActed.clear()
    this.currentBet = 0
    this.aggressionCount = 0 
    this.currentBetContext = null
    for (const p of this.players) {
      this.playerBets.set(p.id, 0)
    }
    for (const [id, act] of this.playerActions) {
      if (act.action !== 'fold' && act.action !== 'all_in') {
        this.playerActions.set(id, { action: '', amount: 0, text: '' })
      }
    }

    this.advancePhaseCards()

    if (this.phase !== GAME_PHASES.SHOWDOWN) {
      const next = this.findNextDecisionIndex((this.dealerIndex + 1) % this.players.length)
      if (next !== -1) this.setActiveIndex(next)
    }
  }

  checkHandOver() {
    const notFolded = this.players.filter(p => !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id))
    if (notFolded.length === 1) {
      clearTimeout(this.runOutBoardTimeout)
      this.finishHand(notFolded[0].id)
    } else if (notFolded.length === 0) {
      this.resetToWaiting()
    }
  }

  shouldExposeRunoutHands() {
    const active = this.getActivePlayers()
    if (active.length <= 1) return false

    const playersWithDecisions = this.getDecisionPlayers()
    const nonAllInActive = active.filter(p => !this.allInPlayers.has(p.id))
    if (playersWithDecisions.length > 1) return false

    if (playersWithDecisions.length === 1) {
      const player = playersWithDecisions[0]
      const playerBet = this.playerBets.get(player.id) || 0
      const needsToAct = playerBet < this.currentBet && !this.roundActed.has(player.id)
      if (needsToAct) return false
    }

    return this.phase !== GAME_PHASES.WAITING &&
      this.phase !== GAME_PHASES.SHOWDOWN &&
      active.some(p => this.allInPlayers.has(p.id)) &&
      nonAllInActive.length <= 1
  }

  calculatePots() {
    const pots = []
    let activeBetters = [...this.players].filter(p => this.playerTotalBets.get(p.id) > 0)
    
    while (activeBetters.length > 0) {
      const minBet = Math.min(...activeBetters.map(p => this.playerTotalBets.get(p.id)))
      let potAmount = 0
      const eligiblePlayers = []
      
      for (const p of this.players) {
        const bet = this.playerTotalBets.get(p.id) || 0
        if (bet > 0) {
          const contribution = Math.min(bet, minBet)
          potAmount += contribution
          this.playerTotalBets.set(p.id, bet - contribution)
          if (!this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id)) {
            eligiblePlayers.push(p.id)
          }
        }
      }
      
      if (potAmount > 0) {
        pots.push({ amount: potAmount, eligiblePlayers })
      }
      
      activeBetters = [...this.players].filter(p => this.playerTotalBets.get(p.id) > 0)
    }
    return pots
  }

  resolveShowdown() {
    // Prevent uncalled bets on all-in scenarios from being treated as side pots
    this.returnUncalledBets()

    const pots = this.calculatePots()
    
    const active = this.players.filter(p => !this.removedPlayers.has(p.id) && !this.foldedPlayers.has(p.id))
    const evaluated = active.map(p => ({
      playerId: p.id,
      hand: evaluateHand([...(this.playerHands.get(p.id) || []), ...this.communityCards])
    }))
    
    const winnersOutput = new Map()
    const playerHandNames = {}
    // Per-pot breakdown so the client can render "Main pot: Alice · Side pot:
    // Bob" instead of just "Split pot" when winners differ across pots.
    // pots[0] is the main pot, pots[1+] are progressively higher side pots.
    const potBreakdown = []

    evaluated.forEach(e => {
      playerHandNames[e.playerId] = getHandName(e.hand)
    })

    pots.forEach((pot, potIndex) => {
      const eligibleEvaluated = evaluated.filter(e => pot.eligiblePlayers.includes(e.playerId))
      if (eligibleEvaluated.length === 0) return

      eligibleEvaluated.sort((a, b) => compareHands(b.hand, a.hand))
      const best = eligibleEvaluated[0]
      const potWinners = eligibleEvaluated.filter(e => compareHands(e.hand, best.hand) === 0)

      const share = Math.floor(pot.amount / potWinners.length)
      let remainder = pot.amount % potWinners.length

      const breakdownEntry = {
        // potIndex 0 = main pot, 1+ = side pots (smallest stack first).
        potIndex,
        potLabel: potIndex === 0 ? 'main' : (pots.length > 2 ? `side-${potIndex}` : 'side'),
        amount: pot.amount,
        winners: []
      }

      for (const w of potWinners) {
        const player = this.players.find(p => p.id === w.playerId)
        if (player) {
          const wonAmount = share + (remainder > 0 ? 1 : 0)
          player.chips += wonAmount
          remainder = Math.max(0, remainder - 1)

          breakdownEntry.winners.push({
            playerId: w.playerId,
            username: player.username,
            chips: wonAmount,
            handName: getHandName(w.hand)
          })

          if (winnersOutput.has(w.playerId)) {
            winnersOutput.get(w.playerId).chips += wonAmount
          } else {
            winnersOutput.set(w.playerId, {
              playerId: w.playerId,
              username: player.username,
              chips: wonAmount,
              handName: getHandName(w.hand),
              handRank: w.hand.rank,
              winningCards: w.hand.bestCards
            })
          }
        }
      }
      potBreakdown.push(breakdownEntry)
    })

    this.phase = GAME_PHASES.SHOWDOWN
    this._clearTurnTimeout()
    this._cancelRunoutVote()
    this._recordAllInLuckForShowdown(active, winnersOutput)
    this.recordCompletedHand({
      type: 'showdown',
      winners: Array.from(winnersOutput.values()),
      playerHandNames
    })
    this.broadcastState()
    this.onBroadcast({
      type: 'showdown',
      data: {
        winners: Array.from(winnersOutput.values()),
        hands: Object.fromEntries(active.map(p => [p.id, this.playerHands.get(p.id)])),
        playerHandNames,
        potBreakdown
      }
    })

    this._gameTimeout(() => {
      const oldDealerId = this.players[this.dealerIndex]?.id;

      this.players.forEach(p => this.rebuyIfNeeded(p));

      this.players = this.getSeatedPlayers()
      this.removedPlayers.clear()

      if (this.players.length > 0) {
        const prevIdx = this.players.findIndex(p => p.id === oldDealerId)
        if (prevIdx !== -1) {
          this.dealerIndex = (prevIdx + 1) % this.players.length
        } else {
          this.dealerIndex = this.dealerIndex % this.players.length
        }
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
    }, 15000)
  }

  finishHand(winnerId) {
    const winner = this.players.find(p => p.id === winnerId)
    if (winner) winner.chips += this.pot

    this.phase = GAME_PHASES.SHOWDOWN
    this._clearTurnTimeout()
    this._cancelRunoutVote()
    this._clearRunoutInProgress()
    this.recordCompletedHand({
      type: 'fold_out',
      winners: [{ playerId: winnerId, username: winner?.username, chips: this.pot, handName: 'Won by fold' }],
      playerHandNames: { [winnerId]: 'Won by fold' }
    })
    this.broadcastState()
    this.onBroadcast({
      type: 'showdown',
      data: {
        winners: [{ playerId: winnerId, username: winner?.username, chips: this.pot, handName: 'Won by fold', winningCards: [] }],
        hands: {},
        playerHandNames: { [winnerId]: 'Won by fold' }
      }
    })

    this._gameTimeout(() => {
      const oldDealerId = this.players[this.dealerIndex]?.id;

      this.players.forEach(p => this.rebuyIfNeeded(p));

      this.players = this.getSeatedPlayers()
      this.removedPlayers.clear()

      if (this.players.length > 0) {
        const prevIdx = this.players.findIndex(p => p.id === oldDealerId)
        if (prevIdx !== -1) {
          this.dealerIndex = (prevIdx + 1) % this.players.length
        } else {
          this.dealerIndex = this.dealerIndex % this.players.length
        }
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
    }, 5000)
  }

  // Per-signed-in-user luck snapshot for any all-in player who reached
  // this showdown. Reconstructs the board state at the latest all-in
  // (using handActionHistory's phase tag) and Monte-Carlos each active
  // hand's equity from that point. Bots are skipped. Fire-and-forget DB
  // writes inside luckStats — engine never blocks on them.
  _recordAllInLuckForShowdown(active, winnersOutput) {
    const allInActive = active.filter(p => this.allInPlayers.has(p.id))
    if (allInActive.length < 2) return
    // Need at least one signed-in human all-in to bother computing equity.
    if (!allInActive.some(p => p.userId && !p.isBot)) return

    let latestAllIn = null
    for (const a of this.handActionHistory) {
      if (a.action === 'all_in') latestAllIn = a
    }
    if (!latestAllIn) return

    const boardSize = PHASE_BOARD_SIZE[latestAllIn.phase] ?? 0
    const boardAtAllIn = this.communityCards.slice(0, boardSize)

    // Every active player's hole cards feed the equity sim (a bot's hand
    // still affects a human's equity even though the bot itself isn't
    // recorded). Skip if any active seat is missing hole cards.
    const equityInput = active
      .map(p => ({
        playerId: p.id,
        userId: p.userId || null,
        isBot: !!p.isBot,
        hole: this.playerHands.get(p.id)
      }))
      .filter(p => Array.isArray(p.hole) && p.hole.length === 2)
    if (equityInput.length < 2) return

    const equityMap = computeAllInEquity(
      equityInput.map(p => ({ playerId: p.playerId, hole: p.hole })),
      boardAtAllIn
    )

    for (const p of equityInput) {
      if (!p.userId || p.isBot) continue
      if (!this.allInPlayers.has(p.playerId)) continue
      const equity = equityMap.get(p.playerId) ?? 0.5
      const won = winnersOutput.has(p.playerId)
      recordAllInShowdown({ userId: p.userId, equity, won })
        .catch(err => console.warn('[luck] all-in write failed:', err.message))
    }
  }

  recordCompletedHand({ type, winners, playerHandNames }) {
    // Cards-by-player map: at showdown, the engine reveals cards for everyone
    // who didn't fold. On a fold-out, only the lone non-folded player is
    // technically "active" — we don't force-reveal them, so cards stays null.
    const cardsByPlayer = {}
    const actionsByPlayer = {}
    const winnerIds = new Set(winners.map(w => w.playerId))

    // Pre-bucket actions by playerId in one O(N) pass. Previously this used
    // `.filter(a => a.playerId === p.id)` inside a per-player loop —
    // O(players × actions) — which the downstream summary readers in
    // PokerRoom._recordBotHandResults / _recordHumanHandResults then walked
    // through again.
    for (const p of this.players) actionsByPlayer[p.id] = []
    for (const a of this.handActionHistory) {
      const bucket = actionsByPlayer[a.playerId]
      if (bucket) bucket.push(a)
    }

    for (const p of this.players) {
      const folded = this.foldedPlayers.has(p.id)
      const removed = this.removedPlayers.has(p.id)
      if (type === 'showdown' && !folded && !removed) {
        cardsByPlayer[p.id] = (this.playerHands.get(p.id) || []).map(c => ({ ...c }))
      } else {
        cardsByPlayer[p.id] = null
      }
    }

    const summary = {
      handIndex: this.handIndex,
      phaseEnded: this.phase,
      type, // 'showdown' | 'fold_out'
      pot: this.pot,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      communityCards: [...this.communityCards],
      actions: this.handActionHistory.slice(),
      actionsByPlayer,
      cards: cardsByPlayer,
      // Snapshot whether this hand had any deck rigs applied. Downstream
      // ELO / luck-stat recorders consult this to skip rating rigged
      // hands — a player who scripted AA shouldn't have their rating go
      // up for winning a coin flip they pre-decided. We read it from
      // the live engine flag here, before the next-hand cleanup runs.
      handIsRigged: !!this._handIsRigged,
      // playerHandNames at the summary level too so the bot context can
      // attach "Two Pair", "Flush", etc. to each revealed-showdown entry.
      playerHandNames: { ...(playerHandNames || {}) },
      winners: winners.map(w => ({
        playerId: w.playerId,
        username: w.username,
        chips: w.chips,
        handName: w.handName || playerHandNames?.[w.playerId] || null
      })),
      profitsByPlayer: {}
    }

    for (const p of this.players) {
      const start = this.handStartChips.get(p.id) ?? p.chips
      summary.profitsByPlayer[p.id] = p.chips - start
      const stats = this.ensurePlayerStats(p.id)
      stats.profit += (p.chips - start)

      // Showdown counters: anyone who didn't fold made it to a showdown.
      if (type === 'showdown' && !this.foldedPlayers.has(p.id) && !this.removedPlayers.has(p.id)) {
        stats.showdownsSeen += 1
        if (winnerIds.has(p.id)) stats.showdownsWon += 1
      }
    }
    this.handHistory.push(summary)
    // Bounded to 50 hands. shift() is O(n) on a 50-entry array — drop the
    // oldest by replacing with the tail slice (V8 elides this on small arrays).
    if (this.handHistory.length > 50) {
      this.handHistory = this.handHistory.slice(this.handHistory.length - 50)
    }
    // Invalidate caches that depend on the completed-hand stream.
    this._handHistorySnapshot = null
  }

  // Build everything in the game-state envelope that's shared across viewers.
  // The per-viewer `players[]` array gets attached separately so we can swap
  // only the `cards` slot per recipient instead of rebuilding the whole tree.
  _buildStateEnvelope() {
    const visiblePlayers = this.getSeatedPlayers()
    const dealerPlayerId = this.players[this.dealerIndex]?.id || null
    const visibleDealerIndex = visiblePlayers.findIndex(p => p.id === dealerPlayerId)
    const activePlayer = this.players[this.activeIndex]
    const runoutLocked = this.exposeRunoutHands || this.shouldExposeRunoutHands()
    // The seat at activeIndex only counts as "active" if it actually has a
    // decision to make. Once they go all-in, fold, or get removed, the
    // engine doesn't auto-advance activeIndex — without this gate the
    // client would still flash "YOUR TURN" + leave action buttons clickable
    // for the player who just shoved or called all-in.
    const activeIsActionable = activePlayer
      && !this.removedPlayers.has(activePlayer.id)
      && !this.foldedPlayers.has(activePlayer.id)
      && !this.allInPlayers.has(activePlayer.id)
      && activePlayer.isConnected
    const activePlayerId = activeIsActionable ? activePlayer.id : null
    // The turn deadline only ticks when there's another human at the
    // table — same condition as _scheduleTurnTimeout. Without this gate
    // the client would still show the red-ring warning even in solo-vs-
    // bots games where the server has nothing it'd actually auto-fold.
    const otherHumanPresent = activePlayerId && this.players.some(p =>
      p && p.id !== activePlayerId && !p.isBot && p.isConnected
    )
    const hasTimedActiveTurn = Boolean(
      activePlayerId &&
      otherHumanPresent &&
      this.phase !== GAME_PHASES.WAITING &&
      this.phase !== GAME_PHASES.SHOWDOWN
    )
    // We always expose a monotonic turn-start timestamp (even when the
    // deadline is untimed) because BotPlayer uses it as the turn-dedup
    // key. Without this, all turns in a bot-only arena have the same key
    // ("phase-null"), so when action wraps back to a bot within the same
    // phase the bot's _lastTurnKey collides and the bot freezes. The
    // *display* of the warning ring still keys off activeTurnExpiresAt
    // below, so the UX gate is preserved.
    const turnStartedAt = activePlayerId &&
      this.phase !== GAME_PHASES.WAITING &&
      this.phase !== GAME_PHASES.SHOWDOWN
        ? this.lastTurnChange
        : null

    return {
      visiblePlayers,
      visibleDealerIndex,
      runoutLocked,
      activePlayerId,
      hasTimedActiveTurn,
      envelope: {
        phase: this.phase,
        pot: this.pot,
        currentBet: this.currentBet,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        communityCards: this.communityCards,
        runoutLocked,
        // Whether the rig_hand power has already been used for the
        // upcoming hand. The client uses this to show a banner so
        // a second user doesn't waste time picking cards just to be
        // rejected with `already_rigged` server-side. Only the flag
        // is exposed — the actual rigged cards stay secret so other
        // players can't peek at the script.
        nextHandRigged: !!(this._pendingRigHand || this._riggedHoleCards || this._riggedBoardSlots),
        dealerIndex: visibleDealerIndex,
        activePlayerId,
        activeTurnStartedAt: turnStartedAt,
        // Use the headcount-scaled limit so the client's countdown ring
        // matches what the server will actually enforce.
        // 2026-05: _currentTurnLimitMs() can return null for heads-up
        // (no timer). In that case BOTH expiresAt and limitMs must be
        // null on the wire — otherwise `lastTurnChange + null` coerces
        // to `lastTurnChange + 0` and the client interprets the turn
        // as already expired, immediately ringing the seat red.
        ...(() => {
          const limitMs = this._currentTurnLimitMs()
          const timed = hasTimedActiveTurn && typeof limitMs === 'number' && limitMs > 0
          return {
            activeTurnExpiresAt: timed ? this.lastTurnChange + limitMs : null,
            activeTurnLimitMs: timed ? limitMs : null,
          }
        })(),
        activeTurnWarningMs: POKER_CONFIG.TURN_WARNING_MS
      }
    }
  }

  // Build a single player record without cards. cards is attached by the
  // caller depending on what the viewer is allowed to see.
  _buildPlayerSeat(p) {
    return {
      id: p.id,
      username: p.username,
      avatarId: p.avatarId || null,
      avatarUrl: p.avatarUrl || null,
      isBot: Boolean(p.isBot),
      botId: p.botId || null,
      botColor: p.botColor || null,
      botTextColor: p.botTextColor || null,
      botAvatarUrl: p.botAvatarUrl || null,
      addedByPlayerId: p.addedByPlayerId || null,
      ownerDisplayName: p.ownerDisplayName || null,
      // Bot profile fields used by the seat-click popover. We surface
      // these for every seat (null on humans) so the client doesn't
      // need a separate fetch — important for private bots, which
      // anonymous viewers can't hit /api/bots/:id for.
      botOwnerUserId: p.botOwnerUserId || null,
      botElo: typeof p.botElo === 'number' ? p.botElo : null,
      botHandsPlayed: p.botHandsPlayed ?? null,
      botHandsWon: p.botHandsWon ?? null,
      botShowdownsPlayed: p.botShowdownsPlayed ?? null,
      botShowdownsWon: p.botShowdownsWon ?? null,
      botKind: p.botKind || null,
      botNeuralKind: p.botNeuralKind || null,
      botCloneTier: p.botCloneTier || null,
      botIsPublic: typeof p.botIsPublic === 'boolean' ? p.botIsPublic : null,
      chips: p.chips,
      bet: this.playerBets.get(p.id) || 0,
      totalBet: this.playerTotalBets.get(p.id) || 0,
      // P/L = chips on hand + chips committed to the current pot + chips
      // staked on open side bets − initial buy-in. The open side-bet stake
      // is included so placing a prop bet doesn't immediately *look* like a
      // loss — it's just chips parked in a market, mark-to-market is hidden
      // until the position is sold or the prop resolves (engine drains the
      // stake at that point and the realized delta lands in `chips`).
      profit: p.chips + (this.playerTotalBets.get(p.id) || 0) + (p.openSideBetStake || 0) - (p.pokerBuyIn || POKER_CONFIG.STARTING_CHIPS),
      buyIn: p.pokerBuyIn || POKER_CONFIG.STARTING_CHIPS,
      openSideBetStake: p.openSideBetStake || 0,
      lastAction: this.playerActions.get(p.id) || null,
      folded: this.foldedPlayers.has(p.id),
      allIn: this.allInPlayers.has(p.id),
      waitingNextHand: this.waitingNextHand.has(p.id),
      isConnected: p.isConnected
    }
  }

  // Decide what `cards` array a viewer should see for a given seat. Mirrors
  // the original inline rule in getGameState — extracted so the broadcast
  // path can compute it once per (viewer, seat) pair.
  _cardsForViewer(seatPlayer, forPlayerId, runoutLocked, revealAllCards) {
    const handPresent = this.playerHands.has(seatPlayer.id) && (this.playerHands.get(seatPlayer.id) || []).length > 0
    const folded = this.foldedPlayers.has(seatPlayer.id)
    const waitingNext = this.waitingNextHand.has(seatPlayer.id)
    const visible =
      forPlayerId === seatPlayer.id ||
      (revealAllCards && !waitingNext) ||
      (runoutLocked && !folded && !waitingNext) ||
      (this.phase === GAME_PHASES.SHOWDOWN && !folded && !waitingNext)
    if (visible) return this.playerHands.get(seatPlayer.id) || []
    return handPresent ? [null, null] : []
  }

  // Backwards-compatible single-shot game state (still used by routes/tests
  // and by spectator joins that need a one-off snapshot). Broadcast hot path
  // goes through buildBroadcastViews below instead.
  getGameState(forPlayerId = null, options = {}) {
    const { visiblePlayers, envelope, runoutLocked } = this._buildStateEnvelope()
    const revealAllCards = Boolean(options.revealAllCards)
    return {
      ...envelope,
      serverTime: Date.now(),
      players: visiblePlayers.map(p => ({
        ...this._buildPlayerSeat(p),
        cards: this._cardsForViewer(p, forPlayerId, runoutLocked, revealAllCards)
      }))
    }
  }

  // Hot-path: build the views we'll need for one broadcast tick.
  // Returns:
  //   - sharedView: object for any recipient who gets the "everyone reveals"
  //     view (spectators always, and seated players when phase=SHOWDOWN or
  //     runoutLocked — those cases collapse to a single shared payload).
  //   - perPlayerView(seatId): builds the seat's view, reusing the cached
  //     "no-cards" seats array and only swapping in that seat's hole cards.
  //
  // Designed so the caller can JSON.stringify each unique view ONCE and reuse
  // the resulting string for every recipient.
  buildBroadcastViews() {
    const { visiblePlayers, envelope, runoutLocked } = this._buildStateEnvelope()
    const isSharedReveal = runoutLocked || this.phase === GAME_PHASES.SHOWDOWN
    const baseSeats = visiblePlayers.map(p => this._buildPlayerSeat(p))
    const now = Date.now()

    // Spectator view (revealAllCards = true). Same shape for every spectator.
    const spectatorSeats = baseSeats.map((seat, i) => ({
      ...seat,
      cards: this._cardsForViewer(visiblePlayers[i], null, runoutLocked, true)
    }))
    const spectatorView = { ...envelope, serverTime: now, players: spectatorSeats }

    // If we're in a shared-reveal phase, every seated player sees the same
    // thing spectators do (apart from `revealAllCards` semantics which are
    // moot here). Reuse the spectator view as the player view.
    if (isSharedReveal) {
      return {
        spectatorView,
        sharedPlayerView: spectatorView,
        perPlayerView: () => spectatorView
      }
    }

    // Normal play: build seats with no cards revealed, then for each player
    // shallow-clone the seats array and swap in that player's hole cards.
    const hiddenSeats = baseSeats.map((seat, i) => ({
      ...seat,
      cards: this._cardsForViewer(visiblePlayers[i], null, runoutLocked, false)
    }))

    const seatIndexById = new Map(visiblePlayers.map((p, i) => [p.id, i]))

    const perPlayerView = (playerId) => {
      const idx = seatIndexById.get(playerId)
      if (idx === undefined) {
        // Caller is seated but not yet in visiblePlayers (e.g. just removed).
        // Hand them the hidden-cards view; nothing personal to reveal.
        return { ...envelope, serverTime: now, players: hiddenSeats }
      }
      const seats = hiddenSeats.slice()
      seats[idx] = {
        ...hiddenSeats[idx],
        cards: this.playerHands.get(playerId) || []
      }
      return { ...envelope, serverTime: now, players: seats }
    }

    return {
      spectatorView,
      sharedPlayerView: null,
      perPlayerView
    }
  }

  broadcastState() {
    if (this.onStateBroadcast) {
      this.onStateBroadcast()
      return
    }

    for (const player of this.getSeatedPlayers()) {
      player.send({ type: 'game_state', data: this.getGameState(player.id) })
    }
  }

}

// Run-it-twice methods (~300 lines) live in ./runItTwice.js. Attach them
// to PokerGame's prototype here so `this` binding stays correct without
// PokerGame ballooning past 1700 lines again.
attachRunItTwice(PokerGame)

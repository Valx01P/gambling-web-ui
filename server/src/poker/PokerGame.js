import { Deck } from './deck.js'
import { GAME_PHASES, POKER_CONFIG, MESSAGE_TYPES } from '../config/constants.js'
import { evaluateHand, compareHands, getHandName } from './handEvaluator.js'

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

  _scheduleTurnTimeout() {
    this._clearTurnTimeout()
    if (!this.onTurnTimeout) return
    if (this.paused) return
    if (this.phase === GAME_PHASES.WAITING || this.phase === GAME_PHASES.SHOWDOWN) return
    const player = this.players[this.activeIndex]
    if (!player) return
    const playerId = player.id
    this._turnTimeoutHandle = setTimeout(() => {
      this._turnTimeoutHandle = null
      // Stale check — only fire if it's still this player's turn.
      const stillActive = this.players[this.activeIndex]?.id === playerId
      if (!stillActive) return
      try { this.onTurnTimeout(playerId) } catch (err) {
        console.error('[poker] turn timeout cb:', err)
      }
    }, POKER_CONFIG.TURN_LIMIT_MS)
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
    clearTimeout(this.runOutBoardTimeout)

    this.dealerIndex = this.dealerIndex % this.players.length

    for (const player of this.players) {
      this.playerHands.set(player.id, this.deck.drawMultiple(2))
      this.playerBets.set(player.id, 0)
      this.playerTotalBets.set(player.id, 0)
    }

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
        if (isRaise) {
          this.currentBet = newBet
          this.roundActed.clear()
        }

        this.aggressionCount++
        if (isRaise) {
          this.currentBetContext = {
            playerId,
            isReRaise: this.aggressionCount >= 3,
            isAllIn: false
          }
        }
        this.playerActions.set(playerId, { action: 'raise', amount: newBet, text: this.getAggressionLabel(false) })
        if (currentPlayer.chips === 0) this.allInPlayers.add(playerId)
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

    if (!this.exposeRunoutHands && this.shouldExposeRunoutHands()) {
      this.exposeRunoutHands = true
      this.broadcastState()
      // Bumped 1200 → 2200ms so spectators can register the reveal before
      // the first runout card lands.
      this.runOutBoardTimeout = this._gameTimeout(() => this.runOutBoard(), 2200)
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
    switch (this.phase) {
      case GAME_PHASES.PREFLOP:
        this.communityCards.push(...this.deck.drawMultiple(3))
        this.phase = GAME_PHASES.FLOP
        break
      case GAME_PHASES.FLOP:
        this.communityCards.push(this.deck.draw())
        this.phase = GAME_PHASES.TURN
        break
      case GAME_PHASES.TURN:
        this.communityCards.push(this.deck.draw())
        this.phase = GAME_PHASES.RIVER
        break
      case GAME_PHASES.RIVER:
        this.phase = GAME_PHASES.SHOWDOWN
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
    const activePlayerId = activePlayer && !this.removedPlayers.has(activePlayer.id) && activePlayer.isConnected
      ? activePlayer.id
      : null
    const hasTimedActiveTurn = Boolean(
      activePlayerId &&
      this.phase !== GAME_PHASES.WAITING &&
      this.phase !== GAME_PHASES.SHOWDOWN
    )

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
        dealerIndex: visibleDealerIndex,
        activePlayerId,
        activeTurnStartedAt: hasTimedActiveTurn ? this.lastTurnChange : null,
        activeTurnExpiresAt: hasTimedActiveTurn ? this.lastTurnChange + POKER_CONFIG.TURN_LIMIT_MS : null,
        activeTurnLimitMs: POKER_CONFIG.TURN_LIMIT_MS,
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
      addedByPlayerId: p.addedByPlayerId || null,
      ownerDisplayName: p.ownerDisplayName || null,
      chips: p.chips,
      bet: this.playerBets.get(p.id) || 0,
      totalBet: this.playerTotalBets.get(p.id) || 0,
      profit: p.chips + (this.playerTotalBets.get(p.id) || 0) - (p.pokerBuyIn || POKER_CONFIG.STARTING_CHIPS),
      buyIn: p.pokerBuyIn || POKER_CONFIG.STARTING_CHIPS,
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

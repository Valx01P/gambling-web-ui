import { Deck } from './deck.js'
import { GAME_PHASES, POKER_CONFIG } from '../config/constants.js'
import { determineWinners } from './handEvaluator.js'

export class PokerGame {
  constructor(onBroadcast) {
    this.deck = new Deck()
    this.phase = GAME_PHASES.WAITING
    this.communityCards = []
    this.pot = 0
    this.currentBet = 0
    this.smallBlind = POKER_CONFIG.SMALL_BLIND
    this.bigBlind = POKER_CONFIG.BIG_BLIND
    this.dealerIndex = 0
    this.activeIndex = 0
    this.players = []
    this.playerHands = new Map()
    this.playerBets = new Map()
    this.playerTotalBets = new Map()
    this.playerActions = new Map()
    this.foldedPlayers = new Set()
    this.allInPlayers = new Set()
    this.roundActed = new Set()
    this.onBroadcast = onBroadcast || (() => {})
  }

  addPlayer(player) {
    if (this.players.length >= POKER_CONFIG.MAX_PLAYERS) return false
    if (this.players.find(p => p.id === player.id)) return false
    this.players.push(player)
    return true
  }

  removePlayer(playerId) {
    const player = this.players.find(p => p.id === playerId)
    if (!player) return
    player.isConnected = false

    if (this.phase !== GAME_PHASES.WAITING && this.phase !== GAME_PHASES.SHOWDOWN) {
      // If active hand and it's their turn, gracefully fold them to keep the game loop intact
      if (this.players[this.activeIndex]?.id === playerId) {
        this.handleAction(playerId, 'fold')
      } else {
        this.foldedPlayers.add(playerId)
        this.checkHandOver()
      }
    } else {
      // Safe to immediately pull them out if no hand is running
      this.players = this.players.filter(p => p.id !== playerId)
    }
  }

  getActivePlayers() {
    return this.players.filter(p => !this.foldedPlayers.has(p.id) && p.isConnected)
  }

  getDecisionPlayers() {
    return this.players.filter(p =>
      !this.foldedPlayers.has(p.id) && !this.allInPlayers.has(p.id) && p.isConnected
    )
  }

  canStart() {
    return this.players.length >= POKER_CONFIG.MIN_PLAYERS && this.phase === GAME_PHASES.WAITING
  }

  findNextDecisionIndex(startFrom) {
    for (let i = 0; i < this.players.length; i++) {
      const idx = (startFrom + i) % this.players.length
      const p = this.players[idx]
      if (p && !this.foldedPlayers.has(p.id) && !this.allInPlayers.has(p.id) && p.isConnected) {
        return idx
      }
    }
    return -1
  }

  startHand() {
    if (!this.canStart()) return false

    this.deck.reset()
    this.communityCards = []
    this.pot = 0
    this.currentBet = 0
    this.foldedPlayers.clear()
    this.allInPlayers.clear()
    this.playerHands.clear()
    this.playerBets.clear()
    this.playerTotalBets.clear()
    this.playerActions.clear()
    this.roundActed.clear()

    this.dealerIndex = this.dealerIndex % this.players.length

    for (const player of this.players) {
      this.playerHands.set(player.id, this.deck.drawMultiple(2))
      this.playerBets.set(player.id, 0)
      this.playerTotalBets.set(player.id, 0)
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
    this.playerActions.set(this.players[sbIdx].id, { action: 'sb', amount: this.smallBlind })
    this.postBlind(this.players[bbIdx], this.bigBlind)
    this.playerActions.set(this.players[bbIdx].id, { action: 'bb', amount: this.bigBlind })
    this.currentBet = this.bigBlind

    const firstAct = this.findNextDecisionIndex((bbIdx + 1) % this.players.length)
    if (firstAct === -1) {
      this.phase = GAME_PHASES.PREFLOP
      this.runOutBoard()
      return true
    }
    this.activeIndex = firstAct
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

  handleAction(playerId, action, amount = 0) {
    if (this.phase === GAME_PHASES.WAITING || this.phase === GAME_PHASES.SHOWDOWN) {
      return { success: false, error: 'No active hand' }
    }

    const currentPlayer = this.players[this.activeIndex]
    if (!currentPlayer || currentPlayer.id !== playerId) {
      return { success: false, error: 'Not your turn' }
    }
    if (this.foldedPlayers.has(playerId) || this.allInPlayers.has(playerId)) {
      return { success: false, error: 'Cannot act' }
    }

    const playerBet = this.playerBets.get(playerId) || 0
    const toCall = this.currentBet - playerBet

    switch (action) {
      case 'fold':
        this.foldedPlayers.add(playerId)
        this.playerActions.set(playerId, { action: 'fold', amount: 0 })
        break

      case 'check':
        if (toCall > 0) return { success: false, error: 'Must call or raise' }
        this.playerActions.set(playerId, { action: 'check', amount: 0 })
        break

      case 'call': {
        if (toCall <= 0) return { success: false, error: 'Nothing to call' }
        const callAmt = Math.min(toCall, currentPlayer.chips)
        currentPlayer.chips -= callAmt
        this.pot += callAmt
        const newBet = playerBet + callAmt
        this.playerBets.set(playerId, newBet)
        this.playerTotalBets.set(playerId, (this.playerTotalBets.get(playerId) || 0) + callAmt)
        this.playerActions.set(playerId, { action: 'call', amount: callAmt })
        if (currentPlayer.chips === 0) this.allInPlayers.add(playerId)
        break
      }

      case 'raise': {
        const raiseTarget = amount
        const minRaise = this.currentBet + this.bigBlind
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
        if (newBet > this.currentBet) {
          this.currentBet = newBet
          this.roundActed.clear()
        }
        this.playerActions.set(playerId, { action: 'raise', amount: newBet })
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
        if (newBet > this.currentBet) {
          this.currentBet = newBet
          this.roundActed.clear()
        }
        this.playerActions.set(playerId, { action: 'all_in', amount: newBet })
        currentPlayer.chips = 0
        this.allInPlayers.add(playerId)
        break
      }

      default:
        return { success: false, error: 'Invalid action' }
    }

    this.roundActed.add(playerId)
    this.afterAction()
    return { success: true }
  }

  afterAction() {
    const notFolded = this.players.filter(p => !this.foldedPlayers.has(p.id))
    if (notFolded.length <= 1) {
      if (notFolded.length === 1) this.finishHand(notFolded[0].id)
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
        this.activeIndex = this.players.indexOf(p)
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

      const newDecision = this.getDecisionPlayers()
      if (newDecision.length <= 1) {
        if (newDecision.length === 1 && this.currentBet > 0 &&
            (this.playerBets.get(newDecision[0].id) || 0) < this.currentBet) {
          this.activeIndex = this.players.indexOf(newDecision[0])
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
    this.activeIndex = nextIdx
    this.broadcastState()
  }

  runOutBoard() {
    while (this.phase !== GAME_PHASES.SHOWDOWN) {
      this.advancePhaseCards()
    }
    this.resolveShowdown()
    this.broadcastState()
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
  }

  advancePhase() {
    this.roundActed.clear()
    this.currentBet = 0
    for (const p of this.players) {
      this.playerBets.set(p.id, 0)
    }
    for (const [id, act] of this.playerActions) {
      if (act.action !== 'fold' && act.action !== 'all_in') {
        this.playerActions.set(id, { action: '', amount: 0 })
      }
    }

    this.advancePhaseCards()

    if (this.phase !== GAME_PHASES.SHOWDOWN) {
      const next = this.findNextDecisionIndex((this.dealerIndex + 1) % this.players.length)
      if (next !== -1) this.activeIndex = next
    }
  }

  checkHandOver() {
    const notFolded = this.players.filter(p => !this.foldedPlayers.has(p.id))
    if (notFolded.length <= 1) {
      if (notFolded.length === 1) this.finishHand(notFolded[0].id)
    }
  }

  resolveShowdown() {
    const active = this.players.filter(p => !this.foldedPlayers.has(p.id))
    const playerData = active.map(p => ({
      playerId: p.id,
      cards: this.playerHands.get(p.id) || []
    }))

    const winners = determineWinners(playerData, this.communityCards)
    const share = Math.floor(this.pot / winners.length)

    for (const w of winners) {
      const player = this.players.find(p => p.id === w.playerId)
      if (player) player.chips += share
    }

    this.phase = GAME_PHASES.SHOWDOWN
    this.onBroadcast({
      type: 'showdown',
      winners: winners.map(w => ({ ...w, chips: share })),
      hands: Object.fromEntries(active.map(p => [p.id, this.playerHands.get(p.id)]))
    })

    setTimeout(() => {
      // Safely reap eliminated and disconnected players after the hand is completely resolved
      this.players = this.players.filter(p => p.chips > 0 && p.isConnected)
      if (this.players.length > 0) {
        this.dealerIndex = (this.dealerIndex + 1) % this.players.length
      }
      this.phase = GAME_PHASES.WAITING
      this.broadcastState()
      if (this.canStart()) {
        setTimeout(() => this.startHand(), 1500)
      }
    }, 4000)
  }

  finishHand(winnerId) {
    const winner = this.players.find(p => p.id === winnerId)
    if (winner) winner.chips += this.pot

    this.phase = GAME_PHASES.SHOWDOWN
    this.onBroadcast({
      type: 'showdown',
      winners: [{ playerId: winnerId, chips: this.pot, handName: 'Last standing' }],
      hands: {}
    })

    setTimeout(() => {
      // Safely reap eliminated and disconnected players after the hand is completely resolved
      this.players = this.players.filter(p => p.chips > 0 && p.isConnected)
      if (this.players.length > 0) {
        this.dealerIndex = (this.dealerIndex + 1) % this.players.length
      }
      this.phase = GAME_PHASES.WAITING
      this.broadcastState()
      if (this.canStart()) {
        setTimeout(() => this.startHand(), 1500)
      }
    }, 3000)
  }

  getGameState(forPlayerId = null) {
    return {
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      communityCards: this.communityCards,
      dealerIndex: this.dealerIndex,
      activePlayerId: this.players[this.activeIndex]?.id || null,
      players: this.players.map(p => ({
        id: p.id,
        username: p.username,
        chips: p.chips,
        bet: this.playerBets.get(p.id) || 0,
        totalBet: this.playerTotalBets.get(p.id) || 0,
        lastAction: this.playerActions.get(p.id) || null,
        folded: this.foldedPlayers.has(p.id),
        allIn: this.allInPlayers.has(p.id),
        isConnected: p.isConnected,
        cards: (forPlayerId === p.id || this.phase === GAME_PHASES.SHOWDOWN)
          ? (this.playerHands.get(p.id) || [])
          : (this.playerHands.has(p.id) ? [null, null] : [])
      }))
    }
  }

  broadcastState() {
    for (const player of this.players) {
      player.send({ type: 'game_state', data: this.getGameState(player.id) })
    }
  }
}
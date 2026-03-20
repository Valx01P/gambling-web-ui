import { Deck } from './deck.js'
import { GAME_PHASES, POKER_CONFIG } from '../config/constants.js'
import { evaluateHand, compareHands, getHandName } from './handEvaluator.js'

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
    this.waitingNextHand = new Set() // Tracks players who joined post-flop
    this.aggressionCount = 0 
    this.runOutBoardTimeout = null 
    this.onBroadcast = onBroadcast || (() => {})
  }

  addPlayer(player) {
    if (this.players.length >= POKER_CONFIG.MAX_PLAYERS) return false
    if (this.players.find(p => p.id === player.id)) return false
    
    this.players.push(player)
    
    // Intercept mid-game joins natively
    if (this.phase !== GAME_PHASES.WAITING) {
      this.playerBets.set(player.id, 0)
      this.playerTotalBets.set(player.id, 0)
      this.playerActions.set(player.id, { action: '', amount: 0, text: '' })
      
      if (this.phase === GAME_PHASES.PREFLOP) {
        // Deal cards to late preflop joiner
        this.playerHands.set(player.id, this.deck.drawMultiple(2))
      } else {
        // Joined post-flop: sit them out visually
        this.playerHands.set(player.id, [])
        this.foldedPlayers.add(player.id)
        this.waitingNextHand.add(player.id)
      }
    }
    return true
  }

  removePlayer(playerId) {
    const playerIdx = this.players.findIndex(p => p.id === playerId)
    if (playerIdx === -1) return
    
    this.players[playerIdx].isConnected = false
    this.waitingNextHand.delete(playerId)

    if (this.phase !== GAME_PHASES.WAITING && this.phase !== GAME_PHASES.SHOWDOWN) {
      if (this.activeIndex === playerIdx) {
        this.handleAction(playerId, 'fold')
      } else {
        this.foldedPlayers.add(playerId)
        this.checkHandOver()
      }
    } else {
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
    this.waitingNextHand.clear() // Clean slate for everyone
    this.playerHands.clear()
    this.playerBets.clear()
    this.playerTotalBets.clear()
    this.playerActions.clear()
    this.roundActed.clear()
    this.aggressionCount = 1
    clearTimeout(this.runOutBoardTimeout)

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
        this.playerActions.set(playerId, { action: 'fold', amount: 0, text: 'FOLD' })
        break

      case 'check':
        if (toCall > 0) return { success: false, error: 'Must call or raise' }
        this.playerActions.set(playerId, { action: 'check', amount: 0, text: 'CHECK' })
        break

      case 'call': {
        if (toCall <= 0) return { success: false, error: 'Nothing to call' }
        const callAmt = Math.min(toCall, currentPlayer.chips)
        currentPlayer.chips -= callAmt
        this.pot += callAmt
        const newBet = playerBet + callAmt
        this.playerBets.set(playerId, newBet)
        this.playerTotalBets.set(playerId, (this.playerTotalBets.get(playerId) || 0) + callAmt)
        this.playerActions.set(playerId, { action: 'call', amount: callAmt, text: 'CALL' })
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
        if (newBet > this.currentBet) {
          this.currentBet = newBet
          this.roundActed.clear()
        }

        this.aggressionCount++
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

    this.roundActed.add(playerId)
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
    const notFolded = this.players.filter(p => !this.foldedPlayers.has(p.id))
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

      if (this.phase === GAME_PHASES.SHOWDOWN) {
        this.resolveShowdown()
        return
      }

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
    if (this.phase === GAME_PHASES.SHOWDOWN || this.phase === GAME_PHASES.WAITING) {
      return
    }

    this.advancePhaseCards()
    this.broadcastState()

    if (this.phase === GAME_PHASES.SHOWDOWN) {
      this.resolveShowdown()
    } else {
      this.runOutBoardTimeout = setTimeout(() => this.runOutBoard(), 1200)
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
  }

  advancePhase() {
    this.returnUncalledBets() 

    this.roundActed.clear()
    this.currentBet = 0
    this.aggressionCount = 0 
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
      if (next !== -1) this.activeIndex = next
    }
  }

  checkHandOver() {
    const notFolded = this.players.filter(p => !this.foldedPlayers.has(p.id))
    if (notFolded.length === 1) {
      clearTimeout(this.runOutBoardTimeout)
      this.finishHand(notFolded[0].id)
    } else if (notFolded.length === 0) {
      clearTimeout(this.runOutBoardTimeout)
      this.phase = GAME_PHASES.WAITING
      this.pot = 0
      this.broadcastState()
    }
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
          if (!this.foldedPlayers.has(p.id)) {
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
    const pots = this.calculatePots()
    
    const active = this.players.filter(p => !this.foldedPlayers.has(p.id))
    const evaluated = active.map(p => ({
      playerId: p.id,
      hand: evaluateHand([...(this.playerHands.get(p.id) || []), ...this.communityCards])
    }))
    
    const winnersOutput = new Map()
    const playerHandNames = {}
    
    evaluated.forEach(e => {
      playerHandNames[e.playerId] = getHandName(e.hand)
    })

    for (const pot of pots) {
      const eligibleEvaluated = evaluated.filter(e => pot.eligiblePlayers.includes(e.playerId))
      if (eligibleEvaluated.length === 0) continue
      
      eligibleEvaluated.sort((a, b) => compareHands(b.hand, a.hand))
      const best = eligibleEvaluated[0]
      const potWinners = eligibleEvaluated.filter(e => compareHands(e.hand, best.hand) === 0)
      
      const share = Math.floor(pot.amount / potWinners.length)
      let remainder = pot.amount % potWinners.length
      
      for (const w of potWinners) {
        const player = this.players.find(p => p.id === w.playerId)
        if (player) {
          const wonAmount = share + (remainder > 0 ? 1 : 0)
          player.chips += wonAmount
          remainder = Math.max(0, remainder - 1)
          
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
    }

    this.phase = GAME_PHASES.SHOWDOWN
    this.broadcastState() 
    this.onBroadcast({
      type: 'showdown',
      data: {
        winners: Array.from(winnersOutput.values()),
        hands: Object.fromEntries(active.map(p => [p.id, this.playerHands.get(p.id)])),
        playerHandNames
      }
    })

    setTimeout(() => {
      const oldDealerId = this.players[this.dealerIndex]?.id;

      this.players.forEach(p => {
        if (p.chips <= 0) {
          p.chips = POKER_CONFIG.STARTING_CHIPS;
          this.onBroadcast({ 
            type: 'system_message', 
            data: { message: `${p.username} auto-rebought for ${POKER_CONFIG.STARTING_CHIPS} chips.` } 
          });
        }
      });

      this.players = this.players.filter(p => p.isConnected)
      
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
      this.broadcastState()
      if (this.canStart()) {
        setTimeout(() => this.startHand(), 1500)
      }
    }, 15000)
  }

  finishHand(winnerId) {
    const winner = this.players.find(p => p.id === winnerId)
    if (winner) winner.chips += this.pot

    this.phase = GAME_PHASES.SHOWDOWN
    this.broadcastState() 
    this.onBroadcast({
      type: 'showdown',
      data: {
        winners: [{ playerId: winnerId, username: winner?.username, chips: this.pot, handName: 'Won by fold', winningCards: [] }],
        hands: {},
        playerHandNames: { [winnerId]: 'Won by fold' }
      }
    })

    setTimeout(() => {
      const oldDealerId = this.players[this.dealerIndex]?.id;

      this.players.forEach(p => {
        if (p.chips <= 0) {
          p.chips = POKER_CONFIG.STARTING_CHIPS;
          this.onBroadcast({ 
            type: 'system_message', 
            data: { message: `${p.username} auto-rebought for ${POKER_CONFIG.STARTING_CHIPS} chips.` } 
          });
        }
      });

      this.players = this.players.filter(p => p.isConnected)
      
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
      this.broadcastState()
      if (this.canStart()) {
        setTimeout(() => this.startHand(), 1500)
      }
    }, 5000)
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
        waitingNextHand: this.waitingNextHand.has(p.id), // Sent directly to frontend
        isConnected: p.isConnected,
        // Block empty rendering by verifying the array length is valid
        cards: (forPlayerId === p.id || (this.phase === GAME_PHASES.SHOWDOWN && !this.foldedPlayers.has(p.id) && !this.waitingNextHand.has(p.id)))
          ? (this.playerHands.get(p.id) || [])
          : (this.playerHands.has(p.id) && this.playerHands.get(p.id).length > 0 ? [null, null] : [])
      }))
    }
  }

  broadcastState() {
    for (const player of this.players) {
      player.send({ type: 'game_state', data: this.getGameState(player.id) })
    }
  }
}
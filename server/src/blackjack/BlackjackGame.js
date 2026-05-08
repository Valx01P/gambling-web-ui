import { Deck } from '../poker/deck.js'
import { BLACKJACK_CONFIG } from '../config/constants.js'

const PHASES = {
  WAITING: 'waiting',
  BETTING: 'betting',
  PLAYING: 'playing',
  DEALER: 'dealer',
  SETTLE: 'settle',
}

function createHand(cards, bet, id, split = false) {
  return {
    id,
    cards,
    bet,
    status: 'active',
    result: null,
    payout: 0,
    doubled: false,
    split,
    surrendered: false,
  }
}

function cardValue(card) {
  if (!card) return 0
  if (card.rank === 'A') return 11
  if (['K', 'Q', 'J'].includes(card.rank)) return 10
  return Number(card.rank)
}

export function getBlackjackHandValue(cards = []) {
  let total = 0
  let aces = 0

  for (const card of cards) {
    total += cardValue(card)
    if (card?.rank === 'A') aces += 1
  }

  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }

  return {
    total,
    soft: aces > 0,
    busted: total > 21,
    blackjack: cards.length === 2 && total === 21,
  }
}

export class BlackjackGame {
  constructor(onBroadcast, onStateBroadcast = null) {
    this.deck = new Deck()
    this.phase = PHASES.WAITING
    this.players = []
    this.waitingNextRound = new Set()
    this.playerHands = new Map()
    this.dealerHand = []
    this.currentPlayerIndex = -1
    this.currentHandIndex = 0
    this.handSequence = 0
    this.roundTimers = new Set()
    this.onBroadcast = onBroadcast || (() => {})
    this.onStateBroadcast = onStateBroadcast
  }

  clearTimers() {
    for (const timer of this.roundTimers) clearTimeout(timer)
    this.roundTimers.clear()
  }

  schedule(fn, delay) {
    const timer = setTimeout(() => {
      this.roundTimers.delete(timer)
      fn()
    }, delay)
    this.roundTimers.add(timer)
    return timer
  }

  ensureBankroll(player) {
    if (typeof player.blackjackChips !== 'number') player.blackjackChips = BLACKJACK_CONFIG.STARTING_CHIPS
    if (typeof player.blackjackBuyIn !== 'number') player.blackjackBuyIn = BLACKJACK_CONFIG.STARTING_CHIPS
    if (typeof player.blackjackProfit !== 'number') player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
  }

  reloadForMinimumBet(player) {
    this.ensureBankroll(player)
    if (player.blackjackChips >= BLACKJACK_CONFIG.MIN_BET) return false

    player.blackjackChips += BLACKJACK_CONFIG.STARTING_CHIPS
    player.blackjackBuyIn += BLACKJACK_CONFIG.STARTING_CHIPS
    player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
    this.onBroadcast({
      type: 'system_message',
      data: { message: `${player.username} reloaded for ${BLACKJACK_CONFIG.STARTING_CHIPS} chips.` }
    })
    return true
  }

  reloadBettingPlayersBelowMinimum() {
    let reloaded = false
    for (const player of this.players) {
      if (!player.isConnected || this.waitingNextRound.has(player.id)) continue
      reloaded = this.reloadForMinimumBet(player) || reloaded
    }
    return reloaded
  }

  addPlayer(player) {
    if (this.players.some(p => p.id === player.id)) return false

    this.ensureBankroll(player)
    const roundAlreadyOpen = this.phase !== PHASES.WAITING && (
      this.phase !== PHASES.BETTING || this.playerHands.size > 0
    )
    this.players.push(player)

    if (roundAlreadyOpen) {
      this.waitingNextRound.add(player.id)
    }

    if (this.phase === PHASES.WAITING) {
      this.phase = PHASES.BETTING
    }

    this.broadcastState()
    return true
  }

  removePlayer(playerId) {
    this.players = this.players.filter(player => player.id !== playerId)
    this.playerHands.delete(playerId)
    this.waitingNextRound.delete(playerId)

    if (this.players.length === 0) {
      this.resetToWaiting()
      return
    }

    if (this.phase === PHASES.PLAYING && this.getCurrentPlayer()?.id === playerId) {
      this.advanceTurn()
    } else {
      this.maybeStartRound()
      this.broadcastState()
    }
  }

  resetToWaiting() {
    this.clearTimers()
    this.phase = this.players.length > 0 ? PHASES.BETTING : PHASES.WAITING
    this.playerHands.clear()
    this.waitingNextRound.clear()
    this.dealerHand = []
    this.currentPlayerIndex = -1
    this.currentHandIndex = 0
    if (this.phase === PHASES.BETTING) this.reloadBettingPlayersBelowMinimum()
    this.broadcastState()
  }

  activeBettingPlayers() {
    return this.players.filter(player =>
      player.isConnected &&
      !this.waitingNextRound.has(player.id) &&
      player.blackjackChips >= BLACKJACK_CONFIG.MIN_BET
    )
  }

  playersInRound() {
    return this.players.filter(player => (this.playerHands.get(player.id) || []).length > 0)
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex] || null
  }

  getCurrentHand() {
    const player = this.getCurrentPlayer()
    if (!player) return null
    return (this.playerHands.get(player.id) || [])[this.currentHandIndex] || null
  }

  createHandId(playerId) {
    this.handSequence += 1
    return `${playerId}-${this.handSequence}`
  }

  placeBet(playerId, amount) {
    if (this.phase !== PHASES.BETTING && this.phase !== PHASES.WAITING) {
      return { success: false, error: 'Betting is closed' }
    }

    const player = this.players.find(p => p.id === playerId)
    if (!player || this.waitingNextRound.has(playerId)) return { success: false, error: 'Not seated for this round' }

    this.ensureBankroll(player)
    this.reloadForMinimumBet(player)
    const bet = Math.floor(Number(amount))
    if (!Number.isFinite(bet) || bet < BLACKJACK_CONFIG.MIN_BET) {
      return { success: false, error: `Minimum bet is ${BLACKJACK_CONFIG.MIN_BET}` }
    }
    if (bet > player.blackjackChips) return { success: false, error: 'Not enough chips' }
    if ((this.playerHands.get(playerId) || []).length > 0) return { success: false, error: 'Bet already placed' }

    this.phase = PHASES.BETTING
    player.blackjackChips -= bet
    player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
    this.playerHands.set(playerId, [createHand([], bet, this.createHandId(playerId))])
    this.broadcastState()
    this.maybeStartRound()
    return { success: true }
  }

  maybeStartRound() {
    if (this.phase !== PHASES.BETTING) return
    if (this.reloadBettingPlayersBelowMinimum()) {
      this.broadcastState()
    }
    const eligible = this.activeBettingPlayers()
    if (eligible.length === 0) return
    const allBet = eligible.every(player => (this.playerHands.get(player.id) || []).length > 0)
    if (!allBet) return

    this.schedule(() => this.dealRound(), 600)
  }

  dealRound() {
    if (this.phase !== PHASES.BETTING) return

    this.deck.reset()
    this.dealerHand = []

    for (const player of this.playersInRound()) {
      const [hand] = this.playerHands.get(player.id)
      hand.cards = [this.deck.draw(), this.deck.draw()]
      const value = getBlackjackHandValue(hand.cards)
      if (value.blackjack) hand.status = 'blackjack'
    }

    this.dealerHand = [this.deck.draw(), this.deck.draw()]

    if (getBlackjackHandValue(this.dealerHand).blackjack) {
      this.phase = PHASES.DEALER
      this.currentPlayerIndex = -1
      this.currentHandIndex = 0
      this.broadcastState()
      this.schedule(() => this.settleRound(), 900)
      return
    }

    this.phase = PHASES.PLAYING
    this.currentPlayerIndex = -1
    this.currentHandIndex = 0
    this.advanceTurn()
  }

  canAct(playerId) {
    return this.phase === PHASES.PLAYING && this.getCurrentPlayer()?.id === playerId
  }

  handleAction(playerId, action) {
    if (!this.canAct(playerId)) return { success: false, error: 'Not your turn' }

    switch (action) {
      case 'hit':
        return this.hit(playerId)
      case 'stand':
        return this.stand(playerId)
      case 'double':
        return this.doubleDown(playerId)
      case 'split':
        return this.split(playerId)
      case 'surrender':
        return this.surrender(playerId)
      default:
        return { success: false, error: 'Unknown action' }
    }
  }

  hit(playerId) {
    const hand = this.getCurrentHand()
    if (!hand || hand.status !== 'active') return { success: false, error: 'Hand cannot act' }

    hand.cards.push(this.deck.draw())
    const value = getBlackjackHandValue(hand.cards)
    if (value.busted) {
      hand.status = 'busted'
      this.advanceTurn()
    } else if (value.total === 21) {
      hand.status = 'stood'
      this.advanceTurn()
    } else {
      this.broadcastState()
    }

    return { success: true }
  }

  stand() {
    const hand = this.getCurrentHand()
    if (!hand || hand.status !== 'active') return { success: false, error: 'Hand cannot act' }
    hand.status = 'stood'
    this.advanceTurn()
    return { success: true }
  }

  doubleDown(playerId) {
    const player = this.getCurrentPlayer()
    const hand = this.getCurrentHand()
    if (!player || !hand || hand.status !== 'active') return { success: false, error: 'Hand cannot double' }
    if (hand.cards.length !== 2) return { success: false, error: 'Can only double on first two cards' }
    if (player.blackjackChips < hand.bet) return { success: false, error: 'Not enough chips to double' }

    player.blackjackChips -= hand.bet
    hand.bet *= 2
    hand.doubled = true
    hand.cards.push(this.deck.draw())
    hand.status = getBlackjackHandValue(hand.cards).busted ? 'busted' : 'stood'
    player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
    this.advanceTurn()
    return { success: true }
  }

  split(playerId) {
    const player = this.getCurrentPlayer()
    const hands = this.playerHands.get(playerId) || []
    const hand = this.getCurrentHand()
    if (!player || !hand || hand.status !== 'active') return { success: false, error: 'Hand cannot split' }
    if (hands.length >= 2) return { success: false, error: 'Only two hands are allowed' }
    if (hand.cards.length !== 2 || hand.cards[0].rank !== hand.cards[1].rank) {
      return { success: false, error: 'Can only split a pair' }
    }
    if (player.blackjackChips < hand.bet) return { success: false, error: 'Not enough chips to split' }

    const [first, second] = hand.cards
    player.blackjackChips -= hand.bet
    hands[this.currentHandIndex] = createHand([first, this.deck.draw()], hand.bet, hand.id, true)
    hands.splice(this.currentHandIndex + 1, 0, createHand([second, this.deck.draw()], hand.bet, this.createHandId(playerId), true))
    player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
    this.broadcastState()
    return { success: true }
  }

  surrender(playerId) {
    const hand = this.getCurrentHand()
    const player = this.getCurrentPlayer()
    if (!player || !hand || hand.status !== 'active') return { success: false, error: 'Hand cannot surrender' }
    if (hand.cards.length !== 2 || hand.doubled || hand.split) {
      return { success: false, error: 'Can only surrender original first two cards' }
    }

    const returned = Math.floor(hand.bet / 2)
    hand.status = 'surrendered'
    hand.surrendered = true
    hand.payout = returned
    hand.result = 'surrender'
    player.blackjackChips += returned
    player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
    this.advanceTurn()
    return { success: true }
  }

  advanceTurn() {
    const currentPlayer = this.getCurrentPlayer()
    if (currentPlayer) {
      const hands = this.playerHands.get(currentPlayer.id) || []
      for (let i = this.currentHandIndex + 1; i < hands.length; i++) {
        if (hands[i].status === 'active') {
          this.currentHandIndex = i
          this.broadcastState()
          return
        }
      }
    }

    for (let i = this.currentPlayerIndex + 1; i < this.players.length; i++) {
      const player = this.players[i]
      const hands = this.playerHands.get(player.id) || []
      const nextHandIndex = hands.findIndex(hand => hand.status === 'active')
      if (nextHandIndex !== -1) {
        this.currentPlayerIndex = i
        this.currentHandIndex = nextHandIndex
        this.broadcastState()
        return
      }
    }

    this.currentPlayerIndex = -1
    this.currentHandIndex = 0
    this.phase = PHASES.DEALER
    this.broadcastState()
    this.schedule(() => this.playDealer(), 900)
  }

  playDealer() {
    if (this.phase !== PHASES.DEALER) return

    const hasLiveHand = this.playersInRound().some(player =>
      (this.playerHands.get(player.id) || []).some(hand =>
        !['busted', 'surrendered'].includes(hand.status)
      )
    )

    while (hasLiveHand && getBlackjackHandValue(this.dealerHand).total < 17) {
      this.dealerHand.push(this.deck.draw())
    }

    this.settleRound()
  }

  settleRound() {
    const dealerValue = getBlackjackHandValue(this.dealerHand)

    for (const player of this.playersInRound()) {
      const hands = this.playerHands.get(player.id) || []
      for (const hand of hands) {
        if (hand.status === 'surrendered') continue

        const handValue = getBlackjackHandValue(hand.cards)
        let payout = 0
        let result = 'lose'

        if (handValue.busted || hand.status === 'busted') {
          result = 'lose'
        } else if (dealerValue.blackjack && !handValue.blackjack) {
          result = 'lose'
        } else if (handValue.blackjack && !hand.split && !dealerValue.blackjack) {
          const profit = Math.floor((hand.bet * BLACKJACK_CONFIG.BLACKJACK_PAYOUT_NUMERATOR) / BLACKJACK_CONFIG.BLACKJACK_PAYOUT_DENOMINATOR)
          payout = hand.bet + profit
          result = 'blackjack'
        } else if (dealerValue.busted || compareTotals(handValue, dealerValue) > 0) {
          payout = hand.bet * 2
          result = 'win'
        } else if (compareTotals(handValue, dealerValue) === 0) {
          payout = hand.bet
          result = 'push'
        }

        hand.payout = payout
        hand.result = result
        hand.status = result
        player.blackjackChips += payout
      }

      this.rebuyIfNeeded(player)
      player.blackjackProfit = player.blackjackChips - player.blackjackBuyIn
    }

    this.phase = PHASES.SETTLE
    this.broadcastState()
    this.schedule(() => this.prepareNextRound(), 3500)
  }

  rebuyIfNeeded(player) {
    if (player.blackjackChips > 0) return

    player.blackjackChips += BLACKJACK_CONFIG.STARTING_CHIPS
    player.blackjackBuyIn += BLACKJACK_CONFIG.STARTING_CHIPS
    this.onBroadcast({
      type: 'system_message',
      data: { message: `${player.username} reloaded for ${BLACKJACK_CONFIG.STARTING_CHIPS} chips.` }
    })
  }

  prepareNextRound() {
    if (this.phase !== PHASES.SETTLE) return

    this.playerHands.clear()
    this.dealerHand = []
    this.currentPlayerIndex = -1
    this.currentHandIndex = 0
    this.waitingNextRound.clear()
    this.phase = this.players.length > 0 ? PHASES.BETTING : PHASES.WAITING
    if (this.phase === PHASES.BETTING) this.reloadBettingPlayersBelowMinimum()
    this.broadcastState()
  }

  handState(hand) {
    const value = getBlackjackHandValue(hand.cards)
    const canAct = this.getCurrentHand()?.id === hand.id && this.phase === PHASES.PLAYING && hand.status === 'active'

    return {
      ...hand,
      value: value.total,
      soft: value.soft,
      busted: value.busted,
      blackjack: value.blackjack,
      canAct,
      canHit: canAct,
      canStand: canAct,
      canDouble: canAct && hand.cards.length === 2,
      canSplit: canAct && hand.cards.length === 2 && hand.cards[0]?.rank === hand.cards[1]?.rank,
      canSurrender: canAct && hand.cards.length === 2 && !hand.split && !hand.doubled,
    }
  }

  getGameState() {
    const dealerVisible = this.phase === PHASES.DEALER || this.phase === PHASES.SETTLE
    const currentPlayer = this.getCurrentPlayer()
    const dealerValue = getBlackjackHandValue(dealerVisible ? this.dealerHand : this.dealerHand.slice(0, 1))

    return {
      game: 'blackjack',
      phase: this.phase,
      minBet: BLACKJACK_CONFIG.MIN_BET,
      currentPlayerId: currentPlayer?.id || null,
      currentHandId: this.getCurrentHand()?.id || null,
      dealer: {
        cards: dealerVisible ? this.dealerHand : this.dealerHand.map((card, index) => index === 0 ? card : null),
        value: dealerValue.total,
        soft: dealerValue.soft,
        hidden: !dealerVisible && this.dealerHand.length > 1,
      },
      players: this.players.map(player => {
        this.ensureBankroll(player)
        return {
          id: player.id,
          username: player.username,
          avatarId: player.avatarId || null,
          avatarUrl: player.avatarUrl || null,
          chips: player.blackjackChips,
          profit: player.blackjackProfit,
          waitingNextRound: this.waitingNextRound.has(player.id),
          isConnected: player.isConnected,
          hands: (this.playerHands.get(player.id) || []).map(hand => this.handState(hand)),
        }
      })
    }
  }

  broadcastState() {
    if (this.onStateBroadcast) {
      this.onStateBroadcast()
      return
    }

    this.onBroadcast({
      type: 'game_state',
      data: this.getGameState()
    })
  }
}

function compareTotals(playerValue, dealerValue) {
  return playerValue.total - dealerValue.total
}

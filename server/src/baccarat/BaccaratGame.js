import { Deck } from '../poker/deck.js'
import { BACCARAT_CONFIG } from '../config/constants.js'

const PHASES = {
  WAITING: 'waiting',
  BETTING: 'betting',
  DEALING: 'dealing',
  REVEAL_PLAYER: 'reveal_player',
  REVEAL_BANKER: 'reveal_banker',
  REVEAL_THIRD: 'reveal_third',
  SETTLE: 'settle',
}

const BET_TYPES = new Set(['player', 'banker', 'tie'])
const DEAL_START_DELAY = 1200
const CARD_REVEAL_DELAY = 1200
const THIRD_CARD_REVEAL_DELAY = 1400
const SETTLE_REVEAL_DELAY = 1800
const NEXT_ROUND_DELAY = 5400

function baccaratCardValue(card) {
  if (!card) return 0
  if (card.rank === 'A') return 1
  if (['10', 'J', 'Q', 'K'].includes(card.rank)) return 0
  return Number(card.rank)
}

export function getBaccaratTotal(cards = []) {
  return cards.reduce((sum, card) => sum + baccaratCardValue(card), 0) % 10
}

function createBet(type, amount) {
  return {
    type,
    amount,
    result: null,
    payout: 0,
  }
}

function shouldBankerDraw(bankerTotal, playerThirdCard = null) {
  if (!playerThirdCard) return bankerTotal <= 5

  const thirdValue = baccaratCardValue(playerThirdCard)
  let bankerThird = false

  if (bankerTotal <= 2) bankerThird = true
  else if (bankerTotal === 3) bankerThird = thirdValue !== 8
  else if (bankerTotal === 4) bankerThird = thirdValue >= 2 && thirdValue <= 7
  else if (bankerTotal === 5) bankerThird = thirdValue >= 4 && thirdValue <= 7
  else if (bankerTotal === 6) bankerThird = thirdValue === 6 || thirdValue === 7

  return bankerThird
}

export class BaccaratGame {
  constructor(onBroadcast, onStateBroadcast = null) {
    this.deck = new Deck()
    this.phase = PHASES.WAITING
    this.players = []
    this.waitingNextRound = new Set()
    this.sittingOut = new Set()
    this.playerBets = new Map()
    this.playerHand = []
    this.bankerHand = []
    this.visiblePlayerCards = 0
    this.visibleBankerCards = 0
    this.outcome = null
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
    if (typeof player.baccaratChips !== 'number') player.baccaratChips = BACCARAT_CONFIG.STARTING_CHIPS
    if (typeof player.baccaratBuyIn !== 'number') player.baccaratBuyIn = BACCARAT_CONFIG.STARTING_CHIPS
    if (typeof player.baccaratProfit !== 'number') player.baccaratProfit = player.baccaratChips - player.baccaratBuyIn
  }

  reloadForMinimumBet(player) {
    this.ensureBankroll(player)
    if (player.baccaratChips >= BACCARAT_CONFIG.MIN_BET) return false

    player.baccaratChips += BACCARAT_CONFIG.STARTING_CHIPS
    player.baccaratBuyIn += BACCARAT_CONFIG.STARTING_CHIPS
    player.baccaratProfit = player.baccaratChips - player.baccaratBuyIn
    this.onBroadcast({
      type: 'system_message',
      data: { message: `${player.username} reloaded for ${BACCARAT_CONFIG.STARTING_CHIPS} baccarat chips.` }
    })
    return true
  }

  reloadBettingPlayersBelowMinimum() {
    let reloaded = false
    for (const player of this.players) {
      if (!player.isConnected || this.waitingNextRound.has(player.id) || this.sittingOut.has(player.id)) continue
      reloaded = this.reloadForMinimumBet(player) || reloaded
    }
    return reloaded
  }

  setPlayerAfk(playerId, afk) {
    const player = this.players.find(p => p.id === playerId)
    if (!player) return { success: false, error: 'Player not seated' }

    if (afk) this.sittingOut.add(playerId)
    else this.sittingOut.delete(playerId)

    this.maybeStartRound()
    this.broadcastState()
    return { success: true }
  }

  addPlayer(player) {
    if (this.players.some(p => p.id === player.id)) return false

    this.ensureBankroll(player)
    const roundAlreadyOpen = this.phase !== PHASES.WAITING && (
      this.phase !== PHASES.BETTING || this.playerBets.size > 0
    )
    this.players.push(player)

    if (roundAlreadyOpen) this.waitingNextRound.add(player.id)
    if (this.phase === PHASES.WAITING) this.phase = PHASES.BETTING

    this.broadcastState()
    return true
  }

  removePlayer(playerId) {
    this.players = this.players.filter(player => player.id !== playerId)
    this.playerBets.delete(playerId)
    this.waitingNextRound.delete(playerId)
    this.sittingOut.delete(playerId)

    if (this.players.length === 0) {
      this.resetToWaiting()
      return
    }

    this.maybeStartRound()
    this.broadcastState()
  }

  resetToWaiting() {
    this.clearTimers()
    this.phase = this.players.length > 0 ? PHASES.BETTING : PHASES.WAITING
    this.playerBets.clear()
    this.waitingNextRound.clear()
    this.playerHand = []
    this.bankerHand = []
    this.visiblePlayerCards = 0
    this.visibleBankerCards = 0
    this.outcome = null
    if (this.players.length === 0) this.sittingOut.clear()
    if (this.phase === PHASES.BETTING) this.reloadBettingPlayersBelowMinimum()
    this.broadcastState()
  }

  activeBettingPlayers() {
    return this.players.filter(player =>
      player.isConnected &&
      !this.waitingNextRound.has(player.id) &&
      !this.sittingOut.has(player.id) &&
      player.baccaratChips >= BACCARAT_CONFIG.MIN_BET
    )
  }

  placeBet(playerId, type, amount) {
    if (this.phase !== PHASES.BETTING && this.phase !== PHASES.WAITING) {
      return { success: false, error: 'Betting is closed' }
    }

    const player = this.players.find(p => p.id === playerId)
    if (!player || this.waitingNextRound.has(playerId)) return { success: false, error: 'Not seated for this round' }
    if (this.sittingOut.has(playerId)) return { success: false, error: 'You are sitting out' }

    this.ensureBankroll(player)
    this.reloadForMinimumBet(player)

    const betType = String(type || '').toLowerCase()
    if (!BET_TYPES.has(betType)) return { success: false, error: 'Choose player, banker, or tie' }

    const bet = Math.floor(Number(amount))
    if (!Number.isFinite(bet) || bet < BACCARAT_CONFIG.MIN_BET) {
      return { success: false, error: `Minimum bet is ${BACCARAT_CONFIG.MIN_BET}` }
    }
    if (bet > player.baccaratChips) return { success: false, error: 'Not enough chips' }
    if (this.playerBets.has(playerId)) return { success: false, error: 'Bet already placed' }

    this.phase = PHASES.BETTING
    player.baccaratChips -= bet
    player.baccaratProfit = player.baccaratChips - player.baccaratBuyIn
    this.playerBets.set(playerId, createBet(betType, bet))
    this.broadcastState()
    this.maybeStartRound()
    return { success: true }
  }

  maybeStartRound() {
    if (this.phase !== PHASES.BETTING) return
    if (this.reloadBettingPlayersBelowMinimum()) this.broadcastState()

    const eligible = this.activeBettingPlayers()
    if (eligible.length === 0) return
    const allBet = eligible.every(player => this.playerBets.has(player.id))
    if (!allBet) return

    this.phase = PHASES.DEALING
    this.broadcastState()
    this.schedule(() => this.dealRound(), DEAL_START_DELAY)
  }

  dealRound() {
    if (this.phase !== PHASES.DEALING) return

    this.deck.reset()
    this.playerHand = [this.deck.draw()]
    this.bankerHand = [this.deck.draw()]
    this.playerHand.push(this.deck.draw())
    this.bankerHand.push(this.deck.draw())

    this.visiblePlayerCards = 0
    this.visibleBankerCards = 0
    this.phase = PHASES.DEALING
    this.broadcastState()
    this.schedule(() => this.revealInitialCard(0), CARD_REVEAL_DELAY)
  }

  revealInitialCard(step) {
    if (![PHASES.DEALING, PHASES.REVEAL_PLAYER, PHASES.REVEAL_BANKER].includes(this.phase)) return

    if (step === 0) {
      this.visiblePlayerCards = 1
      this.phase = PHASES.REVEAL_PLAYER
    } else if (step === 1) {
      this.visibleBankerCards = 1
      this.phase = PHASES.REVEAL_BANKER
    } else if (step === 2) {
      this.visiblePlayerCards = 2
      this.phase = PHASES.REVEAL_PLAYER
    } else if (step === 3) {
      this.visibleBankerCards = 2
      this.phase = PHASES.REVEAL_BANKER
    } else {
      return
    }

    this.broadcastState()

    if (step < 3) {
      this.schedule(() => this.revealInitialCard(step + 1), CARD_REVEAL_DELAY)
      return
    }

    this.schedule(() => this.afterInitialReveal(), THIRD_CARD_REVEAL_DELAY)
  }

  afterInitialReveal() {
    if (this.phase !== PHASES.REVEAL_BANKER) return

    const playerTotal = getBaccaratTotal(this.playerHand.slice(0, 2))
    const bankerTotal = getBaccaratTotal(this.bankerHand.slice(0, 2))
    if (playerTotal >= 8 || bankerTotal >= 8) {
      this.schedule(() => this.settleRound(), SETTLE_REVEAL_DELAY)
      return
    }

    if (playerTotal <= 5) {
      this.playerHand.push(this.deck.draw())
      this.visiblePlayerCards = this.playerHand.length
      this.phase = PHASES.REVEAL_THIRD
      this.broadcastState()
      this.schedule(() => this.afterPlayerThirdReveal(), CARD_REVEAL_DELAY)
      return
    }

    if (shouldBankerDraw(bankerTotal)) {
      this.drawBankerThirdCard()
      return
    }

    this.schedule(() => this.settleRound(), SETTLE_REVEAL_DELAY)
  }

  afterPlayerThirdReveal() {
    if (this.phase !== PHASES.REVEAL_THIRD) return

    const bankerTotal = getBaccaratTotal(this.bankerHand.slice(0, 2))
    if (shouldBankerDraw(bankerTotal, this.playerHand[2])) {
      this.drawBankerThirdCard()
      return
    }

    this.schedule(() => this.settleRound(), SETTLE_REVEAL_DELAY)
  }

  drawBankerThirdCard() {
    if (![PHASES.REVEAL_BANKER, PHASES.REVEAL_THIRD].includes(this.phase)) return
    this.bankerHand.push(this.deck.draw())
    this.visibleBankerCards = this.bankerHand.length
    this.phase = PHASES.REVEAL_THIRD
    this.broadcastState()
    this.schedule(() => this.settleRound(), SETTLE_REVEAL_DELAY)
  }

  settleRound() {
    if (![PHASES.REVEAL_BANKER, PHASES.REVEAL_THIRD, PHASES.DEALING].includes(this.phase)) return

    this.visiblePlayerCards = this.playerHand.length
    this.visibleBankerCards = this.bankerHand.length
    const playerTotal = getBaccaratTotal(this.playerHand)
    const bankerTotal = getBaccaratTotal(this.bankerHand)

    if (playerTotal > bankerTotal) this.outcome = 'player'
    else if (bankerTotal > playerTotal) this.outcome = 'banker'
    else this.outcome = 'tie'

    for (const player of this.players) {
      const bet = this.playerBets.get(player.id)
      if (!bet) continue

      let payout = 0
      let result = 'lose'

      if (this.outcome === 'tie') {
        if (bet.type === 'tie') {
          payout = bet.amount * (BACCARAT_CONFIG.TIE_PAYOUT_MULTIPLIER + 1)
          result = 'win'
        } else {
          payout = bet.amount
          result = 'push'
        }
      } else if (bet.type === this.outcome) {
        if (bet.type === 'banker') {
          const profit = Math.floor(bet.amount * (100 - BACCARAT_CONFIG.BANKER_COMMISSION_PERCENT) / 100)
          payout = bet.amount + profit
        } else {
          payout = bet.amount * 2
        }
        result = 'win'
      }

      bet.payout = payout
      bet.result = result
      player.baccaratChips += payout
      player.baccaratProfit = player.baccaratChips - player.baccaratBuyIn
    }

    for (const player of this.players) {
      this.reloadForMinimumBet(player)
    }

    this.phase = PHASES.SETTLE
    this.broadcastState()
    this.schedule(() => this.prepareNextRound(), NEXT_ROUND_DELAY)
  }

  prepareNextRound() {
    if (this.phase !== PHASES.SETTLE) return

    this.playerBets.clear()
    this.waitingNextRound.clear()
    this.playerHand = []
    this.bankerHand = []
    this.visiblePlayerCards = 0
    this.visibleBankerCards = 0
    this.outcome = null
    this.phase = this.players.length > 0 ? PHASES.BETTING : PHASES.WAITING
    if (this.phase === PHASES.BETTING) this.reloadBettingPlayersBelowMinimum()
    this.broadcastState()
  }

  getGameState() {
    const playerCards = this.playerHand.map((card, index) => index < this.visiblePlayerCards ? card : null)
    const bankerCards = this.bankerHand.map((card, index) => index < this.visibleBankerCards ? card : null)

    return {
      game: 'baccarat',
      phase: this.phase,
      minBet: BACCARAT_CONFIG.MIN_BET,
      maxDisplayChips: BACCARAT_CONFIG.MAX_DISPLAY_CHIPS,
      outcome: this.outcome,
      playerHand: {
        cards: playerCards,
        value: this.visiblePlayerCards > 0 ? getBaccaratTotal(this.playerHand.slice(0, this.visiblePlayerCards)) : null,
      },
      bankerHand: {
        cards: bankerCards,
        value: this.visibleBankerCards > 0 ? getBaccaratTotal(this.bankerHand.slice(0, this.visibleBankerCards)) : null,
      },
      players: this.players.map(player => {
        this.ensureBankroll(player)
        const bet = this.playerBets.get(player.id) || null
        return {
          id: player.id,
          username: player.username,
          avatarId: player.avatarId || null,
          avatarUrl: player.avatarUrl || null,
          chips: player.baccaratChips,
          profit: player.baccaratProfit,
          waitingNextRound: this.waitingNextRound.has(player.id),
          sittingOut: this.sittingOut.has(player.id),
          isConnected: player.isConnected,
          bet,
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

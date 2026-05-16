// Short-dated stock options — the WSB layer on top of the stock
// market. Players buy calls (bet the price goes up) or puts (bet it
// goes down) on any ticker, pay a premium up front, and the contract
// resolves in 3 hands. If the option finishes in-the-money the payout
// scales with how deep ITM it is × number of contracts. If OTM, the
// premium is lost — the casino-bet feel.
//
// Strike grid auto-generated from current price: ATM, ±5%, ±15%.
// Premium is heuristic (no Black-Scholes), proportional to:
//   • volatility (high-vol stocks have higher premiums)
//   • time-to-expiry (3 hands always, but the formula scales)
//   • strike distance (deeper OTM = cheaper)
//
// Server-authoritative. Bots can't trade options.

import { MESSAGE_TYPES } from '../config/constants.js'

const EXPIRY_HANDS = 3                      // every contract expires 3 hands out
const CONTRACT_MULTIPLIER = 100             // each "contract" controls 100 nominal shares
const STRIKE_OFFSETS = [-0.15, -0.05, 0, 0.05, 0.15]   // strike grid relative to spot

export class OptionsEngine {
  constructor({ room, broadcast, stockEngine }) {
    this.room = room
    this.broadcast = broadcast
    this.stockEngine = stockEngine
    // playerId → array of open contracts.
    // Each contract: { id, type:'call'|'put', symbol, strike, contracts, premium, expiryHand, openedAtPrice }
    this.positions = new Map()
    this._contractSeq = 0
  }

  _findPlayer(playerId) {
    return this.room.players?.get?.(playerId) || this.room.spectators?.get?.(playerId) || null
  }

  _posFor(playerId) {
    let arr = this.positions.get(playerId)
    if (!arr) { arr = []; this.positions.set(playerId, arr) }
    return arr
  }

  // Heuristic premium per contract (i.e., for 100 underlying shares).
  // Tuned so an ATM 3-hand contract costs roughly volatility × price × 30,
  // OTM strikes are progressively cheaper. Returns chips.
  _premium({ type, price, strike, volatility }) {
    const distance = Math.abs(strike - price) / price
    // Time value scales mostly with vol; we treat 3 hands as the
    // implicit time term.
    const timeValue = price * volatility * 12
    // Intrinsic if already ITM (call when strike < price, put when
    // strike > price).
    const intrinsic = type === 'call'
      ? Math.max(0, price - strike)
      : Math.max(0, strike - price)
    // Out-the-money discount: each 1% OTM cuts premium ~15%.
    const otmFactor = 1 / (1 + distance * 15)
    const premium = (intrinsic + timeValue * otmFactor) * CONTRACT_MULTIPLIER
    return Math.max(1, Math.round(premium))
  }

  // Build the buy-side option chain for a single symbol.
  _chainFor(stock) {
    return STRIKE_OFFSETS.flatMap(off => {
      const strike = Math.max(0.01, Math.round(stock.price * (1 + off) * 100) / 100)
      const callPremium = this._premium({ type: 'call', price: stock.price, strike, volatility: stock.volatility })
      const putPremium  = this._premium({ type: 'put',  price: stock.price, strike, volatility: stock.volatility })
      return [
        { symbol: stock.symbol, type: 'call', strike, premium: callPremium, offset: off },
        { symbol: stock.symbol, type: 'put',  strike, premium: putPremium,  offset: off },
      ]
    })
  }

  buy(playerId, { symbol, type, strike, contracts, handIndex } = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    if (type !== 'call' && type !== 'put') return { success: false, error: 'invalid_type' }
    const stock = this.stockEngine?.stocks?.get?.(symbol)
    if (!stock) return { success: false, error: 'unknown_symbol' }
    const strikeNum = Number(strike)
    if (!Number.isFinite(strikeNum) || strikeNum <= 0) return { success: false, error: 'invalid_strike' }
    const n = Math.max(1, Math.floor(Number(contracts) || 0))
    const premium = this._premium({ type, price: stock.price, strike: strikeNum, volatility: stock.volatility })
    const total = premium * n
    if (player.chips < total) return { success: false, error: 'insufficient_chips', cost: total }
    player.chips -= total
    const id = `opt_${++this._contractSeq}`
    this._posFor(playerId).push({
      id,
      type,
      symbol,
      strike: strikeNum,
      contracts: n,
      premium,
      expiryHand: (Number(handIndex) || 0) + EXPIRY_HANDS,
      openedAtPrice: stock.price,
      openedAtHand: Number(handIndex) || 0,
    })
    this._broadcastSnapshots()
    return { success: true, id, total }
  }

  // Settle every contract whose expiryHand <= current handIndex. Pays
  // out chips to the player; logs the result for the toast.
  onHandEnd(handIndex = 0) {
    const settled = []
    for (const [pid, arr] of this.positions) {
      const player = this._findPlayer(pid)
      const remaining = []
      for (const ct of arr) {
        if (ct.expiryHand > handIndex) { remaining.push(ct); continue }
        const stock = this.stockEngine?.stocks?.get?.(ct.symbol)
        const price = stock?.price ?? 0
        const intrinsic = ct.type === 'call'
          ? Math.max(0, price - ct.strike)
          : Math.max(0, ct.strike - price)
        const payout = Math.floor(intrinsic * CONTRACT_MULTIPLIER * ct.contracts)
        if (player && payout > 0) player.chips += payout
        const net = payout - (ct.premium * ct.contracts)
        settled.push({ playerId: pid, contract: ct, payout, net })
        if (player) {
          const result = payout > 0
            ? `📈 ${ct.type.toUpperCase()} on $${ct.symbol} @ ${ct.strike.toFixed(2)} settled — payout $${payout.toLocaleString()} (net ${net >= 0 ? '+' : '−'}$${Math.abs(net).toLocaleString()})`
            : `💀 ${ct.type.toUpperCase()} on $${ct.symbol} @ ${ct.strike.toFixed(2)} expired worthless — lost $${(ct.premium * ct.contracts).toLocaleString()}`
          player.send?.({ type: MESSAGE_TYPES.SYSTEM_MESSAGE, data: { message: result } })
        }
      }
      this.positions.set(pid, remaining)
    }
    this._broadcastSnapshots()
    return { settled }
  }

  buildSnapshot(playerId) {
    const tickers = this.stockEngine?.stocks?.values?.() || []
    const chain = []
    for (const stock of tickers) {
      if (stock.rugged) continue
      chain.push(...this._chainFor(stock))
    }
    const myPositions = (this.positions.get(playerId) || []).map(ct => {
      const stock = this.stockEngine?.stocks?.get?.(ct.symbol)
      const price = stock?.price ?? 0
      const intrinsic = ct.type === 'call'
        ? Math.max(0, price - ct.strike)
        : Math.max(0, ct.strike - price)
      const markValue = Math.floor(intrinsic * CONTRACT_MULTIPLIER * ct.contracts)
      return { ...ct, currentPrice: price, intrinsic, markValue }
    })
    return { chain, myPositions, expiryHands: EXPIRY_HANDS, contractMultiplier: CONTRACT_MULTIPLIER }
  }

  _broadcastSnapshots() {
    const audience = [
      ...(this.room.players?.values?.() || []),
      ...(this.room.spectators?.values?.() || []),
    ]
    for (const p of audience) {
      if (p.isBot || !p.isConnected) continue
      p.send({ type: 'options:state', data: this.buildSnapshot(p.id) })
    }
  }

  sendSnapshotTo(player) {
    if (!player || player.isBot) return
    player.send({ type: 'options:state', data: this.buildSnapshot(player.id) })
  }

  handlePlayerLeave(playerId) {
    // Settle every open contract at current mark and credit chips.
    const arr = this.positions.get(playerId)
    if (!arr || arr.length === 0) { this.positions.delete(playerId); return }
    const player = this._findPlayer(playerId)
    if (player) {
      for (const ct of arr) {
        const stock = this.stockEngine?.stocks?.get?.(ct.symbol)
        const price = stock?.price ?? 0
        const intrinsic = ct.type === 'call'
          ? Math.max(0, price - ct.strike)
          : Math.max(0, ct.strike - price)
        const payout = Math.floor(intrinsic * CONTRACT_MULTIPLIER * ct.contracts)
        if (payout > 0) player.chips += payout
      }
    }
    this.positions.delete(playerId)
  }
}

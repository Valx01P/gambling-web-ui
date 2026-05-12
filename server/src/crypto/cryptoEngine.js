// Per-room crypto market engine.
//
// Owns the live coin universe: 6 base coins + ~4 random scam meme coins +
// up to one user-minted coin per seated/spectator player. Ticks on a wall-
// clock interval (independent of poker hand pace) so charts move even
// when the table is idle.
//
// Trust model: server-authoritative. Same approach as SideBetEngine — we
// mutate `player.chips` and our own holdings map directly on every
// buy/sell/rug; the client UI just renders state we broadcast.

import { generateMemeCoin } from './memeCoinNames.js'
import {
  tickBaseCoin,
  tickScamCoin,
  tickPlayerCoin,
  pushHistory,
  HISTORY_LEN
} from './coinSimulator.js'

const TICK_MS = 2000
const NUM_SCAM_COINS = 4
const MAX_PLAYER_COINS = 1            // per player
const PLAYER_COIN_FEE = 500           // chips burned to mint
const RUG_KEEP_PERCENT = 0.30         // owner extracts this fraction of
                                      // outsiders' invested cost on rug
const RUG_PRICE_FLOOR = 0.001         // coin collapses to ~0 after rug
const MIN_TRADE_CHIPS = 1
const MAX_HISTORY_FROM_FLAT = HISTORY_LEN

const BASE_COIN_TEMPLATES = [
  { symbol: 'BTC',   name: 'Bitcoin',  startPrice: 60000,  volatility: 0.012, trendBias: 0.0003 },
  { symbol: 'ETH',   name: 'Ethereum', startPrice: 3000,   volatility: 0.018, trendBias: 0.0002 },
  { symbol: 'TRUMP', name: 'TrumpCoin',startPrice: 8.5,    volatility: 0.045, trendBias: 0.0010 },
  { symbol: 'XMR',   name: 'Monero',   startPrice: 160,    volatility: 0.020, trendBias: 0.0000 },
  { symbol: 'XRP',   name: 'XRP',      startPrice: 0.58,   volatility: 0.025, trendBias: -0.0001 },
  { symbol: 'MATIC', name: 'Polygon',  startPrice: 0.72,   volatility: 0.030, trendBias: 0.0001 }
]

let _coinSeq = 0
function nextCoinId(prefix) {
  _coinSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${_coinSeq}`
}

export class CryptoMarketEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast

    // coinId → coin object (see makeCoin)
    this.coins = new Map()
    // playerId → Map<coinId, { shares, costBasis }>
    this.holdings = new Map()
    // playerId → coinId (the coin THIS player minted; null/absent if none)
    this.ownerCoinIds = new Map()
    // coinId → total chips spent by all non-owner buyers since mint, used
    // by rug-pull to compute the extraction bonus. Refunded shares
    // (sell-for-loss) don't reduce this — bagholders get rugged.
    this._outsideInvested = new Map()

    this._tickHandle = null
    this._spawnInitial()
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  start() {
    if (this._tickHandle) return
    this._tickHandle = setInterval(() => this._tick(), TICK_MS)
  }

  stop() {
    if (this._tickHandle) clearInterval(this._tickHandle)
    this._tickHandle = null
  }

  // Called when a player leaves the room. Liquidate everything at current
  // market — owner doesn't get a special rug, this is just an exit
  // settlement. Holdings stay in the engine map but get cleared after.
  handlePlayerLeave(playerId) {
    const player = this._findPlayer(playerId)
    const bag = this.holdings.get(playerId)
    if (!bag) return
    if (player) {
      for (const [coinId, pos] of bag) {
        const coin = this.coins.get(coinId)
        if (!coin || pos.shares <= 0) continue
        const proceeds = Math.floor(pos.shares * coin.price)
        if (proceeds > 0) player.chips += proceeds
      }
    }
    this.holdings.delete(playerId)
    // If they had minted a coin, leave the coin alive — other holders'
    // shares are still valid. The owner just loses control of it.
    const ownedCoinId = this.ownerCoinIds.get(playerId)
    if (ownedCoinId) {
      const coin = this.coins.get(ownedCoinId)
      if (coin) {
        coin.ownerId = null
        coin.ownerLeft = true
      }
      this.ownerCoinIds.delete(playerId)
    }
  }

  // ─── Tick + broadcast ───────────────────────────────────────────────────

  _tick() {
    for (const coin of this.coins.values()) {
      let next
      if (coin.kind === 'base') next = tickBaseCoin(coin)
      else if (coin.kind === 'scam') next = tickScamCoin(coin)
      else next = tickPlayerCoin(coin)
      pushHistory(coin, next)
    }
    this._broadcastTick()
  }

  _broadcastTick() {
    // Light delta — just prices. Clients merge into their local copy and
    // re-render mini-charts. Full state goes out on buy/sell/rug/create.
    const prices = []
    for (const coin of this.coins.values()) {
      prices.push({
        id: coin.id,
        price: round4(coin.price),
        prev: round4(coin.prevPrice)
      })
    }
    this.broadcast({ type: 'crypto:tick', data: { prices, ts: Date.now() } })
  }

  // ─── Snapshot for clients ───────────────────────────────────────────────

  getStatePayload(forPlayerId = null) {
    const coins = []
    for (const coin of this.coins.values()) {
      coins.push({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        kind: coin.kind,
        price: round4(coin.price),
        prevPrice: round4(coin.prevPrice),
        history: coin.history.slice(),
        ownerId: coin.ownerId || null,
        ownerName: coin.ownerName || null,
        ownerShares: coin.kind === 'player' ? round4(coin.ownerShares) : null,
        totalSupply: coin.kind === 'player' ? coin.totalSupply : null,
        rugged: !!coin.rugged,
        createdAt: coin.createdAt
      })
    }
    const myPositions = []
    if (forPlayerId) {
      const bag = this.holdings.get(forPlayerId)
      if (bag) {
        for (const [coinId, pos] of bag) {
          if (pos.shares <= 0) continue
          myPositions.push({
            coinId,
            shares: round4(pos.shares),
            costBasis: Math.round(pos.costBasis)
          })
        }
      }
    }
    return {
      coins,
      myPositions,
      myCoinId: forPlayerId ? (this.ownerCoinIds.get(forPlayerId) || null) : null,
      config: { tickMs: TICK_MS, mintFee: PLAYER_COIN_FEE, minTrade: MIN_TRADE_CHIPS }
    }
  }

  // Compute a player's total unrealized P/L across all crypto holdings.
  // Surfaces on the client FinancesPanel. Cost basis is in chips, value is
  // shares × current price (also chips).
  getUnrealizedPnl(playerId) {
    const bag = this.holdings.get(playerId)
    if (!bag) return { value: 0, cost: 0, pnl: 0 }
    let value = 0
    let cost = 0
    for (const [coinId, pos] of bag) {
      const coin = this.coins.get(coinId)
      if (!coin || pos.shares <= 0) continue
      value += pos.shares * coin.price
      cost += pos.costBasis
    }
    return {
      value: Math.round(value),
      cost: Math.round(cost),
      pnl: Math.round(value - cost)
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  buy(playerId, coinId, chipsToSpend) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    const coin = this.coins.get(coinId)
    if (!coin) return { success: false, error: 'coin_not_found' }
    const spend = Math.floor(Number(chipsToSpend) || 0)
    if (!Number.isFinite(spend) || spend < MIN_TRADE_CHIPS) {
      return { success: false, error: 'invalid_amount' }
    }
    if (player.chips < spend) return { success: false, error: 'insufficient_chips' }

    const shares = spend / coin.price
    if (!Number.isFinite(shares) || shares <= 0) {
      return { success: false, error: 'invalid_amount' }
    }

    // Player coins: cap buys at the available float (totalSupply minus
    // owner-held). Without this you could mint infinite synthetic shares.
    if (coin.kind === 'player') {
      const float = Math.max(0, coin.totalSupply - coin.ownerShares - coin.outstandingHeld)
      if (shares > float) return { success: false, error: 'insufficient_float' }
      coin.outstandingHeld += shares
    }

    player.chips -= spend

    const bag = this._getOrInitBag(playerId)
    const prev = bag.get(coinId) || { shares: 0, costBasis: 0 }
    prev.shares += shares
    prev.costBasis += spend
    bag.set(coinId, prev)

    // Track outsider investment on player coins for the rug bonus.
    if (coin.kind === 'player' && coin.ownerId !== playerId) {
      this._outsideInvested.set(coinId, (this._outsideInvested.get(coinId) || 0) + spend)
    }

    this._broadcastState({ reason: 'buy' })
    return { success: true, shares: round4(shares), spent: spend }
  }

  sell(playerId, coinId, shareCount) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    const coin = this.coins.get(coinId)
    if (!coin) return { success: false, error: 'coin_not_found' }
    const bag = this.holdings.get(playerId)
    const pos = bag?.get(coinId)
    if (!pos || pos.shares <= 0) return { success: false, error: 'no_position' }

    let toSell = Number(shareCount)
    if (!Number.isFinite(toSell) || toSell <= 0) {
      return { success: false, error: 'invalid_amount' }
    }
    if (toSell > pos.shares) toSell = pos.shares

    const proceeds = Math.floor(toSell * coin.price)
    player.chips += proceeds

    // Reduce cost basis proportionally — keeps realized vs unrealized
    // accounting honest when the player sells partial size.
    const fraction = toSell / pos.shares
    pos.costBasis = Math.max(0, pos.costBasis - pos.costBasis * fraction)
    pos.shares -= toSell

    if (coin.kind === 'player') {
      coin.outstandingHeld = Math.max(0, coin.outstandingHeld - toSell)
    }

    if (pos.shares <= 0.00001) bag.delete(coinId)

    this._broadcastState({ reason: 'sell' })
    return { success: true, shares: round4(toSell), proceeds }
  }

  createCoin(playerId, opts = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    if (this.ownerCoinIds.has(playerId)) {
      return { success: false, error: 'already_minted' }
    }
    if (player.chips < PLAYER_COIN_FEE) {
      return { success: false, error: 'insufficient_chips' }
    }

    // Owner-controllable parameters.
    const rawStart = Number(opts.startPrice)
    const startPrice = Number.isFinite(rawStart) && rawStart >= 0.01 && rawStart <= 10000
      ? rawStart
      : 1.0
    const rawKeep = Number(opts.keepPercent)
    const keepPercent = Number.isFinite(rawKeep) && rawKeep >= 0.5 && rawKeep <= 1.0
      ? rawKeep
      : 0.8
    const requestedName = typeof opts.name === 'string'
      ? opts.name.trim().slice(0, 12).toUpperCase().replace(/[^A-Z0-9]/g, '')
      : ''

    player.chips -= PLAYER_COIN_FEE

    const id = nextCoinId('coin')
    const meme = generateMemeCoin(id)
    const symbol = requestedName.slice(0, 6) || meme.symbol
    const name = requestedName || meme.name
    const totalSupply = 1_000_000   // 1M shares; lets fractional buys feel chunky
    const ownerShares = totalSupply * keepPercent

    const coin = makeCoin({
      id,
      symbol,
      name,
      kind: 'player',
      price: startPrice,
      ownerId: playerId,
      ownerName: player.username,
      ownerShares,
      totalSupply,
      outstandingHeld: 0
    })
    this.coins.set(id, coin)
    this.ownerCoinIds.set(playerId, id)
    this._outsideInvested.set(id, 0)

    // Owner gets a "free" position representing their mint allocation. Cost
    // basis = nominal startPrice × ownerShares so the unrealized P/L on
    // their finances panel starts at zero (not "+$N infinite gains").
    const bag = this._getOrInitBag(playerId)
    const existing = bag.get(id) || { shares: 0, costBasis: 0 }
    existing.shares += ownerShares
    existing.costBasis += Math.round(ownerShares * startPrice)
    bag.set(id, existing)

    this._broadcastState({ reason: 'mint' })
    return { success: true, coinId: id, symbol, name, fee: PLAYER_COIN_FEE }
  }

  rugPull(playerId) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    const coinId = this.ownerCoinIds.get(playerId)
    if (!coinId) return { success: false, error: 'no_coin' }
    const coin = this.coins.get(coinId)
    if (!coin || coin.rugged) return { success: false, error: 'already_rugged' }

    // Owner cashes out their own shares at current price (their bag).
    const bag = this.holdings.get(playerId)
    const ownerPos = bag?.get(coinId)
    let ownerProceeds = 0
    if (ownerPos && ownerPos.shares > 0) {
      ownerProceeds = Math.floor(ownerPos.shares * coin.price)
      bag.delete(coinId)
    }

    // Rug bonus: a cut of everything outsiders poured in. This is the
    // "take a percent of their profit" mechanic — except we extract
    // from cost basis (not paper profit) because cost basis is real chips
    // already moved, while paper profit comes back out via the price
    // crash on outsider sells anyway.
    const outsidersCost = this._outsideInvested.get(coinId) || 0
    const rugBonus = Math.floor(outsidersCost * RUG_KEEP_PERCENT)

    player.chips += ownerProceeds + rugBonus

    // Crash the coin to penny-stock territory and freeze the owner status.
    coin.price = Math.max(RUG_PRICE_FLOOR, coin.price * 0.01)
    coin.rugged = true
    coin.ownerShares = 0
    coin.ownerId = null
    this.ownerCoinIds.delete(playerId)

    // Flatten history a bit so the chart actually shows the crash candle.
    pushHistory(coin, coin.price)

    this._broadcastState({ reason: 'rug', coinId, by: player.username })
    return {
      success: true,
      ownerProceeds,
      rugBonus,
      totalCollected: ownerProceeds + rugBonus
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  _findPlayer(playerId) {
    return this.room.players.get(playerId) || this.room.spectators.get(playerId) || null
  }

  _getOrInitBag(playerId) {
    let bag = this.holdings.get(playerId)
    if (!bag) {
      bag = new Map()
      this.holdings.set(playerId, bag)
    }
    return bag
  }

  _spawnInitial() {
    for (const tmpl of BASE_COIN_TEMPLATES) {
      const id = nextCoinId('base')
      this.coins.set(id, makeCoin({
        id,
        symbol: tmpl.symbol,
        name: tmpl.name,
        kind: 'base',
        price: tmpl.startPrice,
        volatility: tmpl.volatility,
        trendBias: tmpl.trendBias
      }))
    }
    for (let i = 0; i < NUM_SCAM_COINS; i += 1) {
      const id = nextCoinId('scam')
      const meme = generateMemeCoin(id)
      this.coins.set(id, makeCoin({
        id,
        symbol: meme.symbol,
        name: meme.name,
        kind: 'scam',
        // Scam coins start at low fractional prices — buyers can grab
        // millions of shares for a small chip outlay, makes pump candles
        // psychologically thrilling.
        price: 0.001 + Math.random() * 0.1
      }))
    }
  }

  _broadcastState(meta = {}) {
    // Per-player state — myPositions/myCoinId differ. Fan out per recipient.
    const audience = [
      ...this.room.players.values(),
      ...this.room.spectators.values()
    ]
    for (const p of audience) {
      if (p.isBot) continue
      try {
        p.send({
          type: 'crypto:state',
          data: { ...this.getStatePayload(p.id), reason: meta.reason || null, meta }
        })
      } catch (err) {
        console.error('[crypto] state send failed:', err.message)
      }
    }
  }
}

function makeCoin(init) {
  return {
    id: init.id,
    symbol: init.symbol,
    name: init.name,
    kind: init.kind,
    price: init.price,
    prevPrice: init.price,
    history: Array.from({ length: MAX_HISTORY_FROM_FLAT }, () => init.price),
    anchor: init.price,
    volatility: init.volatility ?? 0.02,
    trendBias: init.trendBias ?? 0,
    // scam-only fields
    regimeName: null,
    regimeDrift: 0,
    regimeVol: 0,
    regimeTicksLeft: 0,
    // player-only fields
    ownerId: init.ownerId || null,
    ownerName: init.ownerName || null,
    ownerShares: init.ownerShares ?? 0,
    totalSupply: init.totalSupply ?? 0,
    outstandingHeld: init.outstandingHeld ?? 0,
    rugged: false,
    ownerLeft: false,
    createdAt: Date.now()
  }
}

function round4(x) { return Math.round(x * 10000) / 10000 }

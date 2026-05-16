// Stock-market simulation for the table. Distinct from crypto: stocks
// drift on a fictional but plausible random walk (mean reversion + low
// volatility) instead of crypto's stunt-spike behavior. The novel
// mechanic here is PAY-TO-SABOTAGE: a player can spend a chunk of
// chips to crash a specific company's price for a few ticks, profiting
// off the short position they took beforehand. The sabotage cost is
// burned (not paid to anyone), keeping it a chip-sink rather than
// a transfer.
//
// Bots can't trade or sabotage. Holdings + shorts are on the engine,
// not on the Player object, mirroring cryptoEngine's pattern.

import { MESSAGE_TYPES } from '../config/constants.js'

const TICK_MS = 3000
const HISTORY_LEN = 60
const SABOTAGE_COST_PERCENT = 0.10    // 10% of target company market cap
const SABOTAGE_DROP_RANGE = [0.18, 0.42]  // crashes the price 18-42%
const SABOTAGE_COOLDOWN_HANDS = 3

// Sector-coded placeholder URL. Same hybrid as assetsEngine: the
// React panel handles onError fallback, so a missing/blocked real
// URL gracefully degrades to a colored chip with the ticker text.
function stockPh(symbol, sector) {
  const colors = {
    Tech:         '3b82f6/dbeafe',
    Finance:      '0f766e/ccfbf1',
    Energy:       'b45309/fef3c7',
    Healthcare:   '7c3aed/ede9fe',
    Defense:      '991b1b/fee2e2',
    Consumer:     'd97706/fef3c7',
    Materials:    '78350f/fed7aa',
    Conglomerate: '475569/e2e8f0',
    Crypto:       'a21caf/fae8ff',
    Media:        'be185d/fce7f3',
    Auto:         '1d4ed8/dbeafe',
    Aerospace:    '0c4a6e/e0f2fe',
    Retail:       'a16207/fef3c7',
    Real_Estate:  '047857/d1fae5',
    AI:           '4338ca/e0e7ff',
    Cannabis:     '15803d/dcfce7',
    Pharma:       '6d28d9/ede9fe',
  }
  const pal = colors[sector] || colors.Conglomerate
  return `https://placehold.co/240x160/${pal}.png?text=%24${symbol}&font=lato`
}

// Massively expanded ticker catalog. ~30 fictional companies across
// every sector, with realistic starting prices ($15 penny-stock all
// the way to $1200 mega-cap) and sector-tuned volatility. Higher
// volatility = bigger swings = more sabotage / pump payoff.
const COMPANIES = [
  // ─ Mega-caps ─────────────────────────────────────────────────────
  { symbol: 'MEGA', name: 'Megacorp Industries',          startPrice: 1250,  sector: 'Conglomerate', volatility: 0.010, imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a392ad40' },
  { symbol: 'GAFA', name: 'Gigantor Holdings',            startPrice: 940,   sector: 'Tech',         volatility: 0.014, imageUrl: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29' },
  { symbol: 'AAII', name: 'Frontier AI Systems',          startPrice: 1450,  sector: 'AI',           volatility: 0.030, imageUrl: 'https://images.unsplash.com/photo-1558494949-ef0d38d3f2d4' },
  { symbol: 'NXAI', name: 'Neural Nexus Labs',            startPrice: 820,   sector: 'AI',           volatility: 0.035, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Neural_network_abstract.jpg/800px-Neural_network_abstract.jpg' },
  { symbol: 'BANK', name: 'Too-Big-To-Fail Bank',         startPrice: 480,   sector: 'Finance',      volatility: 0.010, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Wall_Street.jpg/800px-Wall_Street.jpg' },
  { symbol: 'BNDS', name: 'Eurobond Holdings',            startPrice: 175,   sector: 'Finance',      volatility: 0.006, imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3' },
  // ─ Energy ────────────────────────────────────────────────────────
  { symbol: 'OIL',  name: 'Petroglobal',                  startPrice: 195,   sector: 'Energy',       volatility: 0.018, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/North_Sea_oil_rig.jpg/800px-North_Sea_oil_rig.jpg' },
  { symbol: 'FUSE', name: 'Fusion Pioneers',              startPrice: 75,    sector: 'Energy',       volatility: 0.040, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Tokamak_fusion.jpg/800px-Tokamak_fusion.jpg' },
  { symbol: 'SOLR', name: 'Solar Continental',            startPrice: 110,   sector: 'Energy',       volatility: 0.020, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Solar_farm_aerial.jpg/800px-Solar_farm_aerial.jpg' },
  { symbol: 'NUKE', name: 'Atomic Power Utilities',       startPrice: 290,   sector: 'Energy',       volatility: 0.012, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Nuclear_cooling_towers.jpg/800px-Nuclear_cooling_towers.jpg' },
  // ─ Healthcare / Pharma ───────────────────────────────────────────
  { symbol: 'PILL', name: 'PharmaCo',                     startPrice: 410,   sector: 'Healthcare',   volatility: 0.014, imageUrl: 'https://images.unsplash.com/photo-1584308666744-0a7a3c4c4e4e' },
  { symbol: 'CRSP', name: 'GeneEdit Sciences',            startPrice: 320,   sector: 'Pharma',       volatility: 0.028, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/DNA_double_helix.jpg/800px-DNA_double_helix.jpg' },
  { symbol: 'WGOV', name: 'Weight Loss Inc.',             startPrice: 540,   sector: 'Pharma',       volatility: 0.022, imageUrl: 'https://images.unsplash.com/photo-1584308666744-0a7a3c4c4e4e' },
  // ─ Defense / Aerospace ───────────────────────────────────────────
  { symbol: 'BOOM', name: 'Defense Dynamics',             startPrice: 740,   sector: 'Defense',      volatility: 0.011, imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd70cbf54a' },
  { symbol: 'JETS', name: 'Astroflight Industries',       startPrice: 380,   sector: 'Aerospace',    volatility: 0.014, imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05' },
  { symbol: 'ORBT', name: 'Orbital Logistics',            startPrice: 215,   sector: 'Aerospace',    volatility: 0.032, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Satellite_earth_orbit.jpg/800px-Satellite_earth_orbit.jpg' },
  // ─ Consumer / Retail ─────────────────────────────────────────────
  { symbol: 'FAST', name: 'BurgerLord',                   startPrice: 95,    sector: 'Consumer',     volatility: 0.013, imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34b4' },
  { symbol: 'COFF', name: 'Roastmasters Coffee',          startPrice: 165,   sector: 'Consumer',     volatility: 0.012, imageUrl: 'https://images.unsplash.com/photo-1495474472289-8607f5a1e9b3' },
  { symbol: 'MEGA_MART', name: 'MegaMart Retail',         startPrice: 235,   sector: 'Retail',       volatility: 0.010, imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
  { symbol: 'SHIP', name: 'PrimeShip Logistics',          startPrice: 525,   sector: 'Retail',       volatility: 0.014, imageUrl: 'https://images.unsplash.com/photo-1586528116314-0d8d0e4f5c3f' },
  // ─ Materials / Mining ────────────────────────────────────────────
  { symbol: 'GOLD', name: 'Glimmer Mining',               startPrice: 245,   sector: 'Materials',    volatility: 0.017, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Open_pit_gold_mine.jpg/800px-Open_pit_gold_mine.jpg' },
  { symbol: 'LITH', name: 'Lithium Continental',          startPrice: 88,    sector: 'Materials',    volatility: 0.024, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Salar_de_Uyuni_lithium_pools.jpg/800px-Salar_de_Uyuni_lithium_pools.jpg' },
  { symbol: 'COBT', name: 'Cobalt Resources',             startPrice: 145,   sector: 'Materials',    volatility: 0.026, imageUrl: 'https://images.unsplash.com/photo-1583248379190-3f5c3b8c8e8e' },
  // ─ Auto / Mobility ───────────────────────────────────────────────
  { symbol: 'EVCO', name: 'Voltage Auto',                 startPrice: 285,   sector: 'Auto',         volatility: 0.030, imageUrl: 'https://images.unsplash.com/photo-1593941707882-a5a8c9c8e6f4' },
  { symbol: 'TRUC', name: 'HaulRight Trucking',           startPrice: 62,    sector: 'Auto',         volatility: 0.014, imageUrl: 'https://images.unsplash.com/photo-1586528116314-0d8d0e4f5c3f' },
  // ─ Media / Crypto / Cannabis ─────────────────────────────────────
  { symbol: 'STRM', name: 'Streamflix Originals',         startPrice: 320,   sector: 'Media',        volatility: 0.022, imageUrl: 'https://images.unsplash.com/photo-1574375927797-0f2f8b3c8f4d' },
  { symbol: 'GAME', name: 'PixelForge Studios',           startPrice: 145,   sector: 'Media',        volatility: 0.026, imageUrl: 'https://images.unsplash.com/photo-1611996575749-79a3ae1c8c6e' },
  { symbol: 'CRYP', name: 'BlockBase Exchange',           startPrice: 410,   sector: 'Crypto',       volatility: 0.045, imageUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0' },
  { symbol: 'WEED', name: 'GreenGrow Holdings',           startPrice: 28,    sector: 'Cannabis',     volatility: 0.040, imageUrl: 'https://images.unsplash.com/photo-1584308666744-0a7a3c4c4e4e' },
  { symbol: 'REIT', name: 'Sunbelt REIT',                 startPrice: 78,    sector: 'Real_Estate',  volatility: 0.011, imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
  // ─ Penny stocks (high volatility, pump-and-dump candy) ──────────
  { symbol: 'SCAM', name: 'Cayman Holdings (?)',          startPrice: 4.20,  sector: 'Crypto',       volatility: 0.080, imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { symbol: 'ZMBE', name: 'Zombie Bankrupt Co.',          startPrice: 0.85,  sector: 'Retail',       volatility: 0.090, imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
]

function pushHistory(stock, price) {
  stock.history.push({ t: Date.now(), p: price })
  if (stock.history.length > HISTORY_LEN) stock.history.shift()
}

// Earnings event tuning. Once every EARNINGS_INTERVAL_HANDS the engine
// picks a random ticker, announces it 1 hand in advance ("MEGA reports
// next hand — position now"), then resolves with one of 4 outcomes:
//   meh      55%  — ±3-7%   (boring beat / miss)
//   moderate 30%  — ±15-22% (real news)
//   blowout  12%  — ±32-45% (major beat / miss, generational candle)
//   rocket   3%   — ±55-75% (the unicorn earnings, life-changing)
// Players can long or short ahead of the event for the upside; bots
// can't trade so this is purely a human / spectator opportunity.
const EARNINGS_INTERVAL_HANDS = 6
const EARNINGS_OUTCOMES = [
  { weight: 55, label: 'meh',      bullRange: [0.03, 0.07], bearRange: [0.03, 0.07] },
  { weight: 30, label: 'moderate', bullRange: [0.15, 0.22], bearRange: [0.15, 0.22] },
  { weight: 12, label: 'blowout',  bullRange: [0.32, 0.45], bearRange: [0.32, 0.45] },
  { weight: 3,  label: 'rocket',   bullRange: [0.55, 0.75], bearRange: [0.55, 0.75] },
]

export class StockEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast
    this.stocks = new Map()  // symbol → {symbol, name, sector, price, basePrice, volatility, history, sabotageUntil}
    for (const c of COMPANIES) {
      const stock = { ...c, price: c.startPrice, basePrice: c.startPrice, history: [], sabotageUntil: 0 }
      pushHistory(stock, c.startPrice)
      this.stocks.set(c.symbol, stock)
    }
    // playerId → Map<symbol, { shares, costBasis }>
    this.holdings = new Map()
    // playerId → handIndex when sabotage was last used (cooldown).
    this.sabotageCooldowns = new Map()
    this._tickTimer = null
    // ── Earnings ──────────────────────────────────────────────────
    // `upcomingEarnings` holds the symbol scheduled to report at the
    // NEXT hand-end. Announced one hand in advance so a player can
    // position long/short. After resolution the slot resets.
    this.upcomingEarnings = null
    this.nextEarningsAtHand = 0
  }

  start() {
    if (this._tickTimer) return
    this._tickTimer = setInterval(() => this._tick(), TICK_MS)
    if (typeof this._tickTimer.unref === 'function') this._tickTimer.unref()
  }
  stop() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null }
  }

  _findPlayer(playerId) {
    return this.room.players?.get?.(playerId) || this.room.spectators?.get?.(playerId) || null
  }

  _bagFor(playerId) {
    let bag = this.holdings.get(playerId)
    if (!bag) { bag = new Map(); this.holdings.set(playerId, bag) }
    return bag
  }

  // Mean-reverting random walk + occasional WSB-tier spike. Per-tick
  // dynamics:
  //   • mean reversion pulls price back toward basePrice at ~2%/tick
  //   • base move = (rand - 0.5) × 4 × volatility × price (2× crypto-feel)
  //   • 6% chance per tick of a "vol spike" — ±3-8% jump on top of
  //     the base move, for the candle-watching dopamine. Bigger
  //     volatility → bigger spikes (lithium / crypto exchange shares
  //     pop harder than utilities).
  //   • sabotage adds a fixed downward bias until sabotageUntil ms.
  _tick() {
    const now = Date.now()
    let changed = false
    for (const stock of this.stocks.values()) {
      const meanReversion = (stock.basePrice - stock.price) * 0.02
      const randomMove = (Math.random() - 0.5) * 4 * stock.volatility * stock.price
      // Vol-spike candle. The 6% rate at the default 3s tick produces
      // ~1 spike per ticker every ~50s — frequent enough to feel
      // "alive" but not so often the chart is a sine wave.
      let spike = 0
      if (Math.random() < 0.06) {
        const dir = Math.random() < 0.5 ? -1 : 1
        const mag = 0.03 + Math.random() * 0.05 + stock.volatility
        spike = dir * mag * stock.price
      }
      let sabotagePull = 0
      if (stock.sabotageUntil > now) {
        sabotagePull = -stock.price * 0.04  // -4% per tick while sabotage is active
      }
      const newPrice = Math.max(1, Math.round((stock.price + meanReversion + randomMove + spike + sabotagePull) * 100) / 100)
      if (newPrice !== stock.price) {
        stock.price = newPrice
        pushHistory(stock, newPrice)
        changed = true
      }
    }
    if (changed) this._broadcastTick()
  }

  // ─── trade ─────────────────────────────────────────────────────────────
  buy(playerId, { symbol, amount } = {}) {
    const spend = Math.max(1, Math.floor(Number(amount) || 0))
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    const stock = this.stocks.get(symbol)
    if (!stock) return { success: false, error: 'unknown_symbol' }
    if (player.chips < spend) return { success: false, error: 'insufficient_chips' }
    const shares = spend / stock.price
    if (shares <= 0) return { success: false, error: 'too_small' }
    player.chips -= spend
    const bag = this._bagFor(playerId)
    const pos = bag.get(symbol) || { shares: 0, costBasis: 0 }
    pos.shares += shares
    pos.costBasis += spend
    bag.set(symbol, pos)
    this._broadcastState()
    return { success: true, symbol, shares, costBasis: spend }
  }

  sell(playerId, { symbol, sharesToSell } = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    const bag = this.holdings.get(playerId)
    const pos = bag?.get(symbol)
    if (!pos || pos.shares <= 0) return { success: false, error: 'no_position' }
    let sellShares = Number(sharesToSell)
    if (!Number.isFinite(sellShares) || sellShares <= 0) sellShares = pos.shares
    sellShares = Math.min(sellShares, pos.shares)
    const stock = this.stocks.get(symbol)
    if (!stock) return { success: false, error: 'unknown_symbol' }
    const proceeds = Math.floor(sellShares * stock.price)
    player.chips += proceeds
    const ratio = sellShares / pos.shares
    pos.costBasis = Math.floor(pos.costBasis * (1 - ratio))
    pos.shares -= sellShares
    if (pos.shares < 0.0001) bag.delete(symbol)
    this._broadcastState()
    return { success: true, symbol, sharesSold: sellShares, proceeds }
  }

  // ─── sabotage ──────────────────────────────────────────────────────────
  // Burns chips proportional to the target's "market cap" estimate
  // (price × 10000 nominal shares). Activates a 4-tick downward bias
  // that drops the price 18-42% over the next ~20 seconds.
  sabotage(playerId, { symbol, handIndex } = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_sabotage' }
    const stock = this.stocks.get(symbol)
    if (!stock) return { success: false, error: 'unknown_symbol' }
    const lastUsed = this.sabotageCooldowns.get(playerId)
    if (typeof lastUsed === 'number' && (handIndex - lastUsed) < SABOTAGE_COOLDOWN_HANDS) {
      return { success: false, error: 'cooldown', cooldownRemaining: SABOTAGE_COOLDOWN_HANDS - (handIndex - lastUsed) }
    }
    const cost = Math.max(500, Math.floor(stock.price * 10000 * SABOTAGE_COST_PERCENT))
    if (player.chips < cost) return { success: false, error: 'insufficient_chips', cost }
    player.chips -= cost
    this.sabotageCooldowns.set(playerId, handIndex)
    stock.sabotageUntil = Date.now() + 20_000  // 20s of downward bias
    // Immediate hit on top of the bias so the player sees the effect.
    const drop = SABOTAGE_DROP_RANGE[0] + Math.random() * (SABOTAGE_DROP_RANGE[1] - SABOTAGE_DROP_RANGE[0])
    stock.price = Math.max(1, Math.round(stock.price * (1 - drop) * 100) / 100)
    pushHistory(stock, stock.price)
    // Sector contagion — competitors in the same sector take a
    // smaller correlated hit. Models the "investors flee the whole
    // sector" panic. Fires before broadcast so the snapshot
    // includes both the direct sabotage and the contagion drops.
    const contagion = this.applySectorContagion(symbol, 0.12)
    this._broadcastState()
    const contagionMsg = contagion.affected > 0
      ? ` Sector contagion: ${contagion.affected} ${contagion.sector} stocks dragged down.`
      : ''
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `📉 ${player.username} sabotaged $${symbol}. Burned $${cost.toLocaleString()}.${contagionMsg}` }
    })
    return { success: true, symbol, cost, dropPercent: Math.round(drop * 100), sectorAffected: contagion.affected }
  }

  // Public method so other engines (InfluenceEngine) can append a
  // history sample after mutating a stock's price directly. Mirrors
  // the module-local pushHistory helper but reachable from outside.
  pushHistoryFor(stock, price) {
    pushHistory(stock, price)
  }

  // ─── Cross-market correlation hooks ────────────────────────────────────
  // Called by worldEngine when a pandemic is released — drops every
  // stock by the supplied magnitude (e.g., 0.25 = -25%) and extends
  // their `sabotageUntil` so prices stay depressed for ~30s. The
  // chart shows a market-wide crash candle, then mean-reversion drags
  // them back up over the recovery window.
  applyMarketShock(magnitude) {
    const m = Math.max(0.05, Math.min(0.6, Number(magnitude) || 0.25))
    for (const stock of this.stocks.values()) {
      stock.price = Math.max(1, Math.round(stock.price * (1 - m) * 100) / 100)
      pushHistory(stock, stock.price)
      stock.sabotageUntil = Date.now() + 30_000
    }
    this._broadcastState()
    return { stocksShocked: this.stocks.size }
  }

  // Sector-correlation hit fired by a sabotage on the SAME sector.
  // Smaller per-stock impact than a direct sabotage, but applied to
  // every same-sector competitor of the target. Models "investors
  // flee the whole sector after one company gets hit" panic.
  applySectorContagion(sourceSymbol, sectorImpact = 0.12) {
    const source = this.stocks.get(sourceSymbol)
    if (!source) return { affected: 0 }
    let affected = 0
    for (const stock of this.stocks.values()) {
      if (stock.symbol === sourceSymbol) continue
      if (stock.sector !== source.sector) continue
      const drop = sectorImpact * (0.7 + Math.random() * 0.6)
      stock.price = Math.max(1, Math.round(stock.price * (1 - drop) * 100) / 100)
      pushHistory(stock, stock.price)
      affected += 1
    }
    if (affected > 0) this._broadcastState()
    return { affected, sector: source.sector }
  }

  // ─── lifecycle / serialization ─────────────────────────────────────────
  onHandEnd(handIndex = 0) {
    // Earnings flow runs on every hand-end:
    //   1. If a stock was queued (announced last hand), resolve it now
    //      with a weighted outcome and a giant candle.
    //   2. If we're due for another earnings announcement, pick a fresh
    //      ticker at random and queue it for next hand. Announce loudly
    //      so players have time to long/short.
    if (this.upcomingEarnings) {
      this._resolveEarnings(this.upcomingEarnings)
      this.upcomingEarnings = null
    }
    if (handIndex >= this.nextEarningsAtHand) {
      this._queueEarnings(handIndex)
    }
    this._broadcastState()
  }

  _queueEarnings(handIndex) {
    const tickers = [...this.stocks.values()].filter(s => !s.rugged)
    if (tickers.length === 0) return
    const pick = tickers[Math.floor(Math.random() * tickers.length)]
    this.upcomingEarnings = pick.symbol
    this.nextEarningsAtHand = handIndex + EARNINGS_INTERVAL_HANDS
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `📢 EARNINGS ALERT — $${pick.symbol} (${pick.name}) reports next hand. Position now.` }
    })
  }

  _resolveEarnings(symbol) {
    const stock = this.stocks.get(symbol)
    if (!stock) return
    // Weighted outcome pick.
    const totalWeight = EARNINGS_OUTCOMES.reduce((s, o) => s + o.weight, 0)
    let roll = Math.random() * totalWeight
    let outcome = EARNINGS_OUTCOMES[0]
    for (const o of EARNINGS_OUTCOMES) {
      if (roll < o.weight) { outcome = o; break }
      roll -= o.weight
    }
    // Direction: 50/50 beat vs miss, independent of magnitude.
    const isBeat = Math.random() < 0.5
    const range = isBeat ? outcome.bullRange : outcome.bearRange
    const mag = range[0] + Math.random() * (range[1] - range[0])
    const signed = isBeat ? mag : -mag
    const newPrice = Math.max(1, Math.round(stock.price * (1 + signed) * 100) / 100)
    stock.price = newPrice
    pushHistory(stock, newPrice)
    const pctText = `${(signed * 100).toFixed(1)}%`
    const emoji = isBeat
      ? (outcome.label === 'rocket' ? '🚀' : outcome.label === 'blowout' ? '📈' : '✅')
      : (outcome.label === 'rocket' ? '💥' : outcome.label === 'blowout' ? '📉' : '⚠️')
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `${emoji} $${symbol} earnings: ${outcome.label.toUpperCase()} ${isBeat ? 'BEAT' : 'MISS'} ${pctText} — now $${stock.price < 100 ? stock.price.toFixed(2) : Math.round(stock.price).toLocaleString()}.` }
    })
  }

  buildSnapshot(playerId) {
    const stocks = [...this.stocks.values()].map(s => ({
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      price: s.price,
      basePrice: s.basePrice,
      history: [...s.history],
      sabotaged: s.sabotageUntil > Date.now(),
      imageUrl: s.imageUrl || null,
    }))
    const bag = this.holdings.get(playerId) || new Map()
    const positions = []
    for (const [symbol, pos] of bag) {
      const s = this.stocks.get(symbol)
      if (!s) continue
      positions.push({
        symbol,
        shares: Math.round(pos.shares * 100) / 100,
        costBasis: pos.costBasis,
        currentValue: Math.floor(pos.shares * s.price),
      })
    }
    return {
      stocks,
      myPositions: positions,
      // Surface the earnings-pending ticker so the panel can highlight
      // it as the "position now or regret tomorrow" target. Resolves
      // on the next hand-end.
      upcomingEarnings: this.upcomingEarnings
    }
  }

  _broadcastState() {
    const seats = this.room.players?.values?.() || []
    for (const p of seats) {
      if (p.isBot || !p.isConnected) continue
      p.send({ type: 'stocks:state', data: this.buildSnapshot(p.id) })
    }
    const specs = this.room.spectators?.values?.() || []
    for (const s of specs) {
      if (!s.isConnected) continue
      s.send({ type: 'stocks:state', data: this.buildSnapshot(s.id) })
    }
  }

  // Lightweight tick broadcast — price-only, no per-player position
  // recompute. Fires every TICK_MS while the engine is running.
  _broadcastTick() {
    const prices = {}
    for (const s of this.stocks.values()) prices[s.symbol] = s.price
    this.broadcast({ type: 'stocks:tick', data: { prices, ts: Date.now() } })
  }

  sendSnapshotTo(player) {
    if (!player || player.isBot) return
    player.send({ type: 'stocks:state', data: this.buildSnapshot(player.id) })
  }

  handlePlayerLeave(playerId) {
    const player = this._findPlayer(playerId)
    const bag = this.holdings.get(playerId)
    if (!bag || bag.size === 0) { this.holdings.delete(playerId); this.sabotageCooldowns.delete(playerId); return }
    if (player) {
      let proceeds = 0
      for (const [symbol, pos] of bag) {
        const s = this.stocks.get(symbol)
        if (!s) continue
        proceeds += Math.floor(pos.shares * s.price)
      }
      player.chips += proceeds
    }
    this.holdings.delete(playerId)
    this.sabotageCooldowns.delete(playerId)
  }
}

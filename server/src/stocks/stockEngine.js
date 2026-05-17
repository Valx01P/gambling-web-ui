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
  // kind:'penny' marks a thin-float ticker — moves a lot on player
  // buys/sells (see _applyTradeImpact below) and dominates the "fastest
  // gain / fastest loss" tickers on the client.
  { symbol: 'SCAM', name: 'Cayman Holdings (?)',          startPrice: 4.20,  sector: 'Crypto',       volatility: 0.080, kind: 'penny', imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { symbol: 'ZMBE', name: 'Zombie Bankrupt Co.',          startPrice: 0.85,  sector: 'Retail',       volatility: 0.090, kind: 'penny', imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
  { symbol: 'BAGS', name: 'Empty Bag Holding Co.',        startPrice: 0.42,  sector: 'Retail',       volatility: 0.110, kind: 'penny', imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
  { symbol: 'WSB',  name: 'WSB Apes Inc.',                startPrice: 6.66,  sector: 'Crypto',       volatility: 0.095, kind: 'penny', imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3' },
  { symbol: 'TRNK', name: 'Trunk Liquidators',            startPrice: 1.20,  sector: 'Retail',       volatility: 0.085, kind: 'penny', imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
  { symbol: 'COPE', name: 'Generational Cope Co.',        startPrice: 2.10,  sector: 'Media',        volatility: 0.100, kind: 'penny', imageUrl: 'https://images.unsplash.com/photo-1574375927797-0f2f8b3c8f4d' },
  // ─ Meme stocks (expensive AND volatile — the headline names) ────
  // kind:'meme' = mid-float, big volatility. Pump-and-dump-able by a
  // whale but takes serious money. Drives the "fastest gain / loss"
  // tickers when penny stocks aren't moving.
  { symbol: 'ROAR', name: 'GameRoar Holdings',            startPrice: 480,   sector: 'Retail',       volatility: 0.070, kind: 'meme',  imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3' },
  { symbol: 'AMCC', name: 'AmpliCorp Cinemas',            startPrice: 22,    sector: 'Media',        volatility: 0.075, kind: 'meme',  imageUrl: 'https://images.unsplash.com/photo-1574375927797-0f2f8b3c8f4d' },
  { symbol: 'MOON', name: 'Moonshot Industries',          startPrice: 188,   sector: 'Crypto',       volatility: 0.085, kind: 'meme',  imageUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0' },
  { symbol: 'TENDY',name: 'Tendies Holdings Group',       startPrice: 95,    sector: 'Consumer',     volatility: 0.078, kind: 'meme',  imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34b4' },
  { symbol: 'YOLO', name: 'YOLO Capital Trust',           startPrice: 312,   sector: 'Finance',      volatility: 0.082, kind: 'meme',  imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3' },
]

// Notional shares outstanding by stock kind. Smaller float = bigger
// price move per dollar traded. Trade impact = trade$ / (price * float).
// • main blue chips: deep float, basically untradeable solo
// • meme: ~10x thinner than main — a few million in buys moves it
// • penny: ~100x thinner than main — pump-and-dump capital easy
const FLOAT_SHARES_BY_KIND = {
  main:  1_000_000,
  meme:  100_000,
  penny: 10_000,
}
// Cap any single trade's price impact at 25% to prevent runaway
// pumps from a single billion-chip buy. Stops the math from feeding
// a single transaction more than a quarter-up/down move.
const MAX_TRADE_IMPACT = 0.25

function pushHistory(stock, price) {
  stock.history.push({ t: Date.now(), p: price })
  if (stock.history.length > HISTORY_LEN) stock.history.shift()
}

// Earnings event tuning. 2-6 tickers report every hand — we
// announce at hand N, resolve at hand N+1. Players can long,
// short, buy calls, or buy puts in the hand before they land.
// The hand-end flow always queues the NEXT batch right after
// resolving the current one, so a player at the table always
// has a stack of "upcoming earnings" to gamble on.
const EARNINGS_INTERVAL_HANDS = 1
const EARNINGS_PER_HAND_MIN = 2
const EARNINGS_PER_HAND_MAX = 6
// Tickers are drawn from a shuffled rotation: every stock reports
// exactly once before any stock can report a second time. Keeps
// the headline ticker-mix varied across a session instead of
// pure RNG repeating big-name picks back-to-back.

// Implied-volatility magnitude bands per stock "kind". These are
// the OUTER ranges of an earnings-day move; the realized move is
// drawn within the band and then scaled by an analyst-surprise
// factor (priced-in events move less than fully-unexpected ones).
//
//   main  (large caps): up +5%..+40%, down -5%..-60%
//   meme  (mid float):  up +10%..+160%, down -10%..-100%
//   penny (thin float): up +10%..+150%, down -10%..-120%
//
// Down ranges are tighter on the upside than meme/penny but
// not symmetric — real-world earnings misses tend to overshoot
// because of forced selling, so the bear band is wider than bull
// on the deep value end for blue chips.
const IV_BANDS = {
  main:  { up: [0.05, 0.40], down: [0.05, 0.60] },
  meme:  { up: [0.10, 1.60], down: [0.10, 1.00] },
  penny: { up: [0.10, 1.50], down: [0.10, 1.20] },
}

// Analyst beat-probability range. Randomized per event so each
// earnings has a different "story" — sometimes the street expects
// a beat (90%) and a miss would be a catastrophe; sometimes
// expectations are low (20%) and any beat is a rocket.
const ANALYST_ODDS_RANGE = [0.18, 0.88]

// Surprise scaling — the actual move = base × (0.30 + 0.70 × surprise).
//
//   Beat with high analyst odds (90%) → surprise low → small candle
//     (priced in: market already bought the rumor)
//   Beat with low analyst odds (20%)  → surprise high → giant candle
//     (unexpected: market piles in after the news)
//   Miss with high analyst odds (90%) → surprise high → giant red candle
//     (forced selling: longs who priced in a beat get blown out)
//   Miss with low analyst odds (20%)  → surprise low → small red candle
//     (expected: shorts already took their profit)
//
// The min floor of 0.30 keeps even fully-priced events from
// vanishing entirely — there's always some move on earnings day.
const SURPRISE_SCALE_MIN = 0.30
const SURPRISE_SCALE_RANGE = 0.70

export class StockEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast
    this.stocks = new Map()  // symbol → {symbol, name, sector, price, basePrice, volatility, kind, history, sabotageUntil}
    for (const c of COMPANIES) {
      // Default any entry that pre-dates the kind taxonomy to 'main'
      // so it gets the deep-liquidity float treatment in trades.
      const stock = {
        ...c,
        kind: c.kind || 'main',
        price: c.startPrice,
        basePrice: c.startPrice,
        history: [],
        sabotageUntil: 0
      }
      pushHistory(stock, c.startPrice)
      this.stocks.set(c.symbol, stock)
    }
    // playerId → Map<symbol, { shares, costBasis }>
    this.holdings = new Map()
    // playerId → handIndex when sabotage was last used (cooldown).
    this.sabotageCooldowns = new Map()
    this._tickTimer = null
    // ── Earnings ──────────────────────────────────────────────────
    // `upcomingEarnings` is an ARRAY of events scheduled to report
    // at the NEXT hand-end. Announced one hand in advance so a
    // player can position long/short/calls/puts before each. After
    // resolution the slot resets and a fresh batch is queued.
    //
    // `_earningsRotation` holds the symbols left in the current
    // cycle. When it empties we reshuffle the full ticker list, so
    // every stock reports exactly once before any repeat. Seeded
    // immediately in the constructor so the Earnings tab shows
    // content from the very first frame — no need to wait for
    // hand-end before any events exist.
    this.upcomingEarnings = []
    this.nextEarningsAtHand = 0
    this._earningsRotation = []
    this._queueEarnings(0)
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
  // Trade price impact: bigger trades move the price proportionally to
  // the ticker's float. Direction = +1 for buy, -1 for sell. Penny/meme
  // tickers have thin floats (FLOAT_SHARES_BY_KIND) so a few-million-dollar
  // buy moves them visibly; blue-chip main stocks barely budge on the
  // same dollar amount. Pump-and-dump emerges naturally.
  _applyTradeImpact(stock, dollarAmount, direction) {
    const float = FLOAT_SHARES_BY_KIND[stock.kind] || FLOAT_SHARES_BY_KIND.main
    const dollarFloat = stock.price * float
    if (dollarFloat <= 0) return 0
    const rawImpact = Math.min(MAX_TRADE_IMPACT, dollarAmount / dollarFloat)
    const move = direction * rawImpact
    stock.price = Math.max(0.01, Math.round(stock.price * (1 + move) * 100) / 100)
    pushHistory(stock, stock.price)
    return move
  }

  buy(playerId, { symbol, amount } = {}) {
    const spend = Math.max(1, Math.floor(Number(amount) || 0))
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    const stock = this.stocks.get(symbol)
    if (!stock) return { success: false, error: 'unknown_symbol' }
    // Stocks live in the BANK wallet — never touch poker chips.
    if ((player.bankBalance || 0) < spend) return { success: false, error: 'insufficient_chips' }
    const shares = spend / stock.price
    if (shares <= 0) return { success: false, error: 'too_small' }
    player.bankBalance -= spend
    const bag = this._bagFor(playerId)
    const pos = bag.get(symbol) || { shares: 0, costBasis: 0 }
    pos.shares += shares
    pos.costBasis += spend
    bag.set(symbol, pos)
    // Apply buy pressure AFTER filling at the pre-trade price — the
    // buyer fills at their reasonable expectation, and the next trader
    // sees a higher price. Keeps the model intuitive.
    this._applyTradeImpact(stock, spend, +1)
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
    // Proceeds land in the bank wallet, same surface as the buy.
    player.bankBalance = (player.bankBalance || 0) + proceeds
    const ratio = sellShares / pos.shares
    pos.costBasis = Math.floor(pos.costBasis * (1 - ratio))
    pos.shares -= sellShares
    if (pos.shares < 0.0001) bag.delete(symbol)
    // Sell pressure: drop the price proportionally. Same float math as
    // buys — pump-and-dumpers feel the dump on penny/meme exits.
    this._applyTradeImpact(stock, proceeds, -1)
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
    // Sabotage is paid from the BANK wallet, not poker chips. Chips
    // are reserved exclusively for poker bets per the design ask;
    // every other money flow on the table runs through the bank.
    if ((player.bankBalance || 0) < cost) return { success: false, error: 'insufficient_chips', cost }
    player.bankBalance -= cost
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
    //   1. Resolve every event queued from the previous hand. Each
    //      gets its own beat/miss roll, magnitude draw, and headline.
    //   2. Queue the NEXT batch (2-6 tickers from the no-repeat
    //      rotation) so positioning windows are continuous.
    const queue = Array.isArray(this.upcomingEarnings)
      ? this.upcomingEarnings
      // backward-compat: pre-batch versions stored a single object
      : this.upcomingEarnings ? [this.upcomingEarnings] : []
    if (queue.length > 0) {
      for (const ev of queue) this._resolveEarnings(ev)
    }
    this.upcomingEarnings = []
    if (handIndex >= this.nextEarningsAtHand) {
      this._queueEarnings(handIndex)
    }
    this._broadcastState()
  }

  // Refill the rotation when it empties. Shuffled, so the headline
  // ticker-mix varies across sessions instead of grouping the same
  // big-name picks back-to-back.
  _refillEarningsRotation() {
    const symbols = [...this.stocks.values()]
      .filter(s => !s.rugged)
      .map(s => s.symbol)
    // Fisher-Yates
    for (let i = symbols.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[symbols[i], symbols[j]] = [symbols[j], symbols[i]]
    }
    this._earningsRotation = symbols
  }

  // Draw a fresh batch of 2-6 tickers from the rotation, refilling
  // whenever it empties. Builds the full event object for each
  // (analyst odds + IV magnitudes from the kind's band), pushes
  // them into upcomingEarnings, announces a combined headline.
  _queueEarnings(handIndex) {
    if (!Array.isArray(this._earningsRotation) || this._earningsRotation.length === 0) {
      this._refillEarningsRotation()
    }
    if (this._earningsRotation.length === 0) return  // no tickers exist at all
    const wantRange = EARNINGS_PER_HAND_MAX - EARNINGS_PER_HAND_MIN + 1
    const wantCount = EARNINGS_PER_HAND_MIN + Math.floor(Math.random() * wantRange)
    const batch = []
    while (batch.length < wantCount) {
      if (this._earningsRotation.length === 0) {
        // Cycle exhausted mid-batch (small ticker catalog) — reshuffle
        // and keep drawing so a single hand can span a rotation roll.
        this._refillEarningsRotation()
        if (this._earningsRotation.length === 0) break
      }
      const symbol = this._earningsRotation.shift()
      const stock = this.stocks.get(symbol)
      if (!stock || stock.rugged) continue
      batch.push(this._makeEarningsEvent(stock, handIndex))
    }
    this.upcomingEarnings = batch
    this.nextEarningsAtHand = handIndex + EARNINGS_INTERVAL_HANDS
    if (batch.length === 0) return
    // 2026-05: earnings announcements no longer push into the table
    // chat — players asked for clean chat with no market noise. The
    // Earnings tab is the canonical surface (it has a 🔔 badge on
    // the tab label and per-event cards), so the chat-spam is gone.
  }

  // Build a single earnings event for the given stock. Pulled out
  // of _queueEarnings so the batch loop stays readable and tests
  // can drive the event-shape directly.
  _makeEarningsEvent(stock, handIndex) {
    const beatOdds = Math.round(
      (ANALYST_ODDS_RANGE[0] + Math.random() * (ANALYST_ODDS_RANGE[1] - ANALYST_ODDS_RANGE[0])) * 100
    ) / 100
    const kind = stock.kind || 'main'
    const band = IV_BANDS[kind] || IV_BANDS.main
    const ivUp   = band.up[0]   + Math.random() * (band.up[1]   - band.up[0])
    const ivDown = band.down[0] + Math.random() * (band.down[1] - band.down[0])
    return {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      kind,
      beatOdds,
      ivUp,
      ivDown,
      spotAtAnnouncement: stock.price,
      announcedAtHand: handIndex,
      resolvesAtHand: handIndex + 1,
    }
  }

  // Resolve the queued earnings event. Direction is sampled against
  // beatOdds; magnitude is sampled from the kind's IV band and then
  // scaled by an analyst-surprise factor so "priced-in" events
  // produce smaller candles than "unexpected" ones.
  _resolveEarnings(event) {
    // Backwards compat: older queues stored just the symbol string.
    // Promote it to a default event using the current spot + the
    // stock's kind band so a single old-shape entry still resolves.
    if (typeof event === 'string') {
      const s = this.stocks.get(event)
      if (!s) return
      const band = IV_BANDS[s.kind || 'main'] || IV_BANDS.main
      event = {
        symbol: event,
        name: s.name,
        kind: s.kind || 'main',
        beatOdds: 0.5,
        ivUp: band.up[0] + (band.up[1] - band.up[0]) / 2,
        ivDown: band.down[0] + (band.down[1] - band.down[0]) / 2,
        spotAtAnnouncement: s.price,
      }
    }
    const stock = this.stocks.get(event.symbol)
    if (!stock) return
    const beatOdds = Math.max(0, Math.min(1, event.beatOdds ?? 0.5))
    const isBeat = Math.random() < beatOdds
    // Surprise = how unexpected the OUTCOME was given the odds.
    //   beat with low odds → high surprise
    //   miss with high odds → high surprise
    const surprise = isBeat ? (1 - beatOdds) : beatOdds
    const scale = SURPRISE_SCALE_MIN + SURPRISE_SCALE_RANGE * surprise
    // Base magnitude sampled uniformly within the IV band, then
    // scaled by surprise.
    const ivBand = isBeat ? [0, event.ivUp ?? 0.1] : [0, event.ivDown ?? 0.1]
    const base = ivBand[0] + Math.random() * (ivBand[1] - ivBand[0])
    const mag = base * scale
    const signed = isBeat ? mag : -mag
    const newPrice = Math.max(1, Math.round(stock.price * (1 + signed) * 100) / 100)
    stock.price = newPrice
    pushHistory(stock, newPrice)
    // Label the candle for the system-message headline. Magnitudes
    // are bucketed against the IV band's TOP end so "blowout" reads
    // as a near-full IV move regardless of stock kind.
    const refIv = isBeat ? (event.ivUp ?? 0.1) : (event.ivDown ?? 0.1)
    const sizeFrac = refIv > 0 ? mag / refIv : 0
    const label = sizeFrac >= 0.80 ? 'rocket'
                : sizeFrac >= 0.55 ? 'blowout'
                : sizeFrac >= 0.25 ? 'moderate'
                : 'meh'
    const pctText = `${(signed * 100).toFixed(1)}%`
    // 2026-05: earnings resolution candle no longer pushes into the
    // table chat. The Earnings tab + the spot price on the stock card
    // are the canonical surfaces — players who don't care about
    // markets shouldn't see market chatter at all.
    void label; void isBeat; void pctText
  }

  buildSnapshot(playerId) {
    const stocks = [...this.stocks.values()].map(s => ({
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      // kind: 'main' | 'meme' | 'penny' — exposed so the client can
      // render the right ticker (fastest-gain/loss lists separate the
      // thin-float meme/penny tier from the deep main tier).
      kind: s.kind || 'main',
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
    if (player && bag) {
      let proceeds = 0
      for (const [symbol, pos] of bag) {
        const s = this.stocks.get(symbol)
        if (!s) continue
        proceeds += Math.floor(pos.shares * s.price)
      }
      player.bankBalance = (player.bankBalance || 0) + proceeds
    }
    this.holdings.delete(playerId)
    this.sabotageCooldowns.delete(playerId)
  }
}

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
// Per-hand anonymous coin mint. The market keeps spawning fresh meme
// tickers every hand so there's always new candy to chase — and any
// player-launched coin blends into the same stream so other players
// can't tell which is which. Capped so the universe doesn't bloat
// indefinitely; the oldest auto-mints retire when we breach.
const AUTO_MINT_PER_HAND_MIN = 1
const AUTO_MINT_PER_HAND_MAX = 3
const SCAM_COIN_CAP = 18              // hard cap on simultaneous scam coins
// Owner's rug bonus as a fraction of outsiders' total cost basis.
// Bumped 0.30 → 0.60 in 2026-05 alongside the change that wipes
// holders' positions entirely (see rugPull). The trolling has to
// be worth pulling the trigger.
const RUG_KEEP_PERCENT = 0.60
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
    if (player && bag) {
      for (const [coinId, pos] of bag) {
        const coin = this.coins.get(coinId)
        if (!coin || pos.shares <= 0) continue
        const proceeds = Math.floor(pos.shares * coin.price)
        if (proceeds > 0) player.bankBalance = (player.bankBalance || 0) + proceeds
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
      // Top holders — sort by current share count, take top 5.
      //
      // Anonymity rule for player-minted coins: when the viewer is NOT
      // the coin's owner, we exclude the owner from this list entirely.
      // The owner always holds the lion's share of float (mint allocates
      // 50-100% to them), which would otherwise tip off non-owners that
      // a real player launched this coin. Excluding them makes the
      // top-holders panel look like a typical "few small buyers, no
      // whale" auto-minted scam coin.
      const isOwnCoinForViewer = forPlayerId && coin.ownerId === forPlayerId
      const hideOwnerFromHolders = coin.kind === 'player' && !isOwnCoinForViewer
      const holders = []
      for (const [pid, bag] of this.holdings) {
        if (hideOwnerFromHolders && pid === coin.ownerId) continue
        const pos = bag.get(coin.id)
        if (!pos || pos.shares <= 0) continue
        const p = this._findPlayer(pid)
        holders.push({
          playerId: pid,
          username: p?.username || 'gone',
          shares: round4(pos.shares),
          value: Math.round(pos.shares * coin.price)
        })
      }
      holders.sort((a, b) => b.value - a.value)
      const topHolders = holders.slice(0, 5)
      // Market cap estimate. Player coins know their supply; base/scam
      // coins use the liquidity as a proxy so the number feels "real".
      const marketCap = coin.kind === 'player'
        ? Math.round(coin.price * (coin.totalSupply || 0))
        : Math.round(coin.liquidity * 2)
      // 2026-05: disguise player coins from non-owners. The whole
      // grift only works if other players think it's just another
      // scam meme coin — so for outside viewers we lie about `kind`
      // and strip ownerId / ownerName / totalSupply. The owner still
      // sees their own coin's owner fields so they can rug it.
      const isOwnCoin = forPlayerId && coin.ownerId === forPlayerId
      const reportedKind = coin.kind === 'player' && !isOwnCoin ? 'scam' : coin.kind
      coins.push({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        kind: reportedKind,
        price: round4(coin.price),
        prevPrice: round4(coin.prevPrice),
        history: coin.history.slice(),
        ownerId: isOwnCoin ? coin.ownerId : null,
        ownerName: isOwnCoin ? coin.ownerName : null,
        ownerShares: isOwnCoin ? round4(coin.ownerShares) : null,
        totalSupply: isOwnCoin ? coin.totalSupply : null,
        rugged: !!coin.rugged,
        createdAt: coin.createdAt,
        // Whale-mechanic surface: depth + cap + holders. Drives the
        // "you'll move it X%" preview on the client.
        liquidity: Math.round(coin.liquidity),
        marketCap,
        topHolders,
        holderCount: holders.length
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
    if (coin.rugged) return { success: false, error: 'coin_rugged' }
    const spend = Math.floor(Number(chipsToSpend) || 0)
    if (!Number.isFinite(spend) || spend < MIN_TRADE_CHIPS) {
      return { success: false, error: 'invalid_amount' }
    }
    // Crypto trades hit the bank wallet only — keeps the poker
    // stack untouched so a market move doesn't risk a busted seat.
    if ((player.bankBalance || 0) < spend) return { success: false, error: 'insufficient_chips' }

    const priceAtTrade = coin.price
    const shares = spend / priceAtTrade
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

    player.bankBalance -= spend

    const bag = this._getOrInitBag(playerId)
    const prev = bag.get(coinId) || { shares: 0, costBasis: 0 }
    prev.shares += shares
    prev.costBasis += spend
    bag.set(coinId, prev)

    // Track outsider investment on player coins for the rug bonus.
    if (coin.kind === 'player' && coin.ownerId !== playerId) {
      this._outsideInvested.set(coinId, (this._outsideInvested.get(coinId) || 0) + spend)
    }

    // Apply whale price impact AFTER the trade fills. The buyer gets
    // shares at priceAtTrade; subsequent buyers see the elevated
    // price. Big bankrolls swinging chips around literally move the
    // market here. Broadcast a "you moved the market X%" toast when
    // the impact is meaningful (>1%) so the whale knows they whaled.
    const impact = applyPriceImpact(coin, spend)
    pushHistory(coin, coin.price)
    if (Math.abs(impact) >= 0.01) {
      this._notifyImpact(player, coin, impact, 'buy')
    }

    this._broadcastState({ reason: 'buy' })
    return { success: true, shares: round4(shares), spent: spend, priceImpact: impact, newPrice: coin.price }
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

    const priceAtTrade = coin.price
    const proceeds = Math.floor(toSell * priceAtTrade)
    player.bankBalance = (player.bankBalance || 0) + proceeds

    // Reduce cost basis proportionally — keeps realized vs unrealized
    // accounting honest when the player sells partial size.
    const fraction = toSell / pos.shares
    pos.costBasis = Math.max(0, pos.costBasis - pos.costBasis * fraction)
    pos.shares -= toSell

    if (coin.kind === 'player') {
      coin.outstandingHeld = Math.max(0, coin.outstandingHeld - toSell)
    }

    if (pos.shares <= 0.00001) bag.delete(coinId)

    // Apply downward price impact AFTER the seller cashes out. The
    // seller gets priceAtTrade; the next holder watching the chart
    // sees a candle crash. This is what makes whale dumps brutal —
    // and what makes pump-and-dump viable: pump price, dump on the
    // bagholders chasing the green candle. Liquidity also shrinks on
    // sells, so each successive dump moves the price further.
    const impact = applyPriceImpact(coin, -proceeds)
    pushHistory(coin, coin.price)
    if (Math.abs(impact) >= 0.01) {
      this._notifyImpact(player, coin, impact, 'sell')
    }

    this._broadcastState({ reason: 'sell' })
    return { success: true, shares: round4(toSell), proceeds, priceImpact: impact, newPrice: coin.price }
  }

  // Toast back to the trader when their order moved the market in a
  // visible way (>1% impact). Helps the whale feel like a whale and
  // helps the minnow understand why their trade barely registered.
  _notifyImpact(player, coin, impactFraction, side) {
    const pct = Math.round(impactFraction * 1000) / 10  // one decimal
    const arrow = pct >= 0 ? '↑' : '↓'
    const verb = side === 'buy' ? 'buy' : 'dump'
    player.send({
      type: 'system_message',
      data: {
        message: `🐋 Your $${coin.symbol} ${verb} moved the market ${arrow}${Math.abs(pct).toFixed(1)}% — new price $${coin.price < 1 ? coin.price.toFixed(5) : coin.price.toFixed(2)}.`
      }
    })
  }

  createCoin(playerId, opts = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    if (this.ownerCoinIds.has(playerId)) {
      return { success: false, error: 'already_minted' }
    }
    // Mint fee paid from the bank wallet — same surface as other
    // crypto-market money flows.
    if ((player.bankBalance || 0) < PLAYER_COIN_FEE) {
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

    player.bankBalance -= PLAYER_COIN_FEE

    const id = nextCoinId('coin')
    const meme = generateMemeCoin(id)
    const symbol = requestedName.slice(0, 6) || meme.symbol
    const name = requestedName || meme.name
    const totalSupply = 1_000_000   // 1M shares; lets fractional buys feel chunky
    const ownerShares = totalSupply * keepPercent

    // Player-coin liquidity starts shallow — any decent-sized buyer
    // can pump it, any decent-sized seller can crash it. This is the
    // "shitcoin" feel: huge volatility, tiny capital required to
    // whale your own bag. Owner can pump their own coin then either
    // dump it (sell) for proceeds OR rug it for the bonus.
    const playerLiquidity = Math.max(20_000, Math.floor(startPrice * totalSupply * 0.05))
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
      outstandingHeld: 0,
      liquidity: playerLiquidity,
      impactCap: 0.50
    })
    coin._initialLiquidity = playerLiquidity
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

    // Rug proceeds + bonus land in the bank wallet — all crypto
    // money paths route here, never to the poker stack.
    player.bankBalance = (player.bankBalance || 0) + ownerProceeds + rugBonus

    // 2026-05: actually drain holders. Pre-change, rugging crashed the
    // chart but every outsider could still in theory sell at the floor
    // price and recover ~1% of their position, so the rug felt toothless
    // ("I lost 99% of paper value but my chip count is fine"). Now every
    // non-owner position in this coin is deleted: the chips outsiders
    // already moved into shares at buy-time are now permanently locked.
    // Broadcast a SYSTEM_MESSAGE per drained holder so the table sees
    // what happened, and capture the per-holder amount on the return
    // value for the UI's "you got rugged for $N" toast.
    const drainedHolders = []
    for (const [holderId, holderBag] of this.holdings) {
      if (holderId === playerId) continue
      const pos = holderBag.get(coinId)
      if (!pos || pos.shares <= 0) continue
      drainedHolders.push({
        playerId: holderId,
        shares: pos.shares,
        costBasis: pos.costBasis
      })
      holderBag.delete(coinId)
    }
    // Per-holder system messages — surface the loss visibly. Goes
    // through the room's broadcaster so connected holders see it on
    // their feed even if they had the coin chart closed.
    if (this.broadcast && drainedHolders.length > 0) {
      const symbol = coin.symbol || 'COIN'
      for (const h of drainedHolders) {
        const victim = this._findPlayer(h.playerId)
        if (!victim) continue
        this.broadcast({
          type: 'system_message',
          data: {
            message: `${player.username} rugged $${symbol} — ${victim.username} lost $${h.costBasis.toLocaleString()}.`
          }
        })
      }
    }

    // Crash the coin to penny-stock territory and freeze the owner status.
    coin.price = Math.max(RUG_PRICE_FLOOR, coin.price * 0.01)
    coin.rugged = true
    coin.ownerShares = 0
    coin.ownerId = null
    this.ownerCoinIds.delete(playerId)

    // Flatten history a bit so the chart actually shows the crash candle.
    pushHistory(coin, coin.price)

    // Rug contagion — every OTHER live player coin takes a 10-25%
    // hit because the room loses confidence in the meme-coin market
    // for a few minutes. Base coins (BTC/ETH-style) and scam coins
    // get a smaller 3-6% bump down because crypto-wide vibes sour.
    // Mirrors the "one rug pulls liquidity from everyone else's
    // shitcoin" dynamic of real meme cycles.
    let contagionCount = 0
    for (const other of this.coins.values()) {
      if (other.id === coin.id || other.rugged) continue
      let drop = 0
      if (other.kind === 'player') drop = 0.10 + Math.random() * 0.15
      else if (other.kind === 'scam') drop = 0.03 + Math.random() * 0.03
      else drop = 0.005 + Math.random() * 0.01   // base coins barely flinch
      other.price = Math.max(0.0001, other.price * (1 - drop))
      // Sucking a bit of liquidity out reflects panicked outflows.
      other.liquidity = Math.max(
        (other._initialLiquidity || other.liquidity) * 0.25,
        other.liquidity * (1 - drop * 0.6)
      )
      pushHistory(other, other.price)
      contagionCount += 1
    }
    if (contagionCount > 0) {
      this.broadcast({
        type: 'system_message',
        data: { message: `📉 The $${coin.symbol} rug shook the market. ${contagionCount} other coins dropped on contagion.` }
      })
    }

    this._broadcastState({ reason: 'rug', coinId, by: player.username })
    return {
      success: true,
      ownerProceeds,
      rugBonus,
      totalCollected: ownerProceeds + rugBonus,
      drainedHolders,
      contagionCount
    }
  }

  // Crash any coin in the market by 95% in one tick. Used by the
  // crash_coin item (see ItemEngine). Different from rug: no owner
  // required, no holder drain, no contagion — just a clean candle that
  // tanks the chart. Holders can still try to sell into the floor.
  // Returns `{success, symbol, dropPct, fromPrice, toPrice}` on success.
  crashCoin(coinId) {
    const coin = this.coins.get(coinId)
    if (!coin) return { success: false, error: 'coin_not_found' }
    if (coin.rugged) return { success: false, error: 'already_rugged' }
    const fromPrice = coin.price
    const dropPct = 95
    const toPrice = Math.max(RUG_PRICE_FLOOR, coin.price * 0.05)
    coin.price = toPrice
    pushHistory(coin, coin.price)
    this._broadcastState({ reason: 'crash', coinId })
    return { success: true, symbol: coin.symbol || 'COIN', dropPct, fromPrice, toPrice }
  }

  // Target-player wipe used by the crash_holdings item. Walks the
  // target's holding bag and erases 95% of the SHARES on each open
  // position. The on-chart price is untouched — only this player loses
  // out (think: their wallet got hacked, not the market). Returns
  // `{coins, valueLost}` so the item engine can report a single line.
  crashHoldingsFor(targetId) {
    const bag = this.holdings.get(targetId)
    if (!bag || bag.size === 0) return { coins: 0, valueLost: 0 }
    let hitCount = 0
    let valueLost = 0
    for (const [coinId, pos] of bag) {
      if (!pos || !(pos.shares > 0)) continue
      const coin = this.coins.get(coinId)
      if (!coin) continue
      const before = pos.shares
      const after = before * 0.05
      pos.shares = after
      // Cost basis tracks the original buy total — leave it alone so
      // a sale at the wiped share count shows the realized loss in the
      // P/L badge instead of artificially "reducing" the cost.
      const lostShares = before - after
      valueLost += lostShares * (coin.price || 0)
      hitCount += 1
    }
    if (hitCount > 0) this._broadcastState({ reason: 'crash_holdings', targetId })
    return { coins: hitCount, valueLost }
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

  // Per-hand hook from PokerRoom. Mints 1-3 anonymous scam coins on
  // every hand-end and retires the oldest plain-scam coins when the
  // universe grows past SCAM_COIN_CAP. Player-minted coins are NEVER
  // retired here — only the auto-mint pool churns, so a player's
  // shitcoin survives until they rug it or leave.
  onHandEnd(_handIndex = 0) {
    // 1) Retire the oldest auto-mints if we're over the cap. We never
    //    cull player-launched coins or rugged ones (they're already
    //    dead chart-wise but holders may still be selling dust).
    const sortableAutos = [...this.coins.values()]
      .filter(c => c.kind === 'scam')
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    const wantMint = AUTO_MINT_PER_HAND_MIN
      + Math.floor(Math.random() * (AUTO_MINT_PER_HAND_MAX - AUTO_MINT_PER_HAND_MIN + 1))
    const projectedCount = sortableAutos.length + wantMint
    const overflow = Math.max(0, projectedCount - SCAM_COIN_CAP)
    for (let i = 0; i < overflow && i < sortableAutos.length; i++) {
      const dead = sortableAutos[i]
      this.coins.delete(dead.id)
      this._outsideInvested.delete(dead.id)
      // Any holdings sitting on a retired coin become worthless — we
      // already broadcasted them; clients drop the coin from the list
      // on next snapshot.
    }

    // 2) Mint fresh anonymous coins. Same makeCoin args as the
    //    initial spawn so they're indistinguishable from the day-zero
    //    pool (and from player-launched coins, which also report
    //    kind='scam' to non-owners).
    for (let i = 0; i < wantMint; i++) {
      const id = nextCoinId('scam')
      const meme = generateMemeCoin(id)
      const scamLiquidity = 2_000_000 + Math.random() * 3_000_000
      const coin = makeCoin({
        id,
        symbol: meme.symbol,
        name: meme.name,
        kind: 'scam',
        price: 0.001 + Math.random() * 0.1,
        liquidity: scamLiquidity,
        impactCap: 0.40
      })
      coin._initialLiquidity = scamLiquidity
      this.coins.set(id, coin)
    }

    if (wantMint > 0 || overflow > 0) {
      this._broadcastState({ reason: 'auto_mint' })
    }
  }

  _spawnInitial() {
    for (const tmpl of BASE_COIN_TEMPLATES) {
      const id = nextCoinId('base')
      const baseLiquidity = 50_000_000   // BTC/ETH-style deep market
      const coin = makeCoin({
        id,
        symbol: tmpl.symbol,
        name: tmpl.name,
        kind: 'base',
        price: tmpl.startPrice,
        volatility: tmpl.volatility,
        trendBias: tmpl.trendBias,
        liquidity: baseLiquidity,
        impactCap: 0.20
      })
      coin._initialLiquidity = baseLiquidity
      this.coins.set(id, coin)
    }
    for (let i = 0; i < NUM_SCAM_COINS; i += 1) {
      const id = nextCoinId('scam')
      const meme = generateMemeCoin(id)
      const scamLiquidity = 2_000_000 + Math.random() * 3_000_000
      const coin = makeCoin({
        id,
        symbol: meme.symbol,
        name: meme.name,
        kind: 'scam',
        // Scam coins start at low fractional prices — buyers can grab
        // millions of shares for a small chip outlay, makes pump candles
        // psychologically thrilling.
        price: 0.001 + Math.random() * 0.1,
        liquidity: scamLiquidity,
        impactCap: 0.40
      })
      coin._initialLiquidity = scamLiquidity
      this.coins.set(id, coin)
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
    // ── Whale / price-impact ────────────────────────────────────────
    // `liquidity` is the chip pool backing this market for the price-
    // impact calculation. Big numbers = deep market = small trades
    // barely register. Small numbers = thin market = single buyer can
    // move the price 10-50%. Picked per kind:
    //   base   — $50M+ (BTC/ETH-style: only a billionaire moves it)
    //   scam   — $2-5M  (modest depth, big traders can swing it)
    //   player — $50K seed (any buyer can pump or dump it noticeably)
    // `impactCap` clamps the per-trade % move so a single absurd buy
    // can't 100x the price in one shot — keeps the chart readable.
    liquidity: init.liquidity ?? 1_000_000,
    impactCap: init.impactCap ?? 0.30,
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

// ─── Price-impact engine ─────────────────────────────────────────────────
// Move a coin's price in response to a chip-denominated order. Positive
// chipsDelta = buy pressure; negative = sell pressure. Uses a smoothed
// linear impact model: the % price move = (chipsDelta / liquidity) *
// kind-specific multiplier, clamped to ±impactCap. Liquidity grows on
// buys and shrinks on sells, so a chain of dumps gets WORSE per trade
// (less depth left to absorb the next sell) — i.e., panic-selling a
// thin coin spirals fast. Returns the % impact actually applied so
// callers can broadcast "you moved the market X%" feedback.
function applyPriceImpact(coin, chipsDelta) {
  if (!coin || !Number.isFinite(chipsDelta) || chipsDelta === 0) return 0
  const depth = Math.max(1000, coin.liquidity || 1000)
  // Kind-based amplifier: player coins are the MOST volatile of all.
  // A $100K trade on BTC barely registers; on a scam coin it bumps
  // the chart visibly; on a player meme coin it can 2-3x the price
  // (or crash it 60%). Big enough swings that other players are
  // tempted to YOLO in for the pump — exactly the trap the minter
  // is hoping for.
  const kindMul = coin.kind === 'player' ? 2.4
                : coin.kind === 'scam'   ? 1.0
                : 0.4   // base coins
  const rawImpact = (chipsDelta / depth) * kindMul
  const clamped = Math.max(-coin.impactCap, Math.min(coin.impactCap, rawImpact))
  const newPrice = Math.max(coin.kind === 'player' && coin.rugged ? RUG_PRICE_FLOOR : 0.0001,
    coin.price * (1 + clamped))
  coin.price = newPrice
  // Liquidity adjusts toward the order direction. Buys deposit chips
  // into the pool; sells remove them. Don't let liquidity collapse to
  // zero — clamp at 25% of starting value so the market is still
  // tradeable even after sustained panic sells.
  const liquidityFloor = Math.max(1000, (coin._initialLiquidity || depth) * 0.25)
  coin.liquidity = Math.max(liquidityFloor, depth + chipsDelta)
  return clamped
}

function round4(x) { return Math.round(x * 10000) / 10000 }

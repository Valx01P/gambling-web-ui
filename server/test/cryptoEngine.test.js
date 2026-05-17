import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CryptoMarketEngine } from '../src/crypto/cryptoEngine.js'

// Minimal room stand-in: just exposes `players` + `spectators` maps and a
// broadcast sink. The engine never reaches further into the room.
function makeRoom() {
  const players = new Map()
  const spectators = new Map()
  const sent = []
  return {
    players,
    spectators,
    broadcastSink: sent,
    addPlayer(p) { players.set(p.id, p) },
    addSpectator(p) { spectators.set(p.id, p) },
  }
}

function fakePlayer({ id = 'p1', chips = 10_000, isBot = false } = {}) {
  // 2026-05: crypto money now flows through bankBalance, not chips.
  // Default the bank to whatever caller specified as `chips` so
  // existing test arithmetic keeps working — they're effectively
  // configuring the wallet that the engine touches.
  return {
    id,
    chips,
    bankBalance: chips,
    isBot,
    username: id,
    _sent: [],
    send(msg) { this._sent.push(msg) }
  }
}

function newEngine() {
  const room = makeRoom()
  const engine = new CryptoMarketEngine({
    room,
    broadcast: (msg) => room.broadcastSink.push(msg)
  })
  return { room, engine }
}

test('engine spawns the 6 base coins + scam coins on construction', () => {
  const { engine } = newEngine()
  const coins = [...engine.coins.values()]
  const baseSymbols = coins.filter(c => c.kind === 'base').map(c => c.symbol).sort()
  assert.deepEqual(baseSymbols, ['BTC', 'ETH', 'MATIC', 'TRUMP', 'XMR', 'XRP'])
  assert.ok(coins.some(c => c.kind === 'scam'), 'has at least one scam coin')
  // Initial history is pre-filled so the sparkline renders something even
  // before the first tick. Length should be >= 2 so client buildPath works.
  for (const c of coins) {
    assert.ok(c.history.length >= 2)
  }
})

test('buy → costs chips, mints shares; sell → returns proceeds, clears basis', () => {
  const { room, engine } = newEngine()
  const p = fakePlayer({ chips: 5000 })
  room.addPlayer(p)
  const btc = [...engine.coins.values()].find(c => c.symbol === 'BTC')

  const buy = engine.buy(p.id, btc.id, 600)
  assert.equal(buy.success, true)
  assert.equal(p.bankBalance, 4400)
  const pos = engine.holdings.get(p.id).get(btc.id)
  assert.ok(pos.shares > 0)
  assert.equal(pos.costBasis, 600)

  // Sell the full position. The exact proceeds depend on the price, but
  // they should be within rounding of 600 since we haven't ticked yet.
  const sharesToSell = pos.shares
  const sell = engine.sell(p.id, btc.id, sharesToSell)
  assert.equal(sell.success, true)
  assert.ok(sell.proceeds >= 599 && sell.proceeds <= 601)
  assert.equal(engine.holdings.get(p.id).has(btc.id), false, 'position deleted')
})

test('one-coin-per-player constraint', () => {
  const { room, engine } = newEngine()
  const p = fakePlayer({ chips: 5000 })
  room.addPlayer(p)
  const first = engine.createCoin(p.id, { name: 'AAA', startPrice: 1, keepPercent: 0.8 })
  assert.equal(first.success, true)
  const second = engine.createCoin(p.id, { name: 'BBB', startPrice: 2, keepPercent: 0.9 })
  assert.equal(second.success, false)
  assert.equal(second.error, 'already_minted')
})

test('mint fee is deducted and owner gets allocated shares', () => {
  const { room, engine } = newEngine()
  const p = fakePlayer({ chips: 5000 })
  room.addPlayer(p)
  engine.createCoin(p.id, { name: 'COIN', startPrice: 2, keepPercent: 0.75 })
  assert.equal(p.bankBalance, 5000 - 500, 'mint fee deducted from bank')
  const coinId = engine.ownerCoinIds.get(p.id)
  const coin = engine.coins.get(coinId)
  assert.equal(coin.ownerId, p.id)
  assert.equal(coin.totalSupply, 1_000_000)
  assert.equal(coin.ownerShares, 750_000)
  const bag = engine.holdings.get(p.id).get(coinId)
  assert.equal(bag.shares, 750_000)
})

test('buy on a player coin caps at the available float', () => {
  const { room, engine } = newEngine()
  const owner = fakePlayer({ id: 'owner', chips: 5000 })
  const buyer = fakePlayer({ id: 'buyer', chips: 10_000_000 })
  room.addPlayer(owner)
  room.addPlayer(buyer)
  engine.createCoin(owner.id, { name: 'CAPPED', startPrice: 1, keepPercent: 0.9 })
  // Float = 10% of 1M = 100k shares. At price=1, that's 100k chips max.
  const coinId = engine.ownerCoinIds.get(owner.id)

  const ok = engine.buy(buyer.id, coinId, 50_000)
  assert.equal(ok.success, true)

  // Trying to push past the float should now bounce.
  const tooMuch = engine.buy(buyer.id, coinId, 1_000_000)
  assert.equal(tooMuch.success, false)
  assert.equal(tooMuch.error, 'insufficient_float')
})

test('rug pull: owner cashes out + extracts a cut of outsider cost', () => {
  const { room, engine } = newEngine()
  const owner = fakePlayer({ id: 'owner', chips: 5000 })
  const a = fakePlayer({ id: 'a', chips: 10_000 })
  const b = fakePlayer({ id: 'b', chips: 10_000 })
  room.addPlayer(owner)
  room.addPlayer(a)
  room.addPlayer(b)
  engine.createCoin(owner.id, { name: 'RUG', startPrice: 1, keepPercent: 0.8 })
  const coinId = engine.ownerCoinIds.get(owner.id)
  engine.buy(a.id, coinId, 2000)
  engine.buy(b.id, coinId, 3000)
  const ownerBankBeforeRug = owner.bankBalance
  const result = engine.rugPull(owner.id)
  assert.equal(result.success, true)
  // ownerProceeds = ~current price * owner's shares (very close to 800k
  // chips since price hasn't moved much). Plus the 60% cut of (2000+3000).
  // 2026-05: bonus bumped 0.30 → 0.60 alongside the change that wipes
  // every non-owner position on rug — see cryptoEngine.js RUG_KEEP_PERCENT.
  assert.equal(result.rugBonus, Math.floor(5000 * 0.60))
  assert.ok(owner.bankBalance > ownerBankBeforeRug)
  const coin = engine.coins.get(coinId)
  assert.equal(coin.rugged, true)
  // Outsiders' positions are now WIPED — they lose what they put in.
  assert.equal(engine.holdings.get(a.id)?.get(coinId), undefined)
  assert.equal(engine.holdings.get(b.id)?.get(coinId), undefined)
  // The 2026-05 change reports drained holders on the result so the
  // UI can show "you got rugged for $N" per victim.
  assert.equal(Array.isArray(result.drainedHolders), true)
  assert.equal(result.drainedHolders.length, 2)
  assert.ok(coin.price < 1)
  // Owner can't rug again.
  const again = engine.rugPull(owner.id)
  assert.equal(again.success, false)
})

test('bots cannot trade', () => {
  const { room, engine } = newEngine()
  const bot = fakePlayer({ id: 'bot1', chips: 10_000, isBot: true })
  room.addPlayer(bot)
  const btc = [...engine.coins.values()].find(c => c.symbol === 'BTC')
  const buy = engine.buy(bot.id, btc.id, 100)
  assert.equal(buy.success, false)
  assert.equal(buy.error, 'bots_cannot_trade')
})

test('handlePlayerLeave liquidates holdings into the player\'s bank', () => {
  const { room, engine } = newEngine()
  const p = fakePlayer({ chips: 5000 })
  room.addPlayer(p)
  const btc = [...engine.coins.values()].find(c => c.symbol === 'BTC')
  engine.buy(p.id, btc.id, 1000)
  const bankAfterBuy = p.bankBalance
  engine.handlePlayerLeave(p.id)
  // Liquidated at the current price — bank should come back close to
  // (but not necessarily exactly) the pre-buy total. At minimum the
  // player shouldn't lose bank since no tick has happened.
  assert.ok(p.bankBalance >= bankAfterBuy, 'leave returns some value')
  assert.equal(engine.holdings.has(p.id), false)
})

test('insufficient bank on buy is rejected, no state mutation', () => {
  const { room, engine } = newEngine()
  const p = fakePlayer({ chips: 50 })
  room.addPlayer(p)
  const btc = [...engine.coins.values()].find(c => c.symbol === 'BTC')
  const result = engine.buy(p.id, btc.id, 1000)
  assert.equal(result.success, false)
  assert.equal(result.error, 'insufficient_chips')
  assert.equal(p.bankBalance, 50)
  assert.equal(engine.holdings.has(p.id), false)
})

test('tick moves prices and pushes history', () => {
  const { engine } = newEngine()
  const coin = [...engine.coins.values()][0]
  const before = coin.price
  const histLenBefore = coin.history.length
  engine._tick()
  // Either history grew, or it was already at cap and the head shifted.
  assert.ok(coin.history.length >= histLenBefore)
  // Price typically moves; can occasionally be equal at the floor.
  assert.ok(coin.price > 0)
  // It also pushed the price into history.
  assert.equal(coin.history[coin.history.length - 1], Math.round(coin.price * 10000) / 10000)
  void before
})

test('spectators can trade just like seated players', () => {
  const { room, engine } = newEngine()
  const p = fakePlayer({ chips: 5000 })
  room.addSpectator(p)
  const btc = [...engine.coins.values()].find(c => c.symbol === 'BTC')
  const buy = engine.buy(p.id, btc.id, 200)
  assert.equal(buy.success, true)
  assert.equal(p.bankBalance, 4800)
})

test('getStatePayload scopes myPositions/myCoinId to the requester', () => {
  const { room, engine } = newEngine()
  const a = fakePlayer({ id: 'a', chips: 10_000 })
  const b = fakePlayer({ id: 'b', chips: 10_000 })
  room.addPlayer(a)
  room.addPlayer(b)
  const btc = [...engine.coins.values()].find(c => c.symbol === 'BTC')
  engine.buy(a.id, btc.id, 500)
  const aPayload = engine.getStatePayload(a.id)
  const bPayload = engine.getStatePayload(b.id)
  assert.equal(aPayload.myPositions.length, 1)
  assert.equal(bPayload.myPositions.length, 0)
})

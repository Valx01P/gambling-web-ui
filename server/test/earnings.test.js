import test from 'node:test'
import assert from 'node:assert/strict'

import { StockEngine } from '../src/stocks/stockEngine.js'
import { OptionsEngine } from '../src/stocks/optionsEngine.js'

// Stub room shape — earnings logic doesn't touch the table itself.
function makeRoom() { return { players: new Map(), spectators: new Map() } }

test('earnings: initial batch is seeded in the constructor, 2-6 events', () => {
  const broadcast = () => {}
  const engine = new StockEngine({ room: makeRoom(), broadcast })
  assert.ok(Array.isArray(engine.upcomingEarnings), 'array shape')
  assert.ok(engine.upcomingEarnings.length >= 2 && engine.upcomingEarnings.length <= 6,
    `seeded batch size ${engine.upcomingEarnings.length}`)
  for (const ev of engine.upcomingEarnings) {
    assert.equal(typeof ev.symbol, 'string')
    assert.equal(typeof ev.beatOdds, 'number')
    assert.ok(ev.beatOdds >= 0 && ev.beatOdds <= 1)
    assert.ok(ev.ivUp > 0)
    assert.ok(ev.ivDown > 0)
  }
  // Snapshot carries the full array.
  const snap = engine.buildSnapshot('p1')
  assert.deepEqual(snap.upcomingEarnings, engine.upcomingEarnings)

  // Hand-end resolves the batch AND queues a fresh one.
  const before = engine.upcomingEarnings
  engine.onHandEnd(1)
  assert.notStrictEqual(engine.upcomingEarnings, before, 'new array')
  assert.ok(engine.upcomingEarnings.length >= 2 && engine.upcomingEarnings.length <= 6)
})

test('earnings rotation: every ticker reports once before any repeats', () => {
  const broadcast = () => {}
  const engine = new StockEngine({ room: makeRoom(), broadcast })
  const totalTickers = [...engine.stocks.values()].filter(s => !s.rugged).length
  const seen = new Set()
  let firstRepeatAt = -1
  // Drain through ~3 full cycles. We require that within any single
  // pass of `totalTickers` symbols there are no duplicates.
  let cycleStart = 0
  // Seed batch is already in upcomingEarnings; count those too.
  let symbols = engine.upcomingEarnings.map(e => e.symbol)
  for (let hand = 1; hand <= 200; hand++) {
    for (const sym of symbols) {
      if (seen.has(sym)) {
        if (firstRepeatAt === -1) firstRepeatAt = seen.size
        // Reset for the next cycle the moment we see a repeat —
        // ensures no overlap WITHIN a cycle of `totalTickers`.
        assert.ok(seen.size >= totalTickers,
          `repeat at draw ${seen.size}; expected the full catalog (${totalTickers}) to print first`)
        seen.clear()
        cycleStart = hand
      }
      seen.add(sym)
    }
    engine.onHandEnd(hand)
    symbols = engine.upcomingEarnings.map(e => e.symbol)
  }
  assert.ok(firstRepeatAt >= totalTickers,
    `first repeat must happen on or after the full catalog completes (got ${firstRepeatAt}, catalog=${totalTickers})`)
})

test('IV bands respect stock kind (large cap, meme, penny)', () => {
  const broadcast = () => {}
  const engine = new StockEngine({ room: makeRoom(), broadcast })

  // Sample a bunch of events for each kind to see the band's extremes.
  // We force the symbol by setting upcomingEarnings directly. Tests
  // the resolver, not the random pick.
  const bandFor = (kind) => {
    let minUp = Infinity, maxUp = 0, minDown = Infinity, maxDown = 0
    const stock = [...engine.stocks.values()].find(s => (s.kind || 'main') === kind)
    assert.ok(stock, `seed stock found for kind=${kind}`)
    // Call _makeEarningsEvent directly so we get one fresh event per
    // sample without invoking the batch/rotation machinery.
    for (let i = 0; i < 600; i++) {
      const q = engine._makeEarningsEvent(stock, 0)
      if (q.ivUp < minUp) minUp = q.ivUp
      if (q.ivUp > maxUp) maxUp = q.ivUp
      if (q.ivDown < minDown) minDown = q.ivDown
      if (q.ivDown > maxDown) maxDown = q.ivDown
    }
    return { minUp, maxUp, minDown, maxDown }
  }

  const main  = bandFor('main')
  const meme  = bandFor('meme')
  const penny = bandFor('penny')

  // Main caps: bull 5-40%, bear 5-60%.
  assert.ok(main.minUp >= 0.05 - 1e-9 && main.maxUp <= 0.40 + 1e-9,
    `main up band: got ${main.minUp}..${main.maxUp}`)
  assert.ok(main.minDown >= 0.05 - 1e-9 && main.maxDown <= 0.60 + 1e-9,
    `main down band: got ${main.minDown}..${main.maxDown}`)
  // Meme: up to 1.60 bull, up to 1.00 bear. Big swings.
  assert.ok(meme.maxUp > 0.50, `meme up should reach beyond main (got ${meme.maxUp})`)
  assert.ok(meme.maxUp <= 1.60 + 1e-9)
  // Penny: up to 1.50 bull, up to 1.20 bear.
  assert.ok(penny.maxDown > 0.60, `penny down should overshoot main bear (got ${penny.maxDown})`)
  assert.ok(penny.maxDown <= 1.20 + 1e-9)
})

test('analyst surprise scaling: low-odds beat produces bigger candle than priced-in beat', () => {
  const engine = new StockEngine({ room: makeRoom(), broadcast: () => {} })
  // Pick a deterministic stock + fixed IV so only surprise scaling
  // varies between the two arms.
  const stock = engine.stocks.get('MEGA') || [...engine.stocks.values()][0]
  const sample = (odds) => {
    // Force a beat by stubbing Math.random for the direction roll —
    // first call inside _resolveEarnings is the beat-vs-miss roll;
    // second call is the base-magnitude draw within IV band.
    const originalRandom = Math.random
    const seq = [0.0, 1.0]   // beat (0 < odds) + top of base range
    let idx = 0
    Math.random = () => seq[idx++ % seq.length]
    try {
      const startPrice = stock.price
      const event = {
        symbol: stock.symbol,
        name: stock.name,
        kind: stock.kind,
        beatOdds: odds,
        ivUp: 0.40,
        ivDown: 0.40,
        spotAtAnnouncement: startPrice,
      }
      engine._resolveEarnings(event)
      const pct = (stock.price - startPrice) / startPrice
      stock.price = startPrice  // restore so the next call computes against the same baseline
      return pct
    } finally {
      Math.random = originalRandom
    }
  }

  const pricedIn = sample(0.95)   // 95% odds, low surprise on beat
  const unexpected = sample(0.20) // 20% odds, high surprise on beat
  assert.ok(pricedIn > 0, `priced-in beat is still positive: got ${pricedIn}`)
  assert.ok(unexpected > pricedIn,
    `low-odds beat should outsize priced-in beat (got ${unexpected} vs ${pricedIn})`)
})

test('options premium pumps when symbol is the upcoming earnings ticker', () => {
  const broadcast = () => {}
  const stocks = new StockEngine({ room: makeRoom(), broadcast })
  const options = new OptionsEngine({ room: makeRoom(), broadcast, stockEngine: stocks })

  const target = stocks.stocks.get('MEGA') || [...stocks.stocks.values()][0]
  const before = options._premium({
    type: 'call', price: target.price, strike: target.price,
    volatility: stocks._tick ? target.volatility : target.volatility,
  })

  // Force the symbol to be the upcoming-earnings ticker.
  stocks.upcomingEarnings = {
    symbol: target.symbol,
    beatOdds: 0.5,
    ivUp: 0.20,
    ivDown: 0.20,
  }
  const pumpedVol = options._volatilityFor(target)
  assert.ok(pumpedVol > target.volatility, 'vol pumped during earnings')
  const after = options._premium({
    type: 'call', price: target.price, strike: target.price,
    volatility: pumpedVol,
  })
  assert.ok(after > before * 1.3,
    `pumped premium should be markedly higher than baseline (got ${after} vs ${before})`)

  // Resolve: upcomingEarnings clears → vol returns to baseline.
  stocks.upcomingEarnings = { symbol: 'OTHER_TICKER', beatOdds: 0.5, ivUp: 0.1, ivDown: 0.1 }
  const crushedVol = options._volatilityFor(target)
  assert.equal(crushedVol, target.volatility, 'IV crush returns to baseline')
})

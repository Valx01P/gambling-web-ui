// Price-tick logic for the three coin "personalities".
//
//   base   — established coins (BTC, ETH, etc). Moderate vol, mean-reverts
//            toward a slow-drifting anchor. Looks like a real chart.
//   scam   — meme coins. Run through regime states (pump / dump / flat /
//            bleed / crab / rise / crash) that switch every N seconds.
//            Massive swings, no mean reversion.
//   player — user-minted coin. Stability scales with how much of the supply
//            the owner still holds. 100% owner-held = nearly flat;
//            ownership diluted = rapidly more volatile.
//
// All ticks return the new price. The caller pushes prevPrice + history.

const HISTORY_LEN = 60

// Clamp a price to a sane floor. We never let a coin's price hit literal
// zero — sell math needs a non-zero denominator, and a "rugged" coin should
// still be visible as a near-flatline penny stock.
const PRICE_FLOOR = 0.0001

function clampPrice(p) {
  if (!Number.isFinite(p)) return PRICE_FLOOR
  return Math.max(PRICE_FLOOR, p)
}

function gauss() {
  // Box-Muller. One sample per call — we throw away the second.
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ─── Base coins ─────────────────────────────────────────────────────────────

export function tickBaseCoin(coin) {
  // Slow anchor drift (long-term trend) + per-tick Gaussian noise scaled
  // by the coin's volatility, with mild mean-reversion toward the anchor.
  const anchor = coin.anchor ?? coin.price
  const drift = (coin.trendBias || 0) * anchor
  const noise = gauss() * (coin.volatility || 0.015) * anchor
  const reversion = (anchor - coin.price) * 0.02
  let next = coin.price + drift + noise + reversion
  // Anchor drifts ~0.5% per tick of the current price; over a session this
  // produces visible secular trends without runaway prices.
  coin.anchor = anchor + (next - anchor) * 0.005
  return clampPrice(next)
}

// ─── Scam meme coins ────────────────────────────────────────────────────────

const SCAM_REGIMES = [
  // [name, ticksMin, ticksMax, perTickReturn, vol]
  ['pump',  10, 30,  0.040, 0.060],   // sharp rip
  ['dump',  10, 30, -0.045, 0.060],   // sharp dump
  ['crash', 3,  8,  -0.150, 0.030],   // capitulation candle
  ['rise',  20, 60,  0.012, 0.025],   // steady uptrend
  ['bleed', 30, 90, -0.008, 0.020],   // slow death
  ['crab',  20, 60,  0.000, 0.030],   // sideways with chop
  ['flat',  10, 30,  0.000, 0.005]    // dead-flat (deceptive calm)
]

function pickRegime(coin) {
  // Slight bias toward "crab" / "bleed" so most coins look like garbage
  // most of the time, punctuated by pumps. Real meme markets behave the
  // same way.
  const r = Math.random()
  if (r < 0.25) return SCAM_REGIMES[5]  // crab
  if (r < 0.45) return SCAM_REGIMES[4]  // bleed
  if (r < 0.60) return SCAM_REGIMES[0]  // pump
  if (r < 0.72) return SCAM_REGIMES[1]  // dump
  if (r < 0.82) return SCAM_REGIMES[3]  // rise
  if (r < 0.92) return SCAM_REGIMES[6]  // flat
  return SCAM_REGIMES[2]                // crash
}

export function tickScamCoin(coin) {
  if (!coin.regimeName || coin.regimeTicksLeft <= 0) {
    const [name, tMin, tMax, drift, vol] = pickRegime(coin)
    coin.regimeName = name
    coin.regimeDrift = drift
    coin.regimeVol = vol
    coin.regimeTicksLeft = Math.floor(tMin + Math.random() * (tMax - tMin))
  }
  const drift = coin.regimeDrift * coin.price
  const noise = gauss() * coin.regimeVol * coin.price
  coin.regimeTicksLeft -= 1
  return clampPrice(coin.price + drift + noise)
}

// ─── Player-minted coins ────────────────────────────────────────────────────
//
// Stability is keyed off the owner's holdings ratio. Owner holds ≥80% of
// supply → very stable (low vol, slight upward drift). As that drops to
// 50% → behaves like a base coin. Below 30% → behaves more like a meme,
// since "the owner can dump at any second".
//
// Rugged coins ignore all of this and just decay toward zero.

export function tickPlayerCoin(coin) {
  if (coin.rugged) {
    // Slow bleed of remaining dust + a chance of one last spike for the
    // bag holders' amusement. Capped near zero.
    const noise = gauss() * 0.05 * coin.price
    return clampPrice(coin.price * 0.985 + noise)
  }
  const ownerRatio = coin.totalSupply > 0
    ? Math.max(0, Math.min(1, coin.ownerShares / coin.totalSupply))
    : 1
  // Volatility goes from 0.005 (100% held) to 0.05 (0% held).
  const vol = 0.005 + (1 - ownerRatio) * 0.045
  // Slight upward bias when owner-held → keeps the owner's "narrative" alive.
  const drift = (ownerRatio * 0.002 - 0.0005) * coin.price
  const noise = gauss() * vol * coin.price
  return clampPrice(coin.price + drift + noise)
}

export function pushHistory(coin, newPrice) {
  coin.prevPrice = coin.price
  coin.price = newPrice
  coin.history.push(Math.round(newPrice * 10000) / 10000)
  if (coin.history.length > HISTORY_LEN) coin.history.shift()
}

export { HISTORY_LEN }

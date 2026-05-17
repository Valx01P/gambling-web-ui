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

// Regime catalog for the volatile "scam" / player coins. Each entry is
// [name, ticksMin, ticksMax, perTickReturn, vol]. Multi-tick regimes
// compound — a 10-tick "rocket" at +50%/tick is roughly 57× the
// starting price; a 6-tick "moon" at +100% is ~64×. The probabilities
// in pickRegime() keep these rare so the meme market still feels like
// "most coins are shit" with occasional life-changing candles.
const SCAM_REGIMES = [
  // ── steady-state / chop ───────────────────────────────────────
  ['pump',  10, 30,  0.040, 0.060],   // sharp rip
  ['dump',  10, 30, -0.045, 0.060],   // sharp dump
  ['crash', 3,  8,  -0.150, 0.030],   // capitulation candle
  ['rise',  20, 60,  0.012, 0.025],   // steady uptrend
  ['bleed', 30, 90, -0.008, 0.020],   // slow death
  ['crab',  20, 60,  0.000, 0.030],   // sideways with chop
  ['flat',  10, 30,  0.000, 0.005],   // dead-flat (deceptive calm)
  // ── extreme regimes — the once-in-a-session candles ───────────
  ['rocket',   6, 14,  0.50, 0.18],   // 1000%+ in a handful of ticks
  ['moon',     3,  7,  1.00, 0.30],   // 10,000%+ — life-changing
  ['parabolic',8, 18,  0.20, 0.12],   // sustained ladder, ~500-2000%
  ['implosion',4,  9, -0.40, 0.20],   // -95% over a few ticks
  ['ragdoll', 12, 28,  0.05, 0.35],   // huge chop, slight upward drift
]

function pickRegime(coin) {
  // Most coins crab / bleed most of the time. Extreme regimes are
  // rare-but-present so the market always has a few rip-or-rug stories.
  const r = Math.random()
  if (r < 0.22) return SCAM_REGIMES[5]   // crab
  if (r < 0.38) return SCAM_REGIMES[4]   // bleed
  if (r < 0.52) return SCAM_REGIMES[0]   // pump
  if (r < 0.62) return SCAM_REGIMES[1]   // dump
  if (r < 0.72) return SCAM_REGIMES[3]   // rise
  if (r < 0.80) return SCAM_REGIMES[6]   // flat
  if (r < 0.86) return SCAM_REGIMES[2]   // crash
  // ── extreme tail (~14% combined) ────────────────────────────
  if (r < 0.92) return SCAM_REGIMES[11]  // ragdoll (chop)
  if (r < 0.95) return SCAM_REGIMES[9]   // parabolic
  if (r < 0.97) return SCAM_REGIMES[7]   // rocket — ~2%
  if (r < 0.99) return SCAM_REGIMES[10]  // implosion
  return SCAM_REGIMES[8]                  // moon — ~1%
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
// 2026-05: player coins now share the SAME regime engine as scam coins
// (pump / dump / crash / rocket / moon / etc). This is what makes the
// "anonymous shitcoin" mix work — other players can't tell from the
// price chart whether a coin was auto-minted or manually launched.
//
// Rugged coins skip regimes and just decay toward zero.

export function tickPlayerCoin(coin) {
  if (coin.rugged) {
    // Slow bleed of remaining dust + a chance of one last spike for
    // the bag holders' amusement. Capped near zero.
    const noise = gauss() * 0.05 * coin.price
    return clampPrice(coin.price * 0.985 + noise)
  }
  return tickScamCoin(coin)
}

export function pushHistory(coin, newPrice) {
  coin.prevPrice = coin.price
  coin.price = newPrice
  coin.history.push(Math.round(newPrice * 10000) / 10000)
  if (coin.history.length > HISTORY_LEN) coin.history.shift()
}

export { HISTORY_LEN }

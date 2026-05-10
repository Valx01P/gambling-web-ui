// Code template emitted by the player-clone bot generator.
//
// Two parts:
//   * `renderCloneBotCode(profile, displayName)` — substitutes the user's
//     derived knobs (call/value thresholds, c-bet freq, open size, etc.)
//     into a fixed code skeleton, then returns the resulting JS string.
//   * `CLONE_BOT_BODY` — the static decision tree itself, written in plain
//     JS so a curious user can read it and tune in the editor.
//
// IMPORTANT: the bot sandbox wraps `${code}` and looks for a top-level
// `decide` function. Do NOT include `return decide(ctx)` at the end — that
// would be a SyntaxError in strict mode and bot would fall back to
// "fold facing any bet" (which is what the user was hitting).

// Static decision tree — substituted with the per-bot constants above. Uses
// only fields that exist on the live ctx (see signals.js): handStrengthScore,
// equity (range-aware), opponents[].stats, lastAggressor, position, etc.
const CLONE_BOT_BODY = `
// --- Hand-strength tiers (fixed — calibrated to preflopHandScore) -------
// AA = 1.00, KK ≈ 0.96, QQ ≈ 0.92, JJ ≈ 0.88, AKs ≈ 0.71, AKo ≈ 0.64,
// 22 ≈ 0.55. Use these instead of magic numbers in the body.
const HS_PREMIUM  = 0.85   // QQ+, AK
const HS_STRONG   = 0.65   // JJ-TT, KQs
const HS_MEDIUM   = 0.50   // mid pairs, broadways
const HS_PLAYABLE = 0.40   // suited connectors, weak Ax
const HS_TRASH    = 0.30

// --- Helpers ------------------------------------------------------------

// Mulberry32-style mash. Deterministic per (hand, seat, salt) so c-bet and
// bluff frequencies actually mix instead of firing every time, but two
// clones at the same table won't synchronize their RNG.
function chance(ctx, salt) {
  const seed = (ctx.handIndex || 0) ^ ((ctx.me?.seat || 0) * 31) ^ salt
  let t = (seed * 0x9e3779b1) | 0
  t = (t ^ (t >>> 16)) * 0x85ebca6b
  t = (t ^ (t >>> 13)) * 0xc2b2ae35
  t = t ^ (t >>> 16)
  return ((t >>> 0) / 4294967296)
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
function safeRaise(ctx, target) {
  const t = Math.max(ctx.minRaiseTarget || ctx.bigBlind, Math.floor(target))
  return { action: 'raise', amount: clamp(t, ctx.minRaiseTarget || ctx.bigBlind, ctx.maxRaiseTarget || t) }
}
function pot(ctx) { return Math.max(ctx.potSize || 0, ctx.bigBlind || 10) }

// Snapshot of opponents for *this hand*. Each opponent's vpip / aggression
// frequency / showdown-win rate comes straight from ctx.opponents[i].stats —
// the engine has been counting actions across the session.
function readOpponents(ctx) {
  const active = (ctx.opponents || []).filter(o => o && !o.folded)
  if (active.length === 0) return { count: 0, avgVpip: 0.3, avgAggr: 0.15, fishyCount: 0, maniacCount: 0, nittyCount: 0 }
  let vpipSum = 0, aggrSum = 0, fishy = 0, maniacs = 0, nits = 0
  for (const o of active) {
    const v = (o.stats?.vpip ?? 0.3)
    const a = (o.stats?.aggressionFreq ?? 0.15)
    const seenEnough = (o.stats?.handsObserved ?? 0) >= 6
    vpipSum += v; aggrSum += a
    if (seenEnough) {
      if (v >= 0.50) maniacs++
      else if (v <= 0.18) nits++
      // "Fishy" = high VPIP, low aggression — calls everything, doesn't bet.
      if (v >= 0.40 && a <= 0.15) fishy++
    }
  }
  return {
    count: active.length,
    avgVpip: vpipSum / active.length,
    avgAggr: aggrSum / active.length,
    fishyCount: fishy,
    maniacCount: maniacs,
    nittyCount: nits
  }
}

// Estimate the most likely opponent range tightness (0-1, smaller = tighter).
// Pulled from the engine's range inference if present, else inferred from
// the largest preflop aggressor's profile.
function tablePressure(ctx) {
  const opps = (ctx.opponents || []).filter(o => !o.folded)
  if (opps.length === 0) return 1
  // estimatedTopPct is set by signals.js when range inference runs.
  const tightest = Math.min(...opps.map(o => o.estimatedTopPct ?? 1))
  return tightest
}

// --- Decision: preflop -------------------------------------------------

function decidePreflop(ctx) {
  const score = ctx.handStrengthScore ?? 0
  const eq = ctx.equity ?? 0.5
  const opp = readOpponents(ctx)
  const pos = ctx.position
  const isLatePos = pos === 'btn' || pos === 'co' || pos === 'late'
  const isBlind = pos === 'sb' || pos === 'bb'

  // BB free option: never fold for free. Either raise with a real hand or
  // check the option to see a free flop. This was the fix for "BB folds
  // when no one raised" — a bot should *always* take the free flop.
  if (ctx.toCall === 0 && pos === 'bb') {
    if (score >= HS_STRONG) return safeRaise(ctx, OPEN_BB * (ctx.bigBlind || 10))
    return { action: 'check' }
  }

  // SB completion: 0.5 BB to call. Wide range for value of seeing a flop
  // closer to in-position (dealer is acting last after the flop in HU/SB
  // vs BB scenarios is a wash, but completing is fine).
  if (pos === 'sb' && ctx.toCall <= ctx.bigBlind) {
    if (score >= HS_PREMIUM) return safeRaise(ctx, Math.max(3, OPEN_BB) * (ctx.bigBlind || 10))
    if (score >= HS_PLAYABLE) return { action: 'call' }
    if (chance(ctx, 7) < 0.30 && score >= HS_TRASH) return { action: 'call' } // mix in some defense
    return { action: 'fold' }
  }

  // Facing a raise: fold trash, call playable, 3-bet premium / when range
  // tight against raiser.
  if (ctx.facingBet) {
    // PREMIUM hands always go in. Don't fold AA/KK to anything.
    if (score >= HS_PREMIUM) {
      const tgt = Math.max(ctx.minRaiseTarget, ctx.currentBet * 3)
      return safeRaise(ctx, tgt)
    }
    // Strong vs a typical opener: 3-bet for value. Vs a 3-bet itself, cooler — call.
    if (score >= HS_STRONG) {
      const isThreeBetSpot = ctx.aggressionCount >= 2
      if (isThreeBetSpot) return { action: 'call' }
      if (chance(ctx, 11) < 0.6) {
        return safeRaise(ctx, ctx.currentBet * 3)
      }
      return { action: 'call' }
    }
    // Medium hands: pot-odds gate. Only call if the price is right.
    if (score >= HS_MEDIUM) {
      if (eq >= CALL_EQ || ctx.potOdds <= 0.25) return { action: 'call' }
      return { action: 'fold' }
    }
    // Marginal hands: only call if it's heads up + cheap (<=20% pot odds)
    // OR equity is unexpectedly OK against a wide aggressor.
    if (score >= HS_PLAYABLE && ctx.potOdds <= 0.18 && opp.count <= 2) {
      return { action: 'call' }
    }
    return { action: 'fold' }
  }

  // Open spot (folded to us) — position matters a lot.
  // Late position opens wider; UTG/MP plays only its tightest range.
  let openCutoff = 1 - PFR_PCT  // baseline = the user's PFR percentile
  if (pos === 'utg' || pos === 'mp')      openCutoff = Math.max(openCutoff, 1 - PFR_PCT * 0.6)
  else if (isLatePos)                     openCutoff = Math.max(0, openCutoff - 0.05)
  // Steal opportunity: against tight blinds, raise wider.
  if (isLatePos && opp.nittyCount >= 1 && chance(ctx, 13) < 0.6) {
    openCutoff = Math.max(0, openCutoff - 0.10)
  }

  if (score >= openCutoff) {
    return safeRaise(ctx, OPEN_BB * (ctx.bigBlind || 10))
  }
  // Limp range — only really mix this if the user limps a lot (loose passive).
  if (score >= 1 - VPIP_PCT && ctx.toCall > 0 && ctx.toCall <= ctx.bigBlind) {
    return { action: 'call' }
  }
  return ctx.toCall === 0 ? { action: 'check' } : { action: 'fold' }
}

// --- Decision: postflop ------------------------------------------------

function decidePostflop(ctx) {
  const eq = ctx.equity ?? 0.5
  const opp = readOpponents(ctx)
  const pressure = tablePressure(ctx)
  // Adjust call threshold by table profile:
  //   Maniacs at table → call lighter (more bluffs to catch)
  //   Nits at table → call heavier (less bluffs to catch)
  let callTarget = CALL_EQ
  if (opp.maniacCount >= 1) callTarget -= 0.06
  if (opp.nittyCount >= 1)  callTarget += 0.05
  if (pressure < 0.10)      callTarget += 0.10  // they showed major strength

  // Value-bet target similarly drifts.
  let valueTarget = VALUE_EQ
  if (opp.fishyCount >= 1) valueTarget -= 0.05  // thin-value vs callers
  if (opp.nittyCount >= 1) valueTarget += 0.04  // slow down vs nits

  const wasAggressor = ctx.lastAggressor && ctx.lastAggressor.isMe
  const board = (ctx.communityCards || []).length

  // No bet to face — choice between check, value bet, c-bet, bluff, or trap.
  if (!ctx.facingBet) {
    // 1. Strong made hand → bet for value (size based on POT_BET).
    if (eq >= valueTarget) {
      return safeRaise(ctx, ctx.currentBet + Math.floor(pot(ctx) * POT_BET))
    }
    // 2. C-bet: we were the preflop aggressor and the flop is dryish. We
    //    fire a smaller-than-pot bet most of the time per C_BET_FREQ.
    if (wasAggressor && board === 3 && chance(ctx, 17) < C_BET_FREQ) {
      const sz = Math.floor(pot(ctx) * (POT_BET * 0.85))
      return safeRaise(ctx, ctx.currentBet + sz)
    }
    // 3. Steal vs scared-money: if the active opponents fold a lot to bets
    //    (low W$SD or high foldsToBet), pressure them more often.
    const easyFolders = (ctx.opponents || []).filter(o =>
      !o.folded && (o.stats?.foldsToBet ?? 0) >= 2 && (o.stats?.handsObserved ?? 0) >= 6
    ).length
    if (easyFolders >= 1 && eq >= 0.30 && chance(ctx, 19) < BLUFF_FREQ + 0.10) {
      return safeRaise(ctx, ctx.currentBet + Math.floor(pot(ctx) * 0.55))
    }
    // 4. Pure bluff (rare) when we have backdoor outs.
    const draws = ctx.draws || {}
    const hasOuts = (draws.outs ?? 0) >= 4
    if (hasOuts && eq >= 0.20 && chance(ctx, 23) < BLUFF_FREQ * 0.7) {
      return safeRaise(ctx, ctx.currentBet + Math.floor(pot(ctx) * 0.5))
    }
    return { action: 'check' }
  }

  // Facing a bet --------------------------------------------------------

  // Premium-equity raise for value (or to fold out worse hands).
  if (eq >= valueTarget + 0.05) {
    const sz = Math.floor(pot(ctx) * 0.75)
    return safeRaise(ctx, ctx.currentBet + sz)
  }

  // Re-raise as a bluff vs an aggressor we've seen bluff before. Use their
  // postflop aggression frequency + low W$SD as a "they bluff a lot" signal.
  const villain = ctx.lastAggressor
  const villainStats = (ctx.opponents || []).find(o => o.id === villain?.id)?.stats
  const villainBluffsLots = villainStats &&
    (villainStats.aggressionFreq ?? 0) >= 0.30 &&
    (villainStats.wonAtShowdownRate ?? 0.5) <= 0.40 &&
    (villainStats.handsObserved ?? 0) >= 8
  if (villainBluffsLots && eq >= 0.40 && chance(ctx, 29) < 0.45) {
    const sz = Math.floor(pot(ctx) * 0.85)
    return safeRaise(ctx, ctx.currentBet + sz)
  }

  // Standard call when equity beats threshold OR when pot odds make it +EV.
  // ctx.potOdds = toCall / (pot + toCall). We need eq >= potOdds to call
  // profitably; we add a small cushion for implied-odds optimism.
  if (eq >= callTarget) return { action: 'call' }
  if (eq >= ctx.potOdds + 0.04) return { action: 'call' }

  // Draws: if we have substantial outs (open-ended + flush draw etc.) and
  // the price is small relative to the pot, peel one street.
  const draws = ctx.draws || {}
  if ((draws.outs ?? 0) >= 8 && ctx.potOdds <= 0.30) return { action: 'call' }

  return { action: 'fold' }
}

function decide(ctx) {
  // Sanity: if we're not in a hand yet, just check.
  if (!ctx.streetIsPreflop && !ctx.streetIsPostflop) return { action: 'check' }
  // All-in and only one decision left: if we can check, check; else gamble.
  if (ctx.facingAllIn) {
    const eq = ctx.equity ?? 0.5
    if (eq >= 0.55) return { action: 'call' }   // call as favorite
    if (eq >= ctx.potOdds + 0.05) return { action: 'call' } // priced in
    return { action: 'fold' }
  }
  return ctx.streetIsPreflop ? decidePreflop(ctx) : decidePostflop(ctx)
}
`

// Substitutes the per-bot constants. We don't escape `${`-like tokens in
// CLONE_BOT_BODY because the body uses regular JS syntax — the user's
// editor won't see template-literal markers.
export function renderCloneBotCode(profile, displayName) {
  const f2 = (n) => Number(n).toFixed(2)
  const f1 = (n) => Number(n).toFixed(1)
  const pct = (n) => `${Math.round(n * 100)}%`

  const header = `// ${displayName}'s clone — generated from your last ${profile.seated} hands.
// Style: ${profile.vpipStyle} / ${profile.aggStyle}.
// VPIP ${pct(profile.vpipRate)} · PFR ${pct(profile.pfrRate)} · AggrFactor ${f1(profile.aggrFactor)}
// Avg open ${f1(profile.avgOpenSizeBB)}bb · WTSD ${pct(profile.wtsdRate)} · W$SD ${pct(profile.wsdRate)}
// c-bet freq ${pct(profile.cBetFreq)} · bluff freq ${pct(profile.bluffFreq)}
//
// Knobs are derived from your real play — edit any constant to deviate. The
// bot reads ctx.equity / ctx.handStrengthScore / ctx.opponents[].stats so it
// adapts to whoever it's playing against, not just to a static threshold.`

  const constants = `
// --- Tunable knobs (data-derived) -------------------------------------
// Equity (0-1) needed to continue facing a bet. Looser styles call lighter.
const CALL_EQ    = ${f2(profile.callThreshold)}
// Equity needed to raise/bet for value postflop.
const VALUE_EQ   = ${f2(profile.valueThreshold)}
// Preflop open size in BB.
const OPEN_BB    = ${f1(profile.openSize)}
// Postflop bet size as a fraction of the pot.
const POT_BET    = ${f2(profile.postBetSize)}
// How often you continuation-bet after raising preflop.
const C_BET_FREQ = ${f2(profile.cBetFreq)}
// How often you bluff weak hands postflop.
const BLUFF_FREQ = ${f2(profile.bluffFreq)}
// Top % of preflop hands you'd call/play voluntarily.
const VPIP_PCT   = ${f2(profile.vpipPlayCutoff)}
// Top % you'd open-raise. Tighter than VPIP.
const PFR_PCT    = ${f2(profile.pfrCutoff)}
`

  // NOTE: no `return decide(ctx)` at the end — that's a top-level return
  // and would be a SyntaxError. The sandbox finds `decide` directly.
  return `${header}\n${constants}\n${CLONE_BOT_BODY}`
}

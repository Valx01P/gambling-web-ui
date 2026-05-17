// Gambler bots — a 5-bot loose-aggressive squad auto-provisioned for
// every user. Mirrors the Oracle provisioning pattern (single migration
// + lazy-provision call in getMyBotsCached) but seeds five rows per
// user instead of one. Each entry below is one bot.
//
// Strategy rules shared by all five (each one tilts them slightly):
//   1. Pay to see flops. Preflop folds only on hands with no equity
//      AND a 3-bet+ price.
//   2. Chase draws — flush + open-ended + gutters call at fair prices.
//   3. NEVER fold a made hand (pair or better) to a single bet under
//      ~70% pot. The previous build folded two pair to a 100-chip
//      probe — that's the exact thing these bots are not supposed to
//      do.
//   4. Capitalize on strength: two pair raises, trips raises big.
//   5. Raise weakness when opponents check around or last aggressor
//      shows passivity.
//   6. Mix in bluffs — semi-bluffs on big draws, pure bluffs when the
//      board's scary and we have position. Frequency varies per bot.
//
// Postflop strength calibration (see POSTFLOP_RANK_BASELINE on the
// server):
//   high card 0.10 · pair 0.25 · two pair 0.40 · trips 0.55
//   straight 0.70 · flush 0.78 · full house 0.88 · quads+ 0.95+

// Shared boilerplate every strategy's `code` is wrapped with. Keeps
// helper math + sizing logic out of every script.
const SHARED_HELPERS = `
// ── helpers ───────────────────────────────────────────────────────────
function pickSize(ctx, frac) {
  // Target a fraction of pot (e.g. 0.66 = 2/3 pot). Falls back to a
  // min-raise when pot is tiny or current bet is large. Always returns
  // the TARGET TOTAL bet for that round — the engine handles deltas.
  var bb = ctx.bigBlind || 10
  var pot = ctx.pot || 0
  var raiseTo = Math.max(
    ctx.currentBet * 2,
    ctx.currentBet + Math.max(bb, Math.floor(pot * frac))
  )
  return Math.max(ctx.minRaiseTo || raiseTo, raiseTo)
}
function shove(ctx) { return Math.max(1, ctx.me.chips + ctx.myBet) }
function aggressorReadsWeak(ctx) {
  // No aggressor → table is folding/checking around. Counts as weak.
  var la = ctx.lastAggressor
  if (!la) return true
  if (la.id === ctx.me.id) return false
  // Tiny open / continuation-bet from a passive seat reads weak.
  var bb = ctx.bigBlind || 10
  var op = ctx.opponents.find(function(o) { return o.id === la.id })
  if (op && op.patterns && op.patterns.passive) return true
  return la.amount <= bb * 2.5
}
function activeOppsCheckedToUs(ctx) {
  if (ctx.toCall > 0) return false
  var any = false
  for (var i = 0; i < ctx.opponents.length; i++) {
    var o = ctx.opponents[i]
    if (o.folded || o.allIn) continue
    var acts = (o.currentHandActions || [])
      .filter(function(a) { return a.phase === ctx.phase })
    if (acts.length === 0) return false
    if (acts[acts.length - 1].action !== 'check') return false
    any = true
  }
  return any
}
function bluffyOpp(ctx) {
  var best = null
  for (var i = 0; i < ctx.opponents.length; i++) {
    var o = ctx.opponents[i]
    if (o.folded || o.allIn) continue
    var bf = (o.patterns && o.patterns.bluffFreq) || 0
    if (!best || bf > best.score) best = { id: o.id, score: bf }
  }
  return best
}
// Cheap call window. Always call when the price is small relative to
// either pot or stack — this is the "any equity is fine here" floor
// every bot shares so a $100 probe into a $300 pot doesn't fold a
// hand with 25% raw equity. potOdds <= ~0.30 covers most c-bets.
function smallBetWindow(ctx) {
  var pot = ctx.pot || 0
  var bb = ctx.bigBlind || 10
  var stack = ctx.me.chips || 1
  if (ctx.toCall <= 0) return false
  if (ctx.toCall <= bb * 3) return true
  if (ctx.toCall <= stack * 0.08) return true
  if (pot > 0 && ctx.toCall / (pot + ctx.toCall) <= 0.30) return true
  return false
}
`.trim()

// 1. Splashy — pays to see every flop, fires turn barrels when checked
//    to, calls down with second pair if bluff-freq looks high. Bluffs
//    ~28% in position. The "fish-with-confidence" archetype.
const SPLASHY_CODE = `
${SHARED_HELPERS}

function decide(ctx) {
  var s = ctx.handStrengthScore || 0
  var eq = (typeof ctx.equity === 'number') ? ctx.equity : null
  var toCall = ctx.toCall || 0
  var bb = ctx.bigBlind || 10
  var inPosition = ctx.position === 'BTN' || ctx.position === 'CO'
  var preflop = ctx.streetIsPreflop

  // ── PREFLOP: pay to see flops aggressively. Only fold the bottom
  //    ~12% to large action. Open-raise medium-up; just call from BB.
  if (preflop) {
    if (toCall === 0) {
      if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.9), say: "let's gamble" }
      return { action: 'check' }
    }
    var profile = ctx.preflopActionProfile || {}
    if ((profile.bets >= 3) && s < 0.45) return { action: 'fold' }
    if (inPosition && s >= 0.58 && profile.bets <= 1 && Math.random() < 0.35) {
      return { action: 'raise', amount: pickSize(ctx, 1.2), say: "splashy 3-bet" }
    }
    if (toCall < ctx.me.chips) return { action: 'call' }
    return s >= 0.40 ? { action: 'all_in' } : { action: 'fold' }
  }

  // ── POSTFLOP
  var draws = ctx.draws || {}
  var bigDraw = draws.hasFlushDraw || draws.hasOpenEnded
  var anyDraw = bigDraw || draws.hasGutshot

  // Free card and we have something: barrel often.
  if (toCall === 0) {
    var weakAgg = aggressorReadsWeak(ctx)
    // Trips or better → bet for value, big size.
    if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.85), say: "value bet" }
    // Two pair → value bet, medium.
    if (s >= 0.40) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "bet bet bet" }
    // Any pair + bigDraw → value/protection bet.
    if (s >= 0.25 || bigDraw) return { action: 'raise', amount: pickSize(ctx, 0.55), say: "lead" }
    if (weakAgg && (anyDraw || inPosition)) {
      return { action: 'raise', amount: pickSize(ctx, 0.45), say: "stab" }
    }
    if (activeOppsCheckedToUs(ctx) && Math.random() < 0.45) {
      return { action: 'raise', amount: pickSize(ctx, 0.40), say: "they don't want it" }
    }
    return { action: 'check' }
  }

  // Facing a bet. Made hands DEFEND — never fold trips, very rarely
  // fold two pair, and call most prices with a pair.
  var bluffer = bluffyOpp(ctx)
  var bluffCalled = bluffer && bluffer.score >= 0.18

  // Trips+ raise for value almost always.
  if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.85), say: "go go go" }
  // Two pair: raise unless price is huge; otherwise call.
  if (s >= 0.40) {
    if (ctx.potOdds < 0.40) return { action: 'raise', amount: pickSize(ctx, 0.75), say: "two pair" }
    return { action: 'call' }
  }
  // Any pair: call most bets. Only fold to massive overbets from
  // non-bluffy opps.
  if (s >= 0.25) {
    if (smallBetWindow(ctx) || ctx.potOdds < 0.45) return { action: 'call' }
    if (bluffCalled) return { action: 'call', say: "i call" }
    return ctx.potOdds < 0.55 ? { action: 'call' } : { action: 'fold' }
  }
  // No made hand. Big draws call at fair prices.
  if (bigDraw && ctx.potOdds < 0.42) return { action: 'call' }
  if (anyDraw && ctx.potOdds < 0.30) return { action: 'call', say: "i'll take a card" }
  if (smallBetWindow(ctx) && (eq == null || eq >= 0.20)) return { action: 'call' }
  // Pure bluff-raise occasionally in position vs foldy opps.
  if (inPosition && Math.random() < 0.18) {
    var foldy = ctx.opponents.some(function(o) {
      return !o.folded && o.patterns && o.patterns.foldsToBet >= 0.55
    })
    if (foldy && (!bluffer || bluffer.score < 0.10)) {
      return { action: 'raise', amount: pickSize(ctx, 0.70), say: "you don't have it" }
    }
  }
  return { action: 'fold' }
}
`.trim()

// 2. Chaser — lives for draws. Raises monster draws as semi-bluffs.
const CHASER_CODE = `
${SHARED_HELPERS}

function decide(ctx) {
  var s = ctx.handStrengthScore || 0
  var eq = (typeof ctx.equity === 'number') ? ctx.equity : null
  var toCall = ctx.toCall || 0
  var draws = ctx.draws || {}
  var preflop = ctx.streetIsPreflop
  var inPosition = ctx.position === 'BTN' || ctx.position === 'CO'

  if (preflop) {
    var profile = ctx.preflopActionProfile || {}
    var suited = ctx.holeCards && ctx.holeCards[0] && ctx.holeCards[1]
      && ctx.holeCards[0].suit === ctx.holeCards[1].suit
    var pair = ctx.holeCards && ctx.holeCards[0] && ctx.holeCards[1]
      && ctx.holeCards[0].rank === ctx.holeCards[1].rank

    if (toCall === 0) {
      if (s >= 0.50 || suited || pair) {
        return { action: 'raise', amount: pickSize(ctx, 0.8), say: "let's chase" }
      }
      return { action: 'check' }
    }
    if (profile.bets >= 3 && s < 0.40 && !pair && !suited) return { action: 'fold' }
    if (suited || pair || s >= 0.32) {
      return toCall < ctx.me.chips ? { action: 'call' } : { action: 'all_in' }
    }
    return { action: 'fold' }
  }

  var outs = draws.outs || 0
  var bigDraw = draws.hasFlushDraw || draws.hasOpenEnded
  var anyDraw = bigDraw || draws.hasGutshot

  if (toCall === 0) {
    // Made hands first: trips+, two pair, pair-with-draw.
    if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.80), say: "value time" }
    if (s >= 0.40) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "two pair pop" }
    if (s >= 0.25 && bigDraw) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "combo draw" }
    if (s >= 0.25) return { action: 'raise', amount: pickSize(ctx, 0.50), say: "lead" }
    if (bigDraw) return { action: 'raise', amount: pickSize(ctx, 0.55), say: "semi-bluff" }
    if (aggressorReadsWeak(ctx) && (anyDraw || inPosition)) {
      return { action: 'raise', amount: pickSize(ctx, 0.45) }
    }
    return { action: 'check' }
  }

  // Facing a bet. Made hands defend hard.
  if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.85), say: "got there" }
  if (s >= 0.40) {
    if (ctx.potOdds < 0.40) return { action: 'raise', amount: pickSize(ctx, 0.75), say: "two pair" }
    return { action: 'call' }
  }
  if (s >= 0.25) {
    if (bigDraw) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "pair + draw" }
    if (smallBetWindow(ctx) || ctx.potOdds < 0.45) return { action: 'call' }
    return ctx.potOdds < 0.55 ? { action: 'call' } : { action: 'fold' }
  }
  // No made hand. Heavy draws raise; light draws call cheap.
  if (bigDraw && ctx.potOdds < 0.42) return { action: 'call' }
  if (anyDraw && ctx.potOdds < 0.30) return { action: 'call', say: "one card" }
  if (smallBetWindow(ctx) && (eq == null || eq >= 0.20)) return { action: 'call' }
  if (inPosition && outs >= 6 && Math.random() < 0.22) {
    return { action: 'raise', amount: pickSize(ctx, 0.66), say: "shipping it" }
  }
  return { action: 'fold' }
}
`.trim()

// 3. Maniac — over-aggressive 3-bettor and barreling machine.
const MANIAC_CODE = `
${SHARED_HELPERS}

function decide(ctx) {
  var s = ctx.handStrengthScore || 0
  var eq = (typeof ctx.equity === 'number') ? ctx.equity : null
  var toCall = ctx.toCall || 0
  var preflop = ctx.streetIsPreflop
  var inPosition = ctx.position === 'BTN' || ctx.position === 'CO'

  if (preflop) {
    var profile = ctx.preflopActionProfile || {}
    if (toCall === 0) {
      if (s >= 0.20) return { action: 'raise', amount: pickSize(ctx, 1.1), say: "RAISE" }
      return { action: 'check' }
    }
    if (profile.bets <= 1 && s >= 0.40 && Math.random() < 0.5) {
      return { action: 'raise', amount: pickSize(ctx, 1.3), say: "3-bet" }
    }
    if (profile.bets >= 3 && s < 0.55) return { action: 'fold' }
    if (toCall < ctx.me.chips) return { action: 'call' }
    return s >= 0.50 ? { action: 'all_in', say: "let's go" } : { action: 'fold' }
  }

  var draws = ctx.draws || {}
  var bigDraw = draws.hasFlushDraw || draws.hasOpenEnded
  var bluffer = bluffyOpp(ctx)

  if (toCall === 0) {
    // Trips+ → big bet. Two pair → big bet. Pair → solid bet. Draw or
    // air → probe. Maniac literally never checks except range-bottom.
    if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.95), say: "BARREL" }
    if (s >= 0.40) return { action: 'raise', amount: pickSize(ctx, 0.80), say: "betting big" }
    if (s >= 0.25) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "value" }
    if (bigDraw) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "semi-bluff" }
    if (s < 0.10 && !bigDraw && Math.random() < 0.30) return { action: 'check' }
    return { action: 'raise', amount: pickSize(ctx, 0.55), say: "stab" }
  }

  // Facing a bet. Maniac re-raises with anything decent.
  if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 1.1), say: "3-bet pot" }
  if (s >= 0.40) return { action: 'raise', amount: pickSize(ctx, 0.90), say: "two pair pop" }
  if (s >= 0.25) {
    // Pair: raise into weakness, otherwise call. Won't fold pair to a
    // single bet — that's not the maniac's vibe.
    if (aggressorReadsWeak(ctx) || (bluffer && bluffer.score >= 0.15)) {
      return { action: 'raise', amount: pickSize(ctx, 0.75), say: "RAISING" }
    }
    return { action: 'call' }
  }
  if (bigDraw && ctx.potOdds < 0.45) {
    return Math.random() < 0.5
      ? { action: 'raise', amount: pickSize(ctx, 0.75), say: "semi-bluff" }
      : { action: 'call' }
  }
  if (smallBetWindow(ctx)) return { action: 'call' }
  // Pure bluff vs small bets in position.
  if (inPosition && Math.random() < 0.32 && ctx.toCall <= ctx.pot * 0.6) {
    return { action: 'raise', amount: pickSize(ctx, 0.85), say: "you're capped" }
  }
  return { action: 'fold' }
}
`.trim()

// 4. Sticky — calls down with any made hand. Won't raise without a
//    strong made hand but won't fold one either.
const STICKY_CODE = `
${SHARED_HELPERS}

function decide(ctx) {
  var s = ctx.handStrengthScore || 0
  var eq = (typeof ctx.equity === 'number') ? ctx.equity : null
  var toCall = ctx.toCall || 0
  var preflop = ctx.streetIsPreflop

  if (preflop) {
    var profile = ctx.preflopActionProfile || {}
    if (toCall === 0) {
      if (s >= 0.62) return { action: 'raise', amount: pickSize(ctx, 0.7), say: "i'll see one" }
      return { action: 'check' }
    }
    if (profile.bets >= 3 && s < 0.55) return { action: 'fold' }
    if (s >= 0.25) {
      return toCall < ctx.me.chips ? { action: 'call' } : (s >= 0.55 ? { action: 'all_in' } : { action: 'fold' })
    }
    return { action: 'fold' }
  }

  var draws = ctx.draws || {}
  var bigDraw = draws.hasFlushDraw || draws.hasOpenEnded
  var anyDraw = bigDraw || draws.hasGutshot

  if (toCall === 0) {
    if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.70), say: "value bet" }
    if (s >= 0.40) return { action: 'raise', amount: pickSize(ctx, 0.55), say: "two pair lead" }
    if (s >= 0.25 && aggressorReadsWeak(ctx)) {
      return { action: 'raise', amount: pickSize(ctx, 0.45) }
    }
    return { action: 'check' }
  }

  // The station rule: pair-or-better + reasonable price → call. Top
  // pair never folds to a single bet. Bluff catchers light up vs
  // bluffy opponents.
  var bluffer = bluffyOpp(ctx)
  if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "the nuts" }
  if (s >= 0.40) {
    if (ctx.potOdds < 0.42) return { action: 'raise', amount: pickSize(ctx, 0.60), say: "two pair" }
    return { action: 'call' }
  }
  if (s >= 0.25) {
    // Pair calls almost any single bet.
    if (smallBetWindow(ctx) || ctx.potOdds < 0.50) return { action: 'call', say: "i call" }
    if (bluffer && bluffer.score >= 0.20) return { action: 'call' }
    return ctx.potOdds < 0.60 ? { action: 'call' } : { action: 'fold' }
  }
  if (bigDraw && ctx.potOdds < 0.40) return { action: 'call' }
  if (anyDraw && ctx.potOdds < 0.28) return { action: 'call' }
  if (smallBetWindow(ctx) && (eq == null || eq >= 0.20)) return { action: 'call' }
  if (bluffer && bluffer.score >= 0.22 && eq != null && eq >= 0.22) {
    return { action: 'call', say: "i don't believe you" }
  }
  return { action: 'fold' }
}
`.trim()

// 5. Hunter — looks for weakness, isolates limpers, picks spots.
const HUNTER_CODE = `
${SHARED_HELPERS}

function decide(ctx) {
  var s = ctx.handStrengthScore || 0
  var eq = (typeof ctx.equity === 'number') ? ctx.equity : null
  var toCall = ctx.toCall || 0
  var preflop = ctx.streetIsPreflop
  var inPosition = ctx.position === 'BTN' || ctx.position === 'CO'

  if (preflop) {
    var profile = ctx.preflopActionProfile || {}
    var limpers = profile.callers >= 1 && profile.bets === 0
    if (toCall === 0) {
      if (s >= 0.45) return { action: 'raise', amount: pickSize(ctx, limpers ? 1.4 : 0.9), say: "raising" }
      return { action: 'check' }
    }
    if (profile.bets >= 3 && s < 0.50) return { action: 'fold' }
    if (s >= 0.30 || (inPosition && Math.random() < 0.65)) {
      return toCall < ctx.me.chips ? { action: 'call' } : { action: 'fold' }
    }
    return { action: 'fold' }
  }

  var draws = ctx.draws || {}
  var bigDraw = draws.hasFlushDraw || draws.hasOpenEnded
  var anyDraw = bigDraw || draws.hasGutshot
  var checkedAround = activeOppsCheckedToUs(ctx)
  var bluffer = bluffyOpp(ctx)

  if (toCall === 0) {
    if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.85), say: "value" }
    if (s >= 0.40) return { action: 'raise', amount: pickSize(ctx, 0.70), say: "two pair" }
    if (s >= 0.25) return { action: 'raise', amount: pickSize(ctx, 0.55), say: "pair lead" }
    if (checkedAround) {
      var frac = bigDraw ? 0.75 : 0.55
      return { action: 'raise', amount: pickSize(ctx, frac), say: "nobody wants it" }
    }
    if (aggressorReadsWeak(ctx) && anyDraw) {
      return { action: 'raise', amount: pickSize(ctx, 0.55) }
    }
    return { action: 'check' }
  }

  // Facing a bet.
  if (s >= 0.55) return { action: 'raise', amount: pickSize(ctx, 0.9), say: "raising you" }
  if (s >= 0.40) {
    if (ctx.potOdds < 0.40) return { action: 'raise', amount: pickSize(ctx, 0.80), say: "two pair" }
    return { action: 'call' }
  }
  if (s >= 0.25) {
    if (bluffer && bluffer.score >= 0.20) return { action: 'raise', amount: pickSize(ctx, 0.66), say: "calling you out" }
    if (smallBetWindow(ctx) || ctx.potOdds < 0.45) return { action: 'call' }
    return ctx.potOdds < 0.55 ? { action: 'call' } : { action: 'fold' }
  }
  if (bluffer && bluffer.score >= 0.22 && eq != null && eq >= 0.25) {
    return { action: 'call', say: "i'm here" }
  }
  if (bigDraw && ctx.potOdds < 0.42) return { action: 'call' }
  if (anyDraw && ctx.potOdds < 0.28) return { action: 'call' }
  if (smallBetWindow(ctx) && (eq == null || eq >= 0.20)) return { action: 'call' }
  if (inPosition && Math.random() < 0.15 && (!bluffer || bluffer.score < 0.08)) {
    return { action: 'raise', amount: pickSize(ctx, 0.80), say: "fold it" }
  }
  return { action: 'fold' }
}
`.trim()

export const GAMBLER_STRATEGIES = [
  { name: 'Splashy',  color: '#f97316', textColor: 'auto', code: SPLASHY_CODE },
  { name: 'Chaser',   color: '#22d3ee', textColor: 'auto', code: CHASER_CODE  },
  { name: 'Maniac',   color: '#ef4444', textColor: 'auto', code: MANIAC_CODE  },
  { name: 'Sticky',   color: '#84cc16', textColor: 'auto', code: STICKY_CODE  },
  { name: 'Hunter',   color: '#a855f7', textColor: 'auto', code: HUNTER_CODE  },
]

'use client'

import { useMemo, useRef, useState } from 'react'
import { CTX_GROUPS } from '../lib/ctxDocs'
import { lintJs } from '../lib/botCodeRunner'

const STARTER_CODE = `/**
 * ============================================================================
 *   POKER BOT — decide(ctx) runs every time it's your turn.
 * ============================================================================
 *
 *   RETURN one of:
 *     { action: 'fold' }
 *     { action: 'check' }
 *     { action: 'call' }
 *     { action: 'raise', amount: <total target bet, in chips> }
 *     { action: 'all_in' }
 *   Add  say: '<phrase>'  to any return to yell at the table (≤80 chars).
 *
 *   SERVER LIMITS
 *     • 150 ms CPU per call  • 128 KB max code  • Pure functions only
 *     • Compile/runtime error → bot folds (or checks if free)
 *     • Returning anything off-contract → bot folds
 *
 * ============================================================================
 *   ctx — EVERYTHING YOUR BOT CAN SEE
 * ============================================================================
 *
 *   The right rail lists every field — click to insert at cursor. The
 *   reference below is grouped by use. Hand any of this to an LLM with
 *   "make this looser" / "exploit bluffers" / etc. — it has enough signal.
 *
 *   ── Phase / table identity ─────────────────────────────────────────
 *   ctx.phase                  'preflop' | 'flop' | 'turn' | 'river'
 *   ctx.streetIsPreflop / streetIsPostflop
 *   ctx.streetIsFlop / streetIsTurn / streetIsRiver
 *   ctx.handIndex              hand counter at this table
 *   ctx.bigBlind / smallBlind / blindLevelLabel
 *   ctx.tableId                stable room id (e.g. 'arena_42')
 *   ctx.tableType              'public' | 'private' | 'arena'
 *   ctx.tableSize / maxSeats
 *   ctx.serverTime             wall-clock ms
 *   ctx.activeTurnStartedAt    ms — combine with serverTime for think-time
 *
 *   ── Position / role ───────────────────────────────────────────────
 *   ctx.position               'btn'|'sb'|'bb'|'utg'|'middle'|'late'
 *   ctx.isHeadsUp / isLatePosition / isBlind
 *   ctx.isInPosition           true = you close the betting this round
 *   ctx.iWasPreflopAggressor   anchor for c-bet logic
 *   ctx.numActiveOpponents     opponents still in the hand
 *
 *   ── Cards & hand strength ─────────────────────────────────────────
 *   ctx.holeCards              [{rank,suit},{rank,suit}]  ranks '2'..'A'
 *   ctx.communityCards         0..5 cards
 *   ctx.handStrength           'trash'|'weak'|'medium'|'strong'|'premium'
 *   ctx.handStrengthIndex      0..4 numeric tier
 *   ctx.handStrengthScore      0..1 numeric  (AA≈1.0, KK≈0.96, AKs≈0.71,
 *                              22≈0.55, 72o≈0.18; postflop = made-hand rank)
 *   ctx.bestHand               postflop: { rank, name, bestCards }
 *                              rank: 0=high,1=pair,2=2p,3=trips,4=straight,
 *                                    5=flush,6=full,7=quads,8=str.flush,9=royal
 *
 *   ── Equity & EV (range-aware Monte Carlo — your sharpest signal) ──
 *   ctx.equity                 0..1 vs estimated opponent ranges. NULL when
 *                              there are no opponents alive yet.
 *   ctx.equityVsRandom         0..1 vs any-two-cards. Baseline.
 *   ctx.breakevenEquity        toCall / (pot + toCall). Required equity to
 *                              break even on a call. Equivalent to potOdds.
 *   ctx.evCallChips            EV of a call in chips. Positive = +EV.
 *   ctx.profitableCall         shortcut for equity > breakevenEquity.
 *   ctx.bluffBreakEven         { half: 0.33, twoThirds: 0.40, pot: 0.50,
 *                                overbet: 0.60 } — required fold rate for
 *                              your bluff to break even at each size.
 *
 *   ── Pot, bets, sizing ─────────────────────────────────────────────
 *   ctx.potSize / currentBet / toCall / potOdds
 *   ctx.minRaiseTarget / maxRaiseTarget   bounds for { action:'raise',amount }
 *   ctx.spr                    stack-to-pot. <1 ≈ committed, >10 = deep
 *   ctx.aggressionCount        1=bet, 2=raise, 3=3-bet, 4+=war
 *   ctx.facingBet / facingRaise / facingAllIn
 *   ctx.commitmentRatio        0..1 — your total bet / starting stack
 *   ctx.committed              true at ≥0.5 commitmentRatio
 *
 *   ── BB-relative views (scale across blind levels) ─────────────────
 *   ctx.myStackBB / effectiveStackBB / potSizeBB / toCallBB / currentBetBB
 *
 *   ── Round dynamics ────────────────────────────────────────────────
 *   ctx.lastAggressor          { id, name, action, amount, phase, isMe } or null
 *   ctx.playersToAct / playersActedThisRound
 *   ctx.preflopActionProfile   'unopened'|'opened'|'three_bet'|'four_bet_plus'
 *
 *   ── Stack landscape ───────────────────────────────────────────────
 *   ctx.chipLeader / shortStack / myChipRank / totalChipsInPlay
 *
 *   ── Draws (postflop only) ─────────────────────────────────────────
 *   ctx.draws.hasFlushDraw / hasOpenEnded / hasGutshot / outs
 *
 *   ── Board texture (postflop only — null preflop) ──────────────────
 *   ctx.boardTexture.wetness   'dry' | 'wet' | 'volatile'
 *   ctx.boardTexture.paired / pairsCount / trips
 *   ctx.boardTexture.monotone / twoTone / rainbow / maxSuitCount
 *   ctx.boardTexture.connected / span / aceLow / drawHeavy / highCard
 *
 *   ── Me (this bot) ─────────────────────────────────────────────────
 *   ctx.me.id / name / seat / chips / bet / totalBetThisHand / position
 *   ctx.me.stats.{ vpip, aggressionFreq, profit, showdownsSeen, … }
 *   ctx.myStack / effectiveStack   shortcuts
 *
 *   ── Per-opponent (array, one per other seat) ──────────────────────
 *   ctx.opponents[i].id / stableId / seat / name / isBot
 *   ctx.opponents[i].chips / bet / totalBet / folded / allIn / position
 *   ctx.opponents[i].lastAction          { action, amount } or null
 *   ctx.opponents[i].lastActionTookMs / avgActionTimeMs   timing tells
 *   ctx.opponents[i].currentHandActions  [{seq,phase,action,amount,tookMs}]
 *   ctx.opponents[i].stackBB / bbToBust  their own stack in BBs
 *   ctx.opponents[i].effectiveStackBB    their stack vs YOURS in BBs
 *   ctx.opponents[i].mRatio              chips / (sb+bb)
 *   ctx.opponents[i].isChipLeader / isShortStack / chipRank
 *   ctx.opponents[i].committed
 *   ctx.opponents[i].estimatedTopPct     0..1 inferred range top-%
 *   ctx.opponents[i].estimatedRangeLabel 'premium'|'tight'|'standard'|…
 *   ctx.opponents[i].sessionProfit       net across rolling 25-hand window
 *   ctx.opponents[i].vsMeProfit          their head-to-head net vs YOU
 *   ctx.opponents[i].wonLastHand
 *   ctx.opponents[i].showdownsThisSession
 *   ctx.opponents[i].revealedShowdowns   [{handIndex,cards,won,handName,pot}]
 *   ctx.opponents[i].stats.{ vpip, aggressionFreq, wtsdRate,
 *                             wonAtShowdownRate, foldsToBet, … }
 *
 *   ── Per-opponent auto-derived behavioral patterns ─────────────────
 *   ctx.opponents[i].patterns.archetype       'nit'|'tag'|'lag'|'maniac'|
 *                                              'fish'|'reg'|'unknown'
 *   ctx.opponents[i].patterns.aggressionBias  'passive'|'balanced'|'over_aggressive'
 *   ctx.opponents[i].patterns.bluffer         boolean
 *   ctx.opponents[i].patterns.stickyCaller    boolean
 *   ctx.opponents[i].patterns.openFreq / limpFreq / threeBetFreq
 *   ctx.opponents[i].patterns.foldTo3BetRate / cBetFreq / oversizeFreq
 *   ctx.opponents[i].patterns.checkRaises / donkBets          raw counts
 *   ctx.opponents[i].patterns.showdownBluffRate / showdownStrongRate
 *   ctx.opponents[i].patterns.recentWins / recentNetChips / recentLossBB
 *   ctx.opponents[i].patterns.tilt            'cool'|'normal'|'tilted'
 *   ctx.opponents[i].patterns.bluffCatchScore 0..1 — call them lighter
 *   ctx.opponents[i].patterns.bluffTargetScore 0..1 — bluff them more
 *   ctx.opponents[i].patterns.foldEquityScore 0..1 — will they fold?
 *   ctx.opponents[i].patterns.sample / sampleConfidence
 *
 *   ── Table profile (rollup over opponents) ─────────────────────────
 *   ctx.tableProfile.dominantArchetype / archetypeCounts
 *   ctx.tableProfile.tightTable / looseTable / aggressiveTable / passiveTable
 *   ctx.tableProfile.tiltedSeats / bluffers / stickyCallers
 *   ctx.tableProfile.loosenessIndex / aggressionIndex            0..1
 *   ctx.tableProfile.avgBluffCatchScore / avgBluffTargetScore / avgFoldEquityScore
 *
 *   ── History ──────────────────────────────────────────────────────
 *   ctx.actionHistory          this hand: [{seq,phase,playerId,playerName,
 *                                action,amount,toCallBefore,potBefore,at,tookMs}]
 *   ctx.handHistory            up to last 25 completed hands — same shape
 *                              per hand plus winners/cards/profitByPlayer
 *   ctx.lastShowdown           most recent type:'showdown' entry or null
 *   ctx.revealedShowdownsByPlayer  { [playerId]: [reveals…] } session memory
 *   ctx.handsSinceLastWin      0 = won the most recent hand
 *
 *   ── Helpers in scope (no ctx. prefix) ─────────────────────────────
 *   handStrength(hole, community)    → tier name for any 2-card hand
 *   evaluateCards(cards)             → { rank, name, bestCards } 5..7 cards
 *   randomFloat(min, max)            → uniform random
 *   console.log(...)                 → debug ring (last 20 lines)
 *
 * ============================================================================
 *   SAMPLE BOT — production-grade decision tree using everything above.
 *   Read it once, then start tuning the constants at the top.
 * ============================================================================
 */

// ─── Tunable knobs (everything below reads from these) ─────────────────
//
// The defaults are tuned NOT to be exploitable by simple over-bluffing. A
// bot that folds 100% of its range to a single raise gets blown off every
// pot — minimum defense frequency (MDF) math forces us to defend at least
// pot/(pot+bet) fraction of hands. We bake that math into the postflop
// branch below. Preflop, we open ~30-45% by position and defend the BB
// very wide vs a single raise.
const OPEN_BB         = 2.8    // preflop open size in BBs (raise to 2.8 × BB + any limp callers)
const POT_BET         = 0.66   // standard postflop value-bet size as fraction of pot
const C_BET_FREQ      = 0.55   // base c-bet probability after opening preflop
const BLUFF_FLOOR_EQ  = 0.18   // never bluff if my own range-equity is below this
const VALUE_RAISE_EQ  = 0.55   // raise for value when equity ≥ this (used to be 0.62 — too tight)
const CALL_DOWN_EQ    = 0.28   // base equity required to call a bet — START LOW, drift up on tight reads
const RIVER_TIGHTEN   = 0.03   // bump call-equity by this on the river (slightly fewer bluffs in range)
const SHORT_STACK_BB  = 15     // opponents below this BB depth are treated as jam/fold

// Pre-baked opening cutoffs by position. score ≥ cutoff = we open. The
// numbers map to roughly: top X% of hands where X = 100 × (1 - cutoff).
// btn opens ~45% of hands, utg ~15%.
const OPEN_CUTOFF = {
  utg: 0.58, mp: 0.52, middle: 0.50, late: 0.45, co: 0.45, btn: 0.40, sb: 0.45
}

// BB defense cutoffs vs a single raise. We defend wider here than at any
// other seat because we've already paid 1 BB and we close the action.
const BB_DEFEND_VS_RAISE_CUTOFF = 0.35   // ≈ top 65% of hands
const BB_DEFEND_VS_3BET_CUTOFF  = 0.55   // tighten dramatically vs a 3-bet

// ─── Tiny per-hand deterministic RNG so frequencies actually mix ──────
function chance(ctx, salt) {
  const seed = (ctx.handIndex || 0) ^ ((ctx.me?.seat || 0) * 31) ^ salt
  let t = (seed * 0x9e3779b1) | 0
  t = ((t ^ (t >>> 16)) * 0x85ebca6b) | 0
  t = ((t ^ (t >>> 13)) * 0xc2b2ae35) | 0
  t = (t ^ (t >>> 16)) >>> 0
  return t / 4294967296
}

function clampRaise(ctx, target) {
  const lo = ctx.minRaiseTarget || ctx.bigBlind
  const hi = ctx.maxRaiseTarget || target
  return { action: 'raise', amount: Math.max(lo, Math.min(hi, Math.floor(target))) }
}

// ─── meAwareness — read your OWN stats so you don't get predictable ───
// Demonstrates: ctx.me.stats.*, commitmentRatio, mRatio (derived), tableId/tableType.
function readMe(ctx) {
  const s = ctx.me?.stats || {}
  const vpip = s.vpip || 0
  const aggr = s.aggressionFreq || 0
  // Self-correct if we've been too predictable — bump bluff freq up when
  // our aggression has been low; tighten when we've been spewing.
  const tooTight = vpip < 0.18 && s.handsObserved >= 12
  const tooLoose = vpip > 0.50 && s.handsObserved >= 12
  const myMRatio = (ctx.bigBlind + ctx.smallBlind) > 0
    ? (ctx.me?.chips || 0) / (ctx.bigBlind + ctx.smallBlind) : 999
  return {
    vpip, aggr, tooTight, tooLoose,
    sessionProfit: s.profit || 0,
    mRatio: myMRatio,
    isArenaSeat: ctx.tableType === 'arena',          // arenas have no human pressure
    isHeadsUpTable: ctx.tableSize === 2 || ctx.isHeadsUp,
    handsSinceLastWin: ctx.handsSinceLastWin ?? -1,  // -1 = none yet
    commitmentRatio: ctx.commitmentRatio || 0
  }
}

// ─── readTable — average exploit scores across active opponents ───────
// Demonstrates: tableProfile.*, opp.patterns.*, opp.vsMeProfit,
//   opp.stackBB / mRatio, opp.lastActionTookMs/avgActionTimeMs.
function readTable(ctx) {
  const active = ctx.opponents.filter(o => !o.folded && !o.allIn)
  let bluffTarget = 0, bluffCatch = 0, foldEquity = 0, tilted = 0
  let myNemesisProfit = 0
  let shortStacks = 0
  for (const o of active) {
    bluffTarget += o.patterns?.bluffTargetScore || 0
    bluffCatch  += o.patterns?.bluffCatchScore  || 0
    foldEquity  += o.patterns?.foldEquityScore  || 0
    if (o.patterns?.tilt === 'tilted') tilted += 1
    if (o.vsMeProfit > myNemesisProfit) myNemesisProfit = o.vsMeProfit
    if ((o.stackBB || 999) <= SHORT_STACK_BB) shortStacks += 1
  }
  const n = Math.max(1, active.length)
  return {
    active, count: active.length,
    bluffTarget: bluffTarget / n,
    bluffCatch:  bluffCatch  / n,
    foldEquity:  foldEquity  / n,
    tilted,
    shortStacks,
    // The opponent who's most stuck-it-to-me this session. Use to play
    // straightforward / cautious vs them.
    nemesis: active.slice().sort((a, b) => (b.vsMeProfit || 0) - (a.vsMeProfit || 0))[0] || null,
    table: ctx.tableProfile || {}
  }
}

// ─── readBoard — full breakdown of the community-card landscape ───────
// Demonstrates: every boardTexture.* field, ctx.bestHand, ctx.draws.
function readBoard(ctx) {
  const bt = ctx.boardTexture
  if (!bt) return { preflop: true }
  return {
    preflop: false,
    paired: bt.paired,
    pairsCount: bt.pairsCount,
    trips: bt.trips,
    monotone: bt.monotone,
    twoTone: bt.twoTone,
    rainbow: bt.rainbow,
    maxSuitCount: bt.maxSuitCount,
    connected: bt.connected,
    span: bt.span,
    aceLow: bt.aceLow,
    drawHeavy: bt.drawHeavy,
    highCard: bt.highCard,                            // 14 = A on board
    wetness: bt.wetness,                              // 'dry' | 'wet' | 'volatile'
    bestRank: ctx.bestHand?.rank ?? -1,
    bestName: ctx.bestHand?.name ?? null,
    outs: ctx.draws?.outs || 0,
    flushDraw: !!ctx.draws?.hasFlushDraw,
    oeStraight: !!ctx.draws?.hasOpenEnded,
    gutshot: !!ctx.draws?.hasGutshot
  }
}

// ─── villainRead — recent showdowns + timing tells per opponent ───────
// Demonstrates: opp.revealedShowdowns, revealedShowdownsByPlayer,
//   lastShowdown, opp.avgActionTimeMs / lastActionTookMs, vsMeProfit.
function villainRead(ctx, oppId) {
  if (!oppId) return null
  const opp = ctx.opponents.find(o => o.id === oppId)
  if (!opp) return null
  const reveals = ctx.revealedShowdownsByPlayer?.[oppId] || opp.revealedShowdowns || []
  const lastReveal = reveals[reveals.length - 1] || null
  // Timing tell — they snap-called vs they tanked. Bots act on a fixed
  // schedule so this is mostly informative against humans (opp.isBot=false).
  const snapped = (opp.lastActionTookMs || 0) > 0 && (opp.lastActionTookMs || 0) < 800
  const tanked = (opp.lastActionTookMs || 0) > 4000
  return {
    archetype: opp.patterns?.archetype || 'unknown',
    confidence: opp.patterns?.sampleConfidence || 'low',
    bluffer: !!opp.patterns?.bluffer,
    sticky: !!opp.patterns?.stickyCaller,
    tilted: opp.patterns?.tilt === 'tilted',
    aggrBias: opp.patterns?.aggressionBias,
    cBetFreq: opp.patterns?.cBetFreq || 0,
    threeBetFreq: opp.patterns?.threeBetFreq || 0,
    foldToThreeBet: opp.patterns?.foldTo3BetRate || 0,
    foldEquityScore: opp.patterns?.foldEquityScore || 0,
    bluffCatchScore: opp.patterns?.bluffCatchScore || 0,
    bluffTargetScore: opp.patterns?.bluffTargetScore || 0,
    stackBB: opp.stackBB || 0,
    mRatio: opp.mRatio || 0,
    vsMeProfit: opp.vsMeProfit || 0,
    estimatedTopPct: opp.estimatedTopPct,             // 0..1, null when no inference
    estimatedRangeLabel: opp.estimatedRangeLabel,
    isBot: !!opp.isBot,
    snapped, tanked,
    lastReveal,                                       // {handIndex, cards, won, handName, pot} or null
    revealCount: reveals.length
  }
}

// ─── runGood — read short-term variance / streaks from handHistory ────
// Demonstrates: ctx.handHistory, ctx.lastShowdown, ctx.handsSinceLastWin.
function runGood(ctx) {
  const recent = (ctx.handHistory || []).slice(-10)
  const myWins = recent.filter(h =>
    (h.winners || []).some(w => w.playerId === ctx.me?.id)
  ).length
  const myProfit = recent.reduce((s, h) => s + (h.profit || 0), 0)
  // Inspect the last showdown — did we see who was bluffing or value-betting?
  const lastSd = ctx.lastShowdown
  const lastWinner = lastSd?.winners?.[0] || null
  return {
    myWins, myProfitLast10: myProfit,
    handsSinceLastWin: ctx.handsSinceLastWin ?? -1,
    lastShowdownWinnerId: lastWinner?.playerId,
    lastShowdownHand: lastWinner?.handName
  }
}

// ─── analyseCurrentHand — extract patterns from THIS hand's actionHistory
// Demonstrates: ctx.actionHistory, ctx.lastAggressor, lastOpponentAction.
function analyseCurrentHand(ctx) {
  const ah = ctx.actionHistory || []
  // Are there multiple aggressors? Suggests serious strength somewhere.
  const raisers = new Set()
  let totalRaiseSize = 0, raiseCount = 0
  for (const a of ah) {
    if (a.action === 'raise' || a.action === 'all_in') {
      raisers.add(a.playerId)
      totalRaiseSize += a.amount || 0
      raiseCount += 1
    }
  }
  return {
    raisersCount: raisers.size,
    avgRaiseSize: raiseCount > 0 ? totalRaiseSize / raiseCount : 0,
    lastOpponentAction: ctx.lastOpponentAction || '',
    aggressorIsMe: !!(ctx.lastAggressor && ctx.lastAggressor.isMe),
    streetActions: ah.filter(a => a.phase === ctx.phase).length
  }
}

function decide(ctx) {
  const eq = ctx.equity ?? 0.5
  const eqVsRandom = ctx.equityVsRandom ?? eq
  const score = ctx.handStrengthScore ?? 0

  // ── Hand analysis — single source of truth for "what do I have?" ─────
  // ctx.handAnalysis.preflop  is always present when we have 2 hole cards.
  // ctx.handAnalysis.postflop is null preflop, populated on flop+.
  const pre = ctx.handAnalysis?.preflop || {}
  const post = ctx.handAnalysis?.postflop || null

  // Build situational reads. Each helper above pulls a different cluster
  // of signals; assemble them once per decision so the body stays clean.
  const t = readTable(ctx)
  const me = readMe(ctx)
  const board = readBoard(ctx)
  const villain = villainRead(ctx, ctx.lastAggressor?.id)
  const trend = runGood(ctx)
  const hand = analyseCurrentHand(ctx)

  // ────────────────────────────────────────────────────────────────────
  // 1. ALL-IN SPOTS — call as a favorite or when priced in. Never agonize.
  // ────────────────────────────────────────────────────────────────────
  if (ctx.facingAllIn) {
    // Vs a known bluffer with a high catch score, lower the bar a bit.
    const threshold = 0.55 - 0.05 * (villain?.bluffCatchScore || 0)
    if (eq >= threshold) return { action: 'call', say: 'getting there' }
    if (ctx.profitableCall) return { action: 'call' }
    return { action: 'fold' }
  }

  // ────────────────────────────────────────────────────────────────────
  // 2. PREFLOP
  // ────────────────────────────────────────────────────────────────────
  if (ctx.streetIsPreflop) {
    // BB free option — never fold for free. Raise premium, otherwise check
    // and see a flop with literally anything.
    if (ctx.toCall === 0 && ctx.position === 'bb') {
      if (score >= 0.85) return clampRaise(ctx, OPEN_BB * ctx.bigBlind)
      return { action: 'check' }
    }
    // SB completion — only the BB to act behind. Complete with a wide range
    // because we're only paying 0.5 BB extra and we close action.
    if (ctx.position === 'sb' && ctx.toCall <= ctx.bigBlind) {
      if (score >= 0.85) return clampRaise(ctx, Math.max(3, OPEN_BB) * ctx.bigBlind)
      if (score >= 0.34) return { action: 'call' }   // top ~66%
      return { action: 'fold' }
    }

    // Facing a raise. The most-broken thing the prior template did was fold
    // virtually every hand here. Rebuilt with explicit cutoffs and an MDF
    // defense from the BB so a single 3x raise can't just take the pot.
    if (ctx.facingBet) {
      // (1) Premium hands (handAnalysis.preflop.neverFoldPreflop === true):
      //     AA, KK, QQ, JJ, TT, AKs, AKo, AQs. Never, ever fold. 3-bet for
      //     value, call vs a 4-bet rather than 5-betting light.
      //     This is the hard rule that prevents AK from getting folded.
      if (pre.neverFoldPreflop) {
        if (ctx.aggressionCount >= 3) return { action: 'call' }
        return clampRaise(ctx, ctx.currentBet * 3)
      }

      // (2) Strong hands: mix 3-bet vs single open, call vs 3-bet+.
      if (score >= 0.65) {
        if (ctx.aggressionCount === 1 && chance(ctx, 11) < 0.45) {
          return clampRaise(ctx, ctx.currentBet * 3)
        }
        return { action: 'call' }
      }

      // (3) BB defense — wide, because we close the action and we're priced in.
      //     The cutoffs reflect minimum-defense-frequency math: against a
      //     standard 3x open we need to defend ~62% of hands. We split that
      //     into a flat call range here; 3-bet bluffs are mixed in below.
      if (ctx.position === 'bb') {
        const cutoff = ctx.aggressionCount >= 2 ? BB_DEFEND_VS_3BET_CUTOFF
                                                 : BB_DEFEND_VS_RAISE_CUTOFF
        if (score >= cutoff) {
          // 3-bet bluff some suited connectors / Axs / pairs vs a wide opener.
          const villainOpened = ctx.aggressionCount === 1
          const villainIsLoose = villain && villain.archetype && /lag|maniac|fish/.test(villain.archetype)
          if (villainOpened && villainIsLoose && score >= 0.42 && chance(ctx, 5) < 0.22) {
            return clampRaise(ctx, ctx.currentBet * 3)
          }
          return { action: 'call' }
        }
        // Below the BB defense bar — fold to a raise, but if it was a
        // min-raise (≤ 2.2 BB) call anything reasonable for the price.
        if (ctx.currentBet <= 2.2 * ctx.bigBlind && score >= 0.20) {
          return { action: 'call' }
        }
        return { action: 'fold' }
      }

      // (4) Non-BB defense — use pot odds AND a hand-strength floor.
      //     Real defending ranges from non-BB positions sit around 15-25%.
      if (score >= 0.55 && ctx.potOdds <= 0.40) return { action: 'call' }
      if (score >= 0.45 && ctx.potOdds <= 0.30) return { action: 'call' }
      // Multiway with implied odds (small pair set-mining, suited connectors).
      if (score >= 0.40 && ctx.potOdds <= 0.20 && t.count >= 2 && ctx.effectiveStackBB >= 30) {
        return { action: 'call' }
      }
      return { action: 'fold' }
    }

    // First in / limped to me. Position-based opening — much wider than before.
    let openCutoff = OPEN_CUTOFF[ctx.position] ?? 0.50
    if (t.table.tightTable) openCutoff -= 0.05      // steal wider at nitty tables
    if (t.table.looseTable) openCutoff += 0.04      // tighten at maniac tables
    if (me.isHeadsUpTable) openCutoff -= 0.10       // very wide heads-up
    if (me.tooLoose) openCutoff += 0.05             // self-correct if I've been spewy
    if (t.shortStacks >= 1) openCutoff -= 0.03      // pressure short stacks
    if (me.tooTight) openCutoff -= 0.04             // self-correct if I've been nitty

    if (score >= openCutoff) {
      const size = OPEN_BB * ctx.bigBlind + (ctx.aggressionCount === 0 ? 0 : ctx.bigBlind)
      return clampRaise(ctx, size)
    }
    // Limpers and we have a playable hand — over-limp or iso-raise.
    if (ctx.toCall > 0 && ctx.toCall <= ctx.bigBlind && score >= 0.36) {
      // Iso-raise vs a single limper with a strong hand to thin the field.
      if (score >= 0.55 && t.count <= 2) {
        return clampRaise(ctx, OPEN_BB * ctx.bigBlind + ctx.bigBlind)
      }
      return { action: 'call' }
    }
    return ctx.toCall === 0 ? { action: 'check' } : { action: 'fold' }
  }

  // ────────────────────────────────────────────────────────────────────
  // 3. POSTFLOP — equity-led, opponent-aware, board-aware sizing
  // ────────────────────────────────────────────────────────────────────

  // Adjust call threshold by table + board + street.
  //   • bluffCatch high → call lighter
  //   • passive table → call thinner (less bluffs in their range)
  //   • monotone / drawHeavy board → tighten a hair (more outs against us)
  //   • river → tighten (smaller bluff frequencies in most ranges)
  //   • vs a nemesis who's beaten us repeatedly → respect more
  let callTarget = CALL_DOWN_EQ - 0.06 * t.bluffCatch + 0.04 * (1 - t.foldEquity)
  if (board.monotone || board.drawHeavy) callTarget += 0.03
  if (ctx.streetIsRiver) callTarget += RIVER_TIGHTEN
  if (t.nemesis && t.nemesis.vsMeProfit > 5 * ctx.bigBlind) callTarget += 0.05

  // Value threshold drifts:
  //   • passive / sticky table → thin-value more (lower target)
  //   • tight aggressive table → demand a stronger hand for value-bets
  //   • paired board (FH possible) → demand more
  let valueTarget = VALUE_RAISE_EQ - 0.05 * (t.table.passiveTable ? 1 : 0)
  if (t.table.tightTable && t.table.aggressiveTable) valueTarget += 0.04
  if (board.paired) valueTarget += 0.04

  if (!ctx.facingBet) {
    // 1. C-BET — we were the preflop aggressor on the flop.
    //    Dry, rainbow, ace-low boards → fire larger and more often.
    //    Wet, two-tone, connected boards → check more, smaller when we fire.
    if (ctx.iWasPreflopAggressor && ctx.streetIsFlop) {
      const dryBoost = board.wetness === 'dry' ? 0.15 : board.wetness === 'wet' ? -0.05 : -0.15
      const cbetGate = C_BET_FREQ + dryBoost + 0.10 * t.foldEquity +
                       (me.tooTight ? 0.05 : 0)   // self-correct: I've been nitty
      if (chance(ctx, 17) < cbetGate) {
        // Sizing: smaller on dry (more fold equity, smaller works), bigger on
        // wet (charge their draws).
        const sizeFrac = board.wetness === 'dry' ? POT_BET * 0.66
                       : board.maxSuitCount >= 2 || board.connected ? POT_BET * 0.9
                       : POT_BET
        return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * sizeFrac))
      }
    }
    // 2. Value bet — strong equity OR the analyzer flags this as commit/value.
    //    Larger on wet boards (protect against draws), larger still on a 'nut'
    //    holding. Use post.commitmentSuggestion as a second source.
    const shouldValueBet = eq >= valueTarget ||
                           (post && post.commitmentSuggestion === 'commit') ||
                           (post && (post.valueClass === 'strong' || post.valueClass === 'nut'))
    if (shouldValueBet) {
      let protect = board.drawHeavy || board.twoTone ? 0.85 : POT_BET
      if (post?.valueClass === 'nut') protect = 0.95
      return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * protect))
    }
    // 2b. Semibluff candidate (flush draw + open-ended) gets a big bet for
    //     fold equity + great runout if called.
    if (post?.semibluffCandidate && t.foldEquity >= 0.30 && chance(ctx, 19) < 0.50) {
      return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * 0.66))
    }
    // 3. Semi-bluff / pure bluff vs a foldy table when we have outs OR when
    //    the most recent showdown showed villain's range is wide.
    const outs = ctx.draws?.outs ?? 0
    const villainShowedWeak = trend.lastShowdownWinnerId && trend.lastShowdownHand &&
      /high card|pair/i.test(trend.lastShowdownHand || '')
    if (eq >= BLUFF_FLOOR_EQ && (outs >= 4 || villainShowedWeak) &&
        t.foldEquity >= 0.40 && chance(ctx, 23) < 0.35) {
      // Pick sizing from bluffBreakEven so we can name the % we need to fold.
      const size = t.foldEquity >= 0.60 ? ctx.bluffBreakEven.half        // small bet, foldy table
                 : t.foldEquity >= 0.50 ? ctx.bluffBreakEven.twoThirds
                 : ctx.bluffBreakEven.pot
      const sizeFrac = size === ctx.bluffBreakEven.half ? 0.5
                     : size === ctx.bluffBreakEven.twoThirds ? 0.66
                     : 1.0
      return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * sizeFrac))
    }
    // 4. River probe vs a sticky caller with showdown value — thin value.
    if (ctx.streetIsRiver && eq >= 0.55 && t.table.stickyCallers > 0) {
      return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * 0.5))
    }
    // 5. Otherwise check.
    return { action: 'check' }
  }

  // ───────────────── Facing a bet ─────────────────
  //
  // KEY IDEA: never trust the range-aware equity alone — it assumes the
  // villain is betting with a balanced range. Lots of players bet for the
  // wrong reasons. Blend "eq" (range-aware) and "eqVsRandom" (assumes any
  // two), weighted by how confident we are in their range read.

  // (1) Compute MDF — minimum fraction of our range we have to defend by
  //     calling/raising. Folding more than this is exploitable. For a
  //     pot-sized bet MDF = 0.5; for a half-pot bet MDF = 0.67.
  const mdf = ctx.potSize > 0
    ? ctx.potSize / (ctx.potSize + ctx.toCall)
    : 0.5

  // (2) Build a confidence in the range-aware read. High confidence ⇒ trust
  //     "eq" directly. Low confidence ⇒ tilt toward "eqVsRandom".
  //     Things that LOWER confidence (i.e., make us call lighter):
  //       - villain has shown bluffs at showdown
  //       - villain has high aggression frequency (over-aggressors)
  //       - small sample size on this villain
  //       - villain's bet size is overbet-y (often polarized → call more)
  //       - their last action was fast (snap = polarized)
  let rangeConfidence = 0.70
  if (villain) {
    if (villain.bluffer || villain.bluffCatchScore >= 0.50) rangeConfidence -= 0.25
    if (villain.aggrBias === 'over_aggressive') rangeConfidence -= 0.15
    if (villain.confidence === 'low') rangeConfidence -= 0.15
    if (villain.tilted) rangeConfidence -= 0.10
    if (villain.snapped) rangeConfidence -= 0.05
    // The opposite — tighten when we have a tight read:
    if (villain.archetype === 'nit' && villain.confidence !== 'low') rangeConfidence += 0.15
    if (villain.stickyCaller) rangeConfidence += 0.05
  }
  // Overbets (≥ 1× pot) are usually polarized: nuts or air. We blend wider.
  if (ctx.currentBet >= ctx.potSize) rangeConfidence -= 0.10
  rangeConfidence = Math.max(0.20, Math.min(0.95, rangeConfidence))
  const effEq = rangeConfidence * eq + (1 - rangeConfidence) * eqVsRandom

  // (A) Big equity edge → raise for value. Also fire when the analyzer
  //     says we have a 'nut' or 'strong' value class (sets, straights,
  //     flushes, full houses) — the equity number alone can underrate us
  //     against tight inferred ranges.
  if (effEq >= valueTarget + 0.05 ||
      (post && (post.valueClass === 'nut' || post.valueClass === 'strong'))) {
    const sizeFrac = post?.valueClass === 'nut' ? 0.85 : 0.75
    return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * sizeFrac))
  }

  // (B) Bluff-catch raise — villain bluffs a lot AND we have decent equity.
  //     Skip the raise if they tanked (often a real hand) but still call.
  if (villain && villain.bluffCatchScore >= 0.55 && effEq >= 0.38 && !villain.tanked &&
      chance(ctx, 29) < 0.40) {
    return clampRaise(ctx, ctx.currentBet + Math.floor(ctx.potSize * 0.80))
  }

  // (C) Short-stack jam — pure equity decision, no psychology.
  if (villain && villain.mRatio > 0 && villain.mRatio < 5) {
    if (eq >= 0.45 || ctx.profitableCall) return { action: 'call' }
    return { action: 'fold' }
  }

  // (D) Profitable-call check (pot odds). If the math works, just call.
  //     This is the single biggest fix vs the old template — we used to
  //     fold even when pot odds said call.
  if (ctx.profitableCall) return { action: 'call' }

  // (E) Blended equity beats the call target → call.
  let target = callTarget
  // Tighten the call target slightly on the river (less bluffs in range)
  // and against a non-bluffer with strong sample.
  if (ctx.streetIsRiver) target += RIVER_TIGHTEN
  if (villain && villain.archetype === 'nit' && villain.confidence === 'high') target += 0.08
  if (effEq >= target) return { action: 'call' }

  // (F) MDF defense — never fold more than (1 - mdf) of our range.
  //     If our hand is in the top (1 - mdf) of plausible holdings on this
  //     board, call. We approximate "in the top X%" by handStrengthScore
  //     (preflop equivalent — for postflop holdings the score is mapped
  //     from made-hand rank). Small bets get defended very wide.
  //     This is the bluff-defense that makes a single bet not just take the pot.
  const minCallScore = Math.max(0.18, 1 - mdf)
  if (score >= minCallScore && eqVsRandom >= 0.30) {
    return { action: 'call' }
  }

  // (G) Draws — outs + odds.
  if ((ctx.draws?.outs ?? 0) >= 8 && ctx.potOdds <= 0.32) return { action: 'call' }
  if ((ctx.draws?.outs ?? 0) >= 12) return { action: 'call' }  // monster combo draws always call

  // (H) Pot-committed — keep going unless we're obviously crushed.
  if (ctx.committed && effEq >= 0.25) return { action: 'call', say: 'priced in' }

  // (I) Multi-street pressure detection — if villain has been firing every
  //     street AND their pattern says they're a bluffer, call to catch.
  if (hand.aggressorIsMe === false && ctx.streetIsRiver && villain && villain.bluffer && effEq >= 0.30) {
    return { action: 'call' }
  }

  return { action: 'fold' }
}
`

export { STARTER_CODE }

function DocsItem({ item, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(`ctx.${item.path}`)}
      className="block w-full rounded-md border border-zinc-700/70 bg-zinc-950/60 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/80"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="truncate text-[11px] font-bold text-emerald-300">ctx.{item.path}</code>
        <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-zinc-300">{item.type}</span>
      </div>
      {item.doc && (
        <div className="mt-0.5 text-[10px] font-bold leading-snug text-zinc-200">{item.doc}</div>
      )}
    </button>
  )
}

export default function JsCodeEditor({ code, onCodeChange }) {
  const taRef = useRef(null)
  const [filter, setFilter] = useState('')
  const [docsOpen, setDocsOpen] = useState(true)
  const [copied, setCopied] = useState(null)

  const lint = useMemo(() => lintJs(code), [code])

  function insertAtCursor(snippet) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? code.length
    const end = ta.selectionEnd ?? code.length
    const next = code.slice(0, start) + snippet + code.slice(end)
    onCodeChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + snippet.length
    })
  }

  function resetToTemplate() {
    if (!confirm('Replace your code with the starter template? Your current code will be lost.')) return
    onCodeChange(STARTER_CODE)
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      // Fallback for non-secure contexts: select+copy via a transient textarea.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      ta.remove()
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    }
  }

  function buildCtxMarkdown() {
    const lines = ['# Bot ctx reference (paste this into your LLM)', '']
    for (const g of CTX_GROUPS) {
      lines.push(`## ${g.title}`)
      if (g.description) lines.push(g.description)
      for (const it of g.items) {
        const parts = [`- \`ctx.${it.path}\``, `(${it.type})`]
        if (it.doc) parts.push(`— ${it.doc}`)
        lines.push(parts.join(' '))
      }
      lines.push('')
    }
    lines.push('## Return contract', '- `{ action: "fold" }`', '- `{ action: "check" }`', '- `{ action: "call" }`', '- `{ action: "raise", amount: <total target bet, in chips> }`', '- `{ action: "all_in" }`', '- Any return may also include `say: "<phrase>"` (max 80 chars).')
    return lines.join('\n')
  }

  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return CTX_GROUPS
    const needle = filter.toLowerCase()
    return CTX_GROUPS
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          i.path.toLowerCase().includes(needle) ||
          (i.doc || '').toLowerCase().includes(needle)
        )
      }))
      .filter(g => g.items.length > 0)
  }, [filter])

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            bot.js — your decide(ctx) is the bot
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyText(code, 'code')}
              className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              title="Copy the entire bot.js source"
            >
              {copied === 'code' ? '✓ Copied' : 'Copy code'}
            </button>
            <button
              type="button"
              onClick={resetToTemplate}
              className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              title="Replace the editor contents with the starter template"
            >
              Reset to template
            </button>
            <span className={`text-[10px] font-black uppercase tracking-widest ${lint.ok ? 'text-emerald-300' : 'text-red-200'}`}>
              {lint.ok ? '✓ Parse OK' : '✗ Parse error'}
            </span>
          </div>
        </div>

        <div className="rounded-t-lg border border-b-0 border-zinc-700/70 bg-zinc-900/95 px-3 py-2 font-mono text-[11px]">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-zinc-300">
            in scope when decide(ctx) runs
          </div>
          <div className="text-zinc-300 truncate">
            <span className="text-zinc-400">import </span>
            <span className="text-emerald-300">{'{ ctx }'}</span>
            <span className="text-zinc-400"> from </span>
            <span className="text-amber-300">{`'./game-state'`}</span>
            <span className="text-zinc-400"> // every signal listed in the right rail →</span>
          </div>
          <div className="text-zinc-300 truncate">
            <span className="text-zinc-400">import </span>
            <span className="text-emerald-300">{'{ handStrength, evaluateCards, randomFloat, console }'}</span>
            <span className="text-zinc-400"> from </span>
            <span className="text-amber-300">{`'./helpers'`}</span>
          </div>
        </div>

        <textarea
          ref={taRef}
          value={code}
          onChange={e => onCodeChange(e.target.value)}
          spellCheck={false}
          rows={32}
          className={`w-full resize-y rounded-b-lg border bg-zinc-950/90 p-3 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-300 ${lint.ok ? 'border-zinc-700/70' : 'border-red-500/60'}`}
        />

        {!lint.ok && (
          <div className="rounded-md border border-red-500/40 bg-red-500/15 px-2 py-1.5 text-xs font-bold text-red-100">
            {lint.error}
          </div>
        )}

        <div className="text-[11px] font-bold leading-snug text-zinc-300">
          Server runs <code className="text-emerald-300">decide(ctx)</code> on every turn with a 150 ms CPU budget,
          32 KB max source, no I/O. Return one of:
          {' '}<code className="text-zinc-100">{'{ action: "fold|check|call" }'}</code>,
          {' '}<code className="text-zinc-100">{'{ action: "raise", amount: <chips> }'}</code>,
          {' '}<code className="text-zinc-100">{'{ action: "all_in" }'}</code>.
          Add <code className="text-zinc-100">say: "..."</code> to yell at the table. Errors → bot folds.
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDocsOpen(o => !o)}
            className="flex flex-1 items-center justify-between rounded-md border border-zinc-500/60 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700"
          >
            <span>Context reference</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {docsOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => copyText(buildCtxMarkdown(), 'ref')}
            className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
            title="Copy every signal + helper as markdown — paste into an LLM"
          >
            {copied === 'ref' ? '✓' : 'Copy'}
          </button>
        </div>
        {docsOpen && (
          <>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter signals (e.g. opponent, pot)…"
              className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1.5 text-xs font-bold text-white outline-none placeholder:text-zinc-400 focus:border-zinc-300"
            />
            <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
              {filteredGroups.map(g => (
                <div key={g.title}>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] font-black uppercase tracking-widest text-emerald-200">{g.title}</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{g.items.length}</div>
                  </div>
                  {g.description && (
                    <div className="mb-1.5 text-[11px] font-bold text-zinc-300">{g.description}</div>
                  )}
                  <div className="space-y-1">
                    {g.items.map(it => (
                      <DocsItem key={it.path} item={it} onInsert={insertAtCursor} />
                    ))}
                  </div>
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <div className="text-xs font-bold text-zinc-300">No fields match.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

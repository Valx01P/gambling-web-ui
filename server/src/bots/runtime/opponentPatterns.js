// Per-opponent + table behavioral pattern detection.
//
// signals.js exposes raw counts (vpip, aggressionFreq, fold counts, recent
// bet sizes, revealed showdowns…). This module turns those into the
// higher-level "what kind of player is this" labels and frequency
// breakdowns that bots reach for first when adapting to opponents.
//
// All numbers are observation-derived — no opponent hole cards are used
// unless they were revealed at a showdown. Pure functions, no I/O.

import { GAME_PHASES } from '../../config/constants.js'

// Internal helpers ------------------------------------------------------

const RANK_VAL = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

// Coarse preflop strength score for a 2-card combo we've SEEN. Used to tag
// each revealed showdown as "premium / strong / medium / weak" so we can
// compute "showed-down-weak rate" → bluff suspicion.
function showdownStrengthLabel(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return 'unknown'
  const a = RANK_VAL[cards[0].rank]
  const b = RANK_VAL[cards[1].rank]
  if (!a || !b) return 'unknown'
  const high = Math.max(a, b)
  const low = Math.min(a, b)
  const pair = a === b
  if (pair && high >= 10) return 'premium'             // TT+
  if (pair) return 'medium'                            // 22-99
  if (high === 14 && low >= 10) return 'premium'       // AT+
  if (high >= 12 && low >= 10) return 'strong'         // broadways
  if (high === 14) return 'medium'                     // any ace
  if (high - low <= 2 && high >= 9) return 'medium'    // suited connectors mid+
  return 'weak'
}

// Action-list filters that come up multiple times.
function actionsOf(playerId, actions) {
  return (actions || []).filter(a => a.playerId === playerId)
}
function isAggression(a) { return a.action === 'raise' || a.action === 'all_in' }
function isPassive(a)    { return a.action === 'call' || a.action === 'check' }

// Public API ------------------------------------------------------------

// Walks the player's actions in the current hand + handHistory and computes
// a structured behavior snapshot. Cheap enough to run for every opponent on
// every bot decision (small constant cost — handHistory is capped at 25).
export function computeOpponentPatterns({
  playerId,
  rawStats,         // game.playerStats.get(playerId) snapshot
  currentHandActions,
  handHistory,
  bigBlind,
  myChips,
  oppChips,
  oppRevealedShowdowns  // [{ cards, won, handName, pot, handIndex }, …]
}) {
  const allActions = [
    ...handHistory.flatMap(h => (h.actions || [])),
    ...currentHandActions
  ]
  const ours = actionsOf(playerId, allActions)

  // --- Per-street action counts ----------------------------------------
  const pf = ours.filter(a => a.phase === GAME_PHASES.PREFLOP)
  const fl = ours.filter(a => a.phase === GAME_PHASES.FLOP)
  const tn = ours.filter(a => a.phase === GAME_PHASES.TURN)
  const rv = ours.filter(a => a.phase === GAME_PHASES.RIVER)

  const pfAggressions = pf.filter(isAggression).length
  const pfCalls = pf.filter(a => a.action === 'call').length
  const pfFolds = pf.filter(a => a.action === 'fold').length
  // A "limp" = first-in call equal to the big blind (didn't raise, didn't
  // face a raise). Heuristic: action is 'call' on preflop and the amount
  // is ≤ bigBlind.
  const limps = pf.filter(a => a.action === 'call' && a.amount <= (bigBlind || 10)).length

  // --- Postflop aggregates --------------------------------------------
  const postflopActions = [...fl, ...tn, ...rv]
  const postflopAggressions = postflopActions.filter(isAggression).length
  const postflopPassive = postflopActions.filter(isPassive).length
  const oversizeBets = postflopActions.filter(a => isAggression(a) && a.potBefore > 0 && a.amount >= a.potBefore * 1.25).length

  // --- C-bet / donk / check-raise detection per hand ------------------
  // Group by handIndex so we only consider sequences inside the same hand.
  const handsById = new Map()
  for (const h of handHistory) handsById.set(h.handIndex, h)
  // The current hand isn't in handsById (it's still in progress) — bundle
  // its actions under a synthetic key so the loop logic is uniform.
  const handGroups = new Map()
  for (const h of handHistory) handGroups.set(h.handIndex, h.actions || [])
  if (currentHandActions.length > 0) handGroups.set('__current__', currentHandActions)

  let cBetOpportunities = 0
  let cBetsFired = 0
  let donkBets = 0
  let checkRaises = 0
  let threeBetSpots = 0
  let foldedToThreeBet = 0
  let threeBetsFired = 0
  let openOpportunities = 0
  let opensFired = 0
  for (const [, actions] of handGroups) {
    const sorted = [...actions].sort((a, b) => (a.seq || 0) - (b.seq || 0))
    // Preflop summary: who opened? Who 3-bet?
    let preflopOpener = null
    let threeBettor = null
    let raisesSeen = 0
    for (const a of sorted) {
      if (a.phase !== GAME_PHASES.PREFLOP) break
      if (isAggression(a)) {
        raisesSeen += 1
        if (raisesSeen === 1) preflopOpener = a.playerId
        if (raisesSeen === 2) threeBettor = a.playerId
      }
    }
    // "Open opportunity" = first voluntary action preflop was available to us
    // and we either opened or didn't.
    const firstVoluntary = sorted.find(a => a.phase === GAME_PHASES.PREFLOP && a.action !== 'fold')
    if (firstVoluntary && firstVoluntary.playerId === playerId) {
      openOpportunities += 1
      if (isAggression(firstVoluntary)) opensFired += 1
    }
    // 3-bet opportunity: someone opened before us and our next preflop
    // action is what we did.
    if (preflopOpener && preflopOpener !== playerId) {
      const ourFirstResponse = sorted.find(a =>
        a.phase === GAME_PHASES.PREFLOP && a.playerId === playerId
      )
      if (ourFirstResponse) {
        threeBetSpots += 1
        if (isAggression(ourFirstResponse)) threeBetsFired += 1
      }
    }
    // Fold to 3-bet: we opened, someone re-raised, what did we do next?
    if (preflopOpener === playerId && threeBettor && threeBettor !== playerId) {
      const ourResponse = sorted
        .filter(a => a.phase === GAME_PHASES.PREFLOP && a.playerId === playerId && (a.seq ?? 0) > 0)
        .find((a, _i, arr) => arr.length >= 2)
      // Last preflop action after the 3-bet:
      const ourLastPreflop = [...sorted].reverse().find(a => a.phase === GAME_PHASES.PREFLOP && a.playerId === playerId)
      if (ourLastPreflop?.action === 'fold') foldedToThreeBet += 1
    }
    // C-bet: preflop opener fires a flop bet.
    if (preflopOpener === playerId) {
      const wentToFlop = sorted.some(a => a.phase === GAME_PHASES.FLOP)
      if (wentToFlop) {
        cBetOpportunities += 1
        const ourFirstFlop = sorted.find(a => a.phase === GAME_PHASES.FLOP && a.playerId === playerId)
        if (ourFirstFlop && isAggression(ourFirstFlop)) cBetsFired += 1
      }
    }
    // Donk-bet: NOT the preflop aggressor but leads into them on a postflop street.
    if (preflopOpener && preflopOpener !== playerId) {
      for (const street of [GAME_PHASES.FLOP, GAME_PHASES.TURN, GAME_PHASES.RIVER]) {
        const streetActions = sorted.filter(a => a.phase === street)
        const first = streetActions[0]
        if (first && first.playerId === playerId && isAggression(first)) donkBets += 1
      }
    }
    // Check-raise: same street, we check, then we raise after someone else bets.
    for (const street of [GAME_PHASES.FLOP, GAME_PHASES.TURN, GAME_PHASES.RIVER]) {
      const streetActions = sorted.filter(a => a.phase === street && a.playerId === playerId)
      if (streetActions.length >= 2) {
        const idx = streetActions.findIndex(a => a.action === 'check')
        if (idx !== -1) {
          const later = streetActions.slice(idx + 1).find(isAggression)
          if (later) checkRaises += 1
        }
      }
    }
  }

  // --- Showdown reveal analysis ---------------------------------------
  // What did they actually show at showdowns? "Weak hands shown" = strong
  // bluff-suspicion signal because most players don't take a weak hand
  // to the river unless they're bluffing or stationing.
  const revealCount = oppRevealedShowdowns?.length || 0
  let weakReveals = 0
  let strongReveals = 0
  for (const r of (oppRevealedShowdowns || [])) {
    const lbl = showdownStrengthLabel(r.cards)
    if (lbl === 'weak') weakReveals += 1
    if (lbl === 'premium' || lbl === 'strong') strongReveals += 1
  }
  const showdownBluffRate = revealCount > 0 ? weakReveals / revealCount : 0
  const showdownStrongRate = revealCount > 0 ? strongReveals / revealCount : 0

  // --- Recent performance / tilt heuristic ----------------------------
  const recentHands = handHistory.slice(-10)
  const recentNet = recentHands.reduce((s, h) => s + (h.profitByPlayer?.[playerId] ?? 0), 0)
  const recentWins = recentHands.filter(h =>
    (h.winners || []).some(w => w.playerId === playerId)
  ).length
  const recentLossBB = bigBlind > 0 ? Math.max(0, -recentNet / bigBlind) : 0
  // Tilt: down 20+ BB in recent window. Cool: up 10+ BB. Otherwise normal.
  let tilt = 'normal'
  if (recentLossBB >= 20) tilt = 'tilted'
  else if (bigBlind > 0 && recentNet / bigBlind >= 10) tilt = 'cool'

  // --- Lifetime rates from rawStats (already aggregated by the engine) -
  const handsObserved = rawStats?.handsObserved || 0
  const vpipRate = handsObserved > 0 ? (rawStats?.vpipHands || 0) / handsObserved : 0
  const aggressionFreq = handsObserved > 0 ? (rawStats?.aggressiveActions || 0) / handsObserved : 0
  const wtsdRate = handsObserved > 0 ? (rawStats?.showdownsSeen || 0) / handsObserved : 0
  const wsdRate  = (rawStats?.showdownsSeen || 0) > 0 ? (rawStats?.showdownsWon || 0) / (rawStats?.showdownsSeen || 1) : 0

  // --- Computed frequency knobs ---------------------------------------
  const cBetFreq  = cBetOpportunities > 0 ? cBetsFired / cBetOpportunities : 0
  const threeBetFreq = threeBetSpots > 0 ? threeBetsFired / threeBetSpots : 0
  const foldTo3BetRate = (() => {
    // Denominator: times this player opened and got 3-bet.
    let denom = 0
    let numer = 0
    for (const [, actions] of handGroups) {
      const sorted = [...actions].sort((a, b) => (a.seq || 0) - (b.seq || 0))
      let firstRaise = null, secondRaise = null
      for (const a of sorted) {
        if (a.phase !== GAME_PHASES.PREFLOP) break
        if (isAggression(a)) {
          if (!firstRaise) firstRaise = a
          else if (!secondRaise) secondRaise = a
        }
      }
      if (firstRaise?.playerId === playerId && secondRaise && secondRaise.playerId !== playerId) {
        denom += 1
        const last = [...sorted].reverse().find(a => a.phase === GAME_PHASES.PREFLOP && a.playerId === playerId)
        if (last?.action === 'fold') numer += 1
      }
    }
    return denom > 0 ? numer / denom : 0
  })()
  const openFreq = openOpportunities > 0 ? opensFired / openOpportunities : 0
  const limpFreq = pf.length > 0 ? limps / pf.length : 0
  const oversizeFreq = postflopActions.length > 0 ? oversizeBets / postflopActions.length : 0

  // --- Archetype classification (single label, easy for rule code) -----
  // VPIP × aggression matrix:
  //   tight passive  → nit / rock
  //   tight aggressive → TAG (tight-aggressive, "regular")
  //   loose passive  → fish / station
  //   loose aggressive → LAG / maniac (separate by aggression level)
  let archetype = 'unknown'
  if (handsObserved >= 6) {
    const tight = vpipRate <= 0.22
    const loose = vpipRate >= 0.40
    const aggressive = aggressionFreq >= 0.22
    if (tight && !aggressive) archetype = 'nit'
    else if (tight && aggressive) archetype = 'tag'
    else if (loose && aggressive) archetype = aggressionFreq >= 0.40 ? 'maniac' : 'lag'
    else if (loose && !aggressive) archetype = 'fish'
    else archetype = 'reg'
  }

  // --- Single-glance summary bools ------------------------------------
  // These let bot code branch on the most common "what is this player"
  // questions without computing thresholds itself.
  const stickyCaller = wtsdRate >= 0.40 && aggressionFreq < 0.18
  const bluffer = showdownBluffRate >= 0.20 || (aggressionFreq >= 0.30 && wsdRate <= 0.40 && handsObserved >= 8)
  const aggressionBias = aggressionFreq >= 0.30 ? 'over_aggressive'
                       : aggressionFreq <= 0.10 ? 'passive'
                       : 'balanced'

  // --- Higher-order exploit scores (0..1) ---------------------------------
  //
  // bluffCatchScore: how much you should weight calling them light. Goes up
  // when they bluff a lot (shown weak at showdown), have high overall
  // aggression, and don't win at showdown often. Bots can multiply their
  // call threshold by (1 - bluffCatchScore) to be looser against bluffers.
  let bluffCatchScore = 0
  if (handsObserved >= 6) {
    bluffCatchScore += Math.min(0.4, aggressionFreq) * 0.8         // up to +0.32
    bluffCatchScore += showdownBluffRate * 0.5                     // up to +0.50
    bluffCatchScore += (1 - Math.min(1, wsdRate * 2)) * 0.15       // tighter showdown ↑
    if (oversizeBets / Math.max(1, postflopActions.length) >= 0.10) bluffCatchScore += 0.10
    bluffCatchScore = Math.max(0, Math.min(1, bluffCatchScore))
  }
  // bluffTargetScore: how good they are to bluff at. High = fold a lot,
  // low wtsd, weak preflop range, low recent aggression. Bots can gate
  // their bluff frequency on this number.
  let bluffTargetScore = 0
  if (handsObserved >= 6) {
    const foldRate = handsObserved > 0 ? (rawStats?.foldsToBet || 0) / handsObserved : 0
    bluffTargetScore += Math.min(0.5, foldRate * 2)                // up to +0.50
    bluffTargetScore += (1 - Math.min(1, wtsdRate * 2.5)) * 0.30   // doesn't reach showdown
    bluffTargetScore += (1 - Math.min(1, aggressionFreq * 3)) * 0.20
    bluffTargetScore = Math.max(0, Math.min(1, bluffTargetScore))
  }
  // foldEquityScore: cleaner read of "do they fold to pressure". 0..1.
  // Doesn't care about showdown reveals, just call/fold tendencies.
  const foldRate = handsObserved > 0 ? (rawStats?.foldsToBet || 0) / handsObserved : 0
  const foldEquityScore = Math.max(0, Math.min(1, foldRate * 1.5 + (1 - Math.min(1, wtsdRate * 2)) * 0.3))

  // --- Stack pressure -------------------------------------------------
  // Already on the opponent record as effectiveStackBB; we add the raw
  // "bb's they have left", phrased as "bbToBust" so the intent is obvious
  // when a bot is deciding whether to shove a short stack.
  const stackBB = bigBlind > 0 ? oppChips / bigBlind : 0
  const bbToBust = stackBB

  return {
    archetype,                    // 'nit' | 'tag' | 'lag' | 'maniac' | 'fish' | 'reg' | 'unknown'
    aggressionBias,               // 'passive' | 'balanced' | 'over_aggressive'
    bluffer,                      // boolean — recent reveals or stats suggest they bluff
    stickyCaller,                 // boolean — wtsd high + aggression low = station

    // Frequencies — each 0..1.
    openFreq,                     // opens / open opportunities
    limpFreq,                     // limps / preflop actions
    threeBetFreq,                 // 3-bets / 3-bet opportunities
    foldTo3BetRate,               // folded to 3-bet / opened-and-got-3bet
    cBetFreq,                     // c-bets / c-bet opportunities
    oversizeFreq,                 // overbets / postflop actions
    checkRaises,                  // raw count (low frequencies; raw is more readable)
    donkBets,                     // raw count

    // Showdown reveal patterns.
    revealCount,
    weakReveals,
    strongReveals,
    showdownBluffRate,            // weakReveals / revealCount
    showdownStrongRate,           // strongReveals / revealCount

    // Recent trend.
    recentWins,                   // wins in last 10 hands
    recentNetChips: recentNet,
    recentLossBB,
    tilt,                         // 'cool' | 'normal' | 'tilted'

    // Stack pressure.
    stackBB,
    bbToBust,

    // Higher-order exploit scores (0..1). Use them to gate decision tunables:
    //   * bluffCatchScore — call them lighter when this is high.
    //   * bluffTargetScore — bluff them more when this is high.
    //   * foldEquityScore — your bluffs convert more often when this is high.
    bluffCatchScore,
    bluffTargetScore,
    foldEquityScore,

    // Diagnostic: how much data this is based on.
    sample: handsObserved,
    sampleConfidence: handsObserved >= 20 ? 'high' : handsObserved >= 8 ? 'medium' : 'low'
  }
}

// Roll up per-opponent patterns into a single table-level read. Bots check
// this when deciding overall posture (e.g., open wider at a tight table,
// trap more at a maniac table).
export function summarizeTable(opponentPatterns) {
  if (!opponentPatterns || opponentPatterns.length === 0) {
    return {
      sampleSize: 0,
      avgVpip: 0.30,
      avgAggression: 0.15,
      dominantArchetype: 'unknown',
      tightTable: false,
      looseTable: false,
      aggressiveTable: false,
      passiveTable: false,
      tiltedSeats: 0,
      bluffers: 0,
      stickyCallers: 0
    }
  }
  const counts = {}
  let tiltedSeats = 0
  let bluffers = 0
  let stickyCallers = 0
  for (const p of opponentPatterns) {
    counts[p.archetype] = (counts[p.archetype] || 0) + 1
    if (p.tilt === 'tilted') tiltedSeats += 1
    if (p.bluffer) bluffers += 1
    if (p.stickyCaller) stickyCallers += 1
  }
  const dominantArchetype = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
  // Average aggregates — useful as one-glance scalars.
  const n = opponentPatterns.length
  const sum = (key) => opponentPatterns.reduce((s, p) => s + (p[key] || 0), 0)
  const avg = (key) => n > 0 ? sum(key) / n : 0
  // Looseness / aggression on 0..1 scales — handy multipliers for
  // strategy posture. Looseness is rough proxy from per-opp open + 3-bet
  // frequencies + bluff rate; aggression averages oversizeFreq + cBet.
  const loosenessIndex = Math.min(1, avg('openFreq') * 0.6 + avg('limpFreq') * 0.4 + avg('threeBetFreq') * 0.3)
  const aggressionIndex = Math.min(1, avg('cBetFreq') * 0.5 + avg('oversizeFreq') * 0.5 + avg('threeBetFreq') * 0.4)
  return {
    sampleSize: n,
    archetypeCounts: counts,
    dominantArchetype,
    tiltedSeats,
    bluffers,
    stickyCallers,
    tightTable: dominantArchetype === 'nit' || dominantArchetype === 'tag',
    looseTable: dominantArchetype === 'fish' || dominantArchetype === 'lag' || dominantArchetype === 'maniac',
    aggressiveTable: dominantArchetype === 'maniac' || dominantArchetype === 'lag' || dominantArchetype === 'tag',
    passiveTable: dominantArchetype === 'fish' || dominantArchetype === 'nit',
    loosenessIndex,                                                 // 0..1 — higher = looser table
    aggressionIndex,                                                // 0..1 — higher = more aggressive table
    avgBluffCatchScore: avg('bluffCatchScore'),
    avgBluffTargetScore: avg('bluffTargetScore'),
    avgFoldEquityScore: avg('foldEquityScore')
  }
}

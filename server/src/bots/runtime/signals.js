import { GAME_PHASES } from '../../config/constants.js'
import { strengthFor, tierIndex } from './handStrength.js'
import { evaluateHand, getHandName } from '../../poker/handEvaluator.js'
import {
  preflopHandScore,
  postflopStrengthScore,
  calculateRangeEquity,
  inferRangesForOpponents
} from './equity.js'
import { computeOpponentPatterns, summarizeTable } from './opponentPatterns.js'
import { analyzeHand } from './handAnalyzer.js'

const ROUND_INDEX = {
  [GAME_PHASES.PREFLOP]: 0,
  [GAME_PHASES.FLOP]: 1,
  [GAME_PHASES.TURN]: 2,
  [GAME_PHASES.RIVER]: 3
}

function positionFor(playerIdx, dealerIdx, total) {
  if (playerIdx < 0) return 'middle'
  if (total === 2) return playerIdx === dealerIdx ? 'btn' : 'bb'
  const offset = (playerIdx - dealerIdx + total) % total
  if (offset === 0) return 'btn'
  if (offset === 1) return 'sb'
  if (offset === 2) return 'bb'
  if (offset === total - 1) return 'late'
  if (offset === 3) return 'utg'
  return 'middle'
}

function freezeDeep(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const k of Object.keys(obj)) freezeDeep(obj[k])
  return obj
}

const RANK_VALS = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 }

// Quick draw detection: flush draw, open-ended straight, gutshot. Outs is a
// rough estimate (flush=9, open-ended=8, gutshot=4, combo draw -1 for overlap).
function computeDraws(holeCards, communityCards) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2 || !Array.isArray(communityCards) || communityCards.length === 0) {
    return { hasFlushDraw: false, hasOpenEnded: false, hasGutshot: false, outs: 0 }
  }
  const all = [...holeCards, ...communityCards]
  const suitCounts = {}
  for (const c of all) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1
  const hasFlushDraw = Object.values(suitCounts).some(n => n === 4)

  const ranks = new Set(all.map(c => RANK_VALS[c.rank]).filter(Boolean))
  if (ranks.has(14)) ranks.add(1) // ace can play low

  let hasOpenEnded = false
  let hasGutshot = false
  for (let start = 1; start <= 10; start++) {
    let presentCount = 0
    let missingPos = -1
    for (let i = 0; i < 5; i++) {
      if (ranks.has(start + i)) presentCount++
      else missingPos = i
    }
    if (presentCount === 4) {
      if (missingPos === 0 || missingPos === 4) hasOpenEnded = true
      else hasGutshot = true
    }
    if (presentCount === 5) {
      // Already a straight in this window — short-circuit; bestHand reports it.
      hasOpenEnded = false
      hasGutshot = false
      break
    }
  }
  if (hasOpenEnded) hasGutshot = false

  let outs = 0
  if (hasFlushDraw) outs += 9
  if (hasOpenEnded) outs += 8
  else if (hasGutshot) outs += 4
  if (hasFlushDraw && (hasOpenEnded || hasGutshot)) outs -= 1 // dedupe overlap

  return { hasFlushDraw, hasOpenEnded, hasGutshot, outs }
}

// Cosmetic label for an inferred opponent range, surfaced in the bot context
// so user code can log/reason about it without doing the bucket math itself.
function labelForTopPct(pct) {
  if (pct <= 0.06) return 'premium'
  if (pct <= 0.15) return 'tight'
  if (pct <= 0.30) return 'standard'
  if (pct <= 0.55) return 'loose'
  return 'wide'
}

function classifyPreflopAction(handActions) {
  let raises = 0
  for (const a of handActions) {
    if (a.phase !== GAME_PHASES.PREFLOP) break
    if (a.action === 'raise' || a.action === 'all_in') raises += 1
  }
  if (raises === 0) return 'unopened'
  if (raises === 1) return 'opened'
  if (raises === 2) return 'three_bet'
  return 'four_bet_plus'
}

// Classify the board texture. Cheap math, big leverage — bots that condition
// their c-bet sizing on dry vs wet boards play meaningfully better.
// Returns null preflop (no board), otherwise a structured object with the
// breakdown plus a single 'wetness' summary string for bots that just want
// a label.
function computeBoardTexture(communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length < 3) return null
  const ranks = communityCards.map(c => RANK_VALS[c.rank]).filter(Boolean).sort((a, b) => b - a)
  const suits = communityCards.map(c => c.suit)

  // Pairing: count repeated ranks.
  const rankCounts = {}
  for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1
  const pairs = Object.values(rankCounts).filter(c => c >= 2).length
  const trips = Object.values(rankCounts).some(c => c >= 3)

  // Suit profile.
  const suitCounts = {}
  for (const s of suits) suitCounts[s] = (suitCounts[s] || 0) + 1
  const maxSuit = Math.max(...Object.values(suitCounts))
  const monotone = maxSuit === communityCards.length     // all one suit
  const twoTone  = !monotone && maxSuit >= 2 && (communityCards.length - maxSuit) >= 1

  // Connectedness: gaps between consecutive board ranks. Smaller gaps =
  // more straight draws available.
  const uniqRanks = [...new Set(ranks)].sort((a, b) => b - a)
  const span = uniqRanks.length >= 2 ? uniqRanks[0] - uniqRanks[uniqRanks.length - 1] : 0
  const connected = uniqRanks.length >= 2 && span <= 4
  // Ace-low wheel possibility (A-5-x straight draw).
  const aceLow = uniqRanks.includes(14) && uniqRanks.some(r => r <= 5)

  const highCard = uniqRanks[0] || 0
  const drawHeavy = monotone || twoTone || connected || aceLow

  // Coarse wetness label most bot authors will reach for first.
  let wetness = 'dry'
  if (monotone || (connected && twoTone)) wetness = 'volatile'
  else if (drawHeavy) wetness = 'wet'

  return {
    cards: communityCards.length,
    paired: pairs > 0,
    pairsCount: pairs,
    trips,
    monotone,
    twoTone,
    rainbow: maxSuit === 1,
    maxSuitCount: maxSuit,
    connected,
    span,
    aceLow,
    drawHeavy,
    highCard,                // 14 = A, 13 = K, …
    wetness                  // 'dry' | 'wet' | 'volatile'
  }
}

// Snapshot of what this player revealed at past showdowns this session.
// Combs through handHistory for entries where p.id has a non-null cards
// array (server only fills cards for non-folded participants at showdown).
function revealedShowdownsFor(handHistory, playerId) {
  const out = []
  for (const h of handHistory) {
    const cards = h.cards?.[playerId]
    if (!cards || cards.length !== 2) continue
    out.push({
      handIndex: h.handIndex,
      cards: cards.map(c => ({ ...c })),
      won: (h.winners || []).some(w => w.playerId === playerId),
      handName: h.playerHandNames?.[playerId] || null,
      pot: h.pot
    })
  }
  return out
}

// Average milliseconds it took this player to act, across their actions in
// the (rolling) handHistory + the current hand. Provides a tell against
// humans — bots act on a fixed schedule so this number is mostly useful
// against people. Returns null when there isn't enough data.
function avgActionTime(allActions, playerId) {
  let total = 0
  let count = 0
  for (const a of allActions) {
    if (a.playerId !== playerId) continue
    if (typeof a.tookMs !== 'number') continue
    if (a.tookMs <= 0 || a.tookMs > 120_000) continue   // ignore outliers
    total += a.tookMs
    count += 1
  }
  return count > 0 ? Math.round(total / count) : null
}

// Pure: takes the live PokerGame + the bot's seat. Returns the full ctx the
// bot's decide(ctx) function reads. Read-only — the object and everything
// reachable from it is deep-frozen.
export function buildContext(game, bot) {
  const players = game.players
  const myIdx = players.findIndex(p => p.id === bot.id)
  const me = players[myIdx]
  if (!me) return freezeDeep({ phase: game.phase, error: 'not seated' })

  const total = players.length
  const phase = game.phase
  const isPreflop = phase === GAME_PHASES.PREFLOP
  const roundIndex = ROUND_INDEX[phase] ?? -1
  const myBet = game.playerBets.get(bot.id) || 0
  const myTotalBet = game.playerTotalBets.get(bot.id) || 0
  const toCall = Math.max(0, game.currentBet - myBet)

  const holeCards = (game.playerHands.get(bot.id) || []).map(c => ({ ...c }))
  const communityCards = (game.communityCards || []).map(c => ({ ...c }))

  const handStrength = strengthFor(holeCards, communityCards)
  let bestHand = null
  if (holeCards.length === 2 && communityCards.length >= 3) {
    try {
      const evalResult = evaluateHand([...holeCards, ...communityCards])
      bestHand = {
        rank: evalResult.rank,
        name: getHandName(evalResult),
        bestCards: (evalResult.bestCards || []).map(c => ({ ...c }))
      }
    } catch {}
  }

  // Numeric strength independent of the categorical bucket. Preflop uses the
  // Chen-style score (0-1), postflop uses an equity-baseline by hand rank.
  const handStrengthScore = communityCards.length >= 3
    ? (postflopStrengthScore(holeCards, communityCards) ?? 0)
    : (holeCards.length === 2 ? preflopHandScore(holeCards[0], holeCards[1]) : 0)

  const bigBlind = game.bigBlind || 10
  const smallBlind = game.smallBlind || Math.floor(bigBlind / 2)

  const opponentsRaw = players.filter(p => p.id !== bot.id)
  const opponents = opponentsRaw.map(p => {
    const stats = game.playerStats?.get(p.id)
    const handsObserved = stats?.handsObserved || 0
    const showdownsSeen = stats?.showdownsSeen || 0
    const oppChips = p.chips
    const oppBet = game.playerBets.get(p.id) || 0
    const oppTotalBet = game.playerTotalBets.get(p.id) || 0
    const oppEff = Math.min(me.chips + myBet, oppChips + oppBet)
    return {
      id: p.id,
      seat: players.indexOf(p),
      name: p.username,
      isBot: Boolean(p.isBot),
      botColor: p.botColor || null,
      chips: oppChips,
      bet: oppBet,
      totalBet: oppTotalBet,
      folded: game.foldedPlayers.has(p.id),
      allIn: game.allInPlayers.has(p.id),
      lastAction: game.playerActions.get(p.id) || null,
      position: positionFor(players.indexOf(p), game.dealerIndex, total),
      // Stack vs the bot, in big blinds — same metric you'd see in a HUD.
      effectiveStackBB: bigBlind > 0 ? oppEff / bigBlind : 0,
      // "Committed" = pot-committed. Crude rule: their total bet this hand
      // is at least half of what they had at hand start. Useful for bluffs
      // and shove decisions.
      committed: oppTotalBet > 0 && oppTotalBet >= (oppChips + oppTotalBet) / 2,
      stats: {
        handsObserved,
        handsPlayed: stats?.handsPlayed || 0,
        vpip: handsObserved > 0 ? (stats?.vpipHands || 0) / handsObserved : 0,
        aggressionFreq: handsObserved > 0 ? (stats?.aggressiveActions || 0) / handsObserved : 0,
        foldsToBet: stats?.foldsToBet || 0,
        profit: stats?.profit || 0,
        showdownsSeen,
        showdownsWon: stats?.showdownsWon || 0,
        wtsdRate: handsObserved > 0 ? showdownsSeen / handsObserved : 0,
        wonAtShowdownRate: showdownsSeen > 0 ? (stats?.showdownsWon || 0) / showdownsSeen : 0,
        recentBetSizes: Array.isArray(stats?.recentBetSizes) ? stats.recentBetSizes.slice() : [],
        avgRecentBetSize: stats?.recentBetSizes?.length
          ? stats.recentBetSizes.reduce((a, b) => a + b, 0) / stats.recentBetSizes.length
          : 0
      }
    }
  })

  const activeOpps = opponents.filter(o => !o.folded)
  let lastOpponentAction = ''
  for (const o of opponents) if (o.lastAction?.action) lastOpponentAction = o.lastAction.action

  // --- Equity vs estimated ranges ---------------------------------------
  // Range inference uses each opponent's preflop profile + postflop bet
  // sizing. Equity is a Monte Carlo against those ranges. Both numbers are
  // exposed to the bot so it can make calls/folds based on actual win rate
  // instead of a coarse "premium/strong/medium" bucket.
  const activeOpponentRaw = opponentsRaw.filter(p =>
    !game.foldedPlayers.has(p.id) && !game.allInPlayers.has(p.id) && !game.removedPlayers.has(p.id)
  )
  const oppRanges = (holeCards.length === 2)
    ? inferRangesForOpponents(game, activeOpponentRaw)
    : []
  const opponentRangesById = new Map(oppRanges.map(r => [r.id, r]))
  // Annotate the public opponents array with the inferred range info.
  for (const o of opponents) {
    const r = opponentRangesById.get(o.id)
    o.estimatedTopPct = r?.topPct ?? null
    o.estimatedRangeLabel = r ? labelForTopPct(r.topPct) : null
  }

  let equity = null
  let equityVsRandom = null
  if (holeCards.length === 2 && oppRanges.length > 0) {
    const equityResult = calculateRangeEquity({
      holeCards,
      communityCards,
      opponents: oppRanges.map(r => ({ id: r.id, _topPct: r.topPct })),
      iterations: 600
    })
    equity = equityResult.equity
    // Vs-random: same MC but with topPct = 1 for everyone. Useful baseline
    // for "how strong is my hand on this board period" without modeling.
    const randomResult = calculateRangeEquity({
      holeCards,
      communityCards,
      opponents: oppRanges.map(r => ({ id: r.id, _topPct: 1 })),
      iterations: 400
    })
    equityVsRandom = randomResult.equity
  } else if (holeCards.length === 2 && activeOpponentRaw.length === 0) {
    equity = 1
    equityVsRandom = 1
  }

  const facingBet = toCall > 0
  const facingRaise = facingBet && game.aggressionCount >= 2
  const facingAllIn = facingBet && Boolean(game.currentBetContext?.isAllIn)
  const potOdds = facingBet ? toCall / (game.pot + toCall) : 0
  const oppEffective = activeOpps.length === 0
    ? me.chips
    : Math.min(...activeOpps.map(p => p.chips + p.bet))
  const effectiveStack = Math.min(me.chips + myBet, oppEffective)
  // Stack-to-pot ratio. Pro bots use this as a commitment threshold:
  // SPR < 1 ≈ committed, SPR < 4 ≈ commit with strong made hands, etc.
  const spr = game.pot > 0 ? effectiveStack / game.pot : effectiveStack / Math.max(bigBlind, 1)

  const myStats = game.playerStats?.get(bot.id) || {
    handsObserved: 0, handsPlayed: 0, vpipHands: 0, aggressiveActions: 0,
    foldsToBet: 0, profit: 0, showdownsSeen: 0, showdownsWon: 0
  }

  const actionHistory = (game.handActionHistory || []).slice()

  // Last 25 completed hands at this table — shallow copy each one so the
  // freeze pass doesn't lock down the engine's own data structures.
  const handHistory = (game.handHistory || []).slice(-25).map(h => ({
    handIndex: h.handIndex,
    type: h.type,
    pot: h.pot,
    // Per-hand blind levels — surfaced because the table can vote new
    // blinds mid-session via contest mode, so historical pots aren't
    // necessarily on the same scale as the current one.
    smallBlind: h.smallBlind ?? null,
    bigBlind: h.bigBlind ?? null,
    communityCards: (h.communityCards || []).map(c => ({ ...c })),
    winners: h.winners.slice(),
    profit: h.profitsByPlayer[bot.id] ?? 0,
    profitByPlayer: { ...h.profitsByPlayer },
    cards: h.cards
      ? Object.fromEntries(
          Object.entries(h.cards).map(([pid, cards]) => [pid, cards ? cards.map(c => ({ ...c })) : null])
        )
      : {},
    actionsByPlayer: h.actionsByPlayer
      ? Object.fromEntries(
          Object.entries(h.actionsByPlayer).map(([pid, list]) => [pid, list.slice()])
        )
      : {},
    playerHandNames: { ...(h.playerHandNames || {}) },
    actions: (h.actions || []).slice()
  }))

  const lastShowdown = handHistory.slice().reverse().find(h => h.type === 'showdown') || null

  // --- Derived "advanced" signals --------------------------------------------

  // Most recent voluntary aggressor this hand (raise/all_in, ignoring blinds).
  let lastAggressor = null
  for (let i = actionHistory.length - 1; i >= 0; i--) {
    const a = actionHistory[i]
    if (a.action === 'raise' || a.action === 'all_in') {
      lastAggressor = {
        id: a.playerId,
        name: a.playerName,
        action: a.action,
        amount: a.amount,
        phase: a.phase,
        seq: a.seq,
        isMe: a.playerId === bot.id
      }
      break
    }
  }

  // Players still to act this round vs already acted (excluding the bot itself).
  let playersToAct = 0
  let playersActedThisRound = 0
  for (const p of players) {
    if (p.id === bot.id) continue
    if (game.foldedPlayers.has(p.id) || game.allInPlayers.has(p.id) || game.removedPlayers.has(p.id)) continue
    if (game.roundActed?.has?.(p.id)) playersActedThisRound += 1
    else playersToAct += 1
  }

  // Stack rank — who's the chip leader, who's short, where do I sit?
  const seatChipsList = players
    .filter(p => p.isConnected !== false)
    .map(p => ({ id: p.id, name: p.username, chips: p.chips }))
    .sort((a, b) => b.chips - a.chips)
  const totalChipsInPlay = seatChipsList.reduce((sum, s) => sum + s.chips, 0)
  const myChipRank = Math.max(1, seatChipsList.findIndex(s => s.id === bot.id) + 1)
  const chipLeader = seatChipsList[0]
    ? { id: seatChipsList[0].id, name: seatChipsList[0].name, chips: seatChipsList[0].chips, isMe: seatChipsList[0].id === bot.id }
    : null
  const shortStack = seatChipsList.length
    ? { ...seatChipsList[seatChipsList.length - 1], isMe: seatChipsList[seatChipsList.length - 1].id === bot.id }
    : null

  // Pot-committed: half (or more) of your starting stack this hand is already in.
  const myCommitted = myTotalBet > 0 && myTotalBet >= (me.chips + myTotalBet) / 2

  // Preflop story: did anyone open? Did it get 3-bet? 4-bet+?
  const preflopActionProfile = classifyPreflopAction(actionHistory)

  // --- Per-opponent enrichments -------------------------------------------
  // Now that handHistory + actionHistory are available, layer in everything
  // a bot author might want to peek at per opponent. All of this is derived
  // from public information — never from cards the opponent didn't reveal.
  const allHistoricalActions = handHistory.flatMap(h => h.actions || [])
  for (const o of opponents) {
    // Their action history in the *current* hand (preserves chronological order).
    o.currentHandActions = actionHistory.filter(a => a.playerId === o.id).map(a => ({
      seq: a.seq, phase: a.phase, action: a.action, amount: a.amount,
      potBefore: a.potBefore, toCallBefore: a.toCallBefore, tookMs: a.tookMs || 0
    }))
    // How long they took on their most recent action this hand.
    const lastA = o.currentHandActions[o.currentHandActions.length - 1]
    o.lastActionTookMs = lastA?.tookMs ?? 0
    // Lifetime average action time (across handHistory + current hand). Most
    // useful vs humans — bots have a fixed think delay so this is constant.
    o.avgActionTimeMs = avgActionTime([...allHistoricalActions, ...actionHistory], o.id)
    // Stack position relative to the table.
    o.isChipLeader = chipLeader?.id === o.id
    o.isShortStack = shortStack?.id === o.id
    o.chipRank = Math.max(1, seatChipsList.findIndex(s => s.id === o.id) + 1)
    // M-ratio (effective for cash games too, just blinds-only since we don't run antes).
    o.mRatio = bigBlind + smallBlind > 0 ? o.chips / (bigBlind + smallBlind) : null
    // Session profit derived from handHistory.
    o.sessionProfit = handHistory.reduce((sum, h) => sum + (h.profitByPlayer?.[o.id] ?? 0), 0)
    // Head-to-head profit vs me. Useful for "is this player exploiting me?"
    // reads. Sums profitByPlayer for both seats across handHistory entries
    // where both were active; positive = they're up on me.
    o.vsMeProfit = handHistory.reduce((sum, h) => {
      const oppP = h.profitByPlayer?.[o.id]
      const myP = h.profitByPlayer?.[bot.id]
      if (typeof oppP !== 'number' || typeof myP !== 'number') return sum
      // Only count hands where both players were involved (nonzero profit
      // on either side means at least one of them had skin in).
      if (oppP === 0 && myP === 0) return sum
      return sum + oppP
    }, 0)
    o.wonLastHand = handHistory.length > 0 &&
      handHistory[handHistory.length - 1].winners?.some(w => w.playerId === o.id)
    // Cards they've shown down this session, oldest-first.
    o.revealedShowdowns = revealedShowdownsFor(handHistory, o.id)
    // Convenience: how many times we've seen them at showdown this session
    // (above stat field also exposes this lifetime, but session is what the
    // generated clone bot's range-inference cares about).
    o.showdownsThisSession = o.revealedShowdowns.length
    // Stable-ish session identity: the WS player id is unique for the
    // session. Re-exposed here next to `name` so a bot can build a
    // "players I've seen" Map without doing the lookup itself.
    o.stableId = o.id
    // Stack pressure expressed two ways. effectiveStackBB (already set
    // above) compares against the bot's stack; stackBB is the player's
    // OWN stack in BBs so a bot can ask "how many BBs are they from
    // losing" without doing the math.
    o.stackBB = bigBlind > 0 ? o.chips / bigBlind : 0
    o.bbToBust = o.stackBB
    // Compute behavior patterns. Cheap — see opponentPatterns.js for the
    // full breakdown. Bots that want raw data still have ctx.actionHistory
    // and the player's stats; this is for the common case of "what kind of
    // player is this and how should I react".
    const rawStats = game.playerStats?.get(o.id)
    o.patterns = computeOpponentPatterns({
      playerId: o.id,
      rawStats,
      currentHandActions: o.currentHandActions || [],
      handHistory,
      bigBlind,
      myChips: me.chips,
      oppChips: o.chips,
      oppRevealedShowdowns: o.revealedShowdowns
    })
  }

  // Table-level rollup of those patterns. Lets a bot ask "is this a tight
  // table?" or "are most seats tilted?" with one field.
  const tableProfile = summarizeTable(opponents.map(o => o.patterns).filter(Boolean))

  // --- Board texture ------------------------------------------------------
  // Computed once per call; bots that condition c-bet sizing on dryness vs
  // wetness can read this directly instead of re-walking the cards.
  const boardTexture = computeBoardTexture(communityCards)

  // Flush / straight draws postflop with a coarse outs estimate.
  const draws = computeDraws(holeCards, communityCards)

  // How many hands since I last won a pot at this table.
  let handsSinceLastWin = -1
  for (let i = handHistory.length - 1; i >= 0; i--) {
    const h = handHistory[i]
    if ((h.profitByPlayer?.[bot.id] ?? 0) > 0) {
      handsSinceLastWin = handHistory.length - 1 - i
      break
    }
  }

  const context = {
    // Quick-look signals
    phase,
    streetIsPreflop: isPreflop,
    streetIsPostflop: !isPreflop && phase !== GAME_PHASES.WAITING && phase !== GAME_PHASES.SHOWDOWN,
    position: positionFor(myIdx, game.dealerIndex, total),
    handStrength,
    handStrengthIndex: tierIndex(handStrength),
    handCategory: handStrength,
    // Numeric strength (0-1) for bots that want a sharper signal than the
    // 5-bucket category. Preflop = lookup-table score (AA=1.0, AKo=0.87,
    // 22≈0.56, 72o≈0.13). Postflop = made-hand baseline by rank class.
    handStrengthScore,
    // Full industry-grade analyzer output:
    //   handAnalysis.preflop  — always present when 2 hole cards exist
    //   handAnalysis.postflop — null preflop; rich made-hand + draws + reads
    // The label/tier fields here are the canonical source of truth for
    // "what kind of hand do I have right now". Bots branch on
    // handAnalysis.preflop.neverFoldPreflop, handAnalysis.postflop.valueClass,
    // etc., instead of recomputing rank thresholds from the raw cards.
    handAnalysis: analyzeHand(holeCards, communityCards),
    // Range-aware equity (0-1) vs each unfolded opponent's estimated range.
    // Null when there's no opponent action yet (e.g., we're first to act
    // preflop with no information). Bots SHOULD use this to size bets and
    // make calling decisions instead of relying on the categorical bucket.
    equity,
    equityVsRandom,
    potOdds,
    potSize: game.pot,
    currentBet: game.currentBet,
    toCall,
    myStack: me.chips,
    effectiveStack,
    spr,
    aggressionCount: game.aggressionCount,
    numActiveOpponents: activeOpps.length,
    facingBet,
    facingRaise,
    facingAllIn,
    lastOpponentAction,
    roundIndex,
    isHeadsUp: total === 2,

    // Cards
    holeCards,
    communityCards,
    bestHand,

    // Configuration — `bigBlind` / `smallBlind` reflect the table's current
    // level, not the hardcoded default, so a bot adapts when blinds change.
    handIndex: game.handIndex,
    bigBlind,
    smallBlind,
    blindLevelLabel: `${smallBlind}/${bigBlind}`,
    minRaiseTarget: Math.max(game.currentBet * 2, game.currentBet + bigBlind, bigBlind),
    maxRaiseTarget: me.chips + myBet,
    // BB-relative views — handy for size-aware play that scales across blind
    // levels without rewriting the rules each time.
    myStackBB: bigBlind > 0 ? me.chips / bigBlind : 0,
    effectiveStackBB: bigBlind > 0 ? effectiveStack / bigBlind : 0,
    potSizeBB: bigBlind > 0 ? game.pot / bigBlind : 0,
    toCallBB: bigBlind > 0 ? toCall / bigBlind : 0,
    currentBetBB: bigBlind > 0 ? game.currentBet / bigBlind : 0,

    // Self
    me: {
      id: bot.id,
      name: bot.username,
      seat: myIdx,
      chips: me.chips,
      bet: myBet,
      totalBetThisHand: myTotalBet,
      position: positionFor(myIdx, game.dealerIndex, total),
      stats: {
        handsObserved: myStats.handsObserved,
        handsPlayed: myStats.handsPlayed,
        vpip: myStats.handsObserved > 0 ? myStats.vpipHands / myStats.handsObserved : 0,
        aggressionFreq: myStats.handsObserved > 0 ? myStats.aggressiveActions / myStats.handsObserved : 0,
        profit: myStats.profit,
        showdownsSeen: myStats.showdownsSeen,
        showdownsWon: myStats.showdownsWon
      }
    },

    // Opponents (ordered by seat)
    opponents,

    // History
    actionHistory,
    handHistory,
    lastShowdown,

    // --- Derived advanced signals ---
    lastAggressor,
    playersToAct,
    playersActedThisRound,
    chipLeader,
    shortStack,
    myChipRank,
    totalChipsInPlay,
    committed: myCommitted,
    preflopActionProfile,
    draws,
    handsSinceLastWin,

    dealerSeatIndex: game.dealerIndex,

    // --- New: per-street boolean shortcuts ---------------------------------
    // Same info as `phase` / `roundIndex`, but as plain booleans for cleaner
    // branching. `if (ctx.streetIsRiver) ...` reads better than `phase ===`.
    streetIsFlop: phase === GAME_PHASES.FLOP,
    streetIsTurn: phase === GAME_PHASES.TURN,
    streetIsRiver: phase === GAME_PHASES.RIVER,

    // --- New: aggressor & position derivatives -----------------------------
    // True when I was the most recent preflop raiser. Anchor for c-bet logic
    // ("I opened, the flop checked to me, do I fire?").
    iWasPreflopAggressor: (() => {
      for (const a of actionHistory) {
        if (a.phase !== GAME_PHASES.PREFLOP) break
        if ((a.action === 'raise' || a.action === 'all_in') && a.playerId === bot.id) return true
        if (a.action === 'raise' || a.action === 'all_in') return false
      }
      return false
    })(),
    // I'm last to act this round if no active opponent still needs to act
    // after me. Useful for free showdowns / position bluffs.
    isInPosition: (() => {
      // Active opponents not folded / all-in.
      const active = players.filter(p => p.id !== bot.id &&
        !game.foldedPlayers.has(p.id) && !game.allInPlayers.has(p.id) && !game.removedPlayers.has(p.id))
      if (active.length === 0) return true
      // If everyone else has already acted this round, I'm closing the action.
      return active.every(p => game.roundActed?.has?.(p.id))
    })(),
    // Convenience boolean cluster around position.
    isLatePosition: positionFor(myIdx, game.dealerIndex, total) === 'btn' ||
                    positionFor(myIdx, game.dealerIndex, total) === 'late',
    isBlind: positionFor(myIdx, game.dealerIndex, total) === 'sb' ||
             positionFor(myIdx, game.dealerIndex, total) === 'bb',

    // --- New: pot-odds / EV / fold-equity convenience ----------------------
    // breakevenEquity — the equity you need to break even on this call.
    // Identical to potOdds, just named so the math reads cleaner.
    breakevenEquity: facingBet ? toCall / (game.pot + toCall) : 0,
    // EV of a call in chips, using the range-aware equity number.
    // Positive = +EV call; negative = -EV call. Multiply by hand frequency to
    // get session EV.
    evCallChips: (() => {
      if (!facingBet || equity == null) return 0
      const winShare = (game.pot + toCall) * equity
      const loseCost = toCall * (1 - equity)
      return Math.round(winShare - loseCost)
    })(),
    // Quick boolean — equity exceeds the price.
    profitableCall: facingBet && equity != null && equity > (toCall / (game.pot + toCall)),
    // Fold rate needed for a bluff at potBetSize × pot to break even.
    // Pot-sized bluff break-even is 50%. The map is exposed so a bot can
    // pick its sizing based on the opponent's foldEquityScore.
    bluffBreakEven: {
      half:    1 / 3,    // bet 0.5 × pot → needs 33% fold rate
      twoThirds: 0.4,    // bet 0.66 × pot → needs 40%
      pot:     0.5,      // bet 1 × pot → needs 50%
      overbet: 0.6       // bet 1.5 × pot → needs 60%
    },
    // myTotalBet / my starting stack — separate from `committed` which is
    // a boolean. Use this for graduated commitment decisions.
    commitmentRatio: (me.chips + myTotalBet) > 0 ? myTotalBet / (me.chips + myTotalBet) : 0,

    // --- New: table identity ------------------------------------------------
    // Stable for the session — lets a bot maintain a per-table memory map
    // (e.g., "every time I see Player X at table arena_47 they 3-bet 30%").
    tableId: bot.room?.roomId ?? null,
    tableType: bot.room?.isArena ? 'arena'
              : bot.room?.isPrivate ? 'private'
              : 'public',
    tableSize: total,
    maxSeats: 5,
    // Server's wall-clock at build time. Combined with `activeTurnStartedAt`
    // on game_state this lets a bot compute exact think-time of the player
    // who's currently acting (useful for tells vs humans).
    serverTime: Date.now(),
    activeTurnStartedAt: game.lastTurnChange ?? null,

    // --- New: board texture -------------------------------------------------
    // null preflop. Postflop, holds paired/monotone/wetness/etc. so bots
    // don't have to re-walk the cards every decision.
    boardTexture,

    // --- New: hand-strength label (mirrors the categorical bucket) ---------
    // Convenience derivative of `handStrengthScore`. Bots that want a single
    // word can read this; the numeric is still there for granular logic.
    handStrengthLabel: handStrength,

    // --- New: revealed-cards index by playerId -----------------------------
    // Aggregation of every showdown reveal this session. Same data lives on
    // each opponent, but having a single map indexed by id is easier for
    // bots that maintain their own "seen hands" table.
    revealedShowdownsByPlayer: opponents.reduce((acc, o) => {
      if (o.revealedShowdowns.length > 0) acc[o.id] = o.revealedShowdowns
      return acc
    }, {}),

    // --- New: table-wide pattern summary -----------------------------------
    // Rollup of per-opponent archetypes so a bot can ask "tight table?",
    // "maniac table?", "tilted seats?" in one read. Each per-opponent
    // detail lives on opponents[i].patterns.
    tableProfile
  }

  return freezeDeep(context)
}

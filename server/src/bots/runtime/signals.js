import { GAME_PHASES } from '../../config/constants.js'
import { strengthFor, tierIndex } from './handStrength.js'
import { evaluateHand, getHandName } from '../../poker/handEvaluator.js'

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

    dealerSeatIndex: game.dealerIndex
  }

  return freezeDeep(context)
}

// Per-room side-bet engine. Owns the live YES/NO markets for the current
// hand and mutates `player.chips` directly (server is authoritative — same
// trust model as the main betting engine in PokerGame). Buy/sell happen at
// the same fair price; the house-edge spread was removed in 2026-05 (EDGE
// constant kept at 0 so the clamp call sites can stay symmetric).
//
// Lifecycle:
//   handStart       → clear leftover, spawn 3-5 props
//   onStateChange   → reprice + auto-resolve anything decided; sometimes
//                     spawn a short-window prop (turn_red after the flop)
//   handEnd         → resolve every remaining open prop based on the final
//                     state; card-runout props that never had their resolver
//                     condition reached VOID with refund
//
// The state changes are driven by PokerGame's callbacks:
//   onStateBroadcast (per-action + per-phase) → engine.onStateChange()
//   onBroadcast({ type: 'showdown', ... })    → engine.onHandEnd()
//   PokerGame.startHand transition (preflop)  → engine.onHandStart() (hooked
//   via broadcastGameState wrapper in PokerRoom)

import {
  PROP_CATALOG,
  PROPS_AT_HAND_START,
  PROP_TYPES
} from './propCatalog.js'
import { recordSideBetResult } from '../users/luckStats.js'

// House cut on side bets. Set to 0 in 2026-05 — the casino-style vig
// felt punitive in a friends-only game where the prop catalog already
// has variance baked in. With EDGE = 0 buy and sell happen at the same
// fair price, so a player can in-and-out a market with no implicit
// rake (only the rounding from int shares).
const EDGE = 0
const PRICE_FLOOR = 0.02
const PRICE_CEIL = 0.98
const MIN_BET = 10                   // smallest stake the server accepts
const TARGET_OPEN_PROPS = 4          // engine keeps exactly this many live
const SHOW_RESOLVED_FOR_MS = 6000    // how long a resolved prop stays in the broadcast

export class SideBetEngine {
  constructor({ room, game, broadcast }) {
    this.room = room
    this.game = game
    this.broadcast = broadcast       // (msg) => void — sends to all in room

    // propId → { type, question, shortLabel, detail, status, fairYes,
    //   buyYesPrice, buyNoPrice, sellYesPrice, sellNoPrice, outcome,
    //   resolvedAt, totalYesShares, totalNoShares, totalStaked }
    this.props = new Map()

    // playerId → Map<propId, { side, shares, costPaid, username }>
    this.positions = new Map()

    this._propSeq = 0
    this._lastBroadcastPhase = null
    this._lastObservedHandIndex = -1
    this._lastAggressionCount = 0
    this._reachedShowdownThisHand = false
    this._handEnded = false
    // Types instantiated this hand. Ensures a top-up never re-spawns the
    // same prop type the player already saw (and possibly bet on) earlier
    // in the hand. Cleared on every onHandStart.
    this._spawnedThisHand = new Set()
  }

  // ─── Lifecycle hooks ────────────────────────────────────────────────────

  // Triggered when a new hand begins (preflop phase appears). Idempotent —
  // safe to call on every state-change tick; bails if we already ran for this
  // hand index.
  onHandStart() {
    if (this.game.handIndex === this._lastObservedHandIndex) return
    this._lastObservedHandIndex = this.game.handIndex

    // Defensively resolve anything left over (server crash recovery etc.).
    // Use VOID so leftover positions don't silently lose.
    for (const [id, prop] of this.props) {
      if (prop.status === 'open') this._resolveProp(id, 'void')
    }
    this.props.clear()
    this.positions.clear()
    this._reachedShowdownThisHand = false
    this._handEnded = false
    this._lastAggressionCount = 0
    this._spawnedThisHand.clear()

    const state = this._snapshot()
    this._spawnFromList(PROPS_AT_HAND_START, state, TARGET_OPEN_PROPS)
    // Reprice immediately so the spawn snapshot has live numbers, then send.
    this._repriceAll(state)
    this._broadcastState({ reason: 'hand_start' })
  }

  // Reprice + auto-resolve. Called on every PokerGame state broadcast.
  onStateChange() {
    if (this.game.handIndex !== this._lastObservedHandIndex) {
      // Engine missed a hand start — catch up.
      if (this.game.phase === 'preflop') this.onHandStart()
    }

    this._lastBroadcastPhase = this.game.phase
    const state = this._snapshot()
    let anyChange = false
    for (const [id, prop] of this.props) {
      if (prop.status !== 'open') continue
      const def = PROP_CATALOG[prop.type]
      // Card-runout outcomes can settle on action-driven state changes when a
      // street card has been revealed by `advancePhaseCards`. Action props
      // (anyone_all_in, goes_to_showdown) settle when their condition trips.
      const outcome = def.outcome(state)
      if (outcome !== null && outcome !== undefined) {
        this._resolveProp(id, outcome)
        anyChange = true
        continue
      }
      const fair = def.fairYes(state)
      const yesBuy = clamp(fair + EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      const noBuy = clamp(1 - fair + EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      const yesSell = clamp(fair - EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      const noSell = clamp(1 - fair - EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      if (
        Math.abs(yesBuy - prop.buyYesPrice) > 0.001 ||
        Math.abs(noBuy - prop.buyNoPrice) > 0.001
      ) {
        prop.fairYes = fair
        prop.buyYesPrice = yesBuy
        prop.buyNoPrice = noBuy
        prop.sellYesPrice = yesSell
        prop.sellNoPrice = noSell
        anyChange = true
      }
    }

    // If aggression jumped (a raise / all-in happened), the action props need
    // a reprice even if the rest didn't.
    if (this.game.aggressionCount !== this._lastAggressionCount) {
      this._lastAggressionCount = this.game.aggressionCount
      anyChange = true
    }

    // Trim stale resolved props (keep them visible briefly so the client can
    // animate the outcome, then drop them).
    const now = Date.now()
    for (const [id, prop] of [...this.props.entries()]) {
      if (prop.status !== 'open' && prop.resolvedAt && now - prop.resolvedAt > SHOW_RESOLVED_FOR_MS) {
        this.props.delete(id)
        for (const positions of this.positions.values()) positions.delete(id)
        anyChange = true
      }
    }

    // Maintain TARGET_OPEN_PROPS live markets at all times. As board-runout
    // props resolve mid-hand (e.g. flop_has_pair settles on the flop), top
    // up from any not-yet-used type whose spawn condition fires for the
    // current state — that's when turn_red/river_red enter rotation.
    if (!this._handEnded && this.game.phase !== 'waiting' && this.game.phase !== 'showdown') {
      const filled = this._topUpToTarget(state)
      if (filled) anyChange = true
    }

    if (anyChange) this._broadcastState({ reason: 'state_change' })
  }

  _topUpToTarget(state) {
    const openCount = [...this.props.values()].filter(p => p.status === 'open').length
    if (openCount >= TARGET_OPEN_PROPS) return false
    const needed = TARGET_OPEN_PROPS - openCount
    // Candidates: any type not yet seen this hand. `_spawnFromList` filters
    // by spawn condition + uniqueness within the open set, so a type that
    // resolved earlier this hand is still excluded via _spawnedThisHand.
    const candidates = PROP_TYPES.filter(t => !this._spawnedThisHand.has(t))
    const before = this.props.size
    this._spawnFromList(candidates, state, needed)
    return this.props.size > before
  }

  // Called when the hand resolves (showdown OR fold-out — PokerGame fires the
  // 'showdown' broadcast event for both).
  onHandEnd({ reachedShowdown }) {
    this._handEnded = true
    this._reachedShowdownThisHand = !!reachedShowdown
    const state = this._snapshot()

    for (const [id, prop] of this.props) {
      if (prop.status !== 'open') continue
      const def = PROP_CATALOG[prop.type]
      const outcome = def.outcome(state)
      // Anything still null at hand end → void with refund. Catches the case
      // where a card-runout prop's hand folded out before the river.
      this._resolveProp(id, outcome ?? 'void')
    }

    this._broadcastState({ reason: 'hand_end' })
  }

  // ─── Player-driven actions ──────────────────────────────────────────────

  placeBet(playerId, propId, side, amount) {
    if (side !== 'yes' && side !== 'no') return { success: false, error: 'invalid_side' }
    const intAmount = Math.floor(Number(amount) || 0)
    if (intAmount < MIN_BET) return { success: false, error: `min_bet_${MIN_BET}` }
    const prop = this.props.get(propId)
    if (!prop) return { success: false, error: 'prop_not_found' }
    if (prop.status !== 'open') return { success: false, error: 'prop_closed' }

    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_seated' }
    if (player.chips < intAmount) return { success: false, error: 'insufficient_chips' }

    const price = side === 'yes' ? prop.buyYesPrice : prop.buyNoPrice
    const shares = intAmount / price

    // The stake leaves `chips` (so it can't be double-spent on a poker bet)
    // but moves into `openSideBetStake`, which the P/L formula adds back in.
    // Until the position is sold or resolves, the player's profit display
    // is unaffected — placing a bet shouldn't show as a realized loss.
    player.chips -= intAmount
    player.openSideBetStake = (player.openSideBetStake || 0) + intAmount

    let bag = this.positions.get(playerId)
    if (!bag) { bag = new Map(); this.positions.set(playerId, bag) }
    const existing = bag.get(propId)
    if (existing && existing.side === side) {
      existing.shares += shares
      existing.costPaid += intAmount
    } else if (existing && existing.side !== side) {
      // Player is hedging against their own position. Treat the new buy as a
      // fresh position on the other side — keep both. (Polymarket does the
      // same: YES and NO at the same time is allowed and economically equal
      // to a partial sell once you net them at resolution.)
      const key = `${propId}::${side}`
      bag.set(key, {
        propId,
        side,
        shares,
        costPaid: intAmount,
        username: player.username,
        hedge: true,
      })
    } else {
      bag.set(propId, {
        propId,
        side,
        shares,
        costPaid: intAmount,
        username: player.username,
      })
    }

    prop.totalStaked = (prop.totalStaked || 0) + intAmount
    if (side === 'yes') prop.totalYesShares = (prop.totalYesShares || 0) + shares
    else prop.totalNoShares = (prop.totalNoShares || 0) + shares

    this._broadcastState({ reason: 'place_bet', playerId, propId })
    if (this.room?.broadcastRoomUpdate) this.room.broadcastRoomUpdate()
    return { success: true, shares, price }
  }

  sellPosition(playerId, propId, sharesToSell) {
    const bag = this.positions.get(playerId)
    if (!bag) return { success: false, error: 'no_position' }
    const position = bag.get(propId)
    if (!position) return { success: false, error: 'no_position' }
    const prop = this.props.get(propId)
    if (!prop) return { success: false, error: 'prop_not_found' }
    if (prop.status !== 'open') return { success: false, error: 'prop_closed' }

    const want = Number(sharesToSell)
    const actualShares = (!Number.isFinite(want) || want <= 0)
      ? position.shares
      : Math.min(want, position.shares)
    if (actualShares <= 0) return { success: false, error: 'invalid_shares' }

    const sellPrice = position.side === 'yes' ? prop.sellYesPrice : prop.sellNoPrice
    const proceeds = Math.floor(actualShares * sellPrice)

    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_seated' }
    player.chips += proceeds

    position.shares -= actualShares
    // Track cost basis pro-rata so partial sells leave reasonable accounting.
    // `fractionSold` is shares-just-sold / shares-before-this-sell, which
    // tells us how much of the original costPaid to retire (and pull out of
    // the player's openSideBetStake — the realized portion of the bet is
    // now back in `chips` as proceeds, so it shouldn't double-count).
    const fractionSold = position.shares <= 1e-9 ? 1 : (actualShares / (actualShares + position.shares))
    const costRemoved = Math.floor(position.costPaid * fractionSold)
    position.costPaid = Math.max(0, position.costPaid - costRemoved)
    player.openSideBetStake = Math.max(0, (player.openSideBetStake || 0) - costRemoved)
    if (position.shares <= 1e-9) bag.delete(propId)

    if (position.side === 'yes') prop.totalYesShares = Math.max(0, (prop.totalYesShares || 0) - actualShares)
    else prop.totalNoShares = Math.max(0, (prop.totalNoShares || 0) - actualShares)

    this._broadcastState({ reason: 'sell_position', playerId, propId })
    if (this.room?.broadcastRoomUpdate) this.room.broadcastRoomUpdate()
    return { success: true, proceeds, sharesRemaining: position.shares }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  _resolveProp(propId, outcome) {
    const prop = this.props.get(propId)
    if (!prop || prop.status !== 'open') return
    prop.status = 'resolved'
    prop.outcome = outcome
    prop.resolvedAt = Date.now()

    const payouts = []  // for the broadcast event
    for (const [playerId, bag] of this.positions) {
      const player = this._findPlayer(playerId)
      // Spectators mark-to-market on a void (early hand end) instead of
      // getting their stake refunded. They had no say in the hand ending,
      // but they don't get a "rescue" either — the market price at the
      // moment of void is the realized result, whether that's up or down.
      // Seated players keep the refund-on-void behavior because they're
      // part of the action that ended the hand.
      const holderIsSpectator = !!this.room?.spectators?.has?.(playerId)
      for (const [key, pos] of [...bag.entries()]) {
        if (pos.propId !== propId) continue
        let credit = 0
        let label = ''
        if (outcome === 'void') {
          if (holderIsSpectator) {
            // Use the prop's last computed sell price for the relevant
            // side. The engine refreshes these on every state-change tick,
            // so by the time we reach hand-end these reflect the most
            // recent fair-prob snapshot.
            const sellPx = pos.side === 'yes' ? prop.sellYesPrice : prop.sellNoPrice
            credit = Math.max(0, Math.floor(pos.shares * sellPx))
            // Same label-shape the client expects: 'win' if the realized
            // price beat cost, 'loss' otherwise. 'void' would imply a
            // refund — we're not refunding here.
            label = credit >= pos.costPaid ? 'win' : 'loss'
          } else {
            credit = pos.costPaid
            label = 'void'
          }
        } else if (pos.side === outcome) {
          credit = Math.round(pos.shares)
          label = 'win'
        } else {
          credit = 0
          label = 'loss'
        }
        if (player) {
          if (credit > 0) player.chips += credit
          // The cost basis exits openSideBetStake at resolution regardless
          // of outcome — the bet is no longer open. For a win, chips
          // already absorbed the credit; for a loss, the stake is gone;
          // for a void, chips absorbed the refund. In every case the P/L
          // delta is (chips_after + 0_stake) − (chips_before + stake) =
          // (credit − costPaid), which is the correct realized outcome.
          player.openSideBetStake = Math.max(0, (player.openSideBetStake || 0) - pos.costPaid)
        }
        if (credit !== 0 || label === 'loss') {
          payouts.push({
            playerId,
            username: pos.username,
            side: pos.side,
            shares: pos.shares,
            costPaid: pos.costPaid,
            credit,
            result: label,
          })
        }
        // Persist the win/loss to the user's luck counters (fire-and-forget;
        // anonymous seats have no userId and silently no-op). Voids don't
        // count — the stake was refunded, so the player neither got lucky
        // nor unlucky on that prop.
        if (player?.userId && (label === 'win' || label === 'loss')) {
          const avgEntryPrice = pos.shares > 0 ? pos.costPaid / pos.shares : null
          recordSideBetResult({
            userId: player.userId,
            outcome: label,
            entryPrice: avgEntryPrice,
            chipDelta: credit - pos.costPaid
          }).catch(err => console.warn('[luck] sidebet write failed:', err.message))
        }
        bag.delete(key)
      }
    }

    this.broadcast({
      type: 'sidebet:resolve',
      data: {
        propId,
        type: prop.type,
        question: prop.question,
        outcome,
        finalFairYes: prop.fairYes,
        payouts,
      },
    })
  }

  _snapshot() {
    const game = this.game
    const allInSet = game.allInPlayers
    const foldedSet = game.foldedPlayers
    const active = game.players.filter(p => !game.removedPlayers.has(p.id) && !foldedSet.has(p.id))
    const reachedShowdown = this._reachedShowdownThisHand || (game.phase === 'showdown' && active.length >= 2)
    return {
      phase: game.phase,
      board: [...(game.communityCards || [])],
      handEnded: this._handEnded,
      activePlayerCount: active.length,
      seatCount: game.players.length,
      anyAllIn: allInSet.size > 0,
      reachedShowdown,
      aggressionThisHand: this._cumulativeAggression(),
      foldOutWinner: null,
    }
  }

  // PokerGame tracks aggressionCount per *betting round* — it resets to 0 on
  // each phase advance. We want the hand-level total for action-prop pricing.
  // Sum from handActionHistory.
  _cumulativeAggression() {
    let n = 0
    for (const a of this.game.handActionHistory || []) {
      if (a.action === 'raise' || a.action === 'all_in') n += 1
    }
    return n
  }

  _spawnFromList(typeList, state, targetCount) {
    const eligible = typeList.filter(t => {
      const def = PROP_CATALOG[t]
      if (!def) return false
      if ([...this.props.values()].some(p => p.type === t && p.status === 'open')) return false
      try { return def.spawn(state) } catch { return false }
    })
    // Shuffle and pick up to targetCount.
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = eligible[i]; eligible[i] = eligible[j]; eligible[j] = tmp
    }
    const pick = eligible.slice(0, Math.max(0, targetCount))
    for (const type of pick) this._instantiateProp(type, state)
  }

  _instantiateProp(type, state) {
    const def = PROP_CATALOG[type]
    if (!def) return
    this._spawnedThisHand.add(type)
    const fair = clamp(def.fairYes(state), PRICE_FLOOR, PRICE_CEIL)
    const id = `${type}-${this.game.handIndex}-${++this._propSeq}`
    const prop = {
      id,
      type,
      question: def.question,
      shortLabel: def.shortLabel,
      detail: def.detail,
      status: 'open',
      fairYes: fair,
      buyYesPrice: clamp(fair + EDGE / 2, PRICE_FLOOR, PRICE_CEIL),
      buyNoPrice: clamp(1 - fair + EDGE / 2, PRICE_FLOOR, PRICE_CEIL),
      sellYesPrice: clamp(fair - EDGE / 2, PRICE_FLOOR, PRICE_CEIL),
      sellNoPrice: clamp(1 - fair - EDGE / 2, PRICE_FLOOR, PRICE_CEIL),
      createdAt: Date.now(),
      handIndex: this.game.handIndex,
      totalYesShares: 0,
      totalNoShares: 0,
      totalStaked: 0,
    }
    this.props.set(id, prop)
  }

  _repriceAll(state) {
    for (const prop of this.props.values()) {
      if (prop.status !== 'open') continue
      const def = PROP_CATALOG[prop.type]
      const fair = clamp(def.fairYes(state), PRICE_FLOOR, PRICE_CEIL)
      prop.fairYes = fair
      prop.buyYesPrice = clamp(fair + EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      prop.buyNoPrice = clamp(1 - fair + EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      prop.sellYesPrice = clamp(fair - EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
      prop.sellNoPrice = clamp(1 - fair - EDGE / 2, PRICE_FLOOR, PRICE_CEIL)
    }
  }

  _findPlayer(playerId) {
    // Prefer the game's seated array (hot-path during a hand). Fall back to
    // the room's player map for mid-hand seat changes; then to spectators
    // since they're allowed to place side bets too. The same Player object
    // is mutated in every case — chips and openSideBetStake live on the
    // Player instance regardless of seated/spectator status.
    return this.game.players.find(p => p.id === playerId)
      || this.room?.players?.get?.(playerId)
      || this.room?.spectators?.get?.(playerId)
      || null
  }

  // Build the full sidebet:state payload. Includes every prop in the room
  // plus per-player positions (visible to everyone, like a Polymarket
  // leaderboard). Each client filters its own positions by playerId.
  getStatePayload() {
    const props = []
    for (const prop of this.props.values()) {
      props.push({
        id: prop.id,
        type: prop.type,
        question: prop.question,
        shortLabel: prop.shortLabel,
        detail: prop.detail,
        status: prop.status,
        outcome: prop.outcome || null,
        fairYes: round3(prop.fairYes),
        buyYesPrice: round3(prop.buyYesPrice),
        buyNoPrice: round3(prop.buyNoPrice),
        sellYesPrice: round3(prop.sellYesPrice),
        sellNoPrice: round3(prop.sellNoPrice),
        createdAt: prop.createdAt,
        resolvedAt: prop.resolvedAt || null,
        totalYesShares: Math.round(prop.totalYesShares || 0),
        totalNoShares: Math.round(prop.totalNoShares || 0),
        totalStaked: Math.round(prop.totalStaked || 0),
      })
    }
    const positions = []
    for (const [playerId, bag] of this.positions) {
      for (const pos of bag.values()) {
        positions.push({
          playerId,
          username: pos.username,
          propId: pos.propId,
          side: pos.side,
          shares: Math.round(pos.shares * 100) / 100,
          costPaid: Math.round(pos.costPaid),
        })
      }
    }
    return {
      handIndex: this.game.handIndex,
      props,
      positions,
      config: { edge: EDGE, minBet: MIN_BET },
    }
  }

  _broadcastState(meta = {}) {
    this.broadcast({
      type: 'sidebet:state',
      data: { ...this.getStatePayload(), reason: meta.reason || null },
    })
  }
}

function clamp(x, lo, hi) {
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function round3(x) {
  return Math.round(x * 1000) / 1000
}

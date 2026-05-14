// Headless poker simulator. Runs full hands at native speed (no
// THINK_DELAY, no broadcast, no setTimeout) by driving PokerGame
// directly and replacing its `_gameTimeout` with a synchronous drain
// queue. Used by the Training Simulator on the bots page so users can:
//
//   - Pit their neural bots against each other (or any other bot) and
//     get rapid ELO + reward feedback without watching a live arena.
//   - Test rule-coded bots for ELO swings over hundreds of hands in
//     seconds.
//
// Hand mechanics are identical to live play (same PokerGame, same
// blinds, same action validation, same showdown evaluator) — the only
// stripped-out things are wall-clock pacing and WebSocket broadcasts.
// That keeps every hand "real" enough to count for ELO and to feed the
// neural training updates that already power live games.

import { PokerGame } from '../../poker/PokerGame.js'
import { GAME_PHASES } from '../../config/constants.js'
import { buildContext } from '../runtime/signals.js'
import { compileBot } from '../runtime/codeSandbox.js'
import { buildMemberDecider } from '../runtime/BotPlayer.js'
import { normalizeSuperState, pickNextMember } from '../super/transitions.js'
import { policyFor, DEFAULT_KIND } from '../neural/registry.js'
import {
  extractFeatures, actionQuality, engineActionToActionIdx
} from '../neural/shared.js'
import { applyReinforceUpdate } from '../neuralPolicy.js'
import {
  performanceScore,
  eloDelta,
  isBluffWin,
  STARTING_RATING,
  RATING_FLOOR,
  computeRatingUpdatesForTable
} from '../runtime/eloEngine.js'
import { preflopHandScore } from '../runtime/equity.js'

const DEFAULT_STARTING_CHIPS = 1000
const SAFETY_TICKS_PER_HAND = 1000

// Lightweight stand-in for BotPlayer. Implements just the surface area
// PokerGame.addPlayer / handleAction / broadcastState ever reads off a
// seat (id, username, chips, isBot, isConnected, send). The synchronous
// decision loop never calls send() — we drive decide() directly from
// the runner — so send is a no-op.
class SimSeat {
  constructor({ id, bot, startingChips }) {
    this.id = id
    this.bot = bot
    this.username = bot.name
    this.chips = startingChips
    this.pokerBuyIn = startingChips
    this.isConnected = true
    this.isBot = true
    this.userId = null
    this.isSpectator = false
    this.handStartChips = startingChips

    this.isNeural = Boolean(bot.isNeural)
    this.neuralKind = bot.neuralKind || DEFAULT_KIND
    this.neuralPolicy = this.isNeural ? policyFor(this.neuralKind) : null
    this.neuralState = this.isNeural
      ? this.neuralPolicy.normalizeState(bot.neuralState)
      : null
    this.neuralTrajectory = []
    // Per-action quality log captured for ALL bot types so the new
    // skill-based ELO can grade decisions, not just outcomes.
    this.actionQualityLog = []

    // Oracle: signals.js gates omniscient ctx fields (allHoleCards,
    // exactEquity) on `seat.isOracle`. Without this flag the Oracle's
    // user-coded strategy compiles + runs, but ctx.exactEquity is
    // undefined so it falls back to range equity — defeating the whole
    // point of the bot. Mirrors BotPlayer's `this.isOracle` assignment.
    this.isOracle = Boolean(bot.isOracle)

    // Super-bot scaffolding mirrors BotPlayer:
    //   _superMembers      — per-member decider (NN policy or compiled JS)
    //   _superMemberIds    — id list, used by the bandit re-roll
    //   superState         — persisted bandit state (Thompson / Markov / weighted)
    //   _superTurnsLeft    — countdown to next bandit re-roll
    // Without this the simulator skipped super bots entirely (the rule
    // branch was gated on !isSuper) and they fold/checked every turn.
    this.isSuper = Boolean(bot.isSuper)
    this._superMembers = null
    this._superActiveIdx = 0
    this._superTurnsLeft = 0
    this.superState = null
    this._superMemberIds = null
    if (this.isSuper && Array.isArray(bot.members) && bot.members.length > 0) {
      this._superMembers = bot.members.map(m => buildMemberDecider(m))
      this._superMemberIds = bot.members.map(m => m.id)
      this.superState = normalizeSuperState(bot.superState, this._superMemberIds)
      this._rerollSuperActive()
    }

    // Compile JS code for rule bots once (also covers Oracle — its
    // strategy is just JS in `bot.code`, marked is_oracle = TRUE so the
    // signals layer enriches the ctx). Errors fall back to safe
    // fold/check at decision time — matches the live BotPlayer policy.
    this._compiled = null
    if (!this.isNeural && !this.isSuper && typeof bot.code === 'string' && bot.code.trim()) {
      this._compiled = compileBot(bot.code)
    }
  }

  _rerollSuperActive() {
    if (!this._superMembers || this._superMembers.length === 0) return
    const currentId = this._superActiveIdx != null && this._superMemberIds
      ? this._superMemberIds[this._superActiveIdx]
      : null
    const nextIdx = pickNextMember(this.superState, this._superMemberIds || [], currentId)
    this._superActiveIdx = nextIdx >= 0 ? nextIdx : 0
    // Same 1-3 turn budget as live play. The bandit re-rolls when this
    // hits zero so super-bot strategies actually rotate inside a hand.
    this._superTurnsLeft = 1 + Math.floor(Math.random() * 3)
  }

  // No-op — the runner drives decisions directly off the game's
  // activeIndex, not via game_state push messages.
  send() {}
}

// Summary stats over a neural bot's state. Returning a few aggregates
// rather than the raw weight matrix keeps the API payload small (~80
// numbers per bot vs hundreds of weights) and surfaces the dimensions
// users actually care about: how much training has happened, how big
// the weights have grown, what actions the policy prefers, and how
// well it's been rewarded.
function neuralStateDigest(state) {
  if (!state) return null
  const weights = Array.isArray(state.weights) ? state.weights : []
  let sum = 0
  let count = 0
  let maxAbs = 0
  for (const row of weights) {
    if (!Array.isArray(row)) continue
    for (const w of row) {
      if (!Number.isFinite(w)) continue
      const a = Math.abs(w)
      sum += a
      if (a > maxAbs) maxAbs = a
      count++
    }
  }
  const weightMagnitude = count > 0 ? sum / count : 0
  const rewardHistory = Array.isArray(state.rewardHistory) ? state.rewardHistory : []
  const meanReward = rewardHistory.length > 0
    ? rewardHistory.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0) / rewardHistory.length
    : 0
  const actionCounts = Array.isArray(state.actionCounts) ? state.actionCounts.slice() : []
  return {
    handsTrained: state.handsTrained || 0,
    weightMagnitude,
    weightMaxAbs: maxAbs,
    weightCount: count,
    meanReward,
    rewardHistoryLength: rewardHistory.length,
    actionCounts,
    lastUpdatedAt: state.lastUpdatedAt || null
  }
}

// Bot's persistent stats coming into the sim — used as the "before"
// column in the UI comparison. Lifetime numbers come from the DB row;
// neural training metrics come from the persisted neural_state JSONB.
function snapshotBeforeSim(bot, neuralState) {
  const stats = bot.stats || {}
  return {
    elo: typeof bot.elo === 'number' ? bot.elo : STARTING_RATING,
    handsPlayed: stats.handsPlayed || 0,
    handsWon: stats.handsWon || 0,
    handsVoluntary: stats.handsVoluntary || 0,
    showdownsPlayed: stats.showdownsPlayed || 0,
    showdownsWon: stats.showdownsWon || 0,
    bluffWins: stats.bluffWins || 0,
    neural: bot.isNeural ? neuralStateDigest(neuralState) : null
  }
}

// Bot's state once the sim has finished. seat.bot.elo + seat.bot.stats
// are mutated in-place during _recordShowdown so they hold the trained
// values here. Returns the same shape as snapshotBeforeSim so the UI
// can diff them field-by-field.
function snapshotAfterSim(seat) {
  const bot = seat.bot
  const stats = bot.stats || {}
  return {
    elo: typeof bot.elo === 'number' ? bot.elo : STARTING_RATING,
    handsPlayed: stats.handsPlayed || 0,
    handsWon: stats.handsWon || 0,
    handsVoluntary: stats.handsVoluntary || 0,
    showdownsPlayed: stats.showdownsPlayed || 0,
    showdownsWon: stats.showdownsWon || 0,
    bluffWins: stats.bluffWins || 0,
    neural: seat.isNeural ? neuralStateDigest(seat.neuralState) : null
  }
}

export class SimulationRunner {
  constructor({
    bots,
    numHands,
    startingChips = DEFAULT_STARTING_CHIPS,
    blinds = { sb: 5, bb: 10 },
    persistTraining = false,
    ownerUserId = null
  }) {
    if (!Array.isArray(bots) || bots.length < 2 || bots.length > 5) {
      throw new Error('Simulator needs 2-5 participants.')
    }
    if (!Number.isFinite(numHands) || numHands < 1 || numHands > 5000) {
      throw new Error('numHands must be between 1 and 5000.')
    }

    this.bots = bots
    this.numHands = Math.floor(numHands)
    this.startingChips = startingChips
    this.persistTraining = persistTraining
    this.ownerUserId = ownerUserId

    // Seats — one per participant, with stable ids so we can match
    // them back to bot rows after the run.
    this.seats = bots.map((bot, i) => new SimSeat({
      id: `sim_${bot.id}_${i}`,
      bot,
      startingChips
    }))

    // Snapshot every participant's state BEFORE any hands run. We
    // also clone the neural state structure because the runner mutates
    // it in place during training — taking a deep snapshot here gives
    // the UI a stable "before" reference even after `update()` has run
    // hundreds of times. Stats are primitives so a shallow grab is OK.
    this.preSnapshots = this.seats.map(s => ({
      botId: s.bot.id,
      name: s.bot.name,
      isNeural: s.isNeural,
      neuralKind: s.isNeural ? (s.bot.neuralKind || DEFAULT_KIND) : null,
      snapshot: snapshotBeforeSim(s.bot, s.neuralState)
    }))
    this.handResults = []

    // Build the game with no broadcast + no turn timeout. The runner
    // pulls the active seat directly off `game.players[game.activeIndex]`
    // every iteration, so we don't need broadcast plumbing.
    this.game = new PokerGame(() => {}, () => {}, null)
    this.game.setBlinds(blinds.sb, blinds.bb)

    // Replace `_gameTimeout` with a synchronous drain queue. Every place
    // the engine would have scheduled a setTimeout (runout pacing,
    // post-showdown reset) instead enqueues its callback here, and
    // `_drainDeferred()` fires them in order. This is what lets a
    // 200-hand sim finish in milliseconds.
    this._deferred = []
    this.game._gameTimeout = (callback) => {
      this._deferred.push(callback)
      return null
    }

    // Disable the engine's auto-start-next-hand path. By default the
    // post-showdown reset calls `scheduleNextHand`, which would queue
    // a `startHand()` into our deferred chain and play another hand
    // *without* the outer run() loop getting a chance to reset chips.
    // The result was N hands being played inside a single
    // `_playOneHand()` call — handsRequested=100 ended up producing
    // 1000+ completed hands and trashing the "1k chips per hand"
    // invariant. The runner owns hand-to-hand transitions explicitly
    // (see run()), so the engine's auto-scheduler is a hard no-op
    // here.
    this.game.scheduleNextHand = () => {}

    // Hook the showdown broadcast to capture per-seat outcomes (chips
    // delta, wentToShowdown, etc.) right when they happen. Mirrors
    // PokerRoom._recordBotHandResults without the DB writes.
    this.game.onBroadcast = (msg) => {
      if (msg?.type === 'showdown') this._recordShowdown(msg.data)
    }

    for (const seat of this.seats) this.game.addPlayer(seat)
  }

  // Drain every deferred callback the engine has stashed. New callbacks
  // can be added by the ones we're firing (e.g. runout step → schedule
  // next runout step), so loop until quiet. Bounded to keep a malformed
  // chain from spinning forever.
  _drainDeferred(maxIterations = 200) {
    let iters = 0
    while (this._deferred.length > 0 && iters++ < maxIterations) {
      const cb = this._deferred.shift()
      try { cb() } catch (err) {
        console.error('[sim] deferred callback error:', err.message)
      }
    }
  }

  // One decision tick: read the active seat, ask its policy/code for an
  // action, hand it to the engine. Mirrors BotPlayer._decideAndAct but
  // synchronous. Returns the action that was applied (or null if no
  // active seat / hand ended).
  _decideOnce() {
    if (this.game.phase === GAME_PHASES.WAITING || this.game.phase === GAME_PHASES.SHOWDOWN) {
      return null
    }
    const seat = this.game.players[this.game.activeIndex]
    if (!seat) return null

    let action = null
    let amount = 0

    // Build context once per decision and pass it through every branch.
    // buildContext does Monte Carlo equity + range inference (200-600
    // iterations); rebuilding it 2-3 times per decision dominated sim
    // runtime on training jobs of 10K+ hands.
    let ctx = null
    try { ctx = buildContext(this.game, seat) }
    catch (err) { console.error('[sim] buildContext error:', err.message) }

    try {
      if (ctx && seat.isSuper && seat._superMembers && seat._superMembers.length > 0) {
        // Mirrors BotPlayer's super dispatch: route to the active member,
        // count down, re-roll the bandit at zero. Trajectory isn't
        // recorded here — the simulator doesn't persist super_state
        // updates back to the DB (training runs are read-only for super
        // members; their stats are credited only in live play).
        const member = seat._superMembers[seat._superActiveIdx]
        const cmd = member?.decide?.(ctx) || null
        if (cmd) { action = cmd.action; amount = cmd.amount }
        seat._superTurnsLeft--
        if (seat._superTurnsLeft <= 0) seat._rerollSuperActive()
      } else if (ctx && seat.isNeural && seat.neuralState && seat.neuralPolicy) {
        const result = seat.neuralPolicy.decide(seat.neuralState, ctx)
        if (result) {
          seat.neuralTrajectory.push(result.step)
          action = result.command.action
          amount = result.command.amount
        }
      } else if (ctx && seat._compiled && !seat._compiled.error) {
        // Oracle bots flow through here — `seat.isOracle` was set in the
        // SimSeat ctor, so signals.js populates ctx.exactEquity for them
        // exactly as it does in live play.
        const r = seat._compiled.run(ctx)
        if (r.ok) { action = r.action; amount = r.amount }
      }
    } catch (err) {
      console.error('[sim] decision error:', err.message)
    }

    // Same legal-action coercion as BotPlayer — keeps a buggy policy
    // from getting the game stuck on an impossible action.
    const myBet = this.game.playerBets.get(seat.id) || 0
    const toCall = this.game.currentBet - myBet
    if (!action) action = toCall > 0 ? 'fold' : 'check'
    if (action === 'check' && toCall > 0) action = 'call'
    if (action === 'call' && toCall <= 0) action = 'check'
    if (action === 'call' && toCall >= seat.chips) action = 'all_in'

    // Grade THIS decision for the per-hand action-quality log. Reuses the
    // same ctx the decider saw — the pre-decision snapshot is what we want
    // to grade against, and buildContext is expensive.
    if (ctx) {
      try {
        const features = extractFeatures(ctx)
        const idx = engineActionToActionIdx(action, amount, ctx)
        seat.actionQualityLog.push(actionQuality(idx, features))
      } catch {}
    }

    const result = this.game.handleAction(seat.id, action, amount)
    if (!result?.success) {
      // Fall back to the safest legal action; protects the loop from
      // a stuck `activeIndex` if e.g. a raise amount was invalid.
      const fallback = toCall > 0 ? 'fold' : 'check'
      this.game.handleAction(seat.id, fallback, 0)
    }
    return { seatId: seat.id, action, amount }
  }

  // Pump one full hand through. Returns when the engine settles back
  // to WAITING (showdown handler + post-showdown reset all drained).
  // The runner owns hand-to-hand transitions explicitly — the engine's
  // scheduleNextHand has been monkey-patched to a no-op in the
  // constructor, so this function returns after EXACTLY one hand.
  _playOneHand() {
    if (!this.game.canStart()) return false
    const startedAtHand = this.game.handIndex
    this.game.startHand()

    let ticks = 0
    while (ticks++ < SAFETY_TICKS_PER_HAND) {
      // Always drain any pending deferred callbacks first — runout
      // pacing, all-in board reveals, etc. enqueue work that needs to
      // resolve before the next decision can be asked for.
      if (this._deferred.length > 0) this._drainDeferred()

      if (this.game.phase === GAME_PHASES.WAITING) break
      if (this.game.phase === GAME_PHASES.SHOWDOWN) {
        // Drain the post-showdown reset chain. The reset would have
        // queued scheduleNextHand → startHand, but we no-op'd that in
        // the constructor so the chain stops at phase=WAITING. The
        // outer run() loop then calls _playOneHand() again with a
        // fresh chip reset.
        this._drainDeferred()
        break
      }

      // Capture both `phase` and `activeIndex` before the action. The
      // OLD stuck-detector compared only activeIndex, which produced
      // false positives when the engine advanced the phase (preflop→
      // flop) and by coincidence the first decision player on the new
      // street happened to land on the same seat index. Result: hands
      // bailed mid-flop and only the first hand of a multi-hand run
      // got recorded ("1/100" bug). Comparing the (phase, index) tuple
      // distinguishes "round advanced, same seat is up again" from
      // "engine didn't advance and we're spinning".
      const phaseBefore = this.game.phase
      const activeBefore = this.game.activeIndex
      this._decideOnce()
      const phaseChanged = this.game.phase !== phaseBefore
      const activeChanged = this.game.activeIndex !== activeBefore
      const inMidHand = this.game.phase !== GAME_PHASES.SHOWDOWN
        && this.game.phase !== GAME_PHASES.WAITING
      if (inMidHand && !phaseChanged && !activeChanged && this._deferred.length === 0) {
        // Engine genuinely didn't advance — fall back to a safe
        // forced fold so the game can progress on the next tick.
        const seat = this.game.players[activeBefore]
        if (seat) this.game.handleAction(seat.id, 'fold', 0)
      }
    }
    return this.game.handIndex > startedAtHand
  }

  // Per-hand outcomes for every seat. Same fields PokerRoom uses to
  // compute ELO + train neural bots; we just compute in-memory instead
  // of writing to Postgres. ELO is applied to seat.bot.elo on the fly
  // so the NEXT hand's expectation is against the updated rating.
  _recordShowdown(broadcastData) {
    const handSummary = this.game.handHistory[this.game.handHistory.length - 1]
    if (!handSummary) return
    const winnerIds = new Set((broadcastData?.winners || []).map(w => w.playerId))
    const allSeats = this.game.players
    const bigBlind = this.game.bigBlind || 10

    const handReport = {
      handIndex: this.game.handIndex,
      seats: []
    }

    // PASS 1: gather per-seat outcomes (same shape as PokerRoom's
    // two-pass setup). We need every seat's outcome BEFORE we can call
    // computeRatingUpdatesForTable, because that helper normalizes
    // scores across the whole table to keep ELO zero-sum (no closed-
    // pool drift across long runs).
    const rows = []
    for (const seat of allSeats) {
      const won = winnerIds.has(seat.id)
      const chipsDelta = handSummary.profitsByPlayer?.[seat.id] ?? 0
      const seatActions = handSummary.actionsByPlayer?.[seat.id] ?? []
      const preflopActions = seatActions.filter(a => a.phase === GAME_PHASES.PREFLOP)
      const postflopActions = seatActions.filter(a => a.phase !== GAME_PHASES.PREFLOP)
      const foldedPreflop = preflopActions.some(a => a.action === 'fold')
      const voluntarilyIn = seatActions.some(a => a.action === 'call' || a.action === 'raise' || a.action === 'all_in')
      const postflopRaises = postflopActions.filter(a => a.action === 'raise' || a.action === 'all_in').length
      const wentToShowdown = handSummary.type === 'showdown'
        && !this.game.foldedPlayers.has(seat.id)
        && !this.game.removedPlayers.has(seat.id)

      const holeCards = (this.game.playerHands.get(seat.id) || []).map(c => ({ ...c }))
      const preflopScoreVal = holeCards.length === 2
        ? preflopHandScore(holeCards[0], holeCards[1])
        : null
      const bluffWin = isBluffWin({
        won, wentToShowdown, voluntarilyIn, postflopRaises, holeCards
      })

      const stats = seat.bot.stats || {}
      const liveHandsPlayed = (stats.handsPlayed || 0) + 1
      const liveHandsVoluntary = (stats.handsVoluntary || 0) + (voluntarilyIn ? 1 : 0)
      const liveBluffWins = (stats.bluffWins || 0) + (bluffWin ? 1 : 0)
      const liveFoldOutWins = liveBluffWins + ((stats.handsWon || 0) - (stats.showdownsWon || 0))
      const vpipRate = liveHandsPlayed > 0 ? liveHandsVoluntary / liveHandsPlayed : 0
      const bluffSuccessRate = liveFoldOutWins > 0 ? liveBluffWins / liveFoldOutWins : 0

      // Drain per-action quality scores accumulated during this hand
      // — feeds the new skill-based performanceScore.
      const actionQualities = seat.actionQualityLog || []
      seat.actionQualityLog = []

      rows.push({
        seat,
        won, chipsDelta, foldedPreflop, voluntarilyIn, wentToShowdown,
        postflopRaises, bluffWin, preflopScoreVal,
        liveHandsPlayed, liveHandsVoluntary, liveBluffWins,
        outcome: {
          actionQualities,
          won, chipsDelta, bigBlind, foldedPreflop, voluntarilyIn,
          wentToShowdown, bluffWin
        }
      })
    }

    // PASS 2: batch ELO update — scores normalized across the table.
    const ratingUpdates = computeRatingUpdatesForTable(rows.map(r => ({
      rating: r.seat.bot.elo ?? STARTING_RATING,
      handsPlayed: r.liveHandsPlayed,
      outcome: r.outcome
    })))

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const update = ratingUpdates[i]
      const seat = r.seat
      seat.bot.elo = update.nextRating
      seat.bot.stats = {
        ...(seat.bot.stats || {}),
        handsPlayed: r.liveHandsPlayed,
        handsVoluntary: r.liveHandsVoluntary,
        handsWon: ((seat.bot.stats || {}).handsWon || 0) + (r.won ? 1 : 0),
        showdownsPlayed: ((seat.bot.stats || {}).showdownsPlayed || 0) + (r.wentToShowdown ? 1 : 0),
        showdownsWon: ((seat.bot.stats || {}).showdownsWon || 0) + (r.wentToShowdown && r.won ? 1 : 0),
        bluffWins: r.liveBluffWins
      }

      // Apply the neural training step using the same reward normalization
      // the live game uses — chipsDelta / starting stack, clipped inside
      // applyReinforceUpdate to [-1, +1].
      if (seat.isNeural && seat.neuralState) {
        const trajectory = seat.neuralTrajectory
        seat.neuralTrajectory = []
        if (trajectory.length > 0) {
          const baseline = Math.max(1, seat.handStartChips || seat.pokerBuyIn || 1)
          const rawReward = r.chipsDelta / baseline
          applyReinforceUpdate(seat.neuralState, trajectory, rawReward, seat.neuralKind)
        }
      }

      handReport.seats.push({
        seatId: seat.id,
        botId: seat.bot.id,
        chipsDelta: r.chipsDelta,
        won: r.won,
        wentToShowdown: r.wentToShowdown,
        foldedPreflop: r.foldedPreflop,
        voluntarilyIn: r.voluntarilyIn,
        bluffWin: r.bluffWin,
        preflopScore: r.preflopScoreVal,
        performanceScore: update.normalizedScore,
        eloChange: update.delta,
        eloAfter: seat.bot.elo
      })
    }

    this.handResults.push(handReport)
  }

  // Public entry point. Plays `numHands` then returns the structured
  // summary the API + UI consume.
  //
  // Chip-reset invariant: EVERY hand starts with EVERY seat at exactly
  // `startingChips` (default 1000). This means:
  //   - No "rich-get-richer" advantage where a bot that won an early
  //     all-in starts the next hand with 5× the stack of its
  //     opponents.
  //   - Per-hand chipsDelta (recorded by the engine as `p.chips -
  //     handStartChips[p.id]`) is always relative to the same 1000-
  //     chip baseline, so deltas are directly comparable across hands.
  //   - The cumulative P/L surfaced to the UI is just the sum of
  //     those per-hand deltas — exactly the "total chips won/lost over
  //     N iterations" metric users want.
  // The engine's built-in rebuyIfNeeded is a no-op for bots (early-
  // returns when `player.isBot`), which is why we do the reset here.
  run() {
    const startedAt = Date.now()
    for (let i = 0; i < this.numHands; i++) {
      for (const seat of this.seats) {
        seat.chips = this.startingChips
        seat.pokerBuyIn = this.startingChips
        seat.handStartChips = this.startingChips
        // Clear last hand's action-quality scores so the next hand
        // grades only its own decisions.
        seat.actionQualityLog = []
      }
      const ok = this._playOneHand()
      if (!ok) break
    }
    return this._buildSummary(Date.now() - startedAt)
  }

  // Aggregate per-bot totals. The payload has three sections per bot:
  //   - before: bot's lifetime stats coming INTO the sim (DB-persisted
  //     ELO + handsPlayed + neural training metrics).
  //   - after: same shape, after the sim has run. Lifetime counters
  //     include this run's hands; neural metrics reflect the trained
  //     weights / new reward history.
  //   - sim: outcomes contributed by THIS run only (so UI can show
  //     "won 25 of 100 hands this run" without subtracting two
  //     lifetime numbers in the client).
  _buildSummary(elapsedMs) {
    const perBot = new Map()
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i]
      const pre = this.preSnapshots[i]
      const after = snapshotAfterSim(seat)
      perBot.set(seat.bot.id, {
        botId: seat.bot.id,
        name: seat.bot.name,
        isNeural: seat.isNeural,
        // Surface non-rule kinds so the training UI can badge them. Only
        // isNeural shipped originally; oracle + super are now first-class
        // kinds in live play and need to round-trip through the sim too.
        isOracle: seat.isOracle,
        isSuper: seat.isSuper,
        neuralKind: pre.neuralKind,
        before: pre.snapshot,
        after,
        // Convenience top-level fields the table view reads off without
        // diving into `before`/`after`. Same numbers, just hoisted.
        eloBefore: pre.snapshot.elo,
        eloAfter: after.elo,
        eloChange: after.elo - pre.snapshot.elo,
        // Sim-only tallies, filled in below from handResults.
        // `chipsByHand` is one int per hand played: the bot's chipsDelta
        // for that hand, relative to its 1000-chip starting stack. The
        // running sum drives the cumulative-P/L sparkline in the UI.
        // `chipsCumulative` is the same list pre-summed so the client
        // doesn't have to do it (cheap to compute server-side, saves a
        // loop in the render).
        sim: {
          handsPlayed: 0,
          handsWon: 0,
          handsVoluntary: 0,
          showdowns: 0,
          showdownsWon: 0,
          bluffWins: 0,
          chipsPL: 0,
          chipsByHand: [],
          chipsCumulative: [],
          chipsMin: 0,
          chipsMax: 0
        },
        // Internal: the runner keeps a reference to the trained state
        // so the route can persist it. Stripped before sending to the
        // client. NOT inside `after` — `after.neural` is the digest.
        _neuralState: seat.neuralState || null
      })
    }
    for (const hand of this.handResults) {
      for (const r of hand.seats) {
        const agg = perBot.get(r.botId)
        if (!agg) continue
        agg.sim.handsPlayed += 1
        agg.sim.chipsPL += r.chipsDelta
        agg.sim.chipsByHand.push(r.chipsDelta)
        agg.sim.chipsCumulative.push(agg.sim.chipsPL)
        if (agg.sim.chipsPL < agg.sim.chipsMin) agg.sim.chipsMin = agg.sim.chipsPL
        if (agg.sim.chipsPL > agg.sim.chipsMax) agg.sim.chipsMax = agg.sim.chipsPL
        if (r.won) agg.sim.handsWon += 1
        if (r.voluntarilyIn) agg.sim.handsVoluntary += 1
        if (r.wentToShowdown) {
          agg.sim.showdowns += 1
          if (r.won) agg.sim.showdownsWon += 1
        }
        if (r.bluffWin) agg.sim.bluffWins += 1
      }
    }
    const participants = Array.from(perBot.values())
    return {
      handsRequested: this.numHands,
      handsCompleted: this.handResults.length,
      elapsedMs,
      // Visible payload — `_neuralState` is stripped here so raw
      // weights never leave the server.
      participants: participants.map(({ _neuralState, ...visible }) => visible),
      // Internal-only: keep the full neural states alongside so the
      // route handler can flush them to DB if `persistTraining`.
      _trainedStates: participants.map(p => ({
        botId: p.botId,
        state: p._neuralState
      })),
      // Internal-only: per-hand seat outcomes. The route uses these to
      // mirror live games — one `recordHandResult` row per seat per
      // hand, which keeps the ELO history chart continuous when a user
      // persists training. Never serialized to the client.
      _handResults: this.handResults
    }
  }
}

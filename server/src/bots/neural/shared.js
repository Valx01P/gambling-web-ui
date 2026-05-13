// Shared utilities every neural variant uses. Feature extraction, action
// masking, and command translation are identical across the 4 kinds —
// only the model architecture + update rule differ.

export const FEATURE_NAMES = [
  'bias',
  'preflop', 'flop', 'turn', 'river',
  'equity', 'potOdds', 'sprNorm', 'stackBBNorm',
  'positionNorm', 'opponentsNorm',
  'facingBet', 'facingRaise', 'aggressionNorm', 'commitNorm'
]
export const NUM_FEATURES = FEATURE_NAMES.length // 15

export const ACTION_NAMES = ['fold', 'check', 'call', 'raise_min', 'raise_pot', 'raise_allin']
export const NUM_ACTIONS = ACTION_NAMES.length // 6

export const REWARD_CLIP = 1.0
export const REWARD_HISTORY_LIMIT = 50

export function clamp(x, lo, hi) {
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

export function extractFeatures(ctx) {
  const phase = ctx?.phase || ''
  const preflop = phase === 'preflop' ? 1 : 0
  const flop    = phase === 'flop'    ? 1 : 0
  const turn    = phase === 'turn'    ? 1 : 0
  const river   = phase === 'river'   ? 1 : 0

  const equity = clamp(Number(ctx?.equity ?? ctx?.handStrengthScore ?? 0.4), 0, 1)

  const toCall = Math.max(0, Number(ctx?.toCall) || 0)
  const pot    = Math.max(0, Number(ctx?.potSize) || 0)
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0

  const sprNorm     = clamp((Number(ctx?.spr) || 0) / 10, 0, 1)
  const stackBBNorm = clamp((Number(ctx?.myStackBB) || 0) / 200, 0, 1)

  const positionMap = { btn: 1.0, late: 0.85, middle: 0.55, utg: 0.3, sb: 0.2, bb: 0.4 }
  const positionNorm = positionMap[ctx?.position] ?? 0.5

  const liveOpps = Array.isArray(ctx?.opponents)
    ? ctx.opponents.filter(o => !o.folded && !o.allIn).length
    : 0
  const opponentsNorm = clamp(liveOpps / 4, 0, 1)

  const facingBet   = ctx?.facingBet   ? 1 : 0
  const facingRaise = ctx?.facingRaise ? 1 : 0
  const aggressionNorm = clamp((Number(ctx?.aggressionCount) || 0) / 3, 0, 1)
  const commitNorm = clamp(Number(ctx?.commitmentRatio) || 0, 0, 1)

  return [
    1,
    preflop, flop, turn, river,
    equity, potOdds, sprNorm, stackBBNorm,
    positionNorm, opponentsNorm,
    facingBet, facingRaise, aggressionNorm, commitNorm
  ]
}

export function legalActionMask(ctx) {
  const toCall = Math.max(0, Number(ctx?.toCall) || 0)
  const myChips = Math.max(0, Number(ctx?.myChips ?? ctx?.myStack ?? 0) || 0)
  const minRaiseTarget = Number(ctx?.minRaiseTarget) || 0
  const maxRaiseTarget = Number(ctx?.maxRaiseTarget) || 0
  const canRaise = maxRaiseTarget > minRaiseTarget && minRaiseTarget > 0 && myChips > 0

  const mask = new Array(NUM_ACTIONS).fill(0)
  if (toCall > 0) {
    mask[0] = 1
    mask[2] = myChips > 0 ? 1 : 0
  } else {
    mask[1] = 1
  }
  if (canRaise) {
    mask[3] = 1
    mask[4] = 1
    mask[5] = 1
  } else if (myChips > 0 && toCall < myChips) {
    mask[5] = 1
  }
  return mask
}

// Reverse of actionToCommand — given the engine action+amount a bot
// just played, return the discrete action index used by actionQuality
// (0..5). Used to grade EVERY bot's decisions (not just neural ones)
// at hand-end. Raise sizing is bucketed by amount-vs-pot ratio so a
// small raise scores as raise_min and a big raise scores as raise_pot.
export function engineActionToActionIdx(action, amount, ctx) {
  if (action === 'fold')  return 0
  if (action === 'check') return 1
  if (action === 'call')  return 2
  if (action === 'all_in') return 5
  if (action === 'raise') {
    const pot = Math.max(1, Number(ctx?.potSize) || 1)
    return Number(amount) >= pot * 0.65 ? 4 : 3
  }
  return 2
}

export function actionToCommand(actionIdx, ctx) {
  const name = ACTION_NAMES[actionIdx]
  const myChips = Math.max(0, Number(ctx?.myChips ?? ctx?.myStack ?? 0))
  const toCall = Math.max(0, Number(ctx?.toCall) || 0)
  const minRaise = Number(ctx?.minRaiseTarget) || 0
  const maxRaise = Number(ctx?.maxRaiseTarget) || 0
  const pot = Math.max(0, Number(ctx?.potSize) || 0)
  switch (name) {
    case 'fold':  return { action: 'fold', amount: 0 }
    case 'check': return { action: 'check', amount: 0 }
    case 'call':  return toCall >= myChips
      ? { action: 'all_in', amount: 0 }
      : { action: 'call', amount: 0 }
    case 'raise_min': {
      // raise_min is, by name, the minimum legal raise — clamp once to
      // [minRaise, maxRaise]. If clamping pushes it to all-in, the
      // engine prefers that shape over an over-raise.
      const target = Math.min(maxRaise, minRaise)
      return target >= maxRaise
        ? { action: 'all_in', amount: 0 }
        : { action: 'raise', amount: target }
    }
    case 'raise_pot': {
      const desired = Math.max(minRaise, Math.round(pot * 0.75 + toCall))
      const target = Math.min(maxRaise, Math.max(minRaise, desired))
      return target >= maxRaise
        ? { action: 'all_in', amount: 0 }
        : { action: 'raise', amount: target }
    }
    case 'raise_allin': return { action: 'all_in', amount: 0 }
    default: return { action: toCall > 0 ? 'fold' : 'check', amount: 0 }
  }
}

// Softmax over masked logits. Returns probs aligned to ACTION_NAMES; illegal
// actions get 0. Stable: subtracts max-of-legal-logit before exp.
export function softmaxMasked(logits, mask) {
  let maxLogit = -Infinity
  for (let a = 0; a < NUM_ACTIONS; a++) {
    if (mask[a] && logits[a] > maxLogit) maxLogit = logits[a]
  }
  if (!Number.isFinite(maxLogit)) {
    const probs = new Array(NUM_ACTIONS).fill(0)
    for (let a = 0; a < NUM_ACTIONS; a++) if (mask[a]) { probs[a] = 1; break }
    return probs
  }
  const exps = new Array(NUM_ACTIONS).fill(0)
  let sum = 0
  for (let a = 0; a < NUM_ACTIONS; a++) {
    if (!mask[a]) continue
    const e = Math.exp(logits[a] - maxLogit)
    exps[a] = e
    sum += e
  }
  const probs = new Array(NUM_ACTIONS).fill(0)
  if (sum > 0) for (let a = 0; a < NUM_ACTIONS; a++) probs[a] = exps[a] / sum
  return probs
}

export function sampleFromProbs(probs) {
  let r = Math.random()
  for (let a = 0; a < NUM_ACTIONS; a++) {
    r -= probs[a]
    if (r <= 0 && probs[a] > 0) return a
  }
  let best = 0, bestP = -1
  for (let a = 0; a < NUM_ACTIONS; a++) if (probs[a] > bestP) { bestP = probs[a]; best = a }
  return best
}

export function pushReward(state, reward) {
  state.rewardHistory = [...(state.rewardHistory || []), Number(reward.toFixed(4))]
    .slice(-REWARD_HISTORY_LIMIT)
}

export function makeMatrix(rows, cols, scale = 0.1) {
  const m = []
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols)
    for (let c = 0; c < cols; c++) row[c] = (Math.random() - 0.5) * scale
    m.push(row)
  }
  return m
}

// ---------------------------------------------------------------------------
// Action quality + shaped reward
// ---------------------------------------------------------------------------
//
// The vanilla REINFORCE setup we shipped first used a single per-hand reward
// (chips_delta / starting_stack). That signal is loud when stacks blow up
// but says nothing about *decision quality* — a bot can shove 7-2 offsuit,
// win once, and have that reinforced just as strongly as a +EV all-in. After
// enough hands the policy still drifts toward random play.
//
// To fix: at each decision we compute an action-quality score (-1.5 .. +1)
// from the ctx-derived features we already capture in the trajectory. Then
// per-step we shape the reward via a 2×2 matrix on (was-action-good?, did-we-win?):
//
//   good action + won   → full positive reward       (earned it)
//   good action + lost  → damped negative reward     (bad luck, not bad call)
//   bad action  + won   → small positive reward      (lucky, don't reinforce)
//   bad action  + lost  → amplified negative reward  (deserved + biggest signal)
//
// Net effect: the gradient pulls hardest on the moves we most want the bot
// to stop doing, and pulls softly on the moves that were correct even if
// the hand ended badly.

// Feature indices — kept in step with FEATURE_NAMES above. Hard-coded here
// because the gradient code runs per-step per-hand and the constant lookup
// is hot.
const F_PREFLOP    = 1
const F_EQUITY     = 5
const F_POT_ODDS   = 6
const F_FACING_BET = 11

// Score an action against the features that were live at decision time.
// Returns a number in [-1.5, +1]. Positive = "the spot supported this play",
// negative = "the spot argued against it".
export function actionQuality(actionIdx, features) {
  const equity   = features[F_EQUITY]
  const potOdds  = features[F_POT_ODDS]
  const facing   = features[F_FACING_BET]

  switch (actionIdx) {
    case 0: {  // fold
      if (!facing) return -0.6  // folding into a free check is just wrong
      // Pot-odds-justified fold: equity is below the breakeven, so passing
      // is +EV. Worse the equity vs pot odds, better the fold.
      const margin = equity - potOdds
      if (margin < -0.10) return +0.8   // textbook fold (weak hand vs cheap call)
      if (margin <  0.05) return +0.2   // marginal fold, fine
      if (margin <  0.20) return -0.6   // bad fold — should be calling
      return -1.2                       // terrible fold — clear value left on the table (AK preflop, etc.)
    }
    case 1: {  // check
      if (facing) return -1.0           // can't check facing a bet; if the engine remapped, still wrong intent
      return +0.3                       // free flop / control, slightly positive default
    }
    case 2: {  // call
      const margin = equity - potOdds
      if (margin > 0.20) return +0.6
      if (margin > 0.05) return +0.3
      if (margin > -0.05) return 0
      if (margin > -0.20) return -0.6
      return -1.2                       // calling huge with junk
    }
    case 3:                              // raise_min
    case 4: {                            // raise_pot
      if (equity > 0.65) return +0.8
      if (equity > 0.50) return +0.4
      if (equity > 0.35) return  0
      if (equity > 0.20) return -0.6
      return -1.2
    }
    case 5: {  // raise_allin
      // The most lopsided action — getting this wrong is the single most
      // expensive mistake a bot can make, and conversely the highest-EV
      // shove of a real monster is gold. Amplify both ends.
      if (equity > 0.70) return +1.0
      if (equity > 0.55) return +0.5
      if (equity > 0.40) return  0      // coinflip-style shove — neutral
      if (equity > 0.25) return -0.9
      return -1.5                       // jamming with absolute trash (72o, 94o)
    }
    default: return 0
  }
}

// Combine action quality with hand outcome to produce a per-step reward.
// `rawReward` is the terminal chips_delta/starting_stack, clipped to ±1.
// Returns the reward to use for THIS step's gradient — not the whole hand.
export function shapedReward(quality, rawReward) {
  if (!Number.isFinite(rawReward) || rawReward === 0) {
    // Reward-neutral hand (rare — break-even). Tiny pull toward good
    // play purely from the quality signal so the bot still gets a
    // shaping signal on chop pots and folded-around hands.
    return quality > 0.5 ? 0.05 : quality < -0.5 ? -0.05 : 0
  }

  if (rawReward > 0) {
    // We won. Did we deserve it?
    if (quality < -0.5) return rawReward * 0.20   // jammed 72o, hit a 2-outer — barely reward
    if (quality < 0)    return rawReward * 0.55
    if (quality > 0.5)  return rawReward * 1.10   // earned win — extra credit
    return rawReward
  }

  // We lost. Was it a bad spot or just bad luck?
  if (quality < -0.8) return rawReward * 1.80     // jammed trash and lost — biggest teaching signal
  if (quality < -0.3) return rawReward * 1.35     // notably bad action that lost
  if (quality >  0.5) return rawReward * 0.45     // played it correctly, hand didn't hold
  if (quality >  0)   return rawReward * 0.80
  return rawReward
}

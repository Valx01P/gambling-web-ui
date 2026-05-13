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
      const target = Math.min(maxRaise, Math.max(minRaise, minRaise))
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

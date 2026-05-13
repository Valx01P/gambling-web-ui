// REINFORCE with a running-average reward baseline. Same architecture as
// the vanilla variant — linear softmax over masked actions — but the
// gradient is scaled by (reward - baseline) instead of raw reward. The
// baseline is an exponential moving average of past rewards, so it tracks
// the bot's "typical" outcome and the gradient signal becomes "this hand
// was better/worse than usual, push the action toward/away from it."
//
// Result: same fixed point as vanilla REINFORCE but lower-variance updates,
// which means more stable learning and less random drift between hands.
// Should outperform vanilla on small sample sizes — exactly the regime a
// freshly-spawned bot lives in.
import {
  NUM_FEATURES, NUM_ACTIONS, REWARD_CLIP, REWARD_HISTORY_LIMIT,
  clamp, extractFeatures, legalActionMask, actionToCommand,
  softmaxMasked, sampleFromProbs, pushReward, makeMatrix,
  actionQuality, shapedReward
} from './shared.js'

export const kind = 'reinforce_baseline'

const LR_INIT = 0.05
const LR_DECAY_HANDS = 400
const BASELINE_BETA = 0.05 // EMA coefficient — slower than reward changes

export function currentLearningRate(handsTrained) {
  return LR_INIT / (1 + (handsTrained || 0) / LR_DECAY_HANDS)
}

export function initialState() {
  return {
    kind,
    version: 1,
    weights: makeMatrix(NUM_ACTIONS, NUM_FEATURES, 0.1),
    baseline: 0,
    handsTrained: 0,
    rewardHistory: [],
    actionCounts: new Array(NUM_ACTIONS).fill(0),
    lastUpdatedAt: new Date().toISOString()
  }
}

export function normalizeState(state) {
  if (!state || typeof state !== 'object') return initialState()
  const s = initialState()
  if (Array.isArray(state.weights) && state.weights.length === NUM_ACTIONS) {
    s.weights = state.weights.map(row =>
      Array.isArray(row) && row.length === NUM_FEATURES ? row.slice() : new Array(NUM_FEATURES).fill(0)
    )
  }
  s.baseline = Number.isFinite(state.baseline) ? state.baseline : 0
  s.handsTrained = Number.isFinite(state.handsTrained) ? state.handsTrained : 0
  s.rewardHistory = Array.isArray(state.rewardHistory)
    ? state.rewardHistory.slice(-REWARD_HISTORY_LIMIT)
    : []
  s.actionCounts = Array.isArray(state.actionCounts) && state.actionCounts.length === NUM_ACTIONS
    ? state.actionCounts.slice()
    : new Array(NUM_ACTIONS).fill(0)
  s.lastUpdatedAt = state.lastUpdatedAt || new Date().toISOString()
  return s
}

function forwardLogits(weights, features) {
  const logits = new Array(NUM_ACTIONS)
  for (let a = 0; a < NUM_ACTIONS; a++) {
    let z = 0
    const row = weights[a]
    for (let f = 0; f < NUM_FEATURES; f++) z += row[f] * features[f]
    logits[a] = z
  }
  return logits
}

export function decide(state, ctx) {
  const features = extractFeatures(ctx)
  const mask = legalActionMask(ctx)
  if (!mask.some(m => m === 1)) return null
  const logits = forwardLogits(state.weights, features)
  const probs = softmaxMasked(logits, mask)
  const actionIdx = sampleFromProbs(probs)
  return {
    command: actionToCommand(actionIdx, ctx),
    step: { features, mask, actionIdx }
  }
}

export function update(state, trajectory, rawReward) {
  if (!trajectory || trajectory.length === 0) return state
  const reward = clamp(rawReward, -REWARD_CLIP, REWARD_CLIP)
  const lr = currentLearningRate(state.handsTrained)
  // Per-step shaped reward applied AFTER the baseline subtraction so the
  // baseline still cancels variance from the chip-swing magnitude, while
  // the shaping factor adds quality-aware signal on top.
  for (const step of trajectory) {
    const quality = actionQuality(step.actionIdx, step.features)
    const stepReward = shapedReward(quality, reward)
    const advantage = stepReward - state.baseline
    if (advantage === 0) {
      state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
      continue
    }
    const logits = forwardLogits(state.weights, step.features)
    const probs = softmaxMasked(logits, step.mask)
    for (let a = 0; a < NUM_ACTIONS; a++) {
      const indAdv = (a === step.actionIdx ? 1 : 0) - probs[a]
      if (indAdv === 0) continue
      const scale = lr * advantage * indAdv
      const row = state.weights[a]
      for (let f = 0; f < NUM_FEATURES; f++) row[f] += scale * step.features[f]
    }
    state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
  }
  // Update baseline AFTER the gradient — using the pre-update baseline for
  // this hand's update matches the standard REINFORCE-with-baseline derivation.
  // Baseline tracks the unshaped reward so it stays stable across the new
  // shaping factor.
  state.baseline = (1 - BASELINE_BETA) * state.baseline + BASELINE_BETA * reward
  state.handsTrained = (state.handsTrained || 0) + 1
  pushReward(state, reward)
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

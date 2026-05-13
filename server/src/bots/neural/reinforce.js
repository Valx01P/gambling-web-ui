// Vanilla REINFORCE on a linear softmax policy. This is the baseline
// variant — α and β bots. Fast to train on the basics (pot odds, position,
// hole strength), high variance because there's no value baseline.
import {
  NUM_FEATURES, NUM_ACTIONS, REWARD_CLIP, REWARD_HISTORY_LIMIT,
  clamp, extractFeatures, legalActionMask, actionToCommand,
  softmaxMasked, sampleFromProbs, pushReward, makeMatrix,
  actionQuality, shapedReward
} from './shared.js'

export const kind = 'reinforce'

const LR_INIT = 0.05
const LR_DECAY_HANDS = 400

export function currentLearningRate(handsTrained) {
  return LR_INIT / (1 + (handsTrained || 0) / LR_DECAY_HANDS)
}

export function initialState() {
  return {
    kind,
    version: 1,
    weights: makeMatrix(NUM_ACTIONS, NUM_FEATURES, 0.1),
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
  // Per-step shaped reward (see shared.js) — amplifies bad-action-lost,
  // dampens lucky-bad-action-won. Lets the policy actually learn from
  // hands where outcome and decision quality disagreed.
  for (const step of trajectory) {
    const quality = actionQuality(step.actionIdx, step.features)
    const stepReward = shapedReward(quality, reward)
    if (stepReward === 0) {
      state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
      continue
    }
    const logits = forwardLogits(state.weights, step.features)
    const probs = softmaxMasked(logits, step.mask)
    for (let a = 0; a < NUM_ACTIONS; a++) {
      const advantage = (a === step.actionIdx ? 1 : 0) - probs[a]
      if (advantage === 0) continue
      const scale = lr * stepReward * advantage
      const row = state.weights[a]
      for (let f = 0; f < NUM_FEATURES; f++) row[f] += scale * step.features[f]
    }
    state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
  }
  state.handsTrained = (state.handsTrained || 0) + 1
  pushReward(state, reward)
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

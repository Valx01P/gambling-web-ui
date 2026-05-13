// One-hidden-layer MLP policy: features (15) → tanh(W1·x + b1) (8 hidden)
// → W2·h + b2 (6 logits) → softmax. Trained with REINFORCE, backprop
// through the hidden layer. The nonlinearity lets the bot represent
// interactions vanilla linear can't — e.g. "raise more when equity is high
// AND position is late, but call when only one of those is true."
//
// Roughly 4× more parameters than the linear variant (182 vs 90). Trains
// slower per gradient step but in principle can fit a richer policy.
import {
  NUM_FEATURES, NUM_ACTIONS, REWARD_CLIP, REWARD_HISTORY_LIMIT,
  clamp, extractFeatures, legalActionMask, actionToCommand,
  softmaxMasked, sampleFromProbs, pushReward, makeMatrix,
  actionQuality, shapedReward
} from './shared.js'

export const kind = 'mlp'

const HIDDEN = 8
// Slightly lower than the linear variants — deeper net is more sensitive
// to step size; tuning this is the main reason MLP doesn't strictly
// dominate vanilla REINFORCE on tiny samples.
const LR_INIT = 0.03
const LR_DECAY_HANDS = 500

export function currentLearningRate(handsTrained) {
  return LR_INIT / (1 + (handsTrained || 0) / LR_DECAY_HANDS)
}

export function initialState() {
  return {
    kind,
    version: 1,
    // Xavier-ish: smaller scale than the linear bot since features × 8
    // sums to a wider pre-activation. Keeps tanh from saturating early.
    w1: makeMatrix(HIDDEN, NUM_FEATURES, 0.4 / Math.sqrt(NUM_FEATURES)),
    b1: new Array(HIDDEN).fill(0),
    w2: makeMatrix(NUM_ACTIONS, HIDDEN, 0.4 / Math.sqrt(HIDDEN)),
    b2: new Array(NUM_ACTIONS).fill(0),
    handsTrained: 0,
    rewardHistory: [],
    actionCounts: new Array(NUM_ACTIONS).fill(0),
    lastUpdatedAt: new Date().toISOString()
  }
}

export function normalizeState(state) {
  if (!state || typeof state !== 'object') return initialState()
  const fresh = initialState()
  if (Array.isArray(state.w1) && state.w1.length === HIDDEN) {
    fresh.w1 = state.w1.map(row =>
      Array.isArray(row) && row.length === NUM_FEATURES ? row.slice() : new Array(NUM_FEATURES).fill(0)
    )
  }
  if (Array.isArray(state.b1) && state.b1.length === HIDDEN) fresh.b1 = state.b1.slice()
  if (Array.isArray(state.w2) && state.w2.length === NUM_ACTIONS) {
    fresh.w2 = state.w2.map(row =>
      Array.isArray(row) && row.length === HIDDEN ? row.slice() : new Array(HIDDEN).fill(0)
    )
  }
  if (Array.isArray(state.b2) && state.b2.length === NUM_ACTIONS) fresh.b2 = state.b2.slice()
  fresh.handsTrained = Number.isFinite(state.handsTrained) ? state.handsTrained : 0
  fresh.rewardHistory = Array.isArray(state.rewardHistory)
    ? state.rewardHistory.slice(-REWARD_HISTORY_LIMIT)
    : []
  fresh.actionCounts = Array.isArray(state.actionCounts) && state.actionCounts.length === NUM_ACTIONS
    ? state.actionCounts.slice()
    : new Array(NUM_ACTIONS).fill(0)
  fresh.lastUpdatedAt = state.lastUpdatedAt || new Date().toISOString()
  return fresh
}

// Single forward pass; returns the intermediates we need for backprop.
function forward(state, features) {
  const z1 = new Array(HIDDEN)
  const h  = new Array(HIDDEN)
  for (let j = 0; j < HIDDEN; j++) {
    let s = state.b1[j]
    const row = state.w1[j]
    for (let f = 0; f < NUM_FEATURES; f++) s += row[f] * features[f]
    z1[j] = s
    h[j] = Math.tanh(s)
  }
  const logits = new Array(NUM_ACTIONS)
  for (let a = 0; a < NUM_ACTIONS; a++) {
    let s = state.b2[a]
    const row = state.w2[a]
    for (let j = 0; j < HIDDEN; j++) s += row[j] * h[j]
    logits[a] = s
  }
  return { z1, h, logits }
}

export function decide(state, ctx) {
  const features = extractFeatures(ctx)
  const mask = legalActionMask(ctx)
  if (!mask.some(m => m === 1)) return null
  const { logits } = forward(state, features)
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

  for (const step of trajectory) {
    const quality = actionQuality(step.actionIdx, step.features)
    const stepReward = shapedReward(quality, reward)
    if (stepReward === 0) {
      state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
      continue
    }
    const { z1, h, logits } = forward(state, step.features)
    const probs = softmaxMasked(logits, step.mask)
    // dL/dlogit_a (for REINFORCE w/ log-likelihood) = stepReward * (indicator - p_a)
    const gLogits = new Array(NUM_ACTIONS)
    for (let a = 0; a < NUM_ACTIONS; a++) {
      gLogits[a] = stepReward * ((a === step.actionIdx ? 1 : 0) - probs[a])
    }
    // dL/dW2[a][j] = gLogits[a] * h[j]; dL/db2[a] = gLogits[a]
    for (let a = 0; a < NUM_ACTIONS; a++) {
      const g = gLogits[a]
      if (g === 0) continue
      state.b2[a] += lr * g
      const row = state.w2[a]
      for (let j = 0; j < HIDDEN; j++) row[j] += lr * g * h[j]
    }
    // Backprop through tanh: dh = W2^T · gLogits; dz1 = dh * (1 - h^2)
    const dz1 = new Array(HIDDEN)
    for (let j = 0; j < HIDDEN; j++) {
      let dh = 0
      for (let a = 0; a < NUM_ACTIONS; a++) dh += state.w2[a][j] * gLogits[a]
      dz1[j] = dh * (1 - h[j] * h[j])
    }
    // dL/dW1[j][f] = dz1[j] * features[f]; dL/db1[j] = dz1[j]
    for (let j = 0; j < HIDDEN; j++) {
      const g = dz1[j]
      if (g === 0) continue
      state.b1[j] += lr * g
      const row = state.w1[j]
      for (let f = 0; f < NUM_FEATURES; f++) row[f] += lr * g * step.features[f]
    }
    state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
  }
  state.handsTrained = (state.handsTrained || 0) + 1
  pushReward(state, reward)
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

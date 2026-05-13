// Value-based learner: estimates Q(s, a) directly instead of a policy
// distribution. Acts ε-greedy — with probability ε pick a random legal
// action (exploration), otherwise pick argmax_a Q(s, a) over legal
// actions. ε decays as the bot accumulates hands.
//
// Each poker hand is a terminal episode from the bot's perspective: it
// only sees one reward signal at the end of the hand. So the TD target
// for every action taken during the hand is just `reward` — no
// bootstrapping needed. The update is a regression step toward that
// target, weighted by the current learning rate.
//
// Different paradigm from policy-gradient — the action selection is
// deterministic in the limit (ε → 0), whereas the softmax variants stay
// stochastic. Useful as a contrast bot in the squad.
import {
  NUM_FEATURES, NUM_ACTIONS, REWARD_CLIP, REWARD_HISTORY_LIMIT,
  clamp, extractFeatures, legalActionMask, actionToCommand,
  pushReward, makeMatrix
} from './shared.js'

export const kind = 'qlearning'

const LR_INIT = 0.08
const LR_DECAY_HANDS = 400
const EPSILON_INIT = 0.4
const EPSILON_MIN  = 0.05
const EPSILON_DECAY_HANDS = 300 // half-life-ish for exploration

export function currentLearningRate(handsTrained) {
  return LR_INIT / (1 + (handsTrained || 0) / LR_DECAY_HANDS)
}

export function currentEpsilon(handsTrained) {
  const decayed = EPSILON_INIT / (1 + (handsTrained || 0) / EPSILON_DECAY_HANDS)
  return Math.max(EPSILON_MIN, decayed)
}

export function initialState() {
  return {
    kind,
    version: 1,
    q: makeMatrix(NUM_ACTIONS, NUM_FEATURES, 0.1),
    handsTrained: 0,
    rewardHistory: [],
    actionCounts: new Array(NUM_ACTIONS).fill(0),
    lastUpdatedAt: new Date().toISOString()
  }
}

export function normalizeState(state) {
  if (!state || typeof state !== 'object') return initialState()
  const s = initialState()
  if (Array.isArray(state.q) && state.q.length === NUM_ACTIONS) {
    s.q = state.q.map(row =>
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

function qValues(state, features) {
  const out = new Array(NUM_ACTIONS)
  for (let a = 0; a < NUM_ACTIONS; a++) {
    let s = 0
    const row = state.q[a]
    for (let f = 0; f < NUM_FEATURES; f++) s += row[f] * features[f]
    out[a] = s
  }
  return out
}

function pickEpsilonGreedy(qs, mask, epsilon) {
  // Random over legal actions with prob ε.
  if (Math.random() < epsilon) {
    const legal = []
    for (let a = 0; a < NUM_ACTIONS; a++) if (mask[a]) legal.push(a)
    if (legal.length === 0) return 0
    return legal[Math.floor(Math.random() * legal.length)]
  }
  let best = -1, bestQ = -Infinity
  for (let a = 0; a < NUM_ACTIONS; a++) {
    if (!mask[a]) continue
    if (qs[a] > bestQ) { bestQ = qs[a]; best = a }
  }
  return best < 0 ? 0 : best
}

export function decide(state, ctx) {
  const features = extractFeatures(ctx)
  const mask = legalActionMask(ctx)
  if (!mask.some(m => m === 1)) return null
  const qs = qValues(state, features)
  const epsilon = currentEpsilon(state.handsTrained)
  const actionIdx = pickEpsilonGreedy(qs, mask, epsilon)
  return {
    command: actionToCommand(actionIdx, ctx),
    step: { features, mask, actionIdx }
  }
}

// TD update toward the terminal-episode return. Target is just `reward`
// (no bootstrapping because the hand ends). Update each chosen action's
// Q-row by gradient descent on (target - Q)^2: dW = (target - Q) * x.
export function update(state, trajectory, rawReward) {
  if (!trajectory || trajectory.length === 0) return state
  const reward = clamp(rawReward, -REWARD_CLIP, REWARD_CLIP)
  const lr = currentLearningRate(state.handsTrained)
  for (const step of trajectory) {
    let q = 0
    const row = state.q[step.actionIdx]
    for (let f = 0; f < NUM_FEATURES; f++) q += row[f] * step.features[f]
    const tdError = reward - q
    for (let f = 0; f < NUM_FEATURES; f++) row[f] += lr * tdError * step.features[f]
    state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
  }
  state.handsTrained = (state.handsTrained || 0) + 1
  pushReward(state, reward)
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

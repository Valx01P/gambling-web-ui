// Probabilistic member-selection for super bots. The super bot is a
// multi-armed-bandit problem: each member is an arm, the per-hand chip
// outcome (clipped fraction of starting stack) is the reward, and we
// pick whichever member maximizes a mode-dependent objective.
//
// Modes:
//   - uniform  : the original behavior — pick a random member, agnostic
//                to past performance. Useful as a control / null.
//   - weighted : sample with probability proportional to softmax over
//                each member's mean per-hand reward. Tilts the
//                rotation toward bots that have been pulling weight.
//   - thompson : Bayesian Thompson sampling over Beta(wins+1, losses+1)
//                — the modern default. Naturally explores under-tried
//                members early and exploits proven ones later.
//   - markov   : full transition matrix P(next | current). Counts
//                accumulate when a (from → to) hand wins; renormalizes
//                each pick. Captures "which member is best to follow
//                this one in this lineup."
//
// All four modes share the same per-member stats so the user can switch
// modes without losing data. The mode is persisted alongside the stats
// on the bot row.

export const MODES = ['uniform', 'weighted', 'thompson', 'markov']
export const DEFAULT_MODE = 'thompson'

// Reward clip mirrors the neural bot's: terminal hand outcome scaled
// against the seat's starting stack, capped at ±1 so a single cooler
// doesn't dominate the bandit posterior.
const REWARD_CLIP = 1.0

function clamp01(x, lo = -1, hi = 1) {
  if (!Number.isFinite(x)) return 0
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}

// Initial state for a fresh super bot. Each known member gets a zeroed
// stats record so the chain doesn't NPE before the first hand.
export function initialSuperState({ mode = DEFAULT_MODE, memberIds = [] } = {}) {
  const members = {}
  for (const id of memberIds) {
    members[id] = { actions: 0, hands: 0, wins: 0, totalReward: 0, lastUsedAt: null }
  }
  return {
    version: 1,
    mode: MODES.includes(mode) ? mode : DEFAULT_MODE,
    handsTrained: 0,
    members,
    // Sparse transition matrix for the markov mode. Lazily populated.
    transitions: {},
    lastUpdatedAt: new Date().toISOString()
  }
}

// Repair / extend a persisted state so every current member has a
// stats slot. Members removed from the lineup keep their stats so a
// re-add picks up where it left off; new members get zero rows.
export function normalizeSuperState(raw, memberIds = []) {
  const fresh = initialSuperState({ memberIds })
  if (!raw || typeof raw !== 'object') return fresh
  fresh.mode = MODES.includes(raw.mode) ? raw.mode : DEFAULT_MODE
  fresh.handsTrained = Number.isFinite(raw.handsTrained) ? raw.handsTrained : 0
  fresh.members = { ...(raw.members && typeof raw.members === 'object' ? raw.members : {}) }
  for (const id of memberIds) {
    if (!fresh.members[id]) {
      fresh.members[id] = { actions: 0, hands: 0, wins: 0, totalReward: 0, lastUsedAt: null }
    }
  }
  fresh.transitions = (raw.transitions && typeof raw.transitions === 'object') ? raw.transitions : {}
  fresh.lastUpdatedAt = raw.lastUpdatedAt || fresh.lastUpdatedAt
  return fresh
}

// Pick the next member's index (in `memberIds`) based on the state's
// current mode. `currentMemberId` is the previously-active member's id
// (for markov bias); pass null on the first pick of a session.
export function pickNextMember(state, memberIds, currentMemberId = null) {
  if (!memberIds || memberIds.length === 0) return -1
  if (memberIds.length === 1) return 0
  switch (state?.mode) {
    case 'weighted':  return pickWeighted(state, memberIds)
    case 'thompson':  return pickThompson(state, memberIds)
    case 'markov':    return pickMarkov(state, memberIds, currentMemberId)
    case 'uniform':
    default:          return pickUniform(memberIds)
  }
}

function pickUniform(memberIds) {
  return Math.floor(Math.random() * memberIds.length)
}

// Softmax over mean-reward-per-action. Sharpen with a small temperature
// so a clearly better member dominates the distribution without crowding
// out exploration of less-tried ones.
function pickWeighted(state, memberIds) {
  const TEMP = 1.5
  const stats = memberIds.map(id => state.members?.[id] || {})
  const scores = stats.map(s => {
    const n = Math.max(1, s.actions || 0)
    return (s.totalReward || 0) / n
  })
  const maxScore = Math.max(...scores)
  let sum = 0
  const weights = scores.map(s => {
    const w = Math.exp(TEMP * (s - maxScore))
    sum += w
    return w
  })
  if (sum <= 0) return pickUniform(memberIds)
  let r = Math.random() * sum
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

// Thompson sampling. Each member has a Beta(wins+α, losses+β) over its
// win rate; we draw one sample per member, pick the argmax. α=β=1 is a
// uniform prior (no preconception). Untried members draw from Beta(1,1)
// which spans [0,1], so they get explored early.
function pickThompson(state, memberIds) {
  let bestIdx = 0
  let bestSample = -Infinity
  for (let i = 0; i < memberIds.length; i++) {
    const s = state.members?.[memberIds[i]] || {}
    const wins = Math.max(0, s.wins || 0)
    const losses = Math.max(0, (s.hands || 0) - wins)
    const sample = sampleBeta(wins + 1, losses + 1)
    if (sample > bestSample) { bestSample = sample; bestIdx = i }
  }
  return bestIdx
}

// Markov sampling. transitions[fromId][toId] = win-count; we renormalize
// the row to a probability distribution, with a 1/(N+1) smoothing prior
// so unseen transitions still have a small chance. Without a current
// member (first pick of a session), falls back to Thompson.
function pickMarkov(state, memberIds, currentMemberId) {
  if (!currentMemberId || !state.transitions?.[currentMemberId]) {
    return pickThompson(state, memberIds)
  }
  const row = state.transitions[currentMemberId] || {}
  const smoothing = 1 / (memberIds.length + 1)
  let total = 0
  const weights = memberIds.map(id => {
    const w = (row[id] || 0) + smoothing
    total += w
    return w
  })
  if (total <= 0) return pickUniform(memberIds)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

// Marsaglia / Tsang Beta(α, β) sampler via two gammas. Reasonably fast
// for integer-ish shape params; we never see fractional shapes here.
function sampleBeta(a, b) {
  const x = sampleGamma(a)
  const y = sampleGamma(b)
  return x / (x + y)
}
function sampleGamma(shape) {
  // Marsaglia-Tsang for shape >= 1; trivial shift-up trick for shape<1.
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x, v
    do {
      x = boxMuller()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}
function boxMuller() {
  const u = Math.max(Number.EPSILON, Math.random())
  const v = Math.max(Number.EPSILON, Math.random())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Apply a hand's outcome to the state. `participation` is the trajectory
// captured during the hand: an array of memberIds in the order they
// acted (duplicates allowed when the same member kept the floor for
// multiple turns). `rawReward` is chips_delta / starting_stack clipped.
// We mutate `state` in place + return it for chaining.
export function applyHandResult(state, participation, rawReward) {
  if (!state || !Array.isArray(participation)) return state
  const reward = clamp01(rawReward, -REWARD_CLIP, REWARD_CLIP)
  const won = reward > 0

  // Distinct members who acted in this hand — these are the bandit
  // "arms pulled". Dedup so a member who acted 5 times doesn't get
  // five times the credit (they share one hand outcome).
  const uniqueMembers = [...new Set(participation)]
  for (const memberId of uniqueMembers) {
    const s = state.members[memberId] || (state.members[memberId] = { actions: 0, hands: 0, wins: 0, totalReward: 0 })
    s.hands += 1
    if (won) s.wins += 1
    s.totalReward = (s.totalReward || 0) + reward
    s.lastUsedAt = new Date().toISOString()
  }
  // actions count (every decision, not deduped) — drives the weighted
  // mean-reward denominator.
  for (const memberId of participation) {
    const s = state.members[memberId]
    if (s) s.actions = (s.actions || 0) + 1
  }
  // Markov chain — for each ordered (from, to) pair in the trajectory,
  // bump the count if the hand was a win. Losses don't add edge weight;
  // the smoothing prior keeps them sampleable.
  if (won && participation.length >= 2) {
    if (!state.transitions) state.transitions = {}
    for (let i = 0; i < participation.length - 1; i++) {
      const from = participation[i]
      const to = participation[i + 1]
      if (from === to) continue
      const row = state.transitions[from] || (state.transitions[from] = {})
      row[to] = (row[to] || 0) + 1
    }
  }
  state.handsTrained = (state.handsTrained || 0) + 1
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

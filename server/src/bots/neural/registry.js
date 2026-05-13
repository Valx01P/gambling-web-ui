// Registry of neural-bot policy variants. Each module exposes the same
// shape — initialState, normalizeState, decide(state, ctx), update(state,
// trajectory, reward), currentLearningRate(handsTrained) — so the runtime
// can dispatch by `bot.neuralKind` without caring which technique is
// underneath.
import * as reinforce from './reinforce.js'
import * as reinforceBaseline from './reinforceBaseline.js'
import * as mlp from './mlp.js'
import * as qlearning from './qlearning.js'

const POLICIES = {
  reinforce,
  reinforce_baseline: reinforceBaseline,
  mlp,
  qlearning
}

export function policyFor(kind) {
  return POLICIES[kind] || reinforce
}

export const DEFAULT_KIND = 'reinforce'

// Human-readable names + one-liner descriptions for the UI. Order
// matches the auto-provision tier order (tier 1 → 5).
export const VARIANTS = [
  { kind: 'reinforce', tier: 1, name: 'Neuron α', color: '#06b6d4', label: 'REINFORCE', blurb: 'Vanilla policy gradient. Linear softmax. High variance, fast on basics.' },
  { kind: 'reinforce', tier: 2, name: 'Neuron β', color: '#d946ef', label: 'REINFORCE', blurb: 'Same algorithm, different random init — pairs with α for comparison.' },
  { kind: 'reinforce_baseline', tier: 3, name: 'Neuron γ', color: '#22c55e', label: 'REINFORCE + baseline', blurb: 'Subtracts EMA of past rewards from the gradient. Lower variance, more stable.' },
  { kind: 'mlp', tier: 4, name: 'Neuron δ', color: '#f97316', label: 'MLP (1 hidden)', blurb: 'One tanh hidden layer (8 units). Captures nonlinear feature interactions.' },
  { kind: 'qlearning', tier: 5, name: 'Neuron ε', color: '#fbbf24', label: 'Q-learning · ε-greedy', blurb: 'Value-based: learns Q(s,a) and acts ε-greedy. Different paradigm entirely.' }
]

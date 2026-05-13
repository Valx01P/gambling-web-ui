// Registry of neural-bot policy variants. Each module exposes the same
// shape — initialState, normalizeState, decide(state, ctx), update(state,
// trajectory, reward), currentLearningRate(handsTrained) — so the runtime
// can dispatch by `bot.neuralKind` without caring which technique is
// underneath.
import * as reinforce from './reinforce.js'
import * as reinforceBaseline from './reinforceBaseline.js'
import * as mlp from './mlp.js'
import * as qlearning from './qlearning.js'
import { DEEP_MLP_BY_KIND, ARCHITECTURES as DEEP_MLP_ARCH } from './deepMlp.js'

const POLICIES = {
  reinforce,
  reinforce_baseline: reinforceBaseline,
  mlp,
  qlearning,
  // Each deep-MLP kind dispatches to its own closure built by
  // makeDeepMlp(). DEEP_MLP_BY_KIND is keyed by the same `kind` string
  // the VARIANTS rows below use, so policyFor(bot.neuralKind) Just
  // Works for new tiers.
  ...DEEP_MLP_BY_KIND
}

export function policyFor(kind) {
  return POLICIES[kind] || reinforce
}

export const DEFAULT_KIND = 'reinforce'

// Human-readable names + one-liner descriptions for the UI. Order
// matches the auto-provision tier order (tier 1 → 10). Tiers 1-5 are
// the original "baseline" lineup (one bot per algorithm); tiers 6-10
// are the deep-MLP tier — same algorithm (REINFORCE) but progressively
// deeper / wider networks. The UI splits them into two sections.
export const VARIANTS = [
  { kind: 'reinforce', tier: 1, name: 'Neuron α', color: '#06b6d4', label: 'REINFORCE', blurb: 'Vanilla policy gradient. Linear softmax. High variance, fast on basics.' },
  { kind: 'reinforce', tier: 2, name: 'Neuron β', color: '#d946ef', label: 'REINFORCE', blurb: 'Same algorithm, different random init — pairs with α for comparison.' },
  { kind: 'reinforce_baseline', tier: 3, name: 'Neuron γ', color: '#22c55e', label: 'REINFORCE + baseline', blurb: 'Subtracts EMA of past rewards from the gradient. Lower variance, more stable.' },
  { kind: 'mlp', tier: 4, name: 'Neuron δ', color: '#f97316', label: 'MLP (1×8)', blurb: 'One tanh hidden layer (8 units). Captures nonlinear feature interactions.' },
  { kind: 'qlearning', tier: 5, name: 'Neuron ε', color: '#fbbf24', label: 'Q-learning · ε-greedy', blurb: 'Value-based: learns Q(s,a) and acts ε-greedy. Different paradigm entirely.' },
  // Deep MLP tier — ranked by parameter count. Each step adds either
  // width or depth, so users can A/B the same algorithm at different
  // capacities.
  { kind: 'mlp_16',   tier: 6,  name: 'Neuron ζ', color: '#a855f7', label: 'MLP (1×16)',     params: 358,  blurb: 'Wider single hidden layer (16 tanh units). 2× the baseline MLP.' },
  { kind: 'mlp_2x16', tier: 7,  name: 'Neuron η', color: '#ec4899', label: 'MLP (2×16)',     params: 630,  blurb: 'Two stacked hidden layers (16-16). Deeper feature composition.' },
  { kind: 'mlp_32',   tier: 8,  name: 'Neuron θ', color: '#0ea5e9', label: 'MLP (1×32)',     params: 710,  blurb: 'Wide single layer (32 units). More breadth, same depth.' },
  { kind: 'mlp_3x16', tier: 9,  name: 'Neuron ι', color: '#10b981', label: 'MLP (3×16)',     params: 902,  blurb: 'Three stacked hidden layers (16-16-16). The deepest of the lineup.' },
  { kind: 'mlp_2x32', tier: 10, name: 'Neuron κ', color: '#ef4444', label: 'MLP (2×32)',     params: 1766, blurb: 'Two wide hidden layers (32-32). Largest network — 1.8k parameters.' }
]

// Re-exported so the UI can render a "deep MLP" badge / section header
// keyed by the same kind set the policies use.
export { DEEP_MLP_ARCH }

// Client-side metadata for the neural-bot variants. Mirrors the
// authoritative list in server/src/bots/neural/registry.js — kept in
// sync by hand because the server uses these values to initialize +
// dispatch policies and we don't want to ship the policy modules to
// the browser. Add a new entry here whenever a new kind ships
// server-side.
//
// Used by the bots-page info popover so users can see what each
// algorithm + architecture does without diving into the detail page.

export const NEURAL_KIND_INFO = {
  reinforce: {
    label: 'REINFORCE',
    family: 'Policy gradient',
    blurb:
      'Vanilla policy gradient. Linear softmax head over 15 hand features → 6 actions. Updates weights by ∇log π(a|s) · reward — high variance, but learns the basics fast.',
    arch: 'Linear policy · 15→6 (90 params)',
  },
  reinforce_baseline: {
    label: 'REINFORCE + baseline',
    family: 'Policy gradient',
    blurb:
      'Same algorithm as REINFORCE but subtracts an EMA of past rewards before applying the gradient. Lower variance, more stable convergence on noisy poker outcomes.',
    arch: 'Linear policy · 15→6 (90 params) + scalar baseline',
  },
  mlp: {
    label: 'MLP (1×8)',
    family: 'Policy gradient · neural net',
    blurb:
      'One tanh hidden layer with 8 units between features and the action head. Captures nonlinear interactions (e.g. "raise if equity high AND position late") that the linear policies can\'t represent.',
    arch: '15 → 8 (tanh) → 6 · ~182 params',
  },
  qlearning: {
    label: 'Q-learning · ε-greedy',
    family: 'Value learning',
    blurb:
      'Value-based: learns Q(s,a) ≈ expected reward of taking action a in state s, then acts ε-greedy (mostly best Q, sometimes random for exploration). Different paradigm entirely from the policy-gradient bots.',
    arch: 'Linear Q-table · 15→6 (90 params) · ε decays 0.4 → 0.05',
  },

  // ── Deep MLP tier — architecture variants of the same REINFORCE
  // training. Each step adds either width or depth. Same input (15
  // features), same output (6 actions), same shaped-reward loss.
  mlp_16: {
    label: 'MLP (1×16)',
    family: 'Deep policy gradient',
    blurb:
      'Wider single hidden layer — 16 tanh units. Twice the hidden width of the baseline 1×8 MLP so the policy has more room to represent nonlinear feature combinations.',
    arch: '15 → 16 (tanh) → 6 · 358 params',
  },
  mlp_2x16: {
    label: 'MLP (2×16)',
    family: 'Deep policy gradient',
    blurb:
      'Two stacked hidden layers (16 → 16). Depth lets the network build hierarchical features — first layer extracts intermediate "concepts" from the raw inputs, second layer combines them before scoring actions.',
    arch: '15 → 16 → 16 (tanh) → 6 · 630 params',
  },
  mlp_32: {
    label: 'MLP (1×32)',
    family: 'Deep policy gradient',
    blurb:
      'Wide single layer — 32 tanh units. Same depth as the baseline MLP but 4× the capacity, so it can memorize more distinct hand-context patterns without sharing weights between unrelated spots.',
    arch: '15 → 32 (tanh) → 6 · 710 params',
  },
  mlp_3x16: {
    label: 'MLP (3×16)',
    family: 'Deep policy gradient',
    blurb:
      'Three stacked hidden layers (16 → 16 → 16). The deepest network in the lineup — more sensitive to learning-rate tuning but can in principle represent the richest decision function.',
    arch: '15 → 16 → 16 → 16 (tanh) → 6 · 902 params',
  },
  mlp_2x32: {
    label: 'MLP (2×32)',
    family: 'Deep policy gradient',
    blurb:
      'Two wide hidden layers (32 → 32). The largest network — 1.8k parameters. Highest representational capacity; needs the longest training horizon to settle.',
    arch: '15 → 32 → 32 (tanh) → 6 · 1,766 params',
  },
}

export function infoForKind(kind) {
  return NEURAL_KIND_INFO[kind] || null
}

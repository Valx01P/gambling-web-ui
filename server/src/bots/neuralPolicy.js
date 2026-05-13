// Public API for neural bots — dispatches to the variant in
// ./neural/registry.js based on `kind`. The old single-variant module
// was inlined here; now it lives in ./neural/reinforce.js with three
// siblings (reinforce_baseline, mlp, qlearning).
//
// Everything callers used to import (extractFeatures, NUM_FEATURES,
// ACTION_NAMES, etc.) is re-exported from shared.js so existing call
// sites keep working unchanged.
import { policyFor, DEFAULT_KIND, VARIANTS } from './neural/registry.js'

export {
  FEATURE_NAMES, NUM_FEATURES,
  ACTION_NAMES, NUM_ACTIONS,
  extractFeatures, legalActionMask, actionToCommand
} from './neural/shared.js'

export { policyFor, DEFAULT_KIND, VARIANTS }

// Convenience helpers that pick the right variant for a given kind.

export function initialNeuralState(kind = DEFAULT_KIND) {
  return policyFor(kind).initialState()
}

export function normalizeState(state, kind) {
  // Prefer the kind on the state itself when present — old rows predate
  // the explicit neural_kind column. Fall back to the passed-in arg.
  const k = (state && state.kind) || kind || DEFAULT_KIND
  return policyFor(k).normalizeState(state)
}

// Single-call decision wrapper used by BotPlayer. Returns { command, step }
// or null if no legal action exists.
export function decide(state, ctx, kind) {
  const k = (state && state.kind) || kind || DEFAULT_KIND
  return policyFor(k).decide(state, ctx)
}

// Apply one episode of training to `state` in place. Reward should already
// be normalized to [-1, +1] before calling (the policy modules clip
// defensively anyway).
export function applyReinforceUpdate(state, trajectory, reward, kind) {
  const k = (state && state.kind) || kind || DEFAULT_KIND
  return policyFor(k).update(state, trajectory, reward)
}

export function currentLearningRate(handsTrained, kind = DEFAULT_KIND) {
  return policyFor(kind).currentLearningRate(handsTrained)
}

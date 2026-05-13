// Configurable multi-layer MLP policy. Architecturally a step up from
// `mlp.js` (single 8-unit hidden layer) — supports arbitrary hidden
// layer sizes so we can ship a tier of bots with deeper / wider nets.
// All hidden layers use tanh; the output layer is plain logits → masked
// softmax. Trained with REINFORCE, backprop through every layer using
// the same shaped reward + action-quality signal the other policies use.
//
// Each variant is created via `makeDeepMlp(kind, hidden)` which returns
// a registry-compatible module {kind, initialState, normalizeState,
// decide, update, currentLearningRate}. The hidden-layer sizes are
// captured in the closure so the same generic forward/backward code
// works for every architecture.
//
// State layout (deliberately different shape from mlp.js so we never
// confuse the two on disk):
//   {
//     kind, version, arch: [in, h1, h2, ..., out],
//     layers: [{ w: [out][in], b: [out] }, ...],
//     handsTrained, rewardHistory, actionCounts, lastUpdatedAt
//   }

import {
  NUM_FEATURES, NUM_ACTIONS, REWARD_CLIP, REWARD_HISTORY_LIMIT,
  clamp, extractFeatures, legalActionMask, actionToCommand,
  softmaxMasked, sampleFromProbs, pushReward, makeMatrix,
  actionQuality, shapedReward
} from './shared.js'

// Deeper nets are more sensitive to step size; we scale the base LR
// down with the network's "depth budget" (sum of hidden sizes). The
// shallowest 16-unit variant starts at 0.025; the deepest 2x32 starts
// at ~0.012. Decay window grows too so the gradient lasts longer.
function lrSchedule(hidden) {
  const depthBudget = hidden.reduce((s, n) => s + n, 0)
  // 8-unit baseline (vanilla mlp.js) was 0.03 / 500. Bigger nets get a
  // proportionally smaller initial LR and a longer decay tail.
  const lrInit  = clamp(0.045 - 0.0005 * depthBudget, 0.008, 0.04)
  const lrDecay = 400 + 8 * depthBudget
  return { lrInit, lrDecay }
}

// Standard Xavier/Glorot scale for tanh: each weight ~ N(0, sqrt(2/(fan_in + fan_out))).
// We approximate with a uniform [-s/2, s/2] of comparable variance — `makeMatrix`
// already does uniform random in [-scale/2, scale/2].
function xavierScale(fanIn, fanOut) {
  return Math.sqrt(6 / (fanIn + fanOut))
}

function makeFreshLayers(hidden) {
  const sizes = [NUM_FEATURES, ...hidden, NUM_ACTIONS]
  const layers = []
  for (let i = 0; i < sizes.length - 1; i++) {
    const fanIn = sizes[i]
    const fanOut = sizes[i + 1]
    layers.push({
      w: makeMatrix(fanOut, fanIn, xavierScale(fanIn, fanOut) * 2),
      b: new Array(fanOut).fill(0)
    })
  }
  return { layers, sizes }
}

// Validate / repair a stored state against the expected architecture.
// Mismatched shapes mean someone changed the arch between sessions —
// fall back to fresh layers so we don't crash on a NaN. handsTrained +
// rewardHistory + actionCounts survive when possible since those are
// scalar tallies, not architecture-dependent.
function normalizeStateFor(kind, hidden, state) {
  const fresh = freshState(kind, hidden)
  if (!state || typeof state !== 'object') return fresh

  // Layer integrity: count + per-layer shape must match exactly. A
  // partial rebuild would silently corrupt training, so we either keep
  // all layers or rebuild all of them.
  const expectedSizes = [NUM_FEATURES, ...hidden, NUM_ACTIONS]
  if (Array.isArray(state.layers) && state.layers.length === expectedSizes.length - 1) {
    let ok = true
    for (let i = 0; i < state.layers.length; i++) {
      const layer = state.layers[i]
      const fanIn = expectedSizes[i]
      const fanOut = expectedSizes[i + 1]
      if (!layer || !Array.isArray(layer.w) || layer.w.length !== fanOut
          || !Array.isArray(layer.b) || layer.b.length !== fanOut) {
        ok = false; break
      }
      for (const row of layer.w) {
        if (!Array.isArray(row) || row.length !== fanIn) { ok = false; break }
      }
      if (!ok) break
    }
    if (ok) {
      fresh.layers = state.layers.map(layer => ({
        w: layer.w.map(row => row.slice()),
        b: layer.b.slice()
      }))
    }
  }

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

function freshState(kind, hidden) {
  const { layers, sizes } = makeFreshLayers(hidden)
  return {
    kind,
    version: 1,
    arch: sizes,
    layers,
    handsTrained: 0,
    rewardHistory: [],
    actionCounts: new Array(NUM_ACTIONS).fill(0),
    lastUpdatedAt: new Date().toISOString()
  }
}

// Forward pass. Returns per-layer pre-activations (z) and post-tanh
// activations (h) plus the final logits — backprop needs all of them.
function forward(state, features) {
  const layers = state.layers
  let prev = features
  const hs = [features]    // activations: h[0] = inputs, h[L] = pre-softmax logits
  const zs = []            // pre-activations (for backprop through tanh)
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]
    const fanOut = layer.b.length
    const fanIn = prev.length
    const z = new Array(fanOut)
    for (let o = 0; o < fanOut; o++) {
      let s = layer.b[o]
      const row = layer.w[o]
      for (let i = 0; i < fanIn; i++) s += row[i] * prev[i]
      z[o] = s
    }
    zs.push(z)
    // Last layer is the logits — no nonlinearity. Hidden layers use
    // tanh.
    if (li === layers.length - 1) {
      hs.push(z)
      prev = z
    } else {
      const h = new Array(fanOut)
      for (let o = 0; o < fanOut; o++) h[o] = Math.tanh(z[o])
      hs.push(h)
      prev = h
    }
  }
  return { zs, hs, logits: hs[hs.length - 1] }
}

export function makeDeepMlp(kind, hidden) {
  const { lrInit, lrDecay } = lrSchedule(hidden)

  function currentLearningRate(handsTrained) {
    return lrInit / (1 + (handsTrained || 0) / lrDecay)
  }

  function initialState() {
    return freshState(kind, hidden)
  }

  function normalizeState(state) {
    return normalizeStateFor(kind, hidden, state)
  }

  function decide(state, ctx) {
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

  function update(state, trajectory, rawReward) {
    if (!trajectory || trajectory.length === 0) return state
    const reward = clamp(rawReward, -REWARD_CLIP, REWARD_CLIP)
    const lr = currentLearningRate(state.handsTrained)
    const layers = state.layers
    const L = layers.length

    for (const step of trajectory) {
      const quality = actionQuality(step.actionIdx, step.features)
      const stepReward = shapedReward(quality, reward)
      if (stepReward === 0) {
        state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
        continue
      }
      const { hs, logits } = forward(state, step.features)
      const probs = softmaxMasked(logits, step.mask)
      // dL/dlogit[a] for REINFORCE log-likelihood loss.
      let dOut = new Array(NUM_ACTIONS)
      for (let a = 0; a < NUM_ACTIONS; a++) {
        dOut[a] = stepReward * ((a === step.actionIdx ? 1 : 0) - probs[a])
      }

      // Backprop layer-by-layer from the output back to the input. For
      // each layer:
      //   dW[o][i] = dPostAct[o] * inputAct[i]
      //   db[o]    = dPostAct[o]
      //   dPrevAct = W^T · dPostAct  (passed through tanh' upstream)
      // The OUTPUT layer has no tanh, so we use dOut directly. Hidden
      // layers' dPostAct gets multiplied by (1 - h^2) for tanh'.
      let dPostAct = dOut
      for (let li = L - 1; li >= 0; li--) {
        const layer = layers[li]
        const inputAct = hs[li]                // post-activation of the layer BELOW
        const fanOut = layer.b.length
        const fanIn = inputAct.length
        // Apply tanh derivative for hidden layers (the OUTPUT layer
        // had no nonlinearity, so dPostAct is already correct there).
        if (li < L - 1) {
          // hs[li+1] is this hidden layer's post-tanh activation.
          const h = hs[li + 1]
          for (let o = 0; o < fanOut; o++) {
            dPostAct[o] *= (1 - h[o] * h[o])
          }
        }
        // Compute dPrev for the layer below BEFORE writing to W —
        // otherwise we'd backprop through the updated weights.
        let dPrev = null
        if (li > 0) {
          dPrev = new Array(fanIn).fill(0)
          for (let o = 0; o < fanOut; o++) {
            const g = dPostAct[o]
            if (g === 0) continue
            const row = layer.w[o]
            for (let i = 0; i < fanIn; i++) dPrev[i] += row[i] * g
          }
        }
        // Apply the gradient step to this layer's weights + biases.
        for (let o = 0; o < fanOut; o++) {
          const g = dPostAct[o]
          if (g === 0) continue
          layer.b[o] += lr * g
          const row = layer.w[o]
          for (let i = 0; i < fanIn; i++) row[i] += lr * g * inputAct[i]
        }
        dPostAct = dPrev
      }
      state.actionCounts[step.actionIdx] = (state.actionCounts[step.actionIdx] || 0) + 1
    }
    state.handsTrained = (state.handsTrained || 0) + 1
    pushReward(state, reward)
    state.lastUpdatedAt = new Date().toISOString()
    return state
  }

  return { kind, hidden, initialState, normalizeState, decide, update, currentLearningRate }
}

// Five preconfigured architectures, ranked by parameter count (smallest
// → largest). The numbers in the comments are the on-disk parameter
// count for a (15-in × hidden... × 6-out) MLP including biases.
export const ARCHITECTURES = [
  { kind: 'mlp_16',    hidden: [16],         params: 358  }, // 1 layer, wider than baseline
  { kind: 'mlp_2x16',  hidden: [16, 16],     params: 630  }, // 2 hidden layers, 16 each
  { kind: 'mlp_32',    hidden: [32],         params: 710  }, // 1 layer, wider still
  { kind: 'mlp_3x16',  hidden: [16, 16, 16], params: 902  }, // 3 hidden layers, 16 each
  { kind: 'mlp_2x32',  hidden: [32, 32],     params: 1766 }, // 2 hidden layers, 32 each — widest
]

// Built modules keyed by kind so the registry can dispatch without
// constructing a new closure per call.
export const DEEP_MLP_BY_KIND = Object.fromEntries(
  ARCHITECTURES.map(a => [a.kind, makeDeepMlp(a.kind, a.hidden)])
)

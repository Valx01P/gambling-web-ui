// Shared bot-categorization helpers used by every multi-bot picker
// on the poker page (training simulator, Add Bots tool, bot arena
// lineup queue). Keeps the visual + naming conventions consistent
// across all three.
//
// Mirrors the kind list in server/src/bots/neural/registry.js — add a
// new MLP variant there + update mlpArchLabel here when one ships.

export function isMlpFamily(bot) {
  if (!bot?.isNeural) return false
  const k = bot.neuralKind || ''
  return k === 'mlp' || k.startsWith('mlp_')
}

// Compact architecture chip text for MLP-family bots.
export function mlpArchLabel(kind) {
  switch (kind) {
    case 'mlp':       return 'MLP 1×8'
    case 'mlp_16':    return 'MLP 1×16'
    case 'mlp_32':    return 'MLP 1×32'
    case 'mlp_2x16':  return 'MLP 2×16'
    case 'mlp_2x32':  return 'MLP 2×32'
    case 'mlp_3x16':  return 'MLP 3×16'
    default:          return 'MLP'
  }
}

// Tag for non-MLP neural kinds — visually distinct from the MLP
// family in the picker so the two policy families are scannable.
export function nonMlpNeuralLabel(kind) {
  switch (kind) {
    case 'reinforce':           return 'PG'
    case 'reinforce_baseline':  return 'PG+BL'
    case 'qlearning':           return 'Q-LRN'
    default:                    return 'NN'
  }
}

// Bucket a flat bot list into the same five categories the /poker/bots
// page renders as section shelves. Returns named groups so the picker
// can render labeled strips.
export function bucketByCategory(bots) {
  const buckets = { mlp: [], otherNeural: [], super: [], clone: [], rule: [] }
  for (const b of bots) {
    if (b.isSuper) buckets.super.push(b)
    else if (b.isClone) buckets.clone.push(b)
    else if (isMlpFamily(b)) buckets.mlp.push(b)
    else if (b.isNeural) buckets.otherNeural.push(b)
    else buckets.rule.push(b)
  }
  return buckets
}

// Ordered list of subgroups with display metadata. Skipped if empty.
export function subgroupsFromBuckets(buckets) {
  return [
    { key: 'mlp',         bots: buckets.mlp,         label: 'MLP family',   accent: 'text-purple-200' },
    { key: 'otherNeural', bots: buckets.otherNeural, label: 'Other neural', accent: 'text-cyan-200' },
    { key: 'super',       bots: buckets.super,       label: 'Super',        accent: 'text-violet-200' },
    { key: 'clone',       bots: buckets.clone,       label: 'Clones',       accent: 'text-amber-200' },
    { key: 'rule',        bots: buckets.rule,        label: 'Rule / code',  accent: 'text-zinc-300' }
  ].filter(g => g.bots.length > 0)
}

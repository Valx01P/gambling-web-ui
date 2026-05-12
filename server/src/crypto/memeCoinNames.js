// Meme/scam-coin name generator. Combines an adjective, a noun, and an
// optional suffix to produce names like "SAFEMOON", "PEPE3X", "WAGMI". Pure
// — given the same seed, returns the same name. We seed from coin id so the
// market stays stable across reconnects.

const PREFIXES = [
  'SAFE', 'BABY', 'MINI', 'MEGA', 'TURBO', 'GIGA', 'ULTRA', 'HYPER',
  'PUMP', 'DUMP', 'KING', 'LORD', 'BASED', 'CHAD', 'COPE', 'BOG'
]

const ROOTS = [
  'MOON', 'INU', 'PEPE', 'DOGE', 'FLOKI', 'SHIB', 'CUM', 'WOJAK', 'PONZI',
  'RUG', 'SCAM', 'AIRDROP', 'YIELD', 'STAKE', 'APE', 'BANANA', 'FROG',
  'CAT', 'KITTEN', 'WHALE', 'BULL', 'BEAR', 'LAMBO', 'ROCKET', 'TENDIES',
  'GAINS', 'LOSS', 'BAGS', 'EXIT', 'RUGZ', 'COIN', 'TOKEN', 'CASH'
]

const SUFFIXES = [
  '', '', '', '', '2X', '3X', '69', '420', 'X', 'AI', 'GPT', 'INU', 'CASH',
  'DAO', 'V2', 'V3', 'MAX', 'PRO', 'SWAP'
]

// Tiny xorshift32 so the generator is deterministic. The id is hashed to a
// 32-bit seed first — gives plenty of entropy for short ids.
function hashSeed(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h || 1
}

function next(state) {
  let x = state.seed
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.seed = x >>> 0
  return state.seed
}

function pick(state, arr) {
  return arr[next(state) % arr.length]
}

export function generateMemeCoin(idForSeed) {
  const state = { seed: hashSeed(String(idForSeed || Math.random())) }
  // Skip a few iterations — the first xorshift output is biased low for
  // short seeds, which clusters scam-coin names on the same prefixes.
  next(state); next(state); next(state)
  const prefix = pick(state, PREFIXES)
  const root = pick(state, ROOTS)
  const suffix = pick(state, SUFFIXES)
  const symbol = (prefix.slice(0, 3) + root.slice(0, 3) + (suffix || '')).slice(0, 7)
  const name = `${prefix}${root}${suffix}`
  return { symbol, name }
}

import { tierIndex, TIER_ORDER } from './handStrength.js'

const TIER_NAMES = new Set(TIER_ORDER)
const TIER_SIGNALS = new Set(['handStrength', 'handCategory'])

function normalizeValue(signal, value) {
  if (TIER_SIGNALS.has(signal) && typeof value === 'string' && TIER_NAMES.has(value)) {
    return tierIndex(value)
  }
  return value
}

function ctxValue(ctx, signal) {
  if (signal === 'handStrength' || signal === 'handCategory') return ctx.handStrengthIndex
  return ctx[signal]
}

function compare(left, op, right) {
  switch (op) {
    case '==': return left === right
    case '!=': return left !== right
    case '>':  return typeof left === 'number' && typeof right === 'number' && left > right
    case '>=': return typeof left === 'number' && typeof right === 'number' && left >= right
    case '<':  return typeof left === 'number' && typeof right === 'number' && left < right
    case '<=': return typeof left === 'number' && typeof right === 'number' && left <= right
    case 'in': return Array.isArray(right) && right.includes(left)
    case 'not_in': return Array.isArray(right) && !right.includes(left)
  }
  return false
}

function evalLeaf(node, ctx) {
  if ('signal' in node && 'op' in node) {
    return compare(ctxValue(ctx, node.signal), node.op, normalizeValue(node.signal, node.value))
  }
  for (const [signal, expr] of Object.entries(node)) {
    const ctxVal = ctxValue(ctx, signal)
    if (expr === null) return false
    if (typeof expr === 'object' && !Array.isArray(expr)) {
      for (const [op, val] of Object.entries(expr)) {
        const rhs = op === 'in' || op === 'not_in'
          ? (Array.isArray(val) ? val.map(v => normalizeValue(signal, v)) : val)
          : normalizeValue(signal, val)
        if (!compare(ctxVal, op, rhs)) return false
      }
    } else {
      if (!compare(ctxVal, '==', normalizeValue(signal, expr))) return false
    }
  }
  return true
}

function evalCondition(node, ctx) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node.all)) return node.all.every(s => evalCondition(s, ctx))
  if (Array.isArray(node.any)) return node.any.some(s => evalCondition(s, ctx))
  if (node.not) return !evalCondition(node.not, ctx)
  return evalLeaf(node, ctx)
}

function resolveSize(size, ctx, bigBlind) {
  const fallback = Math.max(ctx.currentBet * 2, ctx.currentBet + bigBlind, bigBlind)
  if (size === undefined || size === null) return fallback
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) return Math.floor(size)
  if (typeof size !== 'string') return fallback

  if (size === 'min') return fallback
  if (size === 'pot') return ctx.potSize + ctx.toCall
  if (size === 'all_in') return ctx.myStack + ctx.toCall

  let m = size.match(/^(\d+(?:\.\d+)?)xBB$/)
  if (m) return Math.floor(parseFloat(m[1]) * bigBlind)
  m = size.match(/^(\d+(?:\.\d+)?)xPot$/)
  if (m) return Math.floor(parseFloat(m[1]) * (ctx.potSize + ctx.toCall))

  return fallback
}

// Returns { action, amount } where amount is the *target total bet* for raise.
// Caller maps these onto PokerGame.handleAction(playerId, action, amount).
export function evaluate(rules, ctx, { bigBlind }) {
  const list = rules?.rules || []
  for (const rule of list) {
    if (rule.when && !evalCondition(rule.when, ctx)) continue
    const action = rule.do?.action

    if (action === 'raise') {
      let target = resolveSize(rule.do.size, ctx, bigBlind)
      const minRaise = Math.max(ctx.currentBet * 2, ctx.currentBet + bigBlind, bigBlind)
      const allInTarget = ctx.myStack + (ctx.currentBet - ctx.toCall)
      if (target >= allInTarget) return { action: 'all_in', amount: 0 }
      if (target < minRaise) target = minRaise
      return { action: 'raise', amount: target }
    }

    if (action === 'all_in' || action === 'fold' || action === 'check' || action === 'call') {
      return { action, amount: 0 }
    }
  }
  return { action: 'fold', amount: 0 }
}

export const _internal = { evalCondition, resolveSize }

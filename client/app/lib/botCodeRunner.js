// Client-side runner for the simulator. Uses Function() with a stripped-down
// scope. This is NOT a security boundary — only the bot owner runs their own
// code here, in their own browser.

export function runUserCode(code, ctx) {
  try {
    const fn = new Function(
      'ctx',
      `"use strict";
       ${code}
       if (typeof decide !== 'function') throw new Error('Define a decide(ctx) function')
       return decide(ctx)`
    )
    const result = fn(ctx)
    return validateResult(result)
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

const VALID_ACTIONS = new Set(['fold', 'check', 'call', 'raise', 'all_in'])

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, error: 'decide() must return an object like { action: "fold" }' }
  }
  if (!VALID_ACTIONS.has(result.action)) {
    return { ok: false, error: `Unknown action "${result.action}"` }
  }
  if (result.action === 'raise') {
    const n = Number(result.amount)
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'raise needs a positive amount' }
    return { ok: true, action: 'raise', amount: Math.floor(n) }
  }
  return { ok: true, action: result.action, amount: 0 }
}

export function lintJs(code) {
  if (typeof code !== 'string') return { ok: false, error: 'Code must be a string' }
  if (!code.trim()) return { ok: true }
  try {
    new Function(code + '\nif (typeof decide !== "function") throw new Error("Define a function called decide(ctx)")')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

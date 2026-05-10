import vm from 'node:vm'
import { evaluateHand, getHandName } from '../../poker/handEvaluator.js'
import { strengthFor } from './handStrength.js'

const COMPILE_TIMEOUT_MS = 250
const RUN_TIMEOUT_MS = 150

// Builds a sandbox that has just enough JS to express a poker strategy.
// No process / require / fetch / setTimeout / Buffer / globalThis. The user's code
// can read ctx and call our small helpers, and that is it.
function makeSandbox(logSink) {
  const sandbox = {
    Math: Math,
    JSON: JSON,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    Symbol: Symbol,
    isNaN, isFinite, parseInt, parseFloat,
    Date: { now: () => Date.now() },
    console: {
      log: (...args) => logSink(args),
      warn: (...args) => logSink(args),
      info: (...args) => logSink(args),
      error: (...args) => logSink(args)
    },
    // Bot-friendly helpers
    evaluateCards(cards) {
      try {
        const result = evaluateHand(cards)
        return { rank: result.rank, name: getHandName(result), bestCards: result.bestCards }
      } catch {
        return null
      }
    },
    handStrength(holeCards, communityCards) {
      try { return strengthFor(holeCards, communityCards || []) }
      catch { return 'trash' }
    },
    randomFloat(min = 0, max = 1) { return min + Math.random() * (max - min) },
    // No __ctx__ or __decide__ here — they get assigned on first run.
  }
  return sandbox
}

// Compiled bot: { run(ctx) -> { action, amount }, dispose() }. On any error
// (compile failure, runtime throw, timeout, invalid return) the caller gets
// a safe `null` so it can fall back to rules.
export function compileBot(code) {
  const logs = []
  const logSink = (args) => {
    if (logs.length >= 20) logs.shift()
    try { logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }
    catch { logs.push('[unserializable]') }
  }
  const sandbox = makeSandbox(logSink)
  const context = vm.createContext(sandbox, { name: 'bot-sandbox' })

  const wrapper = `
    "use strict";
    ${code}
    if (typeof decide !== 'function') {
      throw new Error('Your bot must define a function called decide(ctx).')
    }
    globalThis.__decide__ = decide;
  `

  let compileError = null
  try {
    const script = new vm.Script(wrapper, { filename: 'bot.js' })
    script.runInContext(context, { timeout: COMPILE_TIMEOUT_MS })
  } catch (err) {
    compileError = err
  }

  const invokeScript = new vm.Script('__decide__(__ctx__)', { filename: 'bot-invoke.js' })

  return {
    error: compileError ? (compileError.message || String(compileError)) : null,
    logs,
    run(ctx) {
      if (compileError) return { ok: false, error: compileError.message || String(compileError) }
      try {
        sandbox.__ctx__ = ctx
        const result = invokeScript.runInContext(context, { timeout: RUN_TIMEOUT_MS, breakOnSigint: true })
        const validated = validateResult(result)
        if (!validated.ok) return validated
        return { ok: true, action: validated.action, amount: validated.amount, say: validated.say }
      } catch (err) {
        return { ok: false, error: err.message || String(err) }
      } finally {
        sandbox.__ctx__ = undefined
      }
    },
    dispose() {
      // Just drop the references — no native handles to free.
      sandbox.__ctx__ = undefined
      sandbox.__decide__ = undefined
    }
  }
}

const VALID_ACTIONS = new Set(['fold', 'check', 'call', 'raise', 'all_in'])
const MAX_SAY_LENGTH = 80

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, error: 'decide() must return an object like { action: "fold" }' }
  }
  const action = result.action
  if (!VALID_ACTIONS.has(action)) {
    return { ok: false, error: `Unknown action "${action}". Use fold, check, call, raise, or all_in.` }
  }
  let amount = 0
  if (action === 'raise') {
    const n = Number(result.amount)
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: 'raise needs an amount (target total bet, in chips)' }
    }
    amount = Math.floor(n)
  }
  let say = null
  if (result.say !== undefined && result.say !== null) {
    if (typeof result.say !== 'string') {
      return { ok: false, error: '`say` must be a string' }
    }
    say = result.say.slice(0, MAX_SAY_LENGTH)
  }
  return { ok: true, action, amount, say }
}

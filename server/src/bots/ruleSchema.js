// Shape validation for the bot rule DSL. The runtime evaluator (M2) is what actually
// interprets these. Here we only enforce structural limits so we can never store a
// document the evaluator would reject — and so an attacker can't blow up the server
// by submitting a 10MB nested rule blob.
//
// DSL shape:
//   { rules: Array<Rule>, meta?: object }
// where Rule = { when?: Condition, do: Action }
//
// Condition is a tree of AND/OR/NOT plus leaf comparisons keyed by a known signal.
// Action is { action: 'fold'|'check'|'call'|'raise'|'all_in', size?: SizeExpr }

export const VALID_ACTIONS = new Set(['fold', 'check', 'call', 'raise', 'all_in'])

export const VALID_SIGNALS = new Set([
  'phase',
  'position',
  'handStrength',
  'handCategory',
  'potOdds',
  'potSize',
  'currentBet',
  'toCall',
  'myStack',
  'effectiveStack',
  'aggressionCount',
  'numActiveOpponents',
  'facingBet',
  'facingRaise',
  'facingAllIn',
  'lastOpponentAction',
  'roundIndex',
  'isHeadsUp',
  'streetIsPreflop',
  'streetIsPostflop'
])

export const VALID_OPERATORS = new Set(['==', '!=', '>', '>=', '<', '<=', 'in', 'not_in'])

export const VALID_PHRASE_EVENTS = new Set([
  'win',
  'lose',
  'all_in',
  'fold',
  'raise',
  'big_bluff',
  'bad_beat',
  'showdown_won',
  'showdown_lost',
  'joined_table',
  'left_table'
])

const MAX_RULES = 64
const MAX_DEPTH = 6
const MAX_PHRASES_PER_EVENT = 12
const MAX_PHRASE_LENGTH = 140

function fail(path, message) {
  const err = new Error(`${path}: ${message}`)
  err.code = 'invalid_rules'
  err.path = path
  throw err
}

function validateAction(action, path) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    fail(path, 'action must be an object')
  }
  if (!VALID_ACTIONS.has(action.action)) {
    fail(`${path}.action`, `unknown action "${action.action}"`)
  }
  if (action.size !== undefined) {
    const size = action.size
    const isNumber = typeof size === 'number' && Number.isFinite(size) && size > 0
    const isShorthand = typeof size === 'string' && /^(\d+(\.\d+)?xBB|\d+(\.\d+)?xPot|min|pot|all_in)$/.test(size)
    if (!isNumber && !isShorthand) {
      fail(`${path}.size`, 'size must be a positive number, "<n>xBB", "<n>xPot", "min", "pot", or "all_in"')
    }
  }
  if (action.action === 'raise' && action.size === undefined) {
    fail(`${path}.size`, 'raise requires a size')
  }
}

function validateLeafCondition(node, path) {
  // A leaf is either { signal: <known>, op: <op>, value: ... }
  // or a sugar shape: { [signal]: <value-or-comparison> }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    fail(path, 'condition must be an object')
  }

  if ('signal' in node || 'op' in node || 'value' in node) {
    if (!VALID_SIGNALS.has(node.signal)) fail(`${path}.signal`, `unknown signal "${node.signal}"`)
    if (!VALID_OPERATORS.has(node.op)) fail(`${path}.op`, `unknown operator "${node.op}"`)
    return
  }

  const keys = Object.keys(node)
  if (keys.length === 0) fail(path, 'empty condition')

  for (const key of keys) {
    if (!VALID_SIGNALS.has(key)) fail(`${path}.${key}`, `unknown signal "${key}"`)
    const value = node[key]
    if (value === null) fail(`${path}.${key}`, 'value cannot be null')
    if (typeof value === 'object' && !Array.isArray(value)) {
      const ops = Object.keys(value)
      if (ops.length === 0) fail(`${path}.${key}`, 'empty comparison')
      for (const op of ops) {
        if (!VALID_OPERATORS.has(op)) fail(`${path}.${key}`, `unknown operator "${op}"`)
      }
    }
  }
}

function validateCondition(node, path, depth = 0) {
  if (depth > MAX_DEPTH) fail(path, 'condition nested too deeply')
  if (!node || typeof node !== 'object') fail(path, 'condition must be an object')

  if (Array.isArray(node.all)) {
    if (node.all.length === 0) fail(`${path}.all`, 'all[] cannot be empty')
    node.all.forEach((sub, i) => validateCondition(sub, `${path}.all[${i}]`, depth + 1))
    return
  }
  if (Array.isArray(node.any)) {
    if (node.any.length === 0) fail(`${path}.any`, 'any[] cannot be empty')
    node.any.forEach((sub, i) => validateCondition(sub, `${path}.any[${i}]`, depth + 1))
    return
  }
  if (node.not && typeof node.not === 'object') {
    validateCondition(node.not, `${path}.not`, depth + 1)
    return
  }

  validateLeafCondition(node, path)
}

export function validateRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    fail('rules', 'must be an object')
  }
  if (!Array.isArray(rules.rules)) fail('rules.rules', 'must be an array')
  if (rules.rules.length === 0) fail('rules.rules', 'must have at least one rule (at minimum a default fallback)')
  if (rules.rules.length > MAX_RULES) fail('rules.rules', `too many rules (max ${MAX_RULES})`)

  rules.rules.forEach((rule, i) => {
    const path = `rules.rules[${i}]`
    if (!rule || typeof rule !== 'object') fail(path, 'rule must be an object')
    if (rule.when !== undefined) validateCondition(rule.when, `${path}.when`)
    if (!rule.do) fail(`${path}.do`, 'rule must define a "do" action')
    validateAction(rule.do, `${path}.do`)
  })

  // Last rule should be an unconditional default; we don't *require* it but it's the
  // only sane shape — surface a friendly error if everything is conditional.
  const last = rules.rules[rules.rules.length - 1]
  if (last.when !== undefined) {
    fail('rules.rules', 'last rule must be unconditional (omit "when") to act as a default')
  }
}

export function validatePhrases(phrases) {
  if (phrases === undefined || phrases === null) return
  if (typeof phrases !== 'object' || Array.isArray(phrases)) {
    fail('phrases', 'must be an object keyed by event name')
  }
  for (const [event, list] of Object.entries(phrases)) {
    if (!VALID_PHRASE_EVENTS.has(event)) fail(`phrases.${event}`, `unknown event`)
    if (!Array.isArray(list)) fail(`phrases.${event}`, 'must be an array of strings')
    if (list.length > MAX_PHRASES_PER_EVENT) {
      fail(`phrases.${event}`, `too many phrases (max ${MAX_PHRASES_PER_EVENT})`)
    }
    list.forEach((p, i) => {
      if (typeof p !== 'string') fail(`phrases.${event}[${i}]`, 'must be a string')
      if (p.length > MAX_PHRASE_LENGTH) fail(`phrases.${event}[${i}]`, `too long (max ${MAX_PHRASE_LENGTH} chars)`)
    })
  }
}

export function validateColor(color) {
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    fail('color', 'must be a 6-digit hex color, e.g. "#ff8800"')
  }
}

export function validateTextColor(textColor) {
  if (textColor === undefined || textColor === null) return
  if (textColor !== 'auto' && textColor !== 'white' && textColor !== 'black') {
    fail('textColor', 'must be "auto", "white", or "black"')
  }
}

// Bot names are shown alongside human usernames at the table — same Unicode
// spoof / control-char surface. Reuse the shared sanitizer instead of
// duplicating its regex (the duplicate had a copy-paste bug that silently
// stripped spaces, which broke "Pablo v3" → "Pablov3"). The shared util has
// no runtime dependencies, so importing it here is safe.
//
// We sanitize with a generous maxLength then enforce the bot-specific 32-char
// bound separately. That preserves the original "names over 32 chars are an
// explicit invalid-input error" contract instead of silently truncating —
// the route's 400-with-detail response is more useful to the user than a
// surprise name change.
import { sanitizeDisplayString } from '../utils/sanitize.js'

export function validateName(name) {
  if (typeof name !== 'string') fail('name', 'must be a string')
  const trimmed = sanitizeDisplayString(name, { maxLength: 256 })
  if (trimmed.length < 1 || trimmed.length > 32) {
    fail('name', 'must be between 1 and 32 characters')
  }
  return trimmed
}

// Bumped 32 KB → 128 KB so a complex strategy with the full reference comment
// + sizable lookup tables (e.g., per-opponent opening charts, hand ranges as
// data) comfortably fits. The sandbox compile/run timeouts still cap CPU; the
// length cap is purely about keeping the bot row small in the database.
const MAX_CODE_LENGTH = 131_072

export function validateCode(code) {
  if (code === undefined || code === null) return
  if (typeof code !== 'string') fail('code', 'must be a string')
  if (code.length > MAX_CODE_LENGTH) fail('code', `code is too long (max ${MAX_CODE_LENGTH} chars)`)
}

// Server keeps newly created bots empty on the code field; the client editor
// fills in a rich tutorial template the first time you open the bot. That
// keeps the LLM-paste-ready template in one place (client/app/components/JsCodeEditor.jsx).
export function defaultCode() {
  return ''
}

export function defaultRules() {
  return {
    rules: [
      {
        when: { phase: 'preflop', handStrength: { '>=': 'strong' }, position: { in: ['middle', 'late', 'btn', 'sb', 'bb'] } },
        do: { action: 'raise', size: '3xBB' }
      },
      {
        when: { facingBet: true, potOdds: { '>=': 0.33 }, handStrength: { '>=': 'medium' } },
        do: { action: 'call' }
      },
      { when: { facingBet: false }, do: { action: 'check' } },
      { do: { action: 'fold' } }
    ]
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from '../src/bots/runtime/evaluator.js'
import { defaultRules } from '../src/bots/ruleSchema.js'
import { tierIndex } from '../src/bots/runtime/handStrength.js'

const baseCtx = {
  phase: 'preflop',
  streetIsPreflop: true,
  streetIsPostflop: false,
  position: 'btn',
  handStrength: 'medium',
  handStrengthIndex: tierIndex('medium'),
  handCategory: 'medium',
  potOdds: 0,
  potSize: 15,
  currentBet: 10,
  toCall: 10,
  myStack: 1000,
  effectiveStack: 1000,
  aggressionCount: 1,
  numActiveOpponents: 1,
  facingBet: true,
  facingRaise: false,
  facingAllIn: false,
  lastOpponentAction: 'bb',
  roundIndex: 0,
  isHeadsUp: true
}

test('default rules: premium hand on btn raises 3xBB', () => {
  const ctx = { ...baseCtx, handStrength: 'premium', handStrengthIndex: tierIndex('premium') }
  const result = evaluate(defaultRules(), ctx, { bigBlind: 10 })
  assert.equal(result.action, 'raise')
  assert.equal(result.amount, 30)
})

test('default rules: medium hand facing 33% pot odds calls', () => {
  const ctx = { ...baseCtx, handStrength: 'medium', handStrengthIndex: tierIndex('medium'), potOdds: 0.4 }
  const result = evaluate(defaultRules(), ctx, { bigBlind: 10 })
  assert.equal(result.action, 'call')
})

test('default rules: trash hand folds', () => {
  const ctx = { ...baseCtx, handStrength: 'trash', handStrengthIndex: tierIndex('trash') }
  const result = evaluate(defaultRules(), ctx, { bigBlind: 10 })
  assert.equal(result.action, 'fold')
})

test('default rules: not facing a bet checks', () => {
  const ctx = { ...baseCtx, facingBet: false, toCall: 0, currentBet: 0, handStrength: 'medium', handStrengthIndex: tierIndex('medium') }
  const result = evaluate(defaultRules(), ctx, { bigBlind: 10 })
  assert.equal(result.action, 'check')
})

test('raise upgraded to all-in when size exceeds stack', () => {
  const rules = { rules: [
    { do: { action: 'raise', size: 5000 } }
  ]}
  const result = evaluate(rules, { ...baseCtx, myStack: 100 }, { bigBlind: 10 })
  assert.equal(result.action, 'all_in')
})

test('raise floor enforced at min raise', () => {
  const rules = { rules: [
    { do: { action: 'raise', size: 1 } }
  ]}
  const result = evaluate(rules, baseCtx, { bigBlind: 10 })
  assert.equal(result.action, 'raise')
  assert.ok(result.amount >= 20)
})

test('all/any/not condition combinators', () => {
  const rules = { rules: [
    { when: { all: [{ phase: 'preflop' }, { not: { handStrength: 'trash' } }] }, do: { action: 'check' } },
    { do: { action: 'fold' } }
  ]}
  assert.equal(evaluate(rules, { ...baseCtx, handStrength: 'medium', handStrengthIndex: tierIndex('medium'), facingBet: false, toCall: 0 }, { bigBlind: 10 }).action, 'check')
  assert.equal(evaluate(rules, { ...baseCtx, handStrength: 'trash', handStrengthIndex: tierIndex('trash') }, { bigBlind: 10 }).action, 'fold')
})

test('position in: ["btn","late"] matches btn', () => {
  const rules = { rules: [
    { when: { position: { in: ['btn', 'late'] } }, do: { action: 'check' } },
    { do: { action: 'fold' } }
  ]}
  assert.equal(evaluate(rules, { ...baseCtx, facingBet: false, toCall: 0 }, { bigBlind: 10 }).action, 'check')
  assert.equal(evaluate(rules, { ...baseCtx, position: 'utg', facingBet: false, toCall: 0 }, { bigBlind: 10 }).action, 'fold')
})

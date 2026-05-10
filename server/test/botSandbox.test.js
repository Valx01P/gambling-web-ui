import test from 'node:test'
import assert from 'node:assert/strict'
import { compileBot } from '../src/bots/runtime/codeSandbox.js'

test('compiles and runs a basic decide', () => {
  const bot = compileBot(`
    function decide(ctx) {
      if (ctx.handStrength === 'premium') return { action: 'raise', amount: 30 }
      return { action: 'fold' }
    }
  `)
  assert.equal(bot.error, null)
  const r = bot.run({ handStrength: 'premium' })
  assert.equal(r.ok, true)
  assert.equal(r.action, 'raise')
  assert.equal(r.amount, 30)

  const r2 = bot.run({ handStrength: 'trash' })
  assert.equal(r2.action, 'fold')
})

test('reports compile errors without crashing', () => {
  const bot = compileBot('function decide(ctx) { this is not valid }')
  assert.notEqual(bot.error, null)
})

test('reports runtime errors', () => {
  const bot = compileBot('function decide(ctx) { throw new Error("boom") }')
  const r = bot.run({})
  assert.equal(r.ok, false)
  assert.match(r.error, /boom/)
})

test('rejects invalid action returns', () => {
  const bot = compileBot('function decide(ctx) { return { action: "shimmy" } }')
  const r = bot.run({})
  assert.equal(r.ok, false)
  assert.match(r.error, /Unknown action/)
})

test('rejects raise without amount', () => {
  const bot = compileBot('function decide(ctx) { return { action: "raise" } }')
  const r = bot.run({})
  assert.equal(r.ok, false)
  assert.match(r.error, /amount/)
})

test('cannot reach process or require', () => {
  const bot = compileBot(`
    function decide(ctx) {
      try { return { action: 'raise', amount: process.pid } }
      catch (err) { return { action: 'fold' } }
    }
  `)
  const r = bot.run({})
  assert.equal(r.ok, true)
  assert.equal(r.action, 'fold')
})

test('CPU timeout kills runaway loops', () => {
  const bot = compileBot('function decide(ctx) { while (true) {} }')
  const r = bot.run({})
  assert.equal(r.ok, false)
  assert.match(r.error, /timed? out|Script execution/i)
})

test('helpers: handStrength and evaluateCards available', () => {
  const bot = compileBot(`
    function decide(ctx) {
      const tier = handStrength([{rank:'A',suit:'spades'},{rank:'A',suit:'hearts'}], [])
      const ev = evaluateCards([
        {rank:'A',suit:'spades'},{rank:'A',suit:'hearts'},{rank:'A',suit:'clubs'},
        {rank:'K',suit:'spades'},{rank:'K',suit:'hearts'}
      ])
      if (tier === 'premium' && ev && ev.name) return { action: 'raise', amount: 100 }
      return { action: 'fold' }
    }
  `)
  const r = bot.run({})
  assert.equal(r.action, 'raise')
})

test('console.log captured into logs ring', () => {
  const bot = compileBot(`
    function decide(ctx) {
      console.log('hello', { x: 1 })
      return { action: 'fold' }
    }
  `)
  bot.run({})
  bot.run({})
  assert.ok(bot.logs.length >= 2)
  assert.match(bot.logs[0], /hello/)
})

test('decide can return a custom say string', () => {
  const bot = compileBot(`
    function decide(ctx) {
      return { action: 'raise', amount: 60, say: 'lets build it' }
    }
  `)
  const r = bot.run({})
  assert.equal(r.ok, true)
  assert.equal(r.say, 'lets build it')
})

test('say is clipped to 80 chars', () => {
  const bot = compileBot(`
    function decide(ctx) {
      return { action: 'fold', say: 'a'.repeat(500) }
    }
  `)
  const r = bot.run({})
  assert.equal(r.ok, true)
  assert.equal(r.say.length, 80)
})

test('say must be a string when provided', () => {
  const bot = compileBot('function decide(ctx) { return { action: "fold", say: 42 } }')
  const r = bot.run({})
  assert.equal(r.ok, false)
  assert.match(r.error, /string/)
})

test('frozen ctx resists mutation', () => {
  const bot = compileBot(`
    function decide(ctx) {
      try { ctx.handStrength = 'premium' } catch (e) {}
      return { action: ctx.handStrength === 'premium' ? 'raise' : 'fold', amount: 10 }
    }
  `)
  const ctx = Object.freeze({ handStrength: 'trash' })
  const r = bot.run(ctx)
  assert.equal(r.action, 'fold')
})

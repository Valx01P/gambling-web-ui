'use client'

import { useMemo, useState } from 'react'
import { runUserCode } from '../lib/botCodeRunner'

const PHASE_OPTIONS = ['preflop', 'flop', 'turn', 'river']
const POSITION_OPTIONS = ['btn', 'sb', 'bb', 'utg', 'middle', 'late']
const HAND_STRENGTH_OPTIONS = ['trash', 'weak', 'medium', 'strong', 'premium']
const ACTION_OPTIONS = ['fold', 'check', 'call', 'raise', 'all_in', 'sb', 'bb']

const DEFAULT_CTX = {
  phase: 'preflop',
  position: 'btn',
  handStrength: 'medium',
  potSize: 30,
  currentBet: 10,
  toCall: 10,
  myStack: 1000,
  aggressionCount: 1,
  numActiveOpponents: 1,
  facingBet: true,
  facingRaise: false,
  facingAllIn: false,
  lastOpponentAction: 'bb'
}

// Build a fully populated sample ctx — mirrors what the server gives a real bot
// so users can iterate against realistic data without sitting at a table.
function buildSampleCtx(ctx) {
  const opponents = Array.from({ length: ctx.numActiveOpponents }, (_, i) => ({
    id: `opp-${i + 1}`, seat: i + 1, name: `Opp ${i + 1}`,
    isBot: false, botColor: null, chips: 1000, bet: ctx.currentBet, totalBet: ctx.currentBet,
    folded: false, allIn: false, position: 'middle',
    lastAction: { action: ctx.lastOpponentAction, amount: ctx.currentBet },
    stats: {
      handsObserved: 12, handsPlayed: 5, vpip: 0.4, aggressionFreq: 0.18,
      foldsToBet: 4, profit: 0,
      showdownsSeen: 3, showdownsWon: 1, wtsdRate: 0.25, wonAtShowdownRate: 0.33,
      recentBetSizes: [20, 30, 60], avgRecentBetSize: 36
    }
  }))
  return {
    ...ctx,
    streetIsPreflop: ctx.phase === 'preflop',
    streetIsPostflop: ctx.phase !== 'preflop',
    roundIndex: PHASE_OPTIONS.indexOf(ctx.phase),
    handStrengthIndex: HAND_STRENGTH_OPTIONS.indexOf(ctx.handStrength),
    handCategory: ctx.handStrength,
    potOdds: ctx.toCall > 0 ? ctx.toCall / (ctx.potSize + ctx.toCall) : 0,
    bigBlind: 10,
    smallBlind: 5,
    minRaiseTarget: Math.max(ctx.currentBet * 2, ctx.currentBet + 10, 10),
    maxRaiseTarget: ctx.myStack + (ctx.currentBet - ctx.toCall),
    effectiveStack: Math.min(ctx.myStack + (ctx.currentBet - ctx.toCall), ...opponents.map(o => o.chips + o.bet), ctx.myStack),
    spr: ctx.potSize > 0 ? ctx.myStack / ctx.potSize : 100,
    holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
    communityCards: [],
    bestHand: null,
    handIndex: 14,
    me: {
      id: 'me', name: 'You', seat: 0, chips: ctx.myStack,
      bet: ctx.currentBet - ctx.toCall, totalBetThisHand: ctx.currentBet - ctx.toCall,
      position: ctx.position,
      stats: {
        handsObserved: 14, handsPlayed: 6, vpip: 0.43, aggressionFreq: 0.21,
        profit: 0, showdownsSeen: 4, showdownsWon: 2
      }
    },
    opponents,
    actionHistory: [],
    handHistory: [],
    lastShowdown: null,
    dealerSeatIndex: 0
  }
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{label}</span>
      {children}
    </label>
  )
}

export default function Simulator({ code }) {
  const [ctx, setCtx] = useState(DEFAULT_CTX)

  const decision = useMemo(() => {
    const sample = buildSampleCtx(ctx)
    const result = runUserCode(code || '', sample)
    if (result.ok) return { action: result.action, amount: result.amount, say: result.say }
    return { action: 'error', amount: 0, error: result.error }
  }, [code, ctx])

  function set(key, value) { setCtx(prev => ({ ...prev, [key]: value })) }

  return (
    <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/80 p-3 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-white">Test scenario</div>
          <div className="text-xs font-bold text-zinc-300">Run your decide(ctx) against a sample state.</div>
        </div>
        <div className={`rounded-md border px-3 py-1 text-xs font-black ${
          decision.action === 'fold' ? 'border-red-500/40 bg-red-500/10 text-red-200'
          : decision.action === 'all_in' ? 'border-amber-400/50 bg-amber-500/15 text-amber-100'
          : decision.action === 'raise' ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
          : decision.action === 'error' ? 'border-red-500/60 bg-red-500/20 text-red-100'
          : 'border-zinc-500/50 bg-zinc-700/40 text-white'
        }`}>
          → {decision.action.toUpperCase()}
          {decision.action === 'raise' && decision.amount > 0 ? ` ${decision.amount}` : ''}
        </div>
      </div>
      {decision.error && (
        <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs font-bold text-red-200">
          {decision.error}
        </div>
      )}
      {decision.say && (
        <div className="mb-2 rounded-md border border-zinc-600/60 bg-zinc-900/60 px-2 py-1 text-xs font-bold text-zinc-200">
          said: <span className="text-amber-300">"{decision.say}"</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Phase">
          <select value={ctx.phase} onChange={e => set('phase', e.target.value)} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white">
            {PHASE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Position">
          <select value={ctx.position} onChange={e => set('position', e.target.value)} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white">
            {POSITION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Hand strength">
          <select value={ctx.handStrength} onChange={e => set('handStrength', e.target.value)} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white">
            {HAND_STRENGTH_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Pot size">
          <input type="number" min={0} step={5} value={ctx.potSize} onChange={e => set('potSize', parseInt(e.target.value, 10) || 0)} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white" />
        </Field>
        <Field label="To call">
          <input type="number" min={0} step={5} value={ctx.toCall} onChange={e => {
            const n = parseInt(e.target.value, 10) || 0
            setCtx(prev => ({ ...prev, toCall: n, currentBet: Math.max(prev.currentBet, n), facingBet: n > 0 }))
          }} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white" />
        </Field>
        <Field label="My stack">
          <input type="number" min={0} step={10} value={ctx.myStack} onChange={e => set('myStack', parseInt(e.target.value, 10) || 0)} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white" />
        </Field>
        <Field label="Aggression count">
          <input type="number" min={0} max={10} step={1} value={ctx.aggressionCount} onChange={e => {
            const n = parseInt(e.target.value, 10) || 0
            setCtx(prev => ({ ...prev, aggressionCount: n, facingRaise: n >= 2 }))
          }} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white" />
        </Field>
        <Field label="Active opponents">
          <input type="number" min={0} max={4} step={1} value={ctx.numActiveOpponents} onChange={e => {
            const n = parseInt(e.target.value, 10) || 0
            setCtx(prev => ({ ...prev, numActiveOpponents: n }))
          }} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white" />
        </Field>
        <Field label="Last opp action">
          <select value={ctx.lastOpponentAction} onChange={e => set('lastOpponentAction', e.target.value)} className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white">
            {ACTION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {[
          { label: 'Facing bet', key: 'facingBet' },
          { label: 'Facing raise', key: 'facingRaise' },
          { label: 'Facing all-in', key: 'facingAllIn' }
        ].map(({ label, key }) => (
          <button
            key={key}
            type="button"
            onClick={() => set(key, !ctx[key])}
            className={`rounded-md border px-2 py-1 text-[10px] font-bold ${ctx[key] ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-zinc-600/60 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}
          >
            {label}: {ctx[key] ? 'YES' : 'NO'}
          </button>
        ))}
      </div>
    </div>
  )
}

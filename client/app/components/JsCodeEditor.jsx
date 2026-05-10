'use client'

import { useMemo, useRef, useState } from 'react'
import { CTX_GROUPS } from '../lib/ctxDocs'
import { lintJs } from '../lib/botCodeRunner'

const STARTER_CODE = `/**
 * ============================================================================
 *   POKER BOT — decide(ctx) runs every time it's your bot's turn.
 * ============================================================================
 *
 * Hand it to an LLM along with what you want ("make this looser", "exploit
 * sticky callers", "play heads-up endgame"). The LLM has every signal it
 * needs to write a smart bot.
 *
 *   RETURN one of:
 *     { action: 'fold' }
 *     { action: 'check' }
 *     { action: 'call' }
 *     { action: 'raise', amount: <total target bet, in chips> }
 *     { action: 'all_in' }
 *
 *   Add \`say: '<phrase>'\` to any return to yell at the table (max 80 chars):
 *     { action: 'raise', amount: 60, say: 'lets build it' }
 *
 *   SERVER LIMITS
 *     • 150 ms CPU per call — infinite loops are killed
 *     • 32 KB max code length
 *     • Pure functions only — no fetch / setTimeout / require / process
 *     • Compile or runtime errors → bot folds (or checks if free)
 *     • Returning anything outside the contract above → bot folds
 *
 * ============================================================================
 *   ctx — EVERYTHING YOUR BOT CAN SEE
 * ============================================================================
 *
 *   Pull anything below straight into your decisions. The right rail also
 *   lists every field; click any of them to insert at the cursor.
 *
 *   --- Game state ----------------------------------------------------------
 *   ctx.phase                  'preflop' | 'flop' | 'turn' | 'river'
 *   ctx.roundIndex             0..3 (preflop=0)
 *   ctx.streetIsPreflop        boolean
 *   ctx.streetIsPostflop       boolean
 *   ctx.handIndex              # of hands at this table since you sat
 *   ctx.bigBlind, ctx.smallBlind
 *   ctx.dealerSeatIndex
 *
 *   --- Position & opponents count -----------------------------------------
 *   ctx.position               'btn' | 'sb' | 'bb' | 'utg' | 'middle' | 'late'
 *   ctx.isHeadsUp              true when only one opp remains
 *   ctx.numActiveOpponents     opponents not yet folded this hand
 *
 *   --- Pot, bets, sizing --------------------------------------------------
 *   ctx.potSize                chips in the pot
 *   ctx.currentBet             round bet to match
 *   ctx.toCall                 chips you must add to call (0 if free)
 *   ctx.potOdds                toCall / (pot + toCall), 0..1
 *   ctx.minRaiseTarget         smallest legal raise target
 *   ctx.maxRaiseTarget         your max raise target (= shove)
 *   ctx.spr                    stack-to-pot ratio. <1 ≈ committed,
 *                              <4 ≈ commit with strong hands, >10 ≈ deep
 *   ctx.aggressionCount        1=bet, 2=raise, 3=re-raise, 4+=war
 *   ctx.facingBet, ctx.facingRaise, ctx.facingAllIn   booleans
 *   ctx.lastOpponentAction     fold/check/call/raise/all_in/sb/bb
 *   ctx.bigBlind, ctx.smallBlind, ctx.blindLevelLabel   live table level
 *
 *   --- BB-relative (scale with blind level) ------------------------------
 *   ctx.myStackBB, ctx.effectiveStackBB, ctx.potSizeBB,
 *   ctx.currentBetBB, ctx.toCallBB
 *
 *   --- Round dynamics ---------------------------------------------------
 *   ctx.lastAggressor          { id, name, action, amount, phase, seq, isMe }
 *                              or null. Most recent voluntary raise/all_in.
 *   ctx.playersToAct           opponents still to act this round
 *   ctx.playersActedThisRound  opponents who already acted this round
 *   ctx.preflopActionProfile   'unopened' | 'opened' | 'three_bet' | 'four_bet_plus'
 *   ctx.committed              true when ≥50% of your starting-this-hand
 *                              stack is already in the pot
 *
 *   --- Stack landscape --------------------------------------------------
 *   ctx.chipLeader             { id, name, chips, isMe }
 *   ctx.shortStack             { id, name, chips, isMe }
 *   ctx.myChipRank             1 = chip leader at the table
 *   ctx.totalChipsInPlay
 *   ctx.opponents[i].effectiveStackBB     per-opp effective stack in BBs
 *   ctx.opponents[i].committed
 *
 *   --- Draws (postflop) -------------------------------------------------
 *   ctx.draws.hasFlushDraw     4 cards of one suit
 *   ctx.draws.hasOpenEnded     4 connected cards
 *   ctx.draws.hasGutshot       inside straight draw
 *   ctx.draws.outs             rough estimate (flush=9, oe=8, gs=4)
 *   ctx.handsSinceLastWin      0 = won the most recent hand at this table
 *
 *   --- Cards in your hand & on the board ---------------------------------
 *   ctx.holeCards              [{rank, suit}, {rank, suit}]
 *                              ranks: '2'..'10','J','Q','K','A'
 *                              suits: 'hearts'|'diamonds'|'clubs'|'spades'
 *   ctx.communityCards         0..5 cards depending on phase
 *
 *   --- Hand strength tier (precomputed) -----------------------------------
 *   ctx.handStrength           'trash'|'weak'|'medium'|'strong'|'premium'
 *   ctx.handStrengthIndex      0..4 numeric form
 *   ctx.bestHand               postflop: { rank, name, bestCards }
 *                              rank: 0=high,1=pair,2=2pair,3=trips,4=straight,
 *                                    5=flush,6=full,7=quads,8=str.flush,9=royal
 *
 *   --- This bot (you) -----------------------------------------------------
 *   ctx.me.id                  seat id
 *   ctx.me.name                bot name
 *   ctx.me.seat                index in player order
 *   ctx.me.chips               your remaining stack
 *   ctx.me.bet                 chips you put in this round
 *   ctx.me.totalBetThisHand    chips committed across all rounds this hand
 *   ctx.me.position
 *   ctx.me.stats.handsObserved
 *   ctx.me.stats.vpip          0..1 voluntary-put-money-in
 *   ctx.me.stats.aggressionFreq
 *   ctx.me.stats.profit        net chips at this table
 *   ctx.me.stats.showdownsSeen
 *   ctx.me.stats.showdownsWon
 *   ctx.myStack                shortcut for ctx.me.chips
 *   ctx.effectiveStack         min(my stack, smallest active opp stack)
 *
 *   --- Each opponent (array) ----------------------------------------------
 *   ctx.opponents[i].id
 *   ctx.opponents[i].seat
 *   ctx.opponents[i].name
 *   ctx.opponents[i].isBot
 *   ctx.opponents[i].chips
 *   ctx.opponents[i].bet                this round
 *   ctx.opponents[i].totalBet           this hand
 *   ctx.opponents[i].folded
 *   ctx.opponents[i].allIn
 *   ctx.opponents[i].position
 *   ctx.opponents[i].lastAction         { action, amount } or null
 *   ctx.opponents[i].stats.handsObserved
 *   ctx.opponents[i].stats.vpip
 *   ctx.opponents[i].stats.aggressionFreq
 *   ctx.opponents[i].stats.foldsToBet
 *   ctx.opponents[i].stats.profit
 *   ctx.opponents[i].stats.showdownsSeen
 *   ctx.opponents[i].stats.showdownsWon
 *   ctx.opponents[i].stats.wtsdRate          went-to-showdown rate
 *   ctx.opponents[i].stats.wonAtShowdownRate
 *   ctx.opponents[i].stats.recentBetSizes    last up-to-10 raise totals
 *   ctx.opponents[i].stats.avgRecentBetSize
 *
 *   --- Action history (this hand) -----------------------------------------
 *   ctx.actionHistory
 *     [{ seq, phase, playerId, playerName, action, amount,
 *        toCallBefore, potBefore }, ...]
 *
 *   --- Hand history (last 25 completed hands at this table) ---------------
 *   ctx.handHistory[i].handIndex
 *   ctx.handHistory[i].type             'showdown' | 'fold_out'
 *   ctx.handHistory[i].pot
 *   ctx.handHistory[i].communityCards
 *   ctx.handHistory[i].winners          [{ playerId, username, chips, handName }]
 *   ctx.handHistory[i].profit           your profit on this hand
 *   ctx.handHistory[i].profitByPlayer   { playerId: profit, ... }
 *   ctx.handHistory[i].cards            { playerId: [card, card] | null }
 *                                       SHOWDOWN REVEALS — null = mucked
 *   ctx.handHistory[i].actions          full per-hand action log
 *   ctx.handHistory[i].actionsByPlayer  { playerId: [actions...] }
 *   ctx.lastShowdown                    most recent showdown handHistory entry
 *
 *   --- Helpers in scope (no ctx. prefix) ----------------------------------
 *   handStrength(holeCards, community)  → tier name (use to evaluate ranges)
 *   evaluateCards(cards)                → { rank, name, bestCards } (5–7 cards)
 *   randomFloat(min, max)               → uniform random
 *   console.log(...)                    → debug ring (last 20 lines)
 *
 * ============================================================================
 *   SAMPLE STRATEGY — change everything below.
 * ============================================================================
 */

function decide(ctx) {

  // -------------------------------------------------------------
  // 1. PREFLOP: open premium, defend strong from late position,
  //    call any reasonable hand getting good odds, fold trash.
  // -------------------------------------------------------------
  if (ctx.streetIsPreflop) {
    if (ctx.handStrength === 'premium') {
      // 3x BB open, larger if there's already aggression.
      const target = ctx.currentBet + 3 * ctx.bigBlind
      return { action: 'raise', amount: target, say: 'lets build it' }
    }
    if (ctx.handStrength === 'strong' && ctx.position !== 'utg') {
      const target = ctx.currentBet + Math.floor(2.5 * ctx.bigBlind)
      return { action: 'raise', amount: target }
    }
    if (ctx.facingBet && ctx.handStrength === 'trash') {
      return { action: 'fold' }
    }
    if (ctx.facingBet && ctx.potOdds >= 0.25) {
      return { action: 'call' }
    }
    if (ctx.facingBet) return { action: 'fold' }
    return { action: 'check' }
  }

  // -------------------------------------------------------------
  // 2. POSTFLOP: value-bet sets+, call with showdown value, fold weak.
  // -------------------------------------------------------------
  const madeSetOrBetter = ctx.bestHand && ctx.bestHand.rank >= 3
  if (madeSetOrBetter) {
    const target = ctx.currentBet + Math.floor(ctx.potSize * 0.66)
    return { action: 'raise', amount: target, say: 'value' }
  }

  // -------------------------------------------------------------
  // 3. EXPLOIT TENDENCIES: big bet at known sticky callers,
  //    fold to perceived strength.
  // -------------------------------------------------------------
  const aggressor = ctx.opponents.find(o =>
    o.lastAction && (o.lastAction.action === 'raise' || o.lastAction.action === 'all_in')
  )
  if (aggressor && aggressor.stats.handsObserved >= 8 && aggressor.stats.aggressionFreq < 0.1) {
    // Tight player just raised — respect it unless we have a real hand.
    if (ctx.handStrength === 'medium' || ctx.handStrength === 'weak') {
      return { action: 'fold' }
    }
  }

  if (ctx.facingBet) {
    if (ctx.potOdds >= 0.33 && ctx.handStrength !== 'trash') return { action: 'call' }
    return { action: 'fold' }
  }
  return { action: 'check' }
}
`

export { STARTER_CODE }

function DocsItem({ item, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(`ctx.${item.path}`)}
      className="block w-full rounded-md border border-zinc-700/70 bg-zinc-950/60 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/80"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="truncate text-[11px] font-bold text-emerald-300">ctx.{item.path}</code>
        <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-zinc-300">{item.type}</span>
      </div>
      {item.doc && (
        <div className="mt-0.5 text-[10px] font-bold leading-snug text-zinc-200">{item.doc}</div>
      )}
    </button>
  )
}

export default function JsCodeEditor({ code, onCodeChange }) {
  const taRef = useRef(null)
  const [filter, setFilter] = useState('')
  const [docsOpen, setDocsOpen] = useState(true)
  const [copied, setCopied] = useState(null)

  const lint = useMemo(() => lintJs(code), [code])

  function insertAtCursor(snippet) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? code.length
    const end = ta.selectionEnd ?? code.length
    const next = code.slice(0, start) + snippet + code.slice(end)
    onCodeChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + snippet.length
    })
  }

  function resetToTemplate() {
    if (!confirm('Replace your code with the starter template? Your current code will be lost.')) return
    onCodeChange(STARTER_CODE)
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      // Fallback for non-secure contexts: select+copy via a transient textarea.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      ta.remove()
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    }
  }

  function buildCtxMarkdown() {
    const lines = ['# Bot ctx reference (paste this into your LLM)', '']
    for (const g of CTX_GROUPS) {
      lines.push(`## ${g.title}`)
      if (g.description) lines.push(g.description)
      for (const it of g.items) {
        const parts = [`- \`ctx.${it.path}\``, `(${it.type})`]
        if (it.doc) parts.push(`— ${it.doc}`)
        lines.push(parts.join(' '))
      }
      lines.push('')
    }
    lines.push('## Return contract', '- `{ action: "fold" }`', '- `{ action: "check" }`', '- `{ action: "call" }`', '- `{ action: "raise", amount: <total target bet, in chips> }`', '- `{ action: "all_in" }`', '- Any return may also include `say: "<phrase>"` (max 80 chars).')
    return lines.join('\n')
  }

  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return CTX_GROUPS
    const needle = filter.toLowerCase()
    return CTX_GROUPS
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          i.path.toLowerCase().includes(needle) ||
          (i.doc || '').toLowerCase().includes(needle)
        )
      }))
      .filter(g => g.items.length > 0)
  }, [filter])

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            bot.js — your decide(ctx) is the bot
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyText(code, 'code')}
              className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              title="Copy the entire bot.js source"
            >
              {copied === 'code' ? '✓ Copied' : 'Copy code'}
            </button>
            <button
              type="button"
              onClick={resetToTemplate}
              className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              title="Replace the editor contents with the starter template"
            >
              Reset to template
            </button>
            <span className={`text-[10px] font-black uppercase tracking-widest ${lint.ok ? 'text-emerald-300' : 'text-red-200'}`}>
              {lint.ok ? '✓ Parse OK' : '✗ Parse error'}
            </span>
          </div>
        </div>

        <div className="rounded-t-lg border border-b-0 border-zinc-700/70 bg-zinc-900/95 px-3 py-2 font-mono text-[11px]">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-zinc-300">
            in scope when decide(ctx) runs
          </div>
          <div className="text-zinc-300 truncate">
            <span className="text-zinc-400">import </span>
            <span className="text-emerald-300">{'{ ctx }'}</span>
            <span className="text-zinc-400"> from </span>
            <span className="text-amber-300">{`'./game-state'`}</span>
            <span className="text-zinc-400"> // every signal listed in the right rail →</span>
          </div>
          <div className="text-zinc-300 truncate">
            <span className="text-zinc-400">import </span>
            <span className="text-emerald-300">{'{ handStrength, evaluateCards, randomFloat, console }'}</span>
            <span className="text-zinc-400"> from </span>
            <span className="text-amber-300">{`'./helpers'`}</span>
          </div>
        </div>

        <textarea
          ref={taRef}
          value={code}
          onChange={e => onCodeChange(e.target.value)}
          spellCheck={false}
          rows={32}
          className={`w-full resize-y rounded-b-lg border bg-zinc-950/90 p-3 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-300 ${lint.ok ? 'border-zinc-700/70' : 'border-red-500/60'}`}
        />

        {!lint.ok && (
          <div className="rounded-md border border-red-500/40 bg-red-500/15 px-2 py-1.5 text-xs font-bold text-red-100">
            {lint.error}
          </div>
        )}

        <div className="text-[11px] font-bold leading-snug text-zinc-300">
          Server runs <code className="text-emerald-300">decide(ctx)</code> on every turn with a 150 ms CPU budget,
          32 KB max source, no I/O. Return one of:
          {' '}<code className="text-zinc-100">{'{ action: "fold|check|call" }'}</code>,
          {' '}<code className="text-zinc-100">{'{ action: "raise", amount: <chips> }'}</code>,
          {' '}<code className="text-zinc-100">{'{ action: "all_in" }'}</code>.
          Add <code className="text-zinc-100">say: "..."</code> to yell at the table. Errors → bot folds.
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDocsOpen(o => !o)}
            className="flex flex-1 items-center justify-between rounded-md border border-zinc-500/60 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700"
          >
            <span>Context reference</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {docsOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => copyText(buildCtxMarkdown(), 'ref')}
            className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
            title="Copy every signal + helper as markdown — paste into an LLM"
          >
            {copied === 'ref' ? '✓' : 'Copy'}
          </button>
        </div>
        {docsOpen && (
          <>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter signals (e.g. opponent, pot)…"
              className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1.5 text-xs font-bold text-white outline-none placeholder:text-zinc-400 focus:border-zinc-300"
            />
            <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
              {filteredGroups.map(g => (
                <div key={g.title}>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] font-black uppercase tracking-widest text-emerald-200">{g.title}</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{g.items.length}</div>
                  </div>
                  {g.description && (
                    <div className="mb-1.5 text-[11px] font-bold text-zinc-300">{g.description}</div>
                  )}
                  <div className="space-y-1">
                    {g.items.map(it => (
                      <DocsItem key={it.path} item={it} onInsert={insertAtCursor} />
                    ))}
                  </div>
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <div className="text-xs font-bold text-zinc-300">No fields match.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

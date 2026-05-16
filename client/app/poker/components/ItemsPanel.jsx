'use client'

import { useState } from 'react'
import DeckPickerModal from './DeckPickerModal'

// Item catalog — display metadata only. The server is the source of
// truth for cooldown state, effect, and target validation. This file
// just renders the panel UI matching the server's `items:state` push.
const ITEM_DEFS = [
  {
    id: 'peek',
    name: 'Peek Hand',
    icon: '👁',
    color: 'sky',
    needsTarget: true,
    description: 'Secretly look at one opponent\'s hole cards. Only you see them.',
  },
  {
    id: 'swap',
    name: 'Swap Cards',
    icon: '🔄',
    color: 'fuchsia',
    needsTarget: false,
    description: 'Replace your hole cards with two fresh cards from the deck. Could be better. Could be worse.',
  },
  {
    id: 'scam',
    name: 'Scam Popup',
    icon: '🪤',
    color: 'amber',
    needsTarget: true,
    description: 'Send a target a popup with shifting Accept / Block buttons. If they misclick, ~10% of their stack moves to you.',
  },
  {
    id: 'hack',
    name: 'Hack',
    icon: '💻',
    color: 'red',
    needsTarget: true,
    description: 'Drain a random 5-15% of a target\'s chip stack directly into yours. No popup, no opt-out.',
  },
]

const COLORS = {
  sky: {
    accent: 'text-sky-200',
    button: 'border-sky-400/60 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25',
    dot: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]',
  },
  fuchsia: {
    accent: 'text-fuchsia-200',
    button: 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25',
    dot: 'bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.7)]',
  },
  amber: {
    accent: 'text-amber-200',
    button: 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25',
    dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]',
  },
  red: {
    accent: 'text-red-200',
    button: 'border-red-400/60 bg-red-500/15 text-red-100 hover:bg-red-500/25',
    dot: 'bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.7)]',
  },
}

export default function ItemsPanel({ itemsState, players, myPlayerId, onUseItem }) {
  // Which item, if any, is currently waiting for the user to pick a
  // target. Click "Use →" on a targeted item to open the target picker;
  // click a player to invoke (or "Cancel" to abort).
  const [pickerFor, setPickerFor] = useState(null)
  // Swap is special — it opens a full 52-card deck picker instead
  // of the standard player-target list.
  const [deckPickerOpen, setDeckPickerOpen] = useState(false)
  const items = itemsState?.items || []
  // Targets: non-self, non-folded, non-spectator seats. For PEEK we also
  // include bots — you can spy on a bot's hole cards. For scam/hack we
  // hide bots (server still rejects them, but a tidy picker beats a
  // dead button).
  function targetsFor(itemId) {
    return (players || []).filter(p =>
      p && p.id !== myPlayerId && p.isConnected !== false &&
      (itemId === 'peek' ? true : !p.isBot)
    )
  }

  function handleUse(item) {
    if (item.id === 'swap') {
      setDeckPickerOpen(true)
      return
    }
    if (!item.needsTarget) {
      onUseItem(item.id, null)
      return
    }
    setPickerFor(item.id)
  }

  function handlePickTarget(itemId, targetId) {
    onUseItem(itemId, targetId)
    setPickerFor(null)
  }

  return (
    <>
    <div className="space-y-2">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Loadout</div>
        <div className="mt-1 text-[11px] font-bold text-zinc-300 leading-snug">
          Four griefing tools, each on its own cooldown. The bar under each
          item fills every hand — full bar = ready. Peek works on bots too.
        </div>
      </div>

      {ITEM_DEFS.map(def => {
        const state = items.find(i => i.id === def.id) || { ready: true, cooldownHandsRemaining: 0, refreshHands: 1 }
        const c = COLORS[def.color] || COLORS.sky
        const showPicker = pickerFor === def.id
        const refreshHands = state.refreshHands || 1
        // Progress: 0 → just used (empty bar). 1 → fully recharged.
        const progress = state.ready
          ? 1
          : Math.max(0, Math.min(1, (refreshHands - state.cooldownHandsRemaining) / refreshHands))
        const targets = targetsFor(def.id)
        return (
          <div key={def.id} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-900 text-lg`}>
                {def.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-black ${c.accent}`}>{def.name}</span>
                  {state.ready ? (
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                      Ready
                    </span>
                  ) : (
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                      Recharging
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] font-medium text-zinc-300 leading-snug">{def.description}</div>
                {/* Cooldown progress bar — fills hand-by-hand. Replaces
                    the old "Nh cooldown" text label so the recharge state
                    reads at a glance. */}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${state.ready ? c.dot.replace('shadow-', 'shadow-').split(' ')[0] : c.dot.split(' ')[0]}`}
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                {showPicker ? (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Pick a target</div>
                    {targets.length === 0 ? (
                      <div className="rounded-md border border-zinc-700/70 bg-zinc-900 px-2 py-2 text-[11px] font-bold text-zinc-500 text-center">
                        No valid targets at the table.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {targets.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handlePickTarget(def.id, t.id)}
                            className={`rounded-md border px-2 py-1.5 text-[11px] font-black text-left truncate ${c.button}`}
                          >
                            {t.username || t.id.slice(0, 6)}{t.isBot ? ' 🤖' : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setPickerFor(null)}
                      className="block w-full rounded-md border border-zinc-700/60 bg-zinc-900 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleUse(def)}
                    disabled={!state.ready}
                    className={`mt-2 w-full rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40 ${c.button}`}
                  >
                    {state.ready ? (def.needsTarget ? 'Use → pick target' : 'Use') : 'Recharging…'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
    <DeckPickerModal
      open={deckPickerOpen}
      onClose={() => setDeckPickerOpen(false)}
      onConfirm={(picks) => { onUseItem('swap', null, picks); setDeckPickerOpen(false) }}
    />
    </>
  )
}

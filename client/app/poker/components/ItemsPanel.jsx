'use client'

import { useState } from 'react'
import DeckPickerModal from './DeckPickerModal'
import CardPickerModal from './CardPickerModal'
import RigHandModal from './RigHandModal'

// localStorage key + helpers for "remember the last rig_hand script".
// Scoped by player id so multiple accounts on one machine don't share
// their scripts. Hole-card entries are keyed by player id; entries
// for players no longer seated drop quietly at hydration time.
const RIG_HAND_LAST_KEY = (playerId) => `gwu:poker:rig_hand:last:${playerId}`
function loadLastRigHand(playerId) {
  if (typeof window === 'undefined' || !playerId) return null
  try {
    const raw = window.localStorage.getItem(RIG_HAND_LAST_KEY(playerId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}
function saveLastRigHand(playerId, payload) {
  if (typeof window === 'undefined' || !playerId || !payload) return
  try {
    window.localStorage.setItem(RIG_HAND_LAST_KEY(playerId), JSON.stringify(payload))
  } catch {}
}

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
    id: 'hack',
    name: 'Hack',
    icon: '💻',
    color: 'red',
    needsTarget: true,
    description: 'Drain a random 5-15% of a target\'s chip stack directly into yours. No popup, no opt-out.',
  },
  {
    id: 'scam',
    name: 'Scam Popup',
    icon: '🎣',
    color: 'amber',
    needsTarget: true,
    description: 'Hit a target with a "click yes to send chips" popup. They can decline if they\'re paying attention — but if they fumble the shuffle, 10% of their stack goes to you. Humans only.',
  },
  // ─── Deck-rig powers ────────────────────────────────────────────
  {
    id: 'river_card',
    name: 'Rig River',
    icon: '🃁',
    color: 'rose',
    needsTarget: false,
    description: 'Force the river card to be the card you pick. Fires when the turn-to-river deal happens.',
  },
  {
    id: 'next_card',
    name: 'Rig Next Card',
    icon: '⚡',
    color: 'cyan',
    needsTarget: false,
    description: 'Force the next community card to be whatever you pick. Lands on the very next street.',
  },
  {
    id: 'rig_hand',
    name: 'Rig the Hand',
    icon: '🃏',
    color: 'rose',
    needsTarget: false,
    description: 'Script the entire next hand — your hole cards, your opponents\', and any of the 5 board cards. The ultimate trap. Anything you leave empty draws randomly; late joiners get random cards and don\'t break the plan.',
  },
  // ─── Market-griefing specials ───────────────────────────────────
  {
    id: 'crash_coin',
    name: 'Crash a Coin',
    icon: '📉',
    color: 'fuchsia',
    needsTarget: false,
    // Editor flag — the inline editor in the items panel exposes a
    // coin picker (one of the live market coins). The handler calls
    // onUseItem('crash_coin', null, { coinId }).
    needsCoinPick: true,
    description: 'Pick any coin in the market and tank its price 95% on the next tick. No ownership required — works on base coins, scams, or another player\'s minted shitcoin. Recharges every 2 hands.',
  },
  {
    id: 'crash_holdings',
    name: 'Crash Their Bags',
    icon: '💥',
    color: 'rose',
    needsTarget: true,
    description: 'Pick a target — 95% of their open crypto AND stock positions evaporate. Chart prices don\'t move, only they lose. No effect if they hold nothing. Recharges every 5 hands.',
  },
  {
    id: 'pin_hack',
    name: 'PIN Hack',
    icon: '🪪',
    color: 'red',
    needsTarget: true,
    description: 'Flash a 4-digit PIN at the target for 2 seconds, then a fake "account compromised" panel demands they retype it within 10 seconds. Miss it (wrong number OR run out the clock) and 10-50% of their bank balance lands in yours. Humans only. Recharges every 4 hands.',
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
  rose: {
    accent: 'text-rose-200',
    button: 'border-rose-400/60 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25',
    dot: 'bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.7)]',
  },
  cyan: {
    accent: 'text-cyan-200',
    button: 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25',
    dot: 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]',
  },
}

export default function ItemsPanel({
  itemsState,
  players,
  myPlayerId,
  cryptoCoins = [],
  nextHandRigged = false,
  onUseItem,
  // Active editor lives in the parent so the tools-panel chrome's
  // own "← Back" button can do a one-step pop (editor → items list)
  // before closing the whole panel to the tools menu. Both fields
  // are required when item-use editors should work end-to-end.
  activeEditor: activeEditorProp = null,
  setActiveEditor: setActiveEditorProp = null,
}) {
  // Which item, if any, is currently waiting for the user to pick a
  // target. Click "Use →" on a targeted item to open the target picker;
  // click a player to invoke (or "Cancel" to abort).
  const [pickerFor, setPickerFor] = useState(null)
  // Card-picking editors render inline inside the items panel.
  // When the parent wires both `activeEditor` + `setActiveEditor`
  // props we defer to them (so the panel chrome's Back button can
  // pop just the editor before closing the whole panel). When the
  // parent didn't wire them, we keep local state so the component
  // still works in isolation. Presence of the setter is the gate.
  const [activeEditorLocal, setActiveEditorLocal] = useState(null)
  const useParentEditorState = typeof setActiveEditorProp === 'function'
  const activeEditor = useParentEditorState ? activeEditorProp : activeEditorLocal
  const setActiveEditor = useParentEditorState ? setActiveEditorProp : setActiveEditorLocal
  const items = itemsState?.items || []
  // Targets: non-self, non-folded, non-spectator seats. Bots are
  // valid targets for everything EXCEPT scam (which requires the
  // popup-shuffle UI a bot can't engage with). Peek + hack work on
  // bots; the deck-rig powers don't go through this picker.
  function targetsFor(itemId) {
    // scam / crash_holdings / pin_hack all reject bot targets
    // server-side (popups need a human; bots own no real-money
    // positions; bots can't be social-engineered). Hide bots from the
    // picker for those so the user doesn't pick a dead-end target.
    const humanOnly = itemId === 'scam' || itemId === 'crash_holdings' || itemId === 'pin_hack'
    return (players || []).filter(p =>
      p && p.id !== myPlayerId && p.isConnected !== false &&
      (humanOnly ? !p.isBot : true)
    )
  }

  function handleUse(item) {
    if (item.id === 'swap'
        || item.id === 'river_card'
        || item.id === 'next_card'
        || item.id === 'rig_hand'
        || item.id === 'crash_coin') {
      // Swap + the deck-rig powers + crash_coin all swap the panel
      // view to their inline editor. No popup; the editor IS the
      // panel body until the user confirms or hits Back.
      setActiveEditor(item.id)
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

  // When an editor is active, swap the panel body to render that
  // editor inline. The Back button at the top returns to the items
  // grid. The editor is the SAME width as the items grid — no
  // popup, no overlay, no nested z-index hell.
  if (activeEditor) {
    const back = () => setActiveEditor(null)
    let body = null
    if (activeEditor === 'swap') {
      body = (
        <DeckPickerModal
          onCancel={back}
          onConfirm={(picks) => { onUseItem('swap', null, picks); back() }}
        />
      )
    } else if (activeEditor === 'river_card') {
      body = (
        <CardPickerModal
          count={1}
          title="Force the river card"
          // Lore: the card comes "from your pocket" — duplicates of
          // cards already in play are intentionally allowed so you
          // can stack onto a board for 5-of-a-kind or higher.
          subtitle="Any card — even one already on the board. Pulled from your pocket, no deck check. Fires when the turn → river deal lands."
          confirmLabel="Lock river"
          accent="rose"
          onCancel={back}
          onConfirm={(picks) => { onUseItem('river_card', null, { card: picks[0] }); back() }}
        />
      )
    } else if (activeEditor === 'next_card') {
      body = (
        <CardPickerModal
          count={1}
          title="Force the next community card"
          subtitle="Any card, dupes welcome — pulled from your pocket, not the deck. Lands on whatever street comes next."
          confirmLabel="Lock next card"
          accent="cyan"
          onCancel={back}
          onConfirm={(picks) => { onUseItem('next_card', null, { card: picks[0] }); back() }}
        />
      )
    } else if (activeEditor === 'rig_hand') {
      // Hydrate from the last script the user committed (per-player
      // localStorage). The modal filters stale player-id entries on
      // mount so reopening at a different table doesn't show ghost
      // hole-card slots. The board portion is always reusable.
      const initialPayload = loadLastRigHand(myPlayerId)
      body = (
        <RigHandModal
          myPlayerId={myPlayerId}
          players={players || []}
          alreadyRigged={nextHandRigged}
          initialPayload={initialPayload}
          // Auto-save the in-progress draft on every pick. Reuses the
          // same localStorage key as the post-commit save below, so
          // closing the panel halfway through preserves the last
          // visible card layout — reopening shows the same slots, no
          // re-clicking required. (Saving on every change is cheap;
          // each write is a few hundred bytes of JSON at most.)
          onPicksChange={(draft) => saveLastRigHand(myPlayerId, draft)}
          onCancel={back}
          onConfirm={(payload) => {
            // Save BEFORE dispatching the WS message so even if the
            // server rejects (e.g. already_rigged race), the script
            // is still remembered for the next attempt.
            saveLastRigHand(myPlayerId, payload)
            onUseItem('rig_hand', null, { payload })
            back()
          }}
        />
      )
    } else if (activeEditor === 'crash_coin') {
      // Live coin picker. Only non-rugged coins are listed — a rugged
      // coin is already at floor price. Click a row to fire the crash.
      const liveCoins = (cryptoCoins || []).filter(c => c && !c.rugged)
      body = (
        <div className="space-y-2">
          <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 p-3 text-[11px] font-bold text-fuchsia-200">
            Pick a coin to crash. Tanks its price ~95% on the next tick.
            Holders can still sell into the floor — they just take the hit.
          </div>
          {liveCoins.length === 0 ? (
            <div className="rounded-md border border-zinc-700/70 bg-zinc-950/40 p-3 text-[11px] font-bold text-zinc-500">
              No live coins to crash right now.
            </div>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {liveCoins.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onUseItem('crash_coin', null, { coinId: c.id }); back() }}
                  className="flex w-full items-center justify-between rounded-md border border-zinc-700/70 bg-zinc-950/50 px-3 py-2 text-left hover:border-fuchsia-400/60 hover:bg-fuchsia-500/10"
                >
                  <span>
                    <span className="text-xs font-black text-white">${c.symbol}</span>
                    <span className="ml-2 text-[10px] font-bold text-zinc-500">{c.name || ''}</span>
                  </span>
                  <span className="text-[11px] font-black tabular-nums text-zinc-300">
                    ${typeof c.price === 'number' ? c.price.toFixed(c.price < 1 ? 4 : 2) : '—'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-800"
        >
          ← Back to powers
        </button>
        {body}
      </div>
    )
  }

  return (
    <>
    <div className="space-y-2">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Loadout</div>
        <div className="mt-1 text-[11px] font-bold text-zinc-300 leading-snug">
          Seven tools, each on its own cooldown. The bar under each item fills
          every hand — full bar = ready. Peek + hack work on bots too.
        </div>
      </div>

      {/* Two-column grid. `items-stretch` (implicit on grid) + each
          item card using `flex flex-col h-full` means all cards in
          the same row match height. The flex-1 spacer above the
          action button keeps the button anchored to the bottom of
          every card so they line up across rows regardless of how
          long each description happens to be. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-stretch">
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
          <div key={def.id} className="flex h-full flex-col rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3.5">
            {/* Header row — icon + name + ready badge. Same vertical
                position on every card thanks to the parent flex-col. */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-900 text-lg">
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
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 tabular-nums">
                      {state.cooldownHandsRemaining} {state.cooldownHandsRemaining === 1 ? 'hand' : 'hands'} left
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Description — its own row, with explicit top margin so
                it doesn't kiss the header. flex-1 below pushes the
                action button down regardless of how long this is. */}
            <div className="mt-2 text-[11px] font-medium text-zinc-300 leading-snug">{def.description}</div>
            {/* Cooldown progress bar + a textual recharge cycle label
                so the player can see at a glance how long this item
                takes to come back, not just a faceless progress bar. */}
            <div className="mt-2 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500 tabular-nums">
              <span>Recharges every {refreshHands} {refreshHands === 1 ? 'hand' : 'hands'}</span>
              {!state.ready && (
                <span className="text-zinc-400">{state.cooldownHandsRemaining}/{refreshHands}</span>
              )}
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all duration-300 ${state.ready ? c.dot.replace('shadow-', 'shadow-').split(' ')[0] : c.dot.split(' ')[0]}`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {/* Spacer so every action button anchors to the SAME y
                position across cards in the same grid row. */}
            <div className="flex-1" />
            {/* Action / target picker block. */}
            {showPicker ? (
              <div className="mt-3 space-y-1.5">
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
                  className="block w-full rounded-md border border-zinc-700/60 bg-zinc-900 px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleUse(def)}
                disabled={!state.ready}
                className={`mt-3 w-full rounded-md border px-3 py-2 text-[11px] font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40 ${c.button}`}
              >
                {state.ready ? (def.needsTarget ? 'Use → pick target' : 'Use') : 'Recharging…'}
              </button>
            )}
          </div>
        )
      })}
      </div>
    </div>
    </>
  )
}

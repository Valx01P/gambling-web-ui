'use client'

import { useEffect, useMemo, useState } from 'react'
import CardSprite from '../../components/CardSprite'

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']

// Rig-the-hand editor — renders INLINE inside the items panel, no
// fullscreen modal overlay. Mirrors the layout + DnD pattern of the
// other power editors so the three card-pickers read like one
// design system.
//
// Layout (top → bottom inside the panel):
//   1. Header — title + helper line + reserved counter.
//   2. Players section — one row per seated player with two hole-
//      card slots. The viewer's seat sits first so you can rig
//      your own pair without scanning the list.
//   3. Board row — five slots labeled Flop / Turn / River.
//   4. Deck — every card, fixed 72px-wide cells, horizontal scroll
//      so the panel doesn't need to widen to show all 52.
//   5. Actions — Cancel / Clear all / Rig the hand.
//
// Interaction matches CardPickerModal + DeckPickerModal:
//   • Click a slot → it becomes "active" (amber ring).
//   • Click a deck card → drops it into the active slot, advances
//     to the next empty slot.
//   • Click a deck card with no slot active → first empty slot.
//   • Click a filled slot → clears it + becomes active.
//   • Drag a deck card onto a slot → places it there directly.
//
// Class file is still named *Modal to avoid renaming imports; the
// behavior is inline only.

const SLOT_KIND = { HOLE: 'hole', BOARD: 'board' }
const BOARD_LABELS = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River']

function slotId(kind, a, b) {
  return kind === SLOT_KIND.BOARD ? `board:${a}` : `hole:${a}:${b}`
}
function cardKey(c) { return c ? `${c.rank}-${c.suit}` : null }

export default function RigHandModal({
  myPlayerId,
  players = [],
  alreadyRigged = false,
  // Optional pre-fill of the picks state on mount. Shape matches the
  // onConfirm payload: { holeCards: { [playerId]: [c, c] }, board: [c|null] }.
  // The parent reads this from localStorage so the user's last rig
  // auto-fills the next time they open the editor. Hole-card entries
  // for players not currently seated are dropped at mount.
  initialPayload = null,
  onConfirm,
  onCancel,
}) {
  const orderedPlayers = useMemo(() => {
    const me = players.find(p => p && p.id === myPlayerId)
    const others = players.filter(p => p && p.id !== myPlayerId)
    return me ? [me, ...others] : players
  }, [players, myPlayerId])

  const allSlots = useMemo(() => {
    const out = []
    for (const p of orderedPlayers) {
      if (!p) continue
      out.push(slotId(SLOT_KIND.HOLE, p.id, 0))
      out.push(slotId(SLOT_KIND.HOLE, p.id, 1))
    }
    for (let i = 0; i < 5; i++) out.push(slotId(SLOT_KIND.BOARD, i))
    return out
  }, [orderedPlayers])

  // Lazy initializer hydrates from the saved last-rig script. Anything
  // referencing a player who isn't currently seated drops quietly —
  // those slots would render against ghost ids and confuse the user.
  // The existing useEffect below also prunes stale ids when the
  // seated-player set later changes mid-edit.
  const [picks, setPicks] = useState(() => {
    if (!initialPayload || typeof initialPayload !== 'object') return {}
    const validIds = new Set((players || []).filter(Boolean).map(p => p.id))
    const out = {}
    const hc = initialPayload.holeCards
    if (hc && typeof hc === 'object') {
      for (const [pid, pair] of Object.entries(hc)) {
        if (!validIds.has(pid)) continue
        if (!Array.isArray(pair) || pair.length !== 2) continue
        const a = pair[0], b = pair[1]
        if (a && a.rank && a.suit) {
          out[slotId(SLOT_KIND.HOLE, pid, 0)] = { rank: a.rank, suit: a.suit }
        }
        if (b && b.rank && b.suit) {
          out[slotId(SLOT_KIND.HOLE, pid, 1)] = { rank: b.rank, suit: b.suit }
        }
      }
    }
    if (Array.isArray(initialPayload.board)) {
      for (let i = 0; i < Math.min(5, initialPayload.board.length); i++) {
        const c = initialPayload.board[i]
        if (c && c.rank && c.suit) {
          out[slotId(SLOT_KIND.BOARD, i)] = { rank: c.rank, suit: c.suit }
        }
      }
    }
    return out
  })
  // Selected card from the deck. Clicking a deck card stores it
  // here (highlighted with an amber ring); clicking a slot drops
  // the selected card in. Click the selected card again to
  // deselect. Drag-and-drop is still supported as an alternative.
  const [selectedCard, setSelectedCard] = useState(null)

  // Reset whenever the seated-player list changes — a player leaving
  // could otherwise leave stale picks pointing at a phantom seat.
  useEffect(() => {
    setPicks(prev => {
      const validIds = new Set(orderedPlayers.map(p => p.id))
      const next = {}
      for (const [sid, c] of Object.entries(prev)) {
        if (sid.startsWith('board:')) { next[sid] = c; continue }
        const m = sid.match(/^hole:(.+):[01]$/)
        if (m && validIds.has(m[1])) next[sid] = c
      }
      return next
    })
  }, [orderedPlayers])

  const usedKeys = new Set(
    Object.values(picks).map(cardKey).filter(Boolean)
  )

  // Click a slot:
  //   • slot is empty + a card is selected → drop the selected card,
  //     deselect.
  //   • slot is filled → clear it (the user's "remove" gesture).
  //   • slot is empty + nothing selected → no-op.
  function handleSlotClick(sid) {
    if (picks[sid]) {
      setPicks(prev => {
        const next = { ...prev }
        delete next[sid]
        return next
      })
      return
    }
    if (!selectedCard) return
    const card = selectedCard
    setPicks(prev => {
      const next = { ...prev }
      // If the selected card was already placed elsewhere (rare —
      // the deck disables it when picks include it, but defensively
      // re-check), pull it from there so a card is never duplicated.
      const key = cardKey(card)
      const previousSlot = Object.entries(next).find(([, c]) => cardKey(c) === key)?.[0]
      if (previousSlot) delete next[previousSlot]
      next[sid] = card
      return next
    })
    setSelectedCard(null)
  }

  // Click a deck card. Toggles selection — clicking the same card
  // again clears it. Cards already placed in a slot can't be
  // re-selected (use the slot click to remove them first).
  function handleCardClick(card) {
    if (usedKeys.has(cardKey(card))) return
    setSelectedCard(prev => {
      if (prev && prev.rank === card.rank && prev.suit === card.suit) return null
      return card
    })
  }

  // Drag-and-drop is still supported as an alternative path —
  // independent of the selectedCard model.
  function dropCardOnSlot(card, sid) {
    if (!card || !card.rank || !card.suit) return
    const key = cardKey(card)
    const previousSlot = Object.entries(picks).find(([, c]) => cardKey(c) === key)?.[0]
    setPicks(prev => {
      const next = { ...prev }
      if (previousSlot) delete next[previousSlot]
      next[sid] = card
      return next
    })
    // After a drop, clear any pending click-selection so the next
    // click flow starts fresh.
    setSelectedCard(null)
  }

  function clearAll() {
    setPicks({})
    setSelectedCard(null)
  }

  function confirm() {
    const holeCards = {}
    for (const p of orderedPlayers) {
      const c0 = picks[slotId(SLOT_KIND.HOLE, p.id, 0)]
      const c1 = picks[slotId(SLOT_KIND.HOLE, p.id, 1)]
      if (c0 && c1) holeCards[p.id] = [c0, c1]
    }
    const board = []
    for (let i = 0; i < 5; i++) board.push(picks[slotId(SLOT_KIND.BOARD, i)] || null)
    if (Object.keys(holeCards).length === 0 && !board.some(Boolean)) return
    onConfirm?.({ holeCards, board })
  }

  const totalPicked = Object.keys(picks).length
  const totalSlots = allSlots.length

  return (
    <div className="rounded-xl border border-rose-400/40 bg-zinc-950/60 p-3">
      <div className="text-center">
        <div className="text-[10px] font-black uppercase tracking-widest text-rose-300">Rig the next hand</div>
        <div className="mt-1 text-sm font-black text-white leading-snug">
          Script the entire next game.
        </div>
        <div className="mt-1 text-[11px] font-bold text-zinc-400 leading-snug">
          Click a card to select it (amber ring), then click any drop zone to place it.
          Click a placed card to remove it. Drag works too. Anything you leave empty
          draws randomly; late joiners get random cards and don't break the plan.
        </div>
        <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
          {totalPicked}/{totalSlots} reserved
        </div>
      </div>

      {alreadyRigged && (
        <div className="mt-3 rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-[11px] font-black text-amber-100">
          ⚠ Another player already rigged the next hand. Your picks won't apply this
          round — wait for that rigged hand to play out, then try again.
        </div>
      )}

      {/* Hole cards — compact grid of player tiles. Each tile is a
          name on top + two card slots underneath. Responsive: 2
          tiles per row on phones, 3 on small tablets, all 5 in
          one row on desktop. Keeps the editor short enough that
          the deck below stays in view without scrolling. */}
      <div className="mt-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Hole cards</div>
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
          {orderedPlayers.map(p => {
            const isSelf = p.id === myPlayerId
            const s0 = slotId(SLOT_KIND.HOLE, p.id, 0)
            const s1 = slotId(SLOT_KIND.HOLE, p.id, 1)
            return (
              <div key={p.id} className="rounded-md border border-zinc-700/60 bg-zinc-900/40 px-1.5 py-1.5">
                <div className="truncate text-[11px] font-black text-white text-center leading-tight">
                  {isSelf ? 'YOU' : (p.username || 'Player')}
                  {p.isBot && <span className="ml-0.5 text-[8px] text-zinc-500">🤖</span>}
                </div>
                <div className="mt-1 flex items-center justify-center gap-1">
                  <CardSlot
                    card={picks[s0]}
                    onClick={() => handleSlotClick(s0)}
                    onDropCard={(c) => dropCardOnSlot(c, s0)}
                  />
                  <CardSlot
                    card={picks[s1]}
                    onClick={() => handleSlotClick(s1)}
                    onDropCard={(c) => dropCardOnSlot(c, s1)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Board — five slots with phase labels. */}
      <div className="mt-3 rounded-md border border-zinc-700/60 bg-zinc-900/40 px-2 py-1.5">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Board</div>
        <div className="mt-1 flex flex-wrap items-end justify-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => {
            const sid = slotId(SLOT_KIND.BOARD, i)
            return (
              <div key={sid} className="flex flex-col items-center gap-0.5">
                <CardSlot
                  card={picks[sid]}
                  onClick={() => handleSlotClick(sid)}
                  onDropCard={(c) => dropCardOnSlot(c, sid)}
                />
                <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                  {BOARD_LABELS[i]}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Deck — fixed 72px columns + horizontal scroll. */}
      <div className="mt-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
          Deck — click or drag a card onto a slot
        </div>
        <div className="mt-1 overflow-x-auto -mx-1 px-1">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(13, 72px)' }}
          >
            {SUITS.map(suit => RANKS.map(rank => {
              const card = { rank, suit }
              const used = usedKeys.has(cardKey(card))
              const selected = !!selectedCard
                && selectedCard.rank === rank
                && selectedCard.suit === suit
              return (
                <button
                  key={`${rank}${suit}`}
                  type="button"
                  draggable={!used}
                  onDragStart={(e) => {
                    if (used) { e.preventDefault(); return }
                    e.dataTransfer.setData('application/x-card', JSON.stringify(card))
                    // copyMove so the slot's dropEffect='move' is
                    // accepted; a 'copy'-only source against a 'move'
                    // target makes the browser refuse the drop.
                    e.dataTransfer.effectAllowed = 'copyMove'
                  }}
                  onClick={() => handleCardClick(card)}
                  disabled={used}
                  className={`transition-transform active:scale-95 rounded-md ${
                    used
                      ? 'opacity-25 grayscale cursor-not-allowed'
                      : selected
                        ? 'ring-2 ring-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.4)] cursor-grab'
                        : 'hover:scale-105 hover:ring-2 hover:ring-rose-300/40 cursor-grab'
                  }`}
                  title={used
                    ? `${rank} of ${suit} — already placed`
                    : selected
                      ? `${rank} of ${suit} — click again to deselect`
                      : `${rank} of ${suit} — click to select`}
                >
                  <CardSprite card={card} className="w-full" />
                </button>
              )
            }))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onCancel?.()}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={totalPicked === 0}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear all
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={totalPicked === 0 || alreadyRigged}
          title={alreadyRigged ? 'Another player already rigged this hand — wait for next' : undefined}
          className="rounded-md border border-rose-400/60 bg-rose-500/20 px-3 py-2 text-xs font-black uppercase tracking-widest text-rose-100 hover:bg-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {alreadyRigged ? 'Already rigged' : 'Rig the hand'}
        </button>
      </div>
    </div>
  )
}

// Slot tile — width-driven sizing with the card's natural 80:110
// aspect ratio enforced via `aspect-[80/110]`. Filled slots are
// themselves draggable: pick a card up from one slot and drop it
// on another (hole → board, hole-A → hole-B, etc.). The existing
// dropCardOnSlot logic dedups the source slot, so cross-slot drags
// behave as a MOVE (single card travels between slots) rather than
// a duplicate.
function CardSlot({ card, onClick, onDropCard }) {
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={!!card}
      onDragStart={(e) => {
        if (!card) { e.preventDefault(); return }
        e.dataTransfer.setData('application/x-card', JSON.stringify({ rank: card.rank, suit: card.suit }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDrop={(e) => {
        e.preventDefault()
        try {
          const c = JSON.parse(e.dataTransfer.getData('application/x-card') || 'null')
          if (c) onDropCard?.(c)
        } catch {}
      }}
      className={`relative w-12 sm:w-14 aspect-[80/110] rounded-md transition-all active:scale-95 ${card ? 'cursor-grab' : ''}`}
      title={card ? `${card.rank}${card.suit[0].toUpperCase()} — click to clear, drag to move` : 'Click or drag a card here'}
    >
      {card ? (
        <CardSprite card={card} className="h-full w-full" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-md border-2 border-dashed border-zinc-700 text-base font-black text-zinc-700">?</span>
      )}
    </button>
  )
}

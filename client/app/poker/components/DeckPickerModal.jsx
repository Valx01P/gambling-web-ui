'use client'

import { useState } from 'react'
import CardSprite from '../../components/CardSprite'

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']

// 2-card picker for the Swap power. Renders inline INSIDE the
// items panel — no fullscreen modal overlay. Mirrors the sizing
// + DnD pattern of CardPickerModal + RigHandModal so all three
// powers read like one design system.
//
// Quirk vs. the other pickers: duplicates ARE allowed — picking
// the same card twice is the "5-of-a-kind on the board" meme path
// the design ask called out. So no `usedKeys` filter on the deck.
//
// Class name kept "Modal" to avoid renaming every import; the file
// renders inline content now, not a modal overlay.
export default function DeckPickerModal({ onConfirm, onCancel }) {
  const [picks, setPicks] = useState([])

  function placeAt(card, slotIndex, sourceSlot = null) {
    setPicks(prev => {
      const next = [...prev]
      while (next.length < slotIndex + 1) next.push(null)
      // If the drop came from another slot, clear that slot first so
      // the card moves rather than duplicating. Drops from the deck
      // (sourceSlot = null) preserve the swap-power duplicate behavior.
      if (sourceSlot != null && sourceSlot !== slotIndex && next[sourceSlot]) {
        next[sourceSlot] = null
      }
      next[slotIndex] = card
      return next.filter(Boolean).slice(0, 2)
    })
  }

  function togglePick(card) {
    setPicks(prev => {
      // Duplicates intentionally allowed (5-of-a-kind meme). FIFO
      // replace once both slots are full.
      if (prev.length >= 2) return [prev[1], card]
      return [...prev, card]
    })
  }

  function clearSlot(i) {
    setPicks(prev => prev.filter((_, idx) => idx !== i))
  }

  function reset() { setPicks([]) }

  function confirm() {
    if (picks.length !== 2) return
    onConfirm?.(picks)
    setPicks([])
  }

  function isPicked(card) {
    return picks.some(p => p.rank === card.rank && p.suit === card.suit)
  }

  return (
    <div className="rounded-xl border border-fuchsia-400/40 bg-zinc-950/60 p-3">
      <div className="text-center">
        <div className="text-[10px] font-black uppercase tracking-widest text-fuchsia-300">Swap Cards</div>
        <div className="mt-1 text-base font-black text-white leading-snug">
          Pick any two cards from the deck.
        </div>
        <div className="mt-1 text-[11px] font-bold text-zinc-400 leading-snug">
          Duplicates allowed — stack onto the board for 5-of-a-kind or worse offenses.
        </div>
      </div>

      {/* Slot preview — card-sized placeholders, click to clear,
          drop target for drag from the deck. */}
      <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
        {[0, 1].map(i => {
          const filled = picks[i]
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => { if (filled) clearSlot(i) }}
                draggable={!!filled}
                onDragStart={(e) => {
                  if (!filled) { e.preventDefault(); return }
                  e.dataTransfer.setData('application/x-card', JSON.stringify({ rank: filled.rank, suit: filled.suit }))
                  e.dataTransfer.setData('application/x-card-source-slot', String(i))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => {
                  e.preventDefault()
                  try {
                    const c = JSON.parse(e.dataTransfer.getData('application/x-card') || 'null')
                    const raw = e.dataTransfer.getData('application/x-card-source-slot')
                    const sourceSlot = raw === '' ? null : Number(raw)
                    if (c && c.rank && c.suit) placeAt(c, i, Number.isFinite(sourceSlot) ? sourceSlot : null)
                  } catch {}
                }}
                title={filled ? 'Click to clear, drag to move' : 'Click a card below or drag one here'}
                // aspect-[80/110] = CardSprite's natural viewBox so
                // the rendered card fills the slot with no vertical
                // slack on top + bottom.
                className={`w-14 sm:w-16 aspect-[80/110] rounded-md transition-all active:scale-95 ${filled ? 'cursor-grab' : ''}`}
              >
                {filled ? (
                  <CardSprite card={filled} className="h-full w-full" />
                ) : (
                  <div className="h-full w-full rounded-md border-2 border-dashed border-zinc-700 flex items-center justify-center text-zinc-700 text-lg font-black">
                    ?
                  </div>
                )}
              </button>
              <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                Card {i + 1}
              </div>
            </div>
          )
        })}
      </div>

      {/* Deck — fixed 72px wide cells, horizontally scrollable. */}
      <div className="mt-3">
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
              const picked = isPicked(card)
              return (
                <button
                  key={`${rank}${suit}`}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-card', JSON.stringify(card))
                    // copyMove so the slot's dropEffect='move' is
                    // accepted; a 'copy'-only source against a 'move'
                    // target makes the browser refuse the drop.
                    e.dataTransfer.effectAllowed = 'copyMove'
                  }}
                  onClick={() => togglePick(card)}
                  className={`transition-transform active:scale-95 ${
                    picked
                      ? 'ring-2 ring-amber-300 rounded-md cursor-grab'
                      : 'hover:scale-105 hover:ring-2 hover:ring-fuchsia-300/40 rounded-md cursor-grab'
                  }`}
                  title={`${rank} of ${suit} — click or drag`}
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
          onClick={reset}
          disabled={picks.length === 0}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={picks.length !== 2}
          className="rounded-md border border-fuchsia-400/60 bg-fuchsia-500/20 px-3 py-2 text-xs font-black uppercase tracking-widest text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40"
        >
          Confirm Swap
        </button>
      </div>
    </div>
  )
}

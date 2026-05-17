'use client'

import { useState, useEffect } from 'react'
import CardSprite from '../../components/CardSprite'

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']

// Inline card picker for the single-card powers (river_card,
// next_card). Renders directly INSIDE the items panel — no
// fullscreen modal overlay, no nested popup. The parent
// (ItemsPanel) controls when to mount this and supplies a Back
// button to return to the items list.
//
// Props:
//   count       — number of cards to pick (default 1)
//   title       — heading
//   subtitle    — helper line
//   confirmLabel— button text on confirm
//   accent      — 'rose' | 'cyan' | 'amber' | 'fuchsia' for accent
//   disabledCards — array of {rank, suit} that can't be picked
//                   (e.g. already on the board for river_card)
//   onConfirm   — (cards[]) => void
//   onCancel    — () => void
//
// Duplicates are NOT allowed (the slot dedups). Drag-and-drop is
// supported alongside click-to-pick; clicking a filled slot clears
// it. The class name kept "Modal" to avoid renaming every import.

const ACCENT_RING = {
  amber:   'ring-amber-300',
  rose:    'ring-rose-300',
  fuchsia: 'ring-fuchsia-300',
  cyan:    'ring-cyan-300',
}
const ACCENT_BORDER = {
  amber:   'border-amber-400/40',
  rose:    'border-rose-400/40',
  fuchsia: 'border-fuchsia-400/40',
  cyan:    'border-cyan-400/40',
}
const ACCENT_BTN = {
  amber:   'border-amber-400/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30',
  rose:    'border-rose-400/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30',
  fuchsia: 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100 hover:bg-fuchsia-500/30',
  cyan:    'border-cyan-400/60 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30',
}

export default function CardPickerModal({
  count = 1,
  title = 'Pick a card',
  subtitle = null,
  confirmLabel = 'Confirm',
  accent = 'amber',
  onConfirm,
  onCancel,
  disabledCards = null,
}) {
  const [picks, setPicks] = useState([])
  useEffect(() => { setPicks([]) }, [count])

  const ring = ACCENT_RING[accent] || ACCENT_RING.amber
  const border = ACCENT_BORDER[accent] || ACCENT_BORDER.amber
  const btn = ACCENT_BTN[accent] || ACCENT_BTN.amber

  const disabledKeys = new Set(
    Array.isArray(disabledCards)
      ? disabledCards.filter(c => c && c.rank && c.suit).map(c => `${c.rank}-${c.suit}`)
      : []
  )
  const isDisabled = (c) => disabledKeys.has(`${c.rank}-${c.suit}`)
  const isPicked = (c) => picks.some(p => p.rank === c.rank && p.suit === c.suit)

  function togglePick(card) {
    if (isDisabled(card)) return
    setPicks(prev => {
      const i = prev.findIndex(p => p.rank === card.rank && p.suit === card.suit)
      if (i >= 0) return prev.filter((_, idx) => idx !== i)
      if (prev.length >= count) return [...prev.slice(1), card]
      return [...prev, card]
    })
  }

  function placeAt(card, slotIndex) {
    if (isDisabled(card)) return
    setPicks(prev => {
      // Drop is a move — clear any previous slot holding this card.
      const cleaned = prev.filter(p => !(p.rank === card.rank && p.suit === card.suit))
      const next = [...cleaned]
      while (next.length < slotIndex) next.push(null)
      next[slotIndex] = card
      return next.filter(Boolean).slice(0, count)
    })
  }

  return (
    <div className={`rounded-xl border ${border} bg-zinc-950/60 p-3`}>
      <div className="text-center">
        <div className={`text-[10px] font-black uppercase tracking-widest ${{
          amber: 'text-amber-300', rose: 'text-rose-300',
          fuchsia: 'text-fuchsia-300', cyan: 'text-cyan-300'
        }[accent] || 'text-amber-300'}`}>{title}</div>
        {subtitle && (
          <div className="mt-1 text-[11px] font-bold text-zinc-400 leading-snug">{subtitle}</div>
        )}
        <div className="mt-1 text-[10px] font-bold text-zinc-500">
          {picks.length}/{count} picked
        </div>
      </div>

      {/* Slot tiles — sized JUST under the deck cards so the deck
          reads as the primary surface. Click a filled slot to clear;
          drop a deck card to fill. */}
      <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
        {Array.from({ length: count }).map((_, i) => {
          const filled = picks[i]
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (!filled) return
                  setPicks(prev => prev.filter((_, idx) => idx !== i))
                }}
                draggable={!!filled}
                onDragStart={(e) => {
                  if (!filled) { e.preventDefault(); return }
                  e.dataTransfer.setData('application/x-card', JSON.stringify({ rank: filled.rank, suit: filled.suit }))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => {
                  e.preventDefault()
                  try {
                    const card = JSON.parse(e.dataTransfer.getData('application/x-card') || 'null')
                    if (card && card.rank && card.suit) placeAt(card, i)
                  } catch {}
                }}
                title={filled ? 'Click to clear, drag to move' : 'Click a card below or drag one here'}
                // aspect-[80/110] matches the CardSprite viewBox so
                // the filled card sits edge-to-edge in the slot with
                // no 1.5px slack top/bottom.
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
                #{i + 1}
              </div>
            </div>
          )
        })}
      </div>

      {/* Deck — bigger cards than the slots, horizontally scrollable
          so the items panel doesn't need to widen to show all 52. */}
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
              const disabled = isDisabled(card)
              return (
                <button
                  key={`${rank}${suit}`}
                  type="button"
                  draggable={!disabled}
                  onDragStart={(e) => {
                    if (disabled) { e.preventDefault(); return }
                    e.dataTransfer.setData('application/x-card', JSON.stringify(card))
                    // copyMove so the slot's dropEffect='move' is
                    // accepted; a 'copy'-only source against a 'move'
                    // target makes the browser refuse the drop.
                    e.dataTransfer.effectAllowed = 'copyMove'
                  }}
                  onClick={() => togglePick(card)}
                  disabled={disabled}
                  className={`transition-transform active:scale-95 ${
                    disabled
                      ? 'opacity-30 grayscale cursor-not-allowed'
                      : picked
                        ? `ring-2 ${ring} rounded-md cursor-grab`
                        : 'hover:scale-105 cursor-grab'
                  }`}
                  title={disabled ? `${rank} of ${suit} — already in play` : `${rank} of ${suit} — click or drag`}
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
          onClick={() => setPicks([])}
          disabled={picks.length === 0}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => picks.length === count && onConfirm?.(picks)}
          disabled={picks.length !== count}
          className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-40 ${btn}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

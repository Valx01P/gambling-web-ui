'use client'

import { useState } from 'react'
import CardSprite from '../../components/CardSprite'

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']

// 5-card swap picker — shows all 52 cards in a 4×13 grid. The user
// clicks two cards (duplicates allowed for the meme — stack onto
// what's already on the board to build 5-of-a-kind), then confirms.
//
// The grid uses CardSprite (the same sprite the table renders), so
// every card visually matches the rest of the game.
export default function DeckPickerModal({ open, onClose, onConfirm }) {
  const [picks, setPicks] = useState([])
  if (!open) return null

  function togglePick(card) {
    setPicks(prev => {
      if (prev.length >= 2) {
        // Already two selected — replace the older pick (FIFO).
        return [prev[1], card]
      }
      return [...prev, card]
    })
  }

  function reset() { setPicks([]) }

  function confirm() {
    if (picks.length !== 2) return
    onConfirm(picks)
    setPicks([])
  }

  function isPicked(card) {
    return picks.some(p => p.rank === card.rank && p.suit === card.suit)
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3"
      onClick={() => { onClose(); reset() }}
    >
      <div
        className="w-full max-w-[640px] max-h-[92dvh] overflow-y-auto rounded-2xl border border-fuchsia-400/40 bg-zinc-950/95 px-4 py-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-fuchsia-300">Swap Cards</div>
          <div className="mt-1 text-base font-black text-white leading-snug">
            Pick any two cards from the deck.
          </div>
          <div className="mt-1 text-[11px] font-bold text-zinc-400 leading-snug">
            Duplicates allowed — stack onto the board for 5-of-a-kind or worse offenses.
            <br/>5-of-a-kind <span className="text-amber-300">beats</span> Royal Flush.
          </div>
        </div>

        {/* Current picks preview */}
        <div className="mt-3 flex items-center justify-center gap-3 min-h-[78px]">
          {[0, 1].map(i => (
            <div key={i} className="flex flex-col items-center gap-1">
              {picks[i] ? (
                <CardSprite card={picks[i]} className="w-14" />
              ) : (
                <div className="w-14 h-[77px] rounded-md border-2 border-dashed border-zinc-700 flex items-center justify-center text-zinc-700 text-[10px] font-black uppercase tracking-widest">
                  pick
                </div>
              )}
              <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Card {i + 1}</div>
            </div>
          ))}
        </div>

        {/* 4×13 grid of every card */}
        <div className="mt-3 grid grid-cols-7 sm:grid-cols-13 gap-1">
          {SUITS.map(suit => RANKS.map(rank => {
            const card = { rank, suit }
            const picked = isPicked(card)
            return (
              <button
                key={`${rank}${suit}`}
                type="button"
                onClick={() => togglePick(card)}
                className={`transition-transform active:scale-95 ${picked ? 'ring-2 ring-amber-300 rounded-md' : 'hover:scale-105'}`}
                title={`${rank} of ${suit}`}
              >
                <CardSprite card={card} className="w-full" />
              </button>
            )
          }))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => { onClose(); reset() }}
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
    </div>
  )
}

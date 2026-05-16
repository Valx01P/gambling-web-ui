'use client'

import CardSprite from '../../components/CardSprite'

// Centered modal that reveals an opponent's hole cards to the local
// user only. Server already validated the peek + decremented the
// cooldown — this is pure display. Tap anywhere on the backdrop to
// close. The header explains who was peeked so the user remembers
// who they used the slot on.
export default function PeekRevealModal({ targetUsername, cards, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[min(92vw,360px)] rounded-2xl border border-sky-400/40 bg-zinc-950/95 px-5 py-5 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] font-black uppercase tracking-widest text-sky-300">Peek result</div>
        <div className="mt-1 text-base font-black text-white">
          {targetUsername || 'opponent'}’s hand
        </div>
        <div className="mt-1 text-[11px] font-bold text-zinc-400">Only you can see this.</div>

        <div className="mt-4 flex items-center justify-center gap-3">
          {(cards || []).map((card, i) => (
            <CardSprite key={i} card={card} className="w-20" />
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-md border border-sky-400/60 bg-sky-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-sky-100 hover:bg-sky-500/25"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

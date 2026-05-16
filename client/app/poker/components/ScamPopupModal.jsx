'use client'

import { useState, useEffect, useMemo } from 'react'

// Forced popup when another player has used the Scam item against the
// local user. The mechanic per the design brief: a single "Block"
// button sits in a sea of "Accept" buttons that shift positions every
// ~600ms. If the user misclicks an Accept, ~10% of their stack
// transfers to the attacker. If they hit Block (or wait 30s for the
// server's expiry), no chips move.
//
// We can't be dismissed by clicking the backdrop or pressing Esc —
// that'd be too easy. Only the two real choices resolve the popup.

const NUM_BUTTONS = 9  // 8 Accept + 1 Block, randomized layout
const SHUFFLE_INTERVAL_MS = 700

export default function ScamPopupModal({ senderUsername, amount, onAccept, onBlock }) {
  // Layout: which slot (index in 0..NUM_BUTTONS-1) contains the real
  // Block button. The rest are Accepts. Reshuffled every interval so
  // the user has to track it rather than memorize a position.
  const [blockSlot, setBlockSlot] = useState(() => Math.floor(Math.random() * NUM_BUTTONS))

  useEffect(() => {
    const id = setInterval(() => {
      // Move to a fresh slot — biased away from the previous one so the
      // shuffle is more disorienting than a 1-in-9 stay-put.
      setBlockSlot(prev => {
        let next = Math.floor(Math.random() * NUM_BUTTONS)
        if (next === prev) next = (next + 1) % NUM_BUTTONS
        return next
      })
    }, SHUFFLE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Pre-shuffle the visual order so reloads / re-mounts don't snap to
  // the same predictable pattern. Stable across the modal's lifetime.
  const slotOrder = useMemo(() => {
    const arr = Array.from({ length: NUM_BUTTONS }, (_, i) => i)
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }, [])

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[min(94vw,420px)] rounded-2xl border border-amber-400/60 bg-zinc-950/95 px-5 py-5 shadow-2xl">
        <div className="text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">Incoming offer</div>
          <div className="mt-1 text-base font-black text-white leading-snug">
            <span className="text-amber-200">{senderUsername}</span> is asking for{' '}
            <span className="text-amber-200">${(amount || 0).toLocaleString()}</span>.
          </div>
          <div className="mt-1 text-[11px] font-bold text-zinc-400 leading-snug">
            Sure looks legit. Find the <span className="text-emerald-300">BLOCK</span> button — the rest will agree.
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {slotOrder.map(slotIdx => {
            const isBlock = slotIdx === blockSlot
            return (
              <button
                key={slotIdx}
                type="button"
                onClick={isBlock ? onBlock : onAccept}
                className={
                  isBlock
                    ? 'rounded-md border border-emerald-400/70 bg-emerald-600 px-2 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md hover:bg-emerald-500'
                    : 'rounded-md border border-amber-400/50 bg-amber-500/20 px-2 py-3 text-xs font-black uppercase tracking-widest text-amber-100 shadow-sm hover:bg-amber-500/30'
                }
              >
                {isBlock ? 'Block' : 'Agree'}
              </button>
            )
          })}
        </div>

        <div className="mt-3 text-center text-[10px] font-bold text-zinc-500">
          Buttons reshuffle every {SHUFFLE_INTERVAL_MS}ms.
        </div>
      </div>
    </div>
  )
}

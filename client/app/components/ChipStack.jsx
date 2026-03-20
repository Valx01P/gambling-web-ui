'use client'

import PokerChip from './PokerChip'

function chipBreakdown(amount, maxChips) {
  const denoms = [100, 25, 5]
  const chips = []
  let remaining = amount
  for (const d of denoms) {
    while (remaining >= d && chips.length < maxChips) {
      chips.push(d)
      remaining -= d
    }
  }
  if (remaining > 0 && chips.length < maxChips) chips.push(5)
  return chips
}

export function BetChips({ amount }) {
  if (amount <= 0) return null
  const chips = chipBreakdown(amount, 8)

  return (
    <div className="relative w-5 h-5 sm:w-6 sm:h-6">
      {chips.map((d, i) => (
        <div key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
          <PokerChip value={d} className="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
      ))}
    </div>
  )
}

export function PotChips({ amount }) {
  if (amount <= 0) return null
  const count = Math.min(Math.ceil(amount / 50), 10)
  const chips = chipBreakdown(amount, count)
  if (chips.length === 0) chips.push(5)

  return (
    <div className="flex items-end justify-center gap-1 sm:gap-1.5">
      <div className="relative w-5 h-5 sm:w-6 sm:h-6">
        {chips.slice(0, 5).map((d, i) => (
          <div key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
            <PokerChip value={d} className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        ))}
      </div>
      {chips.length > 5 && (
        <div className="relative w-5 h-5 sm:w-6 sm:h-6">
          {chips.slice(5).map((d, i) => (
            <div key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
              <PokerChip value={d} className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
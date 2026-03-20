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
    <div className="flex flex-col-reverse items-center" style={{ height: 12 + chips.length * 3 }}>
      {chips.map((d, i) => (
        <div key={i} className="absolute" style={{ bottom: i * 3 }}>
          <PokerChip value={d} width={22} height={22} />
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
    <div className="flex items-end justify-center gap-0.5">
      <div className="relative" style={{ width: 20, height: 14 + Math.min(chips.length, 5) * 3 }}>
        {chips.slice(0, 5).map((d, i) => (
          <div key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
            <PokerChip value={d} width={20} height={20} />
          </div>
        ))}
      </div>
      {chips.length > 5 && (
        <div className="relative" style={{ width: 20, height: 14 + (chips.length - 5) * 3 }}>
          {chips.slice(5).map((d, i) => (
            <div key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
              <PokerChip value={d} width={20} height={20} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
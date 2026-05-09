'use client'

import { useMemo } from 'react'
import PokerChip from './PokerChip'

const MAX_BET_CHIPS = 8

function chipBreakdown(amount, maxChips) {
  const denoms = [100000, 25000, 10000, 5000, 2500, 1000, 500, 250, 100, 50, 25, 10, 5]
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

function hashSeed(seed) {
  const value = String(seed || Date.now())
  let hash = 2166136261

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function seededRandom(seed) {
  let state = hashSeed(seed)

  return () => {
    state += 0x6D2B79F5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function getThrowOrigin(origin) {
  const origins = {
    bottom: { x: 0, y: 62 },
    left: { x: -68, y: 0 },
    right: { x: 68, y: 0 },
    top: { x: 0, y: -58 },
  }

  return origins[origin] || origins.bottom
}

function makeThrowLayout(chips, seed, origin) {
  const random = seededRandom(seed)
  const start = getThrowOrigin(origin)

  return chips.map((d, i) => {
    const x = 0
    const y = -(i * 3)
    const arc = 18 + Math.round(random() * 20)

    return {
      value: d,
      x,
      y,
      startX: start.x + Math.round((random() - 0.5) * 12),
      startY: start.y + Math.round((random() - 0.5) * 12),
      midX: Math.round((start.x + x) * 0.45),
      midY: Math.round((start.y + y) * 0.45) - arc,
      settleX: x,
      settleY: y,
      rotation: Math.round((random() - 0.5) * 240),
      startRotation: Math.round((random() - 0.5) * 180),
      delay: i * 34 + Math.round(random() * 45),
    }
  })
}

export function BetChips({ amount, thrown = false, animationKey = '', origin = 'bottom' }) {
  const chips = useMemo(
    () => (amount > 0 ? chipBreakdown(amount, MAX_BET_CHIPS) : []),
    [amount]
  )
  const throwLayout = useMemo(
    () => makeThrowLayout(chips, `${animationKey}-${amount}-${origin}`, origin),
    [animationKey, amount, origin, chips]
  )

  if (amount <= 0) return null

  if (thrown) {
    return (
      <div className="relative w-16 h-14 sm:w-20 sm:h-16 pointer-events-none" aria-hidden="true">
        {throwLayout.map((chip, i) => (
          <div
            key={`${animationKey}-${i}`}
            className="chip-throw-piece absolute left-1/2 top-1/2"
            style={{
              '--chip-x': `${chip.x}px`,
              '--chip-y': `${chip.y}px`,
              '--chip-start-x': `${chip.startX}px`,
              '--chip-start-y': `${chip.startY}px`,
              '--chip-mid-x': `${chip.midX}px`,
              '--chip-mid-y': `${chip.midY}px`,
              '--chip-settle-x': `${chip.settleX}px`,
              '--chip-settle-y': `${chip.settleY}px`,
              '--chip-rot': `${chip.rotation}deg`,
              '--chip-start-rot': `${chip.startRotation}deg`,
              '--chip-delay': `${chip.delay}ms`,
              zIndex: i + 1,
            }}
          >
            <PokerChip value={chip.value} className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        ))}
      </div>
    )
  }

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

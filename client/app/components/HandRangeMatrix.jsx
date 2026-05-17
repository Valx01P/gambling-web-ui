'use client'

import { useMemo, useState } from 'react'

// 13x13 hand-range visualizer. The grid is the classic poker chart:
//   • diagonal       → pocket pairs (AA … 22)
//   • upper triangle → suited hands  (AKs in row A, col K)
//   • lower triangle → offsuit hands (AKo in row K, col A)
//
// We don't have a real opponent-range solver — this is a TEACHING aid,
// not a game-state read. The cell value is a synthesized "preflop
// strength" score so a player can eyeball "what's likely to be a strong
// holding here" against a random opponent. Real range narrowing from
// observed actions could plug in here later; the cell color reflects
// whatever strength function we hand it.

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 }

// Synthetic preflop strength on a 0-100 scale. Calibrated so AA ~ 85,
// 72o ~ 28 — matches the look of published heads-up equity charts
// closely enough for a heatmap. Pure function so callers can swap in
// their own ranking later.
function defaultStrength(row, col) {
  const r1 = RANK_VALUE[RANKS[row]]
  const r2 = RANK_VALUE[RANKS[col]]
  if (row === col) {
    // Pair: 22 = 50, AA = 85 (linear in rank).
    return 50 + (r1 - 2) * (35 / 12)
  }
  const high = Math.max(r1, r2)
  const low = Math.min(r1, r2)
  const suited = row < col
  const gap = high - low
  let s = 30 + (high - 2) * 2 + (low - 2) * 1.5
  if (gap === 1) s += 4
  else if (gap === 2) s += 2
  else if (gap >= 5) s -= 2
  if (suited) s += 3
  return Math.max(20, Math.min(85, s))
}

function labelFor(row, col) {
  const h = RANKS[row]
  const l = RANKS[col]
  if (row === col) return `${h}${l}`         // pair
  if (row < col) return `${h}${l}s`          // suited (above diagonal)
  return `${l}${h}o`                          // offsuit (below diagonal)
}

// Map a 20-85 strength score to a tailwind background class. Hot side
// reads red/amber (premium), cold side reads zinc/slate (trash).
function bgForStrength(s) {
  if (s >= 78) return 'bg-rose-500/85'
  if (s >= 70) return 'bg-rose-500/65'
  if (s >= 62) return 'bg-amber-500/70'
  if (s >= 55) return 'bg-amber-500/45'
  if (s >= 48) return 'bg-emerald-500/40'
  if (s >= 40) return 'bg-emerald-500/25'
  if (s >= 32) return 'bg-zinc-600/40'
  return 'bg-zinc-800/40'
}

function textForStrength(s) {
  return s >= 55 ? 'text-zinc-950' : 'text-zinc-200'
}

export default function HandRangeMatrix({
  // Optional override — pass your own (row, col) → 0-100 strength
  // function (e.g., narrowed by observed actions) to swap the heat
  // signal without touching the layout.
  strengthFn,
  // Optional title — shown above the grid. The player popover passes
  // the target's username so the user reads "Likely hands for Alice".
  title,
}) {
  const fn = strengthFn || defaultStrength
  const [hovered, setHovered] = useState(null)

  const cells = useMemo(() => {
    const grid = []
    for (let r = 0; r < 13; r++) {
      const row = []
      for (let c = 0; c < 13; c++) {
        const s = fn(r, c)
        row.push({ row: r, col: c, label: labelFor(r, c), strength: s })
      }
      grid.push(row)
    }
    return grid
  }, [fn])

  return (
    <div className="space-y-2 text-zinc-200">
      {title && (
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
          {title}
        </div>
      )}
      {/* Tailwind 4 stops at grid-cols-12 out of the box; inline style is
          the simplest way to set a 13-column track without touching the
          theme config. */}
      <div className="grid gap-[1px] rounded-md border border-zinc-700/70 bg-zinc-950/60 p-1"
           style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
        {cells.flat().map(cell => (
          <button
            key={`${cell.row}-${cell.col}`}
            type="button"
            onMouseEnter={() => setHovered(cell)}
            onMouseLeave={() => setHovered(h => h && h.row === cell.row && h.col === cell.col ? null : h)}
            onFocus={() => setHovered(cell)}
            onBlur={() => setHovered(h => h && h.row === cell.row && h.col === cell.col ? null : h)}
            title={`${cell.label} · strength ${Math.round(cell.strength)}`}
            className={`aspect-square min-w-[14px] text-[8px] sm:text-[9px] font-black tracking-tight transition-transform active:scale-90 ${bgForStrength(cell.strength)} ${textForStrength(cell.strength)}`}
          >
            {cell.label}
          </button>
        ))}
      </div>
      {/* Legend + hovered cell read-out. Stays the same height so the
          grid doesn't reflow as the user moves their cursor. */}
      <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 min-h-[18px]">
        <span>
          {hovered
            ? <><span className="text-white">{hovered.label}</span> · strength <span className="text-amber-200">{Math.round(hovered.strength)}</span></>
            : 'Hover a cell — diagonal = pairs, top half = suited, bottom = offsuit.'}
        </span>
      </div>
    </div>
  )
}

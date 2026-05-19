'use client'

// Shared action-pill rendering. Used by both the main felt (poker/page.jsx)
// and the mini PokerWindow. Lives here so both surfaces stay byte-for-byte
// aligned — when the server upgrades a label ("Re-raise" → "4-Bet"), both
// views pick it up without drift.
//
// `action.text` is the authoritative label. The server already produces
// rich aggression text via PokerGame.getAggressionLabel — "Bet", "Raise",
// "Re-raise", "4-Bet", "5-Bet", "Re-raise All-In", "Call All-In" — and
// that string lands here verbatim. The defaultText map is the fallback
// for when only `action.action` is known.

export function formatChipsCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

const ACTION_STYLES = {
  fold:   { bg: 'bg-red-800/90 border-red-600/50 text-red-100', defaultText: 'FOLD' },
  check:  { bg: 'bg-zinc-600/90 border-zinc-400/50 text-white', defaultText: 'CHECK' },
  call:   { bg: 'bg-emerald-700/90 border-emerald-500/50 text-emerald-100', defaultText: 'CALL' },
  raise:  { bg: 'bg-amber-700/90 border-amber-500/50 text-amber-100', defaultText: 'RAISE' },
  all_in: { bg: 'bg-amber-600/90 border-amber-400/50 text-amber-100', defaultText: 'ALL IN' },
  sb:     { bg: 'bg-zinc-800/95 border-zinc-600/50 text-zinc-200', defaultText: 'SB' },
  bb:     { bg: 'bg-zinc-800/95 border-zinc-600/50 text-zinc-200', defaultText: 'BB' },
}

export function formatActionText(action) {
  if (!action || !action.action) return null
  const info = ACTION_STYLES[action.action]
  if (!info) return null
  let text = action.text || info.defaultText
  if (action.amount > 0 && action.action !== 'sb' && action.action !== 'bb') {
    text += ` ${action.amount >= 1_000_000 ? formatChipsCompact(action.amount) : action.amount.toLocaleString()}`
  }
  return text
}

export function ActionBadge({ action, size = 'md' }) {
  if (!action || !action.action) return null
  const info = ACTION_STYLES[action.action]
  if (!info) return null
  const text = formatActionText(action)
  if (!text) return null
  // `sm` is the mini-table variant — denser pill, no responsive bump.
  // `md` matches the main felt's existing nameplate-overlay sizing.
  const sizing = size === 'sm'
    ? 'text-[9px] px-1.5 py-0.5'
    : 'text-[10px] sm:text-xs px-2 py-0.5 sm:py-1'
  return (
    <div className={`${sizing} font-bold rounded-md border ${info.bg} whitespace-nowrap shadow-sm`}>
      {text}
    </div>
  )
}

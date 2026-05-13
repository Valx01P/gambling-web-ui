'use client'

import { useEffect, useState } from 'react'
import BotAvatar from '../../../components/BotAvatar'
import { api } from '../../../lib/api'

// Compact head-to-head leaderboard for the bot edit page. Server query
// is bounded (sample of recent N hands, top M opponents) so this is
// safe to render unconditionally — empty result just hides the panel.

function fmtPct(wins, total) {
  if (!total) return '—'
  return `${Math.round((100 * wins) / total)}%`
}

function fmtChips(n) {
  const v = Number(n) || 0
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString()}`
}

function variantLabel(opp) {
  if (opp.isNeural) {
    if (opp.neuralKind === 'mlp') return 'MLP'
    if (opp.neuralKind === 'qlearning') return 'Q-learn'
    if (opp.neuralKind === 'reinforce_baseline') return 'PG+BL'
    return 'PG'
  }
  if (opp.isClone) return 'Clone'
  return 'Custom'
}

export default function HeadToHeadPanel({ botId, refreshKey = 0 }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.botHeadToHead(botId)
      .then(({ opponents }) => { if (!cancelled) setRows(opponents || []) })
      .catch(err => { if (!cancelled) setError(err.detail || err.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [botId, refreshKey])

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500">
        Loading head-to-head stats…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
        Couldn't load head-to-head: {error}
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">Head-to-head</div>
        <div className="mt-1">No tracked matchups yet. Once this bot plays hands at a table with other bots, win rates show up here.</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
          Head-to-head · top {rows.length} opponents
        </div>
        <div className="text-[10px] font-bold text-zinc-500">
          window: last ~2000 hands
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-zinc-500">
              <th className="px-1 py-1 text-left font-bold">Opponent</th>
              <th className="px-1 py-1 text-right font-bold">Hands</th>
              <th className="px-1 py-1 text-right font-bold">W</th>
              <th className="px-1 py-1 text-right font-bold">Win%</th>
              <th className="px-1 py-1 text-right font-bold">Chips Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(opp => {
              const pct = opp.handsTogether > 0
                ? Math.round((100 * opp.myWins) / opp.handsTogether)
                : 0
              const pctClass = pct >= 60 ? 'text-emerald-300'
                              : pct <= 40 ? 'text-rose-300'
                              : 'text-zinc-200'
              const deltaClass = opp.chipsDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'
              return (
                <tr key={opp.opponentId} className="border-t border-zinc-800/70">
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <BotAvatar
                        name={opp.name}
                        color={opp.color || '#3b82f6'}
                        textColor={opp.textColor || 'auto'}
                        avatarUrl={opp.avatarUrl}
                        size={22}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-zinc-100 font-bold">{opp.name}</div>
                        <div className="truncate text-[9px] text-zinc-500">
                          ELO {opp.elo} · {variantLabel(opp)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono text-zinc-300">{opp.handsTogether}</td>
                  <td className="px-1 py-1.5 text-right font-mono text-zinc-300">{opp.myWins}</td>
                  <td className={`px-1 py-1.5 text-right font-mono font-bold ${pctClass}`}>{fmtPct(opp.myWins, opp.handsTogether)}</td>
                  <td className={`px-1 py-1.5 text-right font-mono font-bold ${deltaClass}`}>{fmtChips(opp.chipsDelta)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[9px] text-zinc-500">
        "W" / "Win%" count hands where this bot finished as the winner across all bots sharing the hand. "Chips Δ" sums this bot's net chip change in those hands.
      </div>
    </div>
  )
}

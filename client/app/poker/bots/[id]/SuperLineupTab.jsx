'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import BotAvatar from '../../../components/BotAvatar'
import { api } from '../../../lib/api'
import SuperBotForm from '../SuperBotForm'

// Lineup view for a super bot. Read-only when the viewer isn't the
// owner (showing the member roster). The owner gets the SuperBotForm
// pre-populated with the current lineup + editable; saving PATCHes
// the bot with the new member IDs.
export default function SuperLineupTab({ bot, isMine, onUpdated }) {
  const [available, setAvailable] = useState([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isMine || !editing) return
    let cancelled = false
    api.listMyBots()
      .then(r => { if (!cancelled) setAvailable((r.bots || []).filter(b => !b.isSuper && b.id !== bot.id)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isMine, editing, bot.id])

  async function save({ memberIds, mode: nextMode }) {
    setBusy(true); setError(null)
    try {
      const patch = { memberIds }
      // Mode change goes through the same PATCH — preserves the
      // accumulated bandit stats so swapping algorithms mid-evolution
      // doesn't reset the chain.
      if (nextMode && nextMode !== bot.superState?.mode) {
        patch.mode = nextMode
      }
      const { bot: updated } = await api.updateBot(bot.id, patch)
      onUpdated?.(updated)
      setEditing(false)
    } catch (err) {
      setError(err.detail || err.message || 'Couldn\'t save lineup')
    } finally { setBusy(false) }
  }

  if (isMine && editing) {
    return (
      <SuperBotForm
        mode="edit"
        initial={bot}
        availableBots={available}
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const members = bot.members || []
  const state = bot.superState || {}
  const mode = state.mode || 'thompson'
  const handsTrained = state.handsTrained || 0
  const modeLabel = {
    thompson: 'Thompson sampling (Bayesian bandit)',
    weighted: 'Weighted softmax',
    markov:   'Markov chain',
    uniform:  'Uniform random'
  }[mode] || mode
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-violet-400/40 bg-violet-500/5 p-3">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">
          Super bot · {modeLabel}
        </div>
        <div className="mt-1 text-xs font-bold text-zinc-200">
          Every random 1-3 turns this bot delegates its next decision to a different member. The {mode === 'thompson' ? 'Thompson posterior' : mode === 'weighted' ? 'softmax weights' : mode === 'markov' ? 'transition matrix' : 'uniform sampler'} updates after every hand from the chip outcome — members get credit when they were on the floor for a winning hand.
        </div>
        <div className="mt-1 text-[10px] font-bold text-zinc-400">
          Hands evaluated: <span className="text-zinc-200">{handsTrained}</span>
        </div>
      </div>

      {/* Per-member stats — what's actually being learned. Sorted by
          win rate descending so the user can see who's pulling weight. */}
      {members.length > 0 && handsTrained > 0 && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 overflow-x-auto">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
            Member performance
          </div>
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="px-1 py-1 text-left font-bold">Member</th>
                <th className="px-1 py-1 text-right font-bold">Hands</th>
                <th className="px-1 py-1 text-right font-bold">Wins</th>
                <th className="px-1 py-1 text-right font-bold">Win%</th>
                <th className="px-1 py-1 text-right font-bold">Avg reward</th>
                <th className="px-1 py-1 text-right font-bold">Pick weight</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const s = state.members?.[m.id] || {}
                const hands = s.hands || 0
                const wins = s.wins || 0
                const winPct = hands > 0 ? Math.round(100 * wins / hands) : 0
                const avgReward = (s.actions || 0) > 0 ? (s.totalReward || 0) / s.actions : 0
                // Eyeballable "pick weight": Thompson posterior mean for
                // simplicity. Real picks resample on each turn, but the
                // mean gives a stable "how often we'd lean here" read.
                const posteriorMean = (wins + 1) / (hands + 2)
                const winClass = winPct >= 55 ? 'text-emerald-300' : winPct <= 45 ? 'text-rose-300' : 'text-zinc-200'
                const rewardClass = avgReward >= 0 ? 'text-emerald-300' : 'text-rose-300'
                return (
                  <tr key={m.id} className="border-t border-zinc-800/70">
                    <td className="px-1 py-1.5 pr-2 text-zinc-100 truncate">{m.name}</td>
                    <td className="px-1 py-1.5 text-right font-mono text-zinc-300">{hands}</td>
                    <td className="px-1 py-1.5 text-right font-mono text-zinc-300">{wins}</td>
                    <td className={`px-1 py-1.5 text-right font-mono font-bold ${winClass}`}>{hands > 0 ? `${winPct}%` : '—'}</td>
                    <td className={`px-1 py-1.5 text-right font-mono font-bold ${rewardClass}`}>{avgReward >= 0 ? '+' : ''}{avgReward.toFixed(3)}</td>
                    <td className="px-1 py-1.5 text-right font-mono text-violet-200">{(posteriorMean * 100).toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[9px] font-bold text-zinc-500">
            Pick weight = Beta posterior mean ((wins + 1) / (hands + 2)). Higher = more likely to be picked under Thompson.
          </div>
        </div>
      )}

      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
            Members · {members.length}
          </div>
          {isMine && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-violet-400/50 bg-violet-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-violet-100 hover:bg-violet-500/25"
            >
              Edit lineup
            </button>
          )}
        </div>
        {members.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-700/70 px-3 py-3 text-center text-[11px] font-bold text-zinc-500">
            No members yet — edit the lineup to add 3 to 5 bots.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m, i) => (
              <li key={m.id}>
                <Link
                  href={`/poker/bots/${m.id}`}
                  className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 transition-colors hover:border-violet-400/40 hover:bg-violet-500/5"
                >
                  <div className="text-[9px] font-black text-zinc-500 w-4 text-center">{i + 1}</div>
                  <BotAvatar name={m.name} color={m.color} textColor={m.textColor} avatarUrl={m.avatarUrl} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-black text-white">{m.name}</div>
                    <div className="truncate text-[10px] font-bold text-zinc-400">
                      ELO {m.elo} · {m.isNeural ? 'Neural' : m.isClone ? `Clone v${m.cloneTier}` : 'Custom'} · by {m.ownerDisplayName}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

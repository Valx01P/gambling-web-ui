'use client'

import { useEffect, useMemo, useState } from 'react'
import BotAvatar from '../../components/BotAvatar'
import { api } from '../../lib/api'
import { BOT_COLOR_PRESETS, isValidHex } from '../../lib/botColors'

// Inline create-or-edit form for a Super bot. Used both inside the list
// section ("+ New super bot") and on the edit page (replace the Code
// tab with the member picker).
//
// Members come from `availableBots` — the user's own non-super bots
// plus, optionally, a public-roster fetch. We don't try to be clever
// about ordering; the user picks the lineup and the runtime cycles
// between them randomly.
const TRANSITION_MODES = [
  { id: 'thompson', label: 'Thompson sampling', blurb: 'Bayesian bandit — explores under-tried members early, exploits the proven ones once data accumulates. Recommended.' },
  { id: 'weighted',  label: 'Weighted softmax', blurb: 'Picks each member with probability ∝ exp(mean reward). Sharper than uniform, simpler than Thompson.' },
  { id: 'markov',    label: 'Markov chain', blurb: 'Transition matrix P(next | current) learned from won-hand sequences. Captures member-to-member synergy.' },
  { id: 'uniform',   label: 'Uniform random', blurb: 'Every member equally likely. Useful as a control / no-learning baseline.' }
]

export default function SuperBotForm({
  mode = 'create',
  initial = null,
  availableBots = [],
  onSubmit,
  onCancel,
  busy = false,
  error = null
}) {
  const [name, setName] = useState(initial?.name || '')
  const [color, setColor] = useState(initial?.color || '#a855f7')
  const [memberIds, setMemberIds] = useState(initial?.superMemberIds || [])
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false)
  const [transitionMode, setTransitionMode] = useState(initial?.superState?.mode || 'thompson')

  // If `initial` changes (e.g. parent swapped from one super bot to
  // another) reset the form.
  useEffect(() => {
    setName(initial?.name || '')
    setColor(initial?.color || '#a855f7')
    setMemberIds(initial?.superMemberIds || [])
    setIsPublic(initial?.isPublic ?? false)
    setTransitionMode(initial?.superState?.mode || 'thompson')
  }, [initial?.id])

  const memberById = useMemo(() => {
    const m = new Map()
    for (const b of availableBots) m.set(b.id, b)
    // Include the existing initial members (in case some came from
    // another user via public bots — they wouldn't be in availableBots).
    for (const m2 of initial?.members || []) m.set(m2.id, m2)
    return m
  }, [availableBots, initial?.members])

  const candidates = useMemo(() => {
    // Exclude super bots and any bot already in the lineup (the latter
    // is shown separately, picked first).
    return availableBots.filter(b => !b.isSuper && !memberIds.includes(b.id))
  }, [availableBots, memberIds])

  function addMember(id) {
    if (memberIds.length >= 5) return
    if (memberIds.includes(id)) return
    setMemberIds([...memberIds, id])
  }
  function removeMember(id) {
    setMemberIds(memberIds.filter(x => x !== id))
  }
  function moveMember(id, delta) {
    const i = memberIds.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= memberIds.length) return
    const next = memberIds.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setMemberIds(next)
  }

  const valid = name.trim().length > 0 && isValidHex(color) && memberIds.length >= 3 && memberIds.length <= 5

  function kindBadge(b) {
    if (b.isNeural) return { label: b.neuralKind === 'mlp' ? 'MLP' : b.neuralKind === 'qlearning' ? 'Q-LEARN' : b.neuralKind === 'reinforce_baseline' ? 'PG+BL' : 'PG', cls: 'text-cyan-200 border-cyan-400/40 bg-cyan-500/10' }
    if (b.isClone) return { label: `CLONE v${b.cloneTier}`, cls: 'text-amber-200 border-amber-400/40 bg-amber-500/10' }
    return { label: 'JS', cls: 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10' }
  }

  return (
    <div className="rounded-xl border border-violet-400/40 bg-violet-500/5 p-3">
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">
        {mode === 'create' ? '+ New super bot' : 'Edit lineup'}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">Name</div>
          <input
            value={name}
            onChange={e => setName(e.target.value.slice(0, 32))}
            placeholder="e.g. Ensemble One"
            disabled={busy}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/50 px-3 py-1.5 text-sm font-bold text-white outline-none"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">Color</div>
          <div className="flex flex-wrap items-center gap-1">
            {BOT_COLOR_PRESETS.slice(0, 8).map(c => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setColor(c.hex)}
                aria-label={c.name}
                title={c.name}
                className={`h-7 w-7 rounded-full transition-transform ${color === c.hex ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </label>
      </div>

      {/* Lineup — current picks with reorder + remove */}
      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            Lineup ({memberIds.length}/5)
          </div>
          <div className={`text-[10px] font-bold ${memberIds.length < 3 ? 'text-rose-300' : 'text-zinc-500'}`}>
            min 3 · max 5
          </div>
        </div>
        {memberIds.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-700/70 px-3 py-3 text-center text-[11px] font-bold text-zinc-500">
            Pick 3 to 5 bots below.
          </div>
        ) : (
          <ul className="space-y-1">
            {memberIds.map((id, i) => {
              const b = memberById.get(id)
              if (!b) return (
                <li key={id} className="rounded-md border border-zinc-700/70 bg-zinc-950/40 px-2 py-1.5 text-[11px] font-bold text-zinc-400">
                  Unknown bot ({id.slice(0, 8)})
                </li>
              )
              const badge = kindBadge(b)
              return (
                <li key={id} className="flex items-center gap-2 rounded-md border border-zinc-700/70 bg-zinc-950/40 px-2 py-1.5">
                  <div className="text-[9px] font-black text-zinc-500 w-4 text-center">{i + 1}</div>
                  <BotAvatar name={b.name} color={b.color} textColor={b.textColor} avatarUrl={b.avatarUrl} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-black text-white">{b.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded border px-1 py-px text-[8px] font-black uppercase tracking-widest ${badge.cls}`}>{badge.label}</span>
                      <span className="truncate text-[10px] font-bold text-zinc-400">ELO {b.elo}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={i === 0} onClick={() => moveMember(id, -1)} className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30">↑</button>
                    <button type="button" disabled={i === memberIds.length - 1} onClick={() => moveMember(id, +1)} className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => removeMember(id)} className="rounded px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/20">×</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Available picks — your other bots, filtered to non-super and not-already-picked */}
      {memberIds.length < 5 && candidates.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-300">Add a member</div>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {candidates.map(b => {
              const badge = kindBadge(b)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => addMember(b.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/30 px-2 py-1 text-left transition-colors hover:border-violet-400/40 hover:bg-violet-500/5"
                  >
                    <BotAvatar name={b.name} color={b.color} textColor={b.textColor} avatarUrl={b.avatarUrl} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold text-white">{b.name}</div>
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded border px-1 py-px text-[8px] font-black uppercase tracking-widest ${badge.cls}`}>{badge.label}</span>
                        <span className="text-[10px] font-bold text-zinc-400">ELO {b.elo}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-black text-violet-300">+ Add</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Transition mode picker — how the super bot decides which member
          to delegate to next. Stats accumulate the same way under all
          modes, so flipping mode mid-evolution doesn't reset learning. */}
      <div className="mt-3">
        <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-300">Transition algorithm</div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {TRANSITION_MODES.map(m => {
            const selected = transitionMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setTransitionMode(m.id)}
                className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                  selected
                    ? 'border-violet-400/60 bg-violet-500/15'
                    : 'border-zinc-700 bg-zinc-950/40 hover:bg-zinc-900'
                }`}
              >
                <div className={`text-[11px] font-black uppercase tracking-widest ${selected ? 'text-violet-100' : 'text-zinc-200'}`}>
                  {m.label}
                </div>
                <div className="mt-0.5 text-[10px] font-bold text-zinc-400">{m.blurb}</div>
              </button>
            )
          })}
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[11px] font-bold text-zinc-300">
        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} disabled={busy} />
        Share publicly (counts toward your 10-public cap)
      </label>

      {error && (
        <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-200">{error}</div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => onSubmit({ name: name.trim(), color, isPublic, memberIds, mode: transitionMode })}
          disabled={busy || !valid}
          className="rounded-md border border-violet-400/60 bg-violet-600 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '…' : (mode === 'create' ? 'Create' : 'Save lineup')}
        </button>
      </div>
    </div>
  )
}

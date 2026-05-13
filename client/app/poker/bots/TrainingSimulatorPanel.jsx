'use client'

import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { ProfileAvatar } from '../../components/ProfileSelector'

// Quick-pick presets so the user doesn't have to type a number — most
// useful values fall into one of these buckets and they cap below the
// server's 5000-hand limit. The free-text input remains for custom
// values inside the same range.
const HAND_PRESETS = [10, 50, 100, 500, 1000, 2000]

// Tiny pill button for picking a bot off the roster strip. The same
// True for any policy in the MLP family — the original 1×8 plus the
// deep-MLP architecture variants (1×16, 1×32, 2×16, 2×32, 3×16). Used
// by the picker to bucket MLP bots into their own subsection and by
// the pill badge to render an MLP-specific tag. Mirrors the kind list
// in server/src/bots/neural/registry.js (sans the non-MLP entries).
function isMlpFamily(bot) {
  if (!bot?.isNeural) return false
  const k = bot.neuralKind || ''
  return k === 'mlp' || k.startsWith('mlp_')
}

// Compact architecture badge text for an MLP bot — turns the policy
// kind into a one-line shape: "MLP 1×8", "MLP 2×32", etc.
function mlpArchLabel(kind) {
  switch (kind) {
    case 'mlp':       return 'MLP 1×8'
    case 'mlp_16':    return 'MLP 1×16'
    case 'mlp_32':    return 'MLP 1×32'
    case 'mlp_2x16':  return 'MLP 2×16'
    case 'mlp_2x32':  return 'MLP 2×32'
    case 'mlp_3x16':  return 'MLP 3×16'
    default:          return 'MLP'
  }
}

// Tag for the non-MLP neural kinds — keeps them visually distinct
// from the MLP family so users can scan the picker at a glance.
function nonMlpNeuralLabel(kind) {
  switch (kind) {
    case 'reinforce':           return 'PG'
    case 'reinforce_baseline':  return 'PG+BL'
    case 'qlearning':           return 'Q-LRN'
    default:                    return 'NN'
  }
}

// component is used for "available" + "selected" rows; `selected` flips
// the colour scheme.
function BotPill({ bot, selected, disabled, onToggle, ownerLabel }) {
  const mlp = isMlpFamily(bot)
  return (
    <button
      type="button"
      onClick={() => onToggle(bot)}
      disabled={disabled}
      title={`${bot.name} · ELO ${bot.elo ?? '—'}${ownerLabel ? ` · ${ownerLabel}` : ''}`}
      className={`flex items-center gap-2 rounded-full border px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
          : 'border-zinc-600/60 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700/80'
      }`}
    >
      <ProfileAvatar
        avatarUrl={bot.avatarUrl}
        name={bot.name}
        nameKey={bot.id}
        size={20}
      />
      <span className="max-w-[14ch] truncate">{bot.name}</span>
      <span className="text-[10px] text-zinc-400">{bot.elo ?? '—'}</span>
      {/* MLP family gets a purple architecture chip with the layer
          shape, so a "1×8" baseline reads visibly different from a
          "2×32" deep variant. Non-MLP neural kinds (REINFORCE, Q-
          learning) get a smaller cyan algorithm chip. */}
      {mlp && (
        <span className="rounded bg-purple-500/25 px-1 text-[9px] font-black uppercase tracking-wider text-purple-100">
          {mlpArchLabel(bot.neuralKind)}
        </span>
      )}
      {bot.isNeural && !mlp && (
        <span className="rounded bg-cyan-500/20 px-1 text-[9px] font-black uppercase tracking-wider text-cyan-200">
          {nonMlpNeuralLabel(bot.neuralKind)}
        </span>
      )}
      {bot.isClone && (
        <span className="rounded bg-fuchsia-500/20 px-1 text-[9px] font-black uppercase tracking-wider text-fuchsia-200">Clone</span>
      )}
      {bot.isSuper && (
        <span className="rounded bg-amber-500/20 px-1 text-[9px] font-black uppercase tracking-wider text-amber-200">Super</span>
      )}
    </button>
  )
}

// Pretty +/- chip for an ELO delta. Used in the results table.
function EloDelta({ value }) {
  if (!Number.isFinite(value)) return <span className="text-zinc-500">—</span>
  if (value === 0) return <span className="text-zinc-400">±0</span>
  return (
    <span className={value > 0 ? 'text-emerald-300' : 'text-red-300'}>
      {value > 0 ? '+' : ''}{value}
    </span>
  )
}

function ChipsDelta({ value }) {
  if (!Number.isFinite(value)) return <span className="text-zinc-500">—</span>
  if (value === 0) return <span className="text-zinc-400">$0</span>
  return (
    <span className={value > 0 ? 'text-emerald-300' : 'text-red-300'}>
      {value > 0 ? '+$' : '−$'}{Math.abs(value).toLocaleString()}
    </span>
  )
}

// Action labels mirror server/src/bots/neural/shared.js ACTION_NAMES.
// Index 0..5 correspond to: fold, check, call, raise small, raise pot,
// all_in. Used to render the neural action distribution before/after.
const ACTION_LABELS = ['fold', 'check', 'call', 'raise sm', 'raise pot', 'all-in']

function fmtNum(n, digits = 2) {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

// Inline SVG sparkline of a bot's cumulative chips P/L across the hands
// it played. Zero-line is drawn so green-vs-red regions are visible at
// a glance. Width is responsive via viewBox + width="100%" so the same
// component fits both narrow detail panels and the full-width chart in
// the expanded view. No external chart library — the geometry is tiny
// (one polyline + a horizontal rule).
function ChipsSparkline({ cumulative, height = 56 }) {
  // Fixed internal coordinate system; the surrounding container scales
  // it to the available width.
  const VB_W = 600
  const VB_H = height
  if (!Array.isArray(cumulative) || cumulative.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-zinc-800/70 bg-zinc-950/60 text-[10px] font-bold text-zinc-600"
        style={{ height }}
      >
        No hands played
      </div>
    )
  }
  const n = cumulative.length
  const maxAbs = Math.max(1, ...cumulative.map(v => Math.abs(v)))
  // Pad y-axis 10% so the line never touches the top/bottom edges.
  const yScale = (v) => {
    const pct = v / maxAbs
    return VB_H / 2 - pct * (VB_H / 2 - 4)
  }
  const xScale = (i) => n === 1 ? VB_W / 2 : (i / (n - 1)) * VB_W
  const last = cumulative[n - 1]
  const points = cumulative.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ')
  const lineColor = last > 0 ? '#34d399' : last < 0 ? '#fca5a5' : '#a1a1aa'
  const fillColor = last > 0 ? 'rgba(52,211,153,0.15)' : last < 0 ? 'rgba(252,165,165,0.15)' : 'rgba(161,161,170,0.1)'
  const areaPoints = `0,${(VB_H / 2).toFixed(1)} ${points} ${VB_W.toFixed(1)},${(VB_H / 2).toFixed(1)}`
  return (
    <svg
      role="img"
      aria-label={`Cumulative chips over ${n} hands, final ${last}`}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className="block"
    >
      {/* Zero line so the user can see when the bot crossed into
          positive vs negative territory during the run. */}
      <line x1="0" y1={VB_H / 2} x2={VB_W} y2={VB_H / 2}
        stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke" />
      <polygon points={areaPoints} fill={fillColor} />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

// One row of the before/after table. `kind` styles whether the value
// went up, down, or stayed the same. `better` overrides the direction
// for cases where lower is better (none of the current metrics use this
// yet, but it keeps the API symmetric).
function CompareRow({ label, before, after, fmt = (v) => v, betterIsHigher = true, neutral = false }) {
  const beforeStr = before == null ? '—' : fmt(before)
  const afterStr = after == null ? '—' : fmt(after)
  let dirClass = 'text-zinc-300'
  if (!neutral && Number.isFinite(before) && Number.isFinite(after) && before !== after) {
    const improved = betterIsHigher ? after > before : after < before
    dirClass = improved ? 'text-emerald-300' : 'text-red-300'
  }
  return (
    <tr className="border-b border-zinc-800/40 last:border-b-0">
      <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</td>
      <td className="py-1 pr-2 text-right tabular-nums text-zinc-200">{beforeStr}</td>
      <td className="py-1 pr-2 text-right text-zinc-600" aria-hidden="true">→</td>
      <td className={`py-1 pr-2 text-right tabular-nums font-bold ${dirClass}`}>{afterStr}</td>
    </tr>
  )
}

// Tiny inline bar showing the distribution of `counts` across the 6
// action indices. Used to render before/after action mix side-by-side
// inside the neural details strip.
function ActionMix({ counts, label }) {
  const safe = Array.isArray(counts) ? counts : []
  const total = safe.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0)
  return (
    <div className="flex-1 min-w-0">
      <div className="mb-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="flex items-end gap-0.5 h-8">
        {ACTION_LABELS.map((name, i) => {
          const c = safe[i] || 0
          const pct = total > 0 ? c / total : 0
          // Color-code by action class so before/after bars are visually
          // identifiable across the two mini-charts.
          const fill = i === 0 ? 'bg-zinc-500'
            : i === 1 ? 'bg-slate-400'
            : i === 2 ? 'bg-sky-400'
            : i === 3 ? 'bg-amber-400'
            : i === 4 ? 'bg-orange-400'
            : 'bg-rose-500'
          return (
            <div key={name} className="flex-1 flex flex-col items-center gap-0.5" title={`${name}: ${c} (${(pct * 100).toFixed(1)}%)`}>
              <div className="w-full flex-1 flex items-end">
                <div className={`w-full ${fill} rounded-sm transition-all`} style={{ height: `${Math.max(2, pct * 100)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-0.5 flex gap-0.5 text-[7px] font-bold text-zinc-600">
        {ACTION_LABELS.map((name) => (
          <div key={name} className="flex-1 text-center truncate">{name}</div>
        ))}
      </div>
    </div>
  )
}

// Big number card with a label, value, and optional delta. Used as the
// four top-of-panel summary tiles when a bot row is expanded.
function StatTile({ label, value, delta, deltaIsCurrency = false, tone = 'neutral', subline }) {
  const toneClass = tone === 'pos' ? 'text-emerald-200'
    : tone === 'neg' ? 'text-red-200'
    : 'text-white'
  return (
    <div className="rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2.5">
      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-base font-black tabular-nums ${toneClass}`}>{value}</div>
      {(delta != null || subline) && (
        <div className="mt-0.5 text-[10px] font-bold text-zinc-400">
          {delta != null && (
            deltaIsCurrency
              ? <ChipsDelta value={delta} />
              : <EloDelta value={delta} />
          )}
          {subline && <span className={delta != null ? 'ml-1' : ''}>{subline}</span>}
        </div>
      )}
    </div>
  )
}

// Full before/after breakdown for one participant. Lives inside the
// expanded results row. Built around four glanceable top-of-panel
// tiles (Final ELO, P/L, Win rate, Hands), a full-width cumulative
// chips chart, then two compact tables (lifetime + sim contribution),
// and — for neural bots — a dedicated training panel with action
// distribution before/after.
function CompareDetails({ participant }) {
  const { before, after, sim, isNeural, neuralKind } = participant
  const winRate = sim.handsPlayed > 0 ? sim.handsWon / sim.handsPlayed : 0
  const sdRate = sim.showdowns > 0 ? sim.showdownsWon / sim.showdowns : null
  const avgPerHand = sim.handsPlayed > 0 ? Math.round(sim.chipsPL / sim.handsPlayed) : 0
  return (
    <div className="flex flex-col gap-3">
      {/* ── Top tiles: the four headline numbers ─────────────────── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile
          label="ELO"
          value={after.elo.toLocaleString()}
          delta={participant.eloChange}
          subline={`from ${before.elo.toLocaleString()}`}
        />
        <StatTile
          label="Sim chips P/L"
          value={(sim.chipsPL >= 0 ? '+$' : '−$') + Math.abs(sim.chipsPL).toLocaleString()}
          tone={sim.chipsPL > 0 ? 'pos' : sim.chipsPL < 0 ? 'neg' : 'neutral'}
          subline={`avg ${avgPerHand >= 0 ? '+' : '−'}$${Math.abs(avgPerHand).toLocaleString()}/hand`}
        />
        <StatTile
          label="Win rate"
          value={`${(winRate * 100).toFixed(1)}%`}
          subline={sdRate != null ? `${sim.showdownsWon}/${sim.showdowns} showdowns won` : `${sim.handsWon}/${sim.handsPlayed} hands`}
        />
        <StatTile
          label="Hands played"
          value={sim.handsPlayed.toLocaleString()}
          subline={`${sim.handsVoluntary} voluntary · ${sim.bluffWins} bluff-wins`}
        />
      </div>

      {/* ── Cumulative chips sparkline ───────────────────────────── */}
      {sim.chipsCumulative?.length > 0 && (
        <div className="rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2.5">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
              Cumulative chips P/L
            </div>
            <div className="text-[9px] font-bold text-zinc-600">
              Each hand: 1,000-chip start · no carry-over
            </div>
          </div>
          <div className="mt-1">
            <ChipsSparkline cumulative={sim.chipsCumulative} height={72} />
          </div>
          <div className="mt-1 flex items-baseline justify-between text-[10px] font-bold">
            <span className="text-zinc-500">hand 1</span>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-emerald-300">peak +${Math.max(0, sim.chipsMax ?? 0).toLocaleString()}</span>
              <span className="text-zinc-700">·</span>
              <span className="text-red-300">trough −${Math.abs(Math.min(0, sim.chipsMin ?? 0)).toLocaleString()}</span>
            </div>
            <span className="text-zinc-500">hand {sim.handsPlayed}</span>
          </div>
        </div>
      )}

      {/* ── Two-column: lifetime / sim contribution ──────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2.5">
          <div className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Lifetime stats · before → after
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <CompareRow label="Hands played" before={before.handsPlayed} after={after.handsPlayed} fmt={(v) => v.toLocaleString()} neutral />
              <CompareRow label="Hands won" before={before.handsWon} after={after.handsWon} fmt={(v) => v.toLocaleString()} />
              <CompareRow label="Voluntary" before={before.handsVoluntary} after={after.handsVoluntary} fmt={(v) => v.toLocaleString()} neutral />
              <CompareRow label="Showdowns" before={before.showdownsPlayed} after={after.showdownsPlayed} fmt={(v) => v.toLocaleString()} neutral />
              <CompareRow label="Showdowns won" before={before.showdownsWon} after={after.showdownsWon} fmt={(v) => v.toLocaleString()} />
              <CompareRow label="Bluff wins" before={before.bluffWins} after={after.bluffWins} fmt={(v) => v.toLocaleString()} />
            </tbody>
          </table>
        </div>

        <div className="rounded-md border border-zinc-700/60 bg-zinc-950/50 p-2.5">
          <div className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400">
            This run only
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Hands played</td>
                <td className="py-1 text-right tabular-nums text-zinc-200">{sim.handsPlayed.toLocaleString()}</td>
              </tr>
              <tr className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Hands won</td>
                <td className="py-1 text-right tabular-nums text-zinc-200">{sim.handsWon} <span className="text-zinc-500">({(winRate * 100).toFixed(1)}%)</span></td>
              </tr>
              <tr className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Voluntary</td>
                <td className="py-1 text-right tabular-nums text-zinc-200">{sim.handsVoluntary}</td>
              </tr>
              <tr className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Showdowns</td>
                <td className="py-1 text-right tabular-nums text-zinc-200">{sim.showdowns} <span className="text-zinc-500">({sim.showdowns > 0 ? (sim.showdownsWon / sim.showdowns * 100).toFixed(1) : 0}% won)</span></td>
              </tr>
              <tr className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Bluff wins</td>
                <td className="py-1 text-right tabular-nums text-zinc-200">{sim.bluffWins}</td>
              </tr>
              <tr className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Cumulative P/L</td>
                <td className="py-1 text-right tabular-nums"><ChipsDelta value={sim.chipsPL} /></td>
              </tr>
              <tr>
                <td className="py-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Per-hand avg</td>
                <td className="py-1 text-right tabular-nums"><ChipsDelta value={avgPerHand} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Neural training metrics ──────────────────────────────── */}
      {isNeural && before.neural && after.neural && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-200">
              Neural training
              <span className="rounded bg-cyan-500/20 px-1 py-0.5 text-[8px] tracking-wider text-cyan-100">
                {neuralKind?.replace(/_/g, ' ') || 'reinforce'}
              </span>
            </div>
            <div className="text-[10px] font-bold text-cyan-300/80">
              {after.neural.handsTrained - before.neural.handsTrained > 0
                ? `+${after.neural.handsTrained - before.neural.handsTrained} training steps`
                : 'No training steps applied'}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                Training metrics · before → after
              </div>
              <table className="w-full text-[11px]">
                <tbody>
                  <CompareRow label="Hands trained" before={before.neural.handsTrained} after={after.neural.handsTrained} fmt={(v) => v.toLocaleString()} />
                  <CompareRow label="Mean |weight|" before={before.neural.weightMagnitude} after={after.neural.weightMagnitude} fmt={(v) => fmtNum(v, 3)} neutral />
                  <CompareRow label="Max |weight|" before={before.neural.weightMaxAbs} after={after.neural.weightMaxAbs} fmt={(v) => fmtNum(v, 3)} neutral />
                  <CompareRow label="Mean reward" before={before.neural.meanReward} after={after.neural.meanReward} fmt={(v) => (v >= 0 ? '+' : '') + fmtNum(v, 3)} />
                  <CompareRow label="Reward samples" before={before.neural.rewardHistoryLength} after={after.neural.rewardHistoryLength} fmt={(v) => v.toLocaleString()} neutral />
                </tbody>
              </table>
            </div>
            <div>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                Action distribution
              </div>
              <div className="flex gap-3">
                <ActionMix counts={before.neural.actionCounts} label="Before" />
                <ActionMix counts={after.neural.actionCounts} label="After" />
              </div>
              <div className="mt-1.5 text-[10px] font-bold text-zinc-500">
                The two charts show how often the policy picked each action — before training (cumulative lifetime) vs after. Differences mean the gradient is steering the bot toward different action mixes.
              </div>
            </div>
          </div>
        </div>
      )}

      {!isNeural && (
        <div className="rounded-md border border-zinc-700/40 bg-zinc-950/30 p-2 text-[10px] font-bold text-zinc-500">
          Rule bots have no trainable weights — their decision function is the JS code they were created with. ELO + lifetime hand counts still update from this run.
        </div>
      )}
    </div>
  )
}

// Splits a flat bot list into three category strips — MLP family,
// other neural kinds (REINFORCE / Q-learning / etc.), then everything
// else (rule bots, clones, super) — each with its own header so users
// can scan "where are my MLP bots?" at a glance. Only renders a
// subgroup if it has at least one bot.
function BotGroupedPills({ bots, selectedIds, selectedCount, onToggle, showOwnerLabel = false }) {
  const groups = useMemo(() => {
    const mlp = []
    const otherNeural = []
    const rest = []
    for (const b of bots) {
      if (isMlpFamily(b)) mlp.push(b)
      else if (b.isNeural) otherNeural.push(b)
      else rest.push(b)
    }
    return { mlp, otherNeural, rest }
  }, [bots])

  const subgroups = [
    { key: 'mlp',    bots: groups.mlp,         label: 'MLP family',    accent: 'text-purple-200' },
    { key: 'neural', bots: groups.otherNeural, label: 'Other neural',  accent: 'text-cyan-200' },
    { key: 'rest',   bots: groups.rest,        label: 'Rule + super',  accent: 'text-zinc-400' }
  ].filter(g => g.bots.length > 0)

  if (subgroups.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {subgroups.map(g => (
        <div key={g.key}>
          <div className={`mb-1 text-[8px] font-black uppercase tracking-widest ${g.accent}`}>
            {g.label}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.bots.map(b => (
              <BotPill
                key={b.id}
                bot={b}
                selected={selectedIds.includes(b.id)}
                disabled={!selectedIds.includes(b.id) && selectedCount >= 5}
                onToggle={onToggle}
                ownerLabel={showOwnerLabel && b.ownerDisplayName ? `by ${b.ownerDisplayName}` : null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Headless training simulator. Pick 2–5 participants from your own
// bots + the public roster, choose a hand count, and run. The server
// plays them at native speed (no THINK_DELAY, no broadcasts) and returns
// per-bot stats. For your own neural bots you can opt to persist the
// trained weights — same training step the live arena uses, just much
// faster.
export default function TrainingSimulatorPanel({ myBots = [], publicBots = [], onPersistResult }) {
  // Selected participants. Keyed by id; order is the seating order at
  // the simulated table (preserved when toggling).
  const [selectedIds, setSelectedIds] = useState([])
  const [numHands, setNumHands] = useState(100)
  const [persistTraining, setPersistTraining] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  // Per-bot expanded state — clicking a result row toggles the
  // before/after detail panel underneath it. Multiple rows can be open
  // at once so users can eyeball two bots side-by-side.
  const [expandedIds, setExpandedIds] = useState(new Set())

  // Merge the user's own bots with public bots — own bots always come
  // first so the picker reads "my bots → public bots". Public bots that
  // are ALSO in `myBots` (i.e., your own public bots) are deduped to
  // avoid double entries. Memoized because both lists can be big.
  const { ownedBots, publicOnly, byId } = useMemo(() => {
    const mineIds = new Set(myBots.map(b => b.id))
    const publicOnly = publicBots.filter(b => !mineIds.has(b.id))
    const byId = new Map()
    for (const b of myBots) byId.set(b.id, { ...b, _owned: true })
    for (const b of publicOnly) byId.set(b.id, { ...b, _owned: false })
    return { ownedBots: myBots, publicOnly, byId }
  }, [myBots, publicBots])

  const selected = selectedIds.map(id => byId.get(id)).filter(Boolean)
  // Any owned bot — not just neural — has persistable stats now. Rule
  // bots, clones, and super bots all get ELO + hand history written
  // when persistTraining is on. Neural bots additionally get their
  // weights saved.
  const ownedSelected = selected.filter(b => b._owned)
  const ownedNeuralSelected = ownedSelected.filter(b => b.isNeural)
  const canRun = selected.length >= 2 && selected.length <= 5 && numHands >= 1 && numHands <= 5000 && !busy

  function toggle(bot) {
    setSelectedIds(prev => {
      if (prev.includes(bot.id)) return prev.filter(x => x !== bot.id)
      if (prev.length >= 5) return prev
      return [...prev, bot.id]
    })
    // Any change invalidates the previous run's result so the user
    // doesn't read stale numbers against a new lineup.
    setResult(null)
  }

  async function run() {
    setBusy(true); setError(null); setResult(null); setExpandedIds(new Set())
    try {
      const out = await api.simulateBots({
        botIds: selectedIds,
        numHands,
        // Persist when the user wants to AND there's at least one
        // owned bot to write to (otherwise the flag has no effect).
        persistTraining: persistTraining && ownedSelected.length > 0
      })
      setResult(out)
      // All bot rows start collapsed. Users open whichever bots they
      // actually care to inspect — a 5-bot run with everything open by
      // default was a wall of charts.
      // Tell the parent so it can refresh /mine — ELO + training counters
      // moved server-side, the bot list cache needs to drop.
      if (out.persisted) onPersistResult?.()
    } catch (err) {
      setError(err.detail || err.message || 'Simulation failed.')
    } finally { setBusy(false) }
  }

  function toggleExpanded(botId) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(botId)) next.delete(botId)
      else next.add(botId)
      return next
    })
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-4 shadow-lg">
      <div>
        <div className="text-sm font-black text-white">Headless Training Simulator</div>
        <div className="mt-0.5 text-[11px] font-bold text-zinc-400">
          Pit 2–5 bots head-to-head at native speed. Every hand starts each bot with <span className="text-amber-200">1,000 chips</span> (equal footing), and the running chip P/L is summed across all hands — no rich-get-richer carry-over. Hands count for ELO and (optionally) train your neural bots.
        </div>
      </div>

      {/* ─── Participant picker ─────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
          <span>Participants ({selected.length}/5)</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => { setSelectedIds([]); setResult(null) }}
              className="text-zinc-500 hover:text-zinc-200"
            >
              Clear
            </button>
          )}
        </div>

        {ownedBots.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            <div className="text-[9px] font-black uppercase tracking-widest text-emerald-200">Your bots</div>
            <BotGroupedPills
              bots={ownedBots}
              selectedIds={selectedIds}
              selectedCount={selected.length}
              onToggle={toggle}
            />
          </div>
        )}

        {publicOnly.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Public roster</div>
            <div className="max-h-44 overflow-y-auto pr-1">
              <BotGroupedPills
                bots={publicOnly}
                selectedIds={selectedIds}
                selectedCount={selected.length}
                onToggle={toggle}
                showOwnerLabel
              />
            </div>
          </div>
        )}

        {ownedBots.length === 0 && publicOnly.length === 0 && (
          <div className="rounded-md border border-zinc-700/70 bg-zinc-950/40 p-3 text-center text-[11px] font-bold text-zinc-500">
            No bots available yet. Create one or browse the public roster first.
          </div>
        )}
      </div>

      {/* ─── Hand count ─────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400">Hands</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {HAND_PRESETS.map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setNumHands(n)}
              className={`rounded-md border px-2.5 py-1 text-xs font-black transition-colors ${
                numHands === n
                  ? 'border-amber-400/70 bg-amber-500/20 text-amber-100'
                  : 'border-zinc-600/60 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {n.toLocaleString()}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={5000}
            value={numHands}
            onChange={(e) => {
              const v = Math.max(1, Math.min(5000, Math.floor(Number(e.target.value) || 0)))
              setNumHands(v)
            }}
            className="w-20 rounded-md border border-zinc-600/60 bg-zinc-900/60 px-2 py-1 text-center text-xs font-black text-white outline-none focus:border-amber-300"
          />
        </div>
      </div>

      {/* ─── Save-to-my-bots toggle ─────────────────────────────── */}
      <label className={`flex items-center gap-2 ${ownedSelected.length === 0 ? 'opacity-50' : ''}`}>
        <input
          type="checkbox"
          checked={persistTraining}
          disabled={ownedSelected.length === 0}
          onChange={(e) => setPersistTraining(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-cyan-400 disabled:cursor-not-allowed"
        />
        <span className="text-xs font-bold text-white">
          Save results to my bots
          {ownedSelected.length > 0 && (
            <span className="ml-1 text-[10px] font-bold text-cyan-200">
              ({ownedSelected.length} of your bot{ownedSelected.length === 1 ? '' : 's'} to update
              {ownedNeuralSelected.length > 0 && `, ${ownedNeuralSelected.length} of which train weights`})
            </span>
          )}
        </span>
      </label>
      <div className="-mt-2 text-[10px] font-bold text-zinc-500">
        Every one of your own bots (rule, clone, super, neural) gets ELO + hand-history writes. Neural bots additionally get their trained weights saved. Public / non-owned bots are played but never mutated.
      </div>

      {/* ─── Run button ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className="w-full rounded-lg border border-amber-400/60 bg-amber-500/15 py-3 text-sm font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Simulating…' : `▶ Run ${numHands.toLocaleString()} hand${numHands === 1 ? '' : 's'}`}
      </button>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs font-bold text-rose-200">
          {error}
        </div>
      )}

      {/* ─── Results table with expandable before/after detail ──── */}
      {result && (
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              Results · {result.handsCompleted}/{result.handsRequested} hands · {(result.elapsedMs / 1000).toFixed(2)}s
            </div>
            <div className="flex items-center gap-2">
              {result.persisted && (
                <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-cyan-200">
                  Saved to DB
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  // Toggle: if anything is open, collapse all; otherwise
                  // open every row at once.
                  if (expandedIds.size > 0) setExpandedIds(new Set())
                  else setExpandedIds(new Set(result.participants.map(p => p.botId)))
                }}
                className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white"
              >
                {expandedIds.size > 0 ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {/* Sort by chipsPL desc so the leaderboard reads top-down. */}
            {[...result.participants].sort((a, b) => b.sim.chipsPL - a.sim.chipsPL).map((p, rank) => {
              const isOpen = expandedIds.has(p.botId)
              const winRate = p.sim.handsPlayed > 0 ? p.sim.handsWon / p.sim.handsPlayed : 0
              return (
                <div key={p.botId} className="overflow-hidden rounded-md border border-zinc-800/80 bg-zinc-900/60">
                  {/* Headline row — collapsed by default. Two columns:
                        LEFT: rank chip + bot name + neural-kind chip
                        RIGHT: ELO transition + chips P/L (the two
                               numbers that matter most at a glance)
                      Everything else lives behind the expand toggle. */}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(p.botId)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/40"
                    aria-expanded={isOpen}
                  >
                    <span
                      aria-hidden="true"
                      className={`shrink-0 text-[10px] text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    >▶</span>
                    <span className={`shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-black ${
                      rank === 0 ? 'bg-amber-500/20 text-amber-200'
                        : rank === 1 ? 'bg-zinc-500/20 text-zinc-200'
                        : rank === 2 ? 'bg-orange-700/30 text-orange-200'
                        : 'bg-zinc-800/60 text-zinc-500'
                    }`}>{rank + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-black text-white">{p.name}</span>
                    {/* MLP-family bots get the same purple architecture
                        chip used in the picker (MLP 1×16, MLP 2×32, …)
                        so the leaderboard reads consistently with the
                        bot selection above. Non-MLP neural kinds get
                        the smaller cyan algorithm chip (PG / PG+BL /
                        Q-LRN). */}
                    {isMlpFamily(p) && (
                      <span className="shrink-0 rounded bg-purple-500/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-purple-100">
                        {mlpArchLabel(p.neuralKind)}
                      </span>
                    )}
                    {p.isNeural && !isMlpFamily(p) && (
                      <span className="shrink-0 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-200">
                        {nonMlpNeuralLabel(p.neuralKind)}
                      </span>
                    )}
                    <div className="flex shrink-0 items-baseline gap-1 text-[11px] tabular-nums">
                      <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500">ELO</span>
                      <span className="text-zinc-400">{p.eloBefore}</span>
                      <span className="text-zinc-600">→</span>
                      <span className="font-bold text-white">{p.eloAfter}</span>
                      <span className="ml-0.5"><EloDelta value={p.eloChange} /></span>
                    </div>
                    <div className="hidden text-zinc-700 sm:inline">·</div>
                    <div className="shrink-0 text-[11px] tabular-nums"><ChipsDelta value={p.sim.chipsPL} /></div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-zinc-800/80 bg-zinc-950/30 p-3">
                      <CompareDetails participant={p} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-2 text-[10px] font-bold text-zinc-500">
            ELO updates compound hand-by-hand inside the run — the same way live games would. Every hand starts each bot at 1,000 chips (no carry-over), so the cumulative P/L below is the bot's signed running total of chips won across this many hands. Click a row for the before/after breakdown.
          </div>
        </div>
      )}
    </div>
  )
}

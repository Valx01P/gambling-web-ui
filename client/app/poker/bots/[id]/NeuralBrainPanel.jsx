'use client'

import { useMemo, useState } from 'react'
import ConfirmPopoverButton from '../../../components/ConfirmPopoverButton'
import { api } from '../../../lib/api'

// Mirrors server/src/bots/neural/shared.js. Duplicated rather than
// imported so the client doesn't pull a server module.
const FEATURE_NAMES = [
  'bias',
  'preflop', 'flop', 'turn', 'river',
  'equity', 'potOdds', 'spr', 'stackBB',
  'position', 'opponents',
  'facingBet', 'facingRaise', 'aggression', 'commit'
]
const ACTION_NAMES = ['fold', 'check', 'call', 'raise_min', 'raise_pot', 'raise_allin']

// Per-variant LR + ε schedules. Mirror the server constants — change in
// both places. (We could ship these from the server but the values are
// static and the client never edits them.)
const VARIANT_META = {
  reinforce:          { label: 'REINFORCE',           lrInit: 0.05, lrDecay: 400 },
  reinforce_baseline: { label: 'REINFORCE + baseline', lrInit: 0.05, lrDecay: 400 },
  mlp:                { label: 'MLP (1 hidden)',       lrInit: 0.03, lrDecay: 500 },
  qlearning:          { label: 'Q-learning · ε-greedy', lrInit: 0.08, lrDecay: 400, epsInit: 0.4, epsMin: 0.05, epsDecay: 300 }
}

function currentLR(kind, handsTrained) {
  const m = VARIANT_META[kind] || VARIANT_META.reinforce
  return m.lrInit / (1 + (handsTrained || 0) / m.lrDecay)
}
function currentEpsilon(handsTrained) {
  const m = VARIANT_META.qlearning
  return Math.max(m.epsMin, m.epsInit / (1 + (handsTrained || 0) / m.epsDecay))
}

function fmt(x, digits = 3) {
  if (!Number.isFinite(x)) return '—'
  return x.toFixed(digits)
}

function RewardSparkline({ rewards, width = 220, height = 40 }) {
  if (!rewards || rewards.length === 0) {
    return <div className="text-[10px] text-zinc-500">No hands played yet.</div>
  }
  const max = Math.max(0.05, ...rewards.map(Math.abs))
  const stepX = rewards.length > 1 ? width / (rewards.length - 1) : width
  const midY = height / 2
  const pts = rewards.map((r, i) => {
    const x = i * stepX
    const y = midY - (r / max) * (height / 2 - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} className="block">
      <line x1={0} y1={midY} x2={width} y2={midY} stroke="#3f3f46" strokeDasharray="2 3" />
      <polyline fill="none" stroke="#22d3ee" strokeWidth="1.5" points={pts} />
    </svg>
  )
}

function WeightCell({ value, maxAbs }) {
  const norm = maxAbs > 0 ? value / maxAbs : 0
  const clamped = Math.max(-1, Math.min(1, norm))
  const alpha = Math.min(0.85, Math.abs(clamped) * 0.85 + 0.1)
  const bg = clamped >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`
  return (
    <td
      className="border border-zinc-800 px-1.5 py-1 text-center font-mono text-[10px] text-white"
      style={{ background: bg }}
      title={value.toFixed(4)}
    >
      {value >= 0 ? '+' : ''}{value.toFixed(2)}
    </td>
  )
}

function matrixMaxAbs(matrix) {
  if (!Array.isArray(matrix)) return 0
  let m = 0
  for (const row of matrix) {
    if (!Array.isArray(row)) continue
    for (const v of row) if (Math.abs(v) > m) m = Math.abs(v)
  }
  return m
}

function WeightsTable({ matrix, rowLabels, colLabels, label }) {
  const maxAbs = useMemo(() => matrixMaxAbs(matrix), [matrix])
  if (!Array.isArray(matrix) || matrix.length === 0) return null
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
        {label}
      </div>
      <div className="overflow-x-auto">
        <table className="text-[10px]">
          <thead>
            <tr>
              <th className="px-1.5 py-1 text-left text-zinc-500"></th>
              {colLabels.map((c, i) => (
                <th key={i} className="px-1.5 py-1 text-center font-bold text-zinc-400">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, r) => (
              <tr key={r}>
                <td className="px-2 py-1 font-bold text-zinc-300">{rowLabels[r] ?? r}</td>
                {row.map((v, c) => <WeightCell key={c} value={v} maxAbs={maxAbs} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function NeuralBrainPanel({ bot, onUpdated, isMine }) {
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState(null)

  const state = bot?.neuralState || null
  const kind = bot?.neuralKind || 'reinforce'
  const meta = VARIANT_META[kind] || VARIANT_META.reinforce
  const handsTrained = state?.handsTrained || 0
  const lr = currentLR(kind, handsTrained)
  const rewards = state?.rewardHistory || []
  const lastReward = rewards.length ? rewards[rewards.length - 1] : null
  const avgRecentReward = useMemo(() => {
    if (rewards.length === 0) return null
    const sum = rewards.reduce((a, b) => a + b, 0)
    return sum / rewards.length
  }, [rewards])

  const actionCounts = state?.actionCounts || []
  const totalActions = actionCounts.reduce((a, b) => a + b, 0)

  async function handleReset() {
    setResetting(true)
    setResetError(null)
    try {
      const { bot: updated } = await api.resetNeuralBot(bot.id)
      onUpdated?.(updated)
    } catch (err) {
      setResetError(err.detail || err.message || 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  if (!state) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">
        This bot has no neural state yet — play a hand to initialize.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/5 p-3">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
          Neural net · {meta.label}
        </div>
        <div className="mt-1 text-xs font-bold text-zinc-200">
          This bot learns from every hand it plays. Reward = chips won/lost as a
          fraction of its starting stack, clipped to ±1. Weights are updated
          server-side after each hand and persist between sessions.
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Hands trained</div>
          <div className="text-sm font-black text-white">{handsTrained}</div>
        </div>
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Learning rate</div>
          <div className="text-sm font-black text-white">{fmt(lr, 4)}</div>
        </div>
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Last reward</div>
          <div className={`text-sm font-black ${lastReward == null ? 'text-zinc-500' : lastReward >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {lastReward == null ? '—' : (lastReward >= 0 ? '+' : '') + lastReward.toFixed(3)}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Avg last {rewards.length || 0}</div>
          <div className={`text-sm font-black ${avgRecentReward == null ? 'text-zinc-500' : avgRecentReward >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {avgRecentReward == null ? '—' : (avgRecentReward >= 0 ? '+' : '') + avgRecentReward.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Variant-specific extras: baseline scalar for the variance-reduced
          REINFORCE, ε for the Q-learner. Both are interpretable scalars —
          rendering them as tiles helps the user understand what's driving
          the bot's behavior without having to read code. */}
      {kind === 'reinforce_baseline' && (
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Baseline (EMA of past rewards)</div>
          <div className={`text-sm font-black ${(state.baseline || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {((state.baseline || 0) >= 0 ? '+' : '') + (state.baseline || 0).toFixed(4)}
          </div>
        </div>
      )}
      {kind === 'qlearning' && (
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Exploration ε</div>
          <div className="text-sm font-black text-amber-300">{fmt(currentEpsilon(handsTrained), 3)}</div>
          <div className="mt-0.5 text-[10px] font-bold text-zinc-400">
            With probability ε the bot picks a random legal action; otherwise argmax Q. Decays as hands trained grows.
          </div>
        </div>
      )}

      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
          Reward history (last {rewards.length})
        </div>
        <RewardSparkline rewards={rewards} />
      </div>

      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
          Action mix (lifetime, {totalActions} decisions)
        </div>
        <div className="space-y-1">
          {ACTION_NAMES.map((name, i) => {
            const count = actionCounts[i] || 0
            const pct = totalActions > 0 ? count / totalActions : 0
            return (
              <div key={name} className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
                <div className="w-24 shrink-0 text-zinc-400">{name}</div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-800">
                  <div className="h-full bg-cyan-500/60" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
                </div>
                <div className="w-16 shrink-0 text-right text-zinc-500">{count} · {(pct * 100).toFixed(1)}%</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Weight matrices — shape depends on the variant. Single matrix for
          the linear policy bots (weights or Q values); MLP shows both
          hidden + output layers. */}
      {(kind === 'reinforce' || kind === 'reinforce_baseline') && (
        <WeightsTable
          matrix={state.weights}
          rowLabels={ACTION_NAMES}
          colLabels={FEATURE_NAMES}
          label="Weights (rows = actions, columns = features). Green = positive, red = negative."
        />
      )}
      {kind === 'qlearning' && (
        <WeightsTable
          matrix={state.q}
          rowLabels={ACTION_NAMES}
          colLabels={FEATURE_NAMES}
          label="Q-value weights (rows = actions, columns = features). Q(s,a) = Σ w·feature."
        />
      )}
      {kind === 'mlp' && (
        <>
          <WeightsTable
            matrix={state.w1}
            rowLabels={Array.from({ length: state.w1?.length || 0 }, (_, i) => `h${i}`)}
            colLabels={FEATURE_NAMES}
            label="Hidden layer W1 (rows = hidden units, columns = features). tanh(W1·x + b1)."
          />
          <WeightsTable
            matrix={state.w2}
            rowLabels={ACTION_NAMES}
            colLabels={Array.from({ length: state.w2?.[0]?.length || 0 }, (_, i) => `h${i}`)}
            label="Output layer W2 (rows = actions, columns = hidden units). logits = W2·h + b2."
          />
        </>
      )}

      {isMine && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/5 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-200">Reset weights</div>
              <div className="mt-0.5 text-xs font-bold text-zinc-200">
                Erases all learning and starts the policy over at random init.
              </div>
            </div>
            <ConfirmPopoverButton
              triggerLabel={resetting ? 'Resetting…' : 'Reset weights'}
              triggerClassName="shrink-0 rounded-md border border-rose-400/60 bg-rose-500/20 px-4 py-2 text-xs font-black uppercase tracking-widest text-rose-100 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
              description="Erases all training progress. Hands-trained returns to 0 and the LR resets to its initial value."
              confirmLabel="Reset"
              align="right"
              persistKey="pokerxyz:confirm:neural-reset:skip"
              busy={resetting}
              onConfirm={handleReset}
            />
          </div>
          {resetError && (
            <div className="mt-2 text-[11px] font-bold text-rose-300">{resetError}</div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import HomeBackLink from '../../components/HomeBackLink'
import AccountMenu from '../../components/AccountMenu'
import AuthGateModal from '../../components/AuthGateModal'
import ConfirmPopoverButton from '../../components/ConfirmPopoverButton'
import BotAvatar from '../../components/BotAvatar'
import { useAuth } from '../../lib/useAuth'
import { api } from '../../lib/api'
import { BOT_COLOR_PRESETS, isValidHex } from '../../lib/botColors'
import SuperBotForm from './SuperBotForm'
import TrainingSimulatorPanel from './TrainingSimulatorPanel'
import { infoForKind } from '../../lib/neuralVariants'

// Persist collapse/expand state per-section across reloads. The key is
// scoped under a single namespace so all of the page's sections share one
// place in localStorage — easy to wipe via the browser if it ever feels
// stuck. Default-open so first-time visitors see content.
function useCollapsed(key, defaultCollapsed = false) {
  const fullKey = `pokerxyz:bots:collapsed:${key}`
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return defaultCollapsed
    const raw = window.localStorage.getItem(fullKey)
    if (raw == null) return defaultCollapsed
    return raw === '1'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(fullKey, collapsed ? '1' : '0')
  }, [fullKey, collapsed])
  return [collapsed, setCollapsed]
}

// Section wrapper with a clickable header. Renders a chevron that flips,
// and hides the body when collapsed. The header is left intact (any
// existing summary chips / counters keep rendering) — we just wrap it.
function CollapsibleSection({ collapseKey, title, subtitle, headerRight, children, accent = 'zinc' }) {
  const [collapsed, setCollapsed] = useCollapsed(collapseKey, false)
  const borderClass = {
    zinc:   'border-zinc-600/50',
    amber:  'border-amber-500/30',
    cyan:   'border-cyan-400/30'
  }[accent] || 'border-zinc-600/50'
  return (
    <div className={`w-full rounded-xl border ${borderClass} bg-zinc-800/90 p-3 shadow-lg`}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
          aria-expanded={!collapsed}
        >
          <span className={`shrink-0 text-zinc-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden>▾</span>
          <div className="min-w-0">
            <div className="text-sm font-black text-white truncate">{title}</div>
            {subtitle && <div className="text-[10px] font-bold text-zinc-300 truncate">{subtitle}</div>}
          </div>
        </button>
        {headerRight && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="mt-3">
          {children}
        </div>
      )}
    </div>
  )
}

// Renders a single clone tier's slot in the My Bots shelf. Three states:
//   * built: existing bot — links to editor, shows ELO badge
//   * unlocked but not built: shows derived stats + Build button
//   * locked: progress meter ("3 more hands until v2")
function CloneSlot({ slot, onBuilt, onUpdated, autoBuild = false, onVisibilityError }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [visBusy, setVisBusy] = useState(false)
  const [error, setError] = useState(null)
  const [recalcOk, setRecalcOk] = useState(false)
  const [autoTriggered, setAutoTriggered] = useState(false)

  async function toggleVisibility() {
    if (!slot.built || !slot.botId) return
    setVisBusy(true)
    try {
      const { bot } = await api.updateBot(slot.botId, { isPublic: !slot.isPublic })
      onUpdated?.(bot)
    } catch (err) {
      onVisibilityError?.(err.detail || err.message || 'Visibility change failed')
    } finally {
      setVisBusy(false)
    }
  }

  async function build() {
    setBusy(true)
    setError(null)
    try {
      const { bot } = await api.buildMyBot(slot.tier)
      onBuilt?.(bot)
      router.push(`/poker/bots/${bot.id}`)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to build')
      setBusy(false)
    }
  }

  // In-place refresh for an existing clone. Same endpoint as the editor's
  // "Recalculate" button — surfaced here so users don't have to open the
  // bot to update it. The ConfirmPopoverButton wrapping it owns the
  // open/close + persist-skip flow; this is just the action it fires.
  async function recalc() {
    if (!slot.built) return
    setRecalcBusy(true)
    setError(null)
    try {
      const { bot } = await api.recalculateClone(slot.botId)
      onUpdated?.(bot)
      setRecalcOk(true)
      setTimeout(() => setRecalcOk(false), 2000)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to recalculate')
    } finally {
      setRecalcBusy(false)
    }
  }

  // Auto-build when the user lands here from the achievement toast
  // (?build=tierN). Guarded so a refresh doesn't re-fire.
  useEffect(() => {
    if (!autoBuild || autoTriggered) return
    if (slot.built || !slot.unlocked) return
    setAutoTriggered(true)
    build()
  }, [autoBuild, autoTriggered, slot])

  // --- Built clone — short row, links to editor + inline Recalc button.
  if (slot.built) {
    return (
      <div className="rounded-lg border border-amber-300/40 bg-amber-500/5 transition-colors hover:bg-amber-500/15">
        <div className="flex items-center gap-2 px-3 py-2">
          <Link href={`/poker/bots/${slot.botId}`} className="flex flex-1 items-center gap-2 min-w-0">
            <BotAvatar name={slot.name} color={slot.color} avatarUrl={slot.avatarUrl} size={28} />
            <div className="min-w-0">
              <div className="truncate text-xs font-black text-white">{slot.name}</div>
              <div className="truncate text-[10px] font-bold text-zinc-400">
                v{slot.tier} · {slot.hands} hands · {slot.isPublic ? 'public' : 'private'}
              </div>
            </div>
          </Link>
          <div className="shrink-0 flex items-center gap-2">
            <div className="text-right">
              <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">ELO</div>
              <div className="text-sm font-black text-amber-200 tabular-nums">{slot.elo}</div>
            </div>
            <button
              type="button"
              onClick={toggleVisibility}
              disabled={visBusy}
              title={slot.isPublic ? 'Public — anyone can sit. Click to make private.' : 'Private — only you can sit. Click to share.'}
              className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                slot.isPublic
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                  : 'border-zinc-600/60 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              {visBusy ? '…' : (slot.isPublic ? 'Public ✓' : 'Private')}
            </button>
            <ConfirmPopoverButton
              triggerLabel={recalcBusy ? 'Recalculating…' : recalcOk ? 'Recalculated ✓' : '↻ Recalculate'}
              triggerClassName="rounded-md border border-amber-400/50 bg-amber-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
              description={`Re-derives this clone's code, color, and ELO from your last ${slot.hands} hands. Overwrites your code edits; bot id stays the same.`}
              confirmLabel="Recalculate"
              align="right"
              persistKey="pokerxyz:confirm:clone-recalculate:skip"
              busy={recalcBusy}
              onConfirm={recalc}
            />
          </div>
        </div>
        {error && (
          <div className="mx-3 mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200">
            {error}
          </div>
        )}
      </div>
    )
  }

  // --- Unlocked but not built — show preview stats + Build button.
  if (slot.unlocked && slot.draft) {
    const p = slot.draft.profile || {}
    const pct = (n) => `${Math.round((n || 0) * 100)}%`
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-500/10 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-300">Available</div>
            <div className="text-xs font-black text-white">v{slot.tier} · {slot.draft.name}</div>
            <div className="text-[10px] font-bold text-zinc-300">
              {slot.draft.seedHandsAnalyzed} hands · {p.vpipStyle}/{p.aggStyle} · ELO {slot.draft.elo}
            </div>
          </div>
          <button
            type="button"
            onClick={build}
            disabled={busy}
            className="shrink-0 rounded-md border border-amber-400/60 bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
          >
            {busy ? 'Building…' : `Build v${slot.tier}`}
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1 text-[9px] font-bold text-zinc-300">
          <span>VPIP {pct(p.vpipRate)}</span>
          <span>PFR {pct(p.pfrRate)}</span>
          <span>cBet {pct(p.cBetFreq)}</span>
          <span>Open {Number(p.avgOpenSizeBB || 0).toFixed(1)}bb</span>
        </div>
        {error && (
          <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200">
            {error}
          </div>
        )}
      </div>
    )
  }

  // --- Locked — show progress to next threshold.
  const remaining = slot.handsRemaining ?? slot.hands
  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">Locked</div>
          <div className="text-xs font-black text-zinc-300">Clone v{slot.tier}</div>
          <div className="text-[10px] font-bold text-zinc-500">
            Play {remaining} more hand{remaining === 1 ? '' : 's'} to unlock ({slot.hands} total)
          </div>
        </div>
        <div className="shrink-0 text-[10px] font-bold text-zinc-500">v{slot.tier}</div>
      </div>
    </div>
  )
}

// 5-slot shelf at the top of the My Bots tab.
function PlayerCloneShelf({ user, onCreated, autoBuildTier = null, onVisibilityError, onResetError }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.previewMyBot()
      setPreview(data)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (user) reload() }, [user?.id])

  if (loading) {
    return (
      <CollapsibleSection
        collapseKey="clones"
        title="Your clone bots"
        subtitle="Reading your play data…"
        accent="amber"
      >
        <div className="text-xs font-bold text-amber-100">Loading…</div>
      </CollapsibleSection>
    )
  }
  if (!preview) return null

  // Built clones we can reset. Slots that haven't been generated yet
  // (locked / unlocked-but-not-built) have no botId to act on.
  const builtClones = (preview.tiers || [])
    .filter(t => t.built && t.botId)
    .map(t => ({
      id: t.botId,
      name: t.name,
      elo: t.elo ?? 500,
      // `t.hands` is the source data size for the tier — close enough
      // for the "N hands of history" summary. The actual reset wipes
      // the clone's lifetime ELO history, not the training data.
      stats: { handsPlayed: t.hands ?? 0 }
    }))

  return (
    <CollapsibleSection
      collapseKey="clones"
      title="Your clone bots"
      subtitle={`Five reserved slots — each one is more accurate, built from more of your hands. Played: ${preview.handsSeated ?? 0} hands.`}
      accent="amber"
      headerRight={builtClones.length > 0 && (
        <ResetAllStatsButton
          bots={builtClones}
          onUpdated={() => reload()}
          onError={onResetError || onVisibilityError}
          persistKey="bots:reset-all-clones-stats-confirmed"
          sectionLabel="of your clone bots"
        />
      )}
    >
      {error && (
        <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        {(preview.tiers || []).map((slot) => (
          <CloneSlot
            key={slot.tier}
            slot={slot}
            autoBuild={autoBuildTier === slot.tier}
            onBuilt={(bot) => {
              onCreated?.(bot)
              reload()
            }}
            onUpdated={() => {
              // Re-fetch the preview so the slot's ELO / name / public flag
              // reflect what the recalc returned. Cheap; preview is small.
              reload()
            }}
            onVisibilityError={onVisibilityError}
          />
        ))}
      </div>
    </CollapsibleSection>
  )
}

// Super-bot shelf — meta-bots that round-robin between 3-5 member
// bots. Cap of 2 per user. Source list comes from the page-level
// myBots fetch (filtered to isSuper).
function PlayerSuperShelf({ superBots, availableBots, onCreated, onUpdated, onVisibilityError, onDeleted, validationError, setValidationError }) {
  const SUPER_LIMIT = 2
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState(null)

  async function submit(form) {
    setBusy(true); setCreateError(null)
    try {
      const { bot } = await api.createSuperBot(form)
      onCreated?.(bot)
      setShowCreate(false)
    } catch (err) {
      setCreateError(err.detail || err.message || 'Couldn\'t create super bot')
    } finally { setBusy(false) }
  }

  const atLimit = superBots.length >= SUPER_LIMIT

  return (
    <CollapsibleSection
      collapseKey="super"
      title={`Super bots (${superBots.length}/${SUPER_LIMIT})`}
      subtitle="Ensembles that rotate between 3-5 member bots — every random 1-3 turns the next decision is delegated to a different member."
      accent="zinc"
      headerRight={
        <div className="flex items-center gap-1.5">
          {superBots.length > 0 && (
            <ResetAllStatsButton
              bots={superBots}
              onUpdated={onUpdated}
              onError={setValidationError}
              persistKey="bots:reset-all-super-stats-confirmed"
              sectionLabel="of your super bots"
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (atLimit) {
                setValidationError?.(`You can have at most ${SUPER_LIMIT} super bots. Delete one to make room.`)
                return
              }
              setShowCreate(v => !v)
              setCreateError(null)
            }}
            className="rounded-md border border-violet-400/50 bg-violet-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-violet-600"
          >
            {showCreate ? 'Cancel' : '+ New super bot'}
          </button>
        </div>
      }
    >
      {showCreate && !atLimit && (
        <div className="mb-3">
          <SuperBotForm
            mode="create"
            availableBots={availableBots}
            busy={busy}
            error={createError}
            onSubmit={submit}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}
      <BotList
        bots={superBots}
        mine
        emptyText="No super bots yet. Combine 3-5 of your bots into one ensemble."
        onDeleted={onDeleted}
        onUpdated={onUpdated}
        onVisibilityError={onVisibilityError}
      />
    </CollapsibleSection>
  )
}

// Shared "Reset all stats" header action — used by every multi-bot
// section (My Bots, Clones, Super). Fans out one resetBotStats call
// per bot serially so the server doesn't see N simultaneous writes
// for the same user. Errors don't abort the run; each failure is
// surfaced via onError so the user can see WHICH bot failed without
// the rest being skipped. Doesn't touch weights/code/super members —
// just ELO + lifetime counters + per-hand history.
function ResetAllStatsButton({ bots, onUpdated, onError, persistKey, sectionLabel }) {
  const [busy, setBusy] = useState(false)
  const totalHands = useMemo(
    () => bots.reduce((sum, b) => sum + (b.stats?.handsPlayed ?? 0), 0),
    [bots]
  )
  async function resetAll() {
    if (busy) return
    setBusy(true)
    try {
      for (const b of bots) {
        try {
          const { bot: updated } = await api.resetBotStats(b.id)
          onUpdated?.(updated)
        } catch (err) {
          onError?.(`Reset failed for ${b.name}: ${err.detail || err.message || 'unknown error'}`)
        }
      }
    } finally {
      setBusy(false)
    }
  }
  if (bots.length === 0) return null
  return (
    <ConfirmPopoverButton
      triggerLabel={busy ? 'Resetting…' : 'Reset all stats'}
      triggerClassName="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
      description={`Reset stats on all ${bots.length} ${sectionLabel}? ELO drops back to 500 and every lifetime counter zeros out across ${totalHands.toLocaleString()} hand${totalHands === 1 ? '' : 's'} of history. Code, neural weights, and super members are left intact — only the ratings and per-hand audit trail get wiped. Permanent.`}
      confirmLabel="Reset all stats"
      persistKey={persistKey}
      busy={busy}
      onConfirm={resetAll}
    />
  )
}

// Generic neural-bots shelf. Used twice on the page:
//   - "Your neural bots" → tiers 1-5 (baseline algorithms)
//   - "Your deep MLP bots" → tiers 6-10 (architecture variants)
// Both share the inline-Reset + Reset-all behavior; only the title /
// subtitle / persist-keys change. Splitting them keeps each list to ~5
// rows even after the deep-MLP tier shipped.
function PlayerNeuralShelf({
  neuralBots,
  title,
  subtitle,
  collapseKey,
  resetAllPersistKey,
  emptyText,
  onUpdated,
  onVisibilityError,
  onResetError
}) {
  // Reset-all: fan out one resetNeuralBot call per bot. Serial fetches
  // (not Promise.all) so the server doesn't see N simultaneous writes
  // hammering the same user's row — also gives users a stable
  // "trained" total at the end. Updates fire in-place via onUpdated.
  const [resetAllBusy, setResetAllBusy] = useState(false)
  const trainableBots = useMemo(
    () => neuralBots.filter(b => (b.stats?.handsPlayed ?? 0) > 0),
    [neuralBots]
  )
  const totalTrainingHands = useMemo(
    () => neuralBots.reduce((sum, b) => sum + (b.stats?.handsPlayed ?? 0), 0),
    [neuralBots]
  )
  async function resetAll() {
    if (resetAllBusy) return
    setResetAllBusy(true)
    try {
      for (const b of neuralBots) {
        try {
          const { bot: updated } = await api.resetNeuralBot(b.id)
          onUpdated?.(updated)
        } catch (err) {
          onResetError?.(`Reset failed for ${b.name}: ${err.detail || err.message || 'unknown error'}`)
          // Don't bail — keep trying the others. A user who clicked
          // "Reset all" expects every bot they own to end up reset,
          // not "we stopped at the first failure".
        }
      }
    } finally {
      setResetAllBusy(false)
    }
  }

  return (
    <CollapsibleSection
      collapseKey={collapseKey}
      title={title}
      subtitle={subtitle}
      accent="cyan"
      headerRight={neuralBots.length > 0 && (
        <ConfirmPopoverButton
          triggerLabel={resetAllBusy ? 'Resetting…' : 'Reset all'}
          triggerClassName="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          description={`Fully reset all ${neuralBots.length} of these bots to day one? Each bot's weights go back to random initialization, ELO resets to 500, every lifetime stat (${totalTrainingHands.toLocaleString()} hand${totalTrainingHands === 1 ? '' : 's'} of training across ${trainableBots.length} bot${trainableBots.length === 1 ? '' : 's'}) gets zeroed, and the hand history behind the ELO chart + head-to-head stats gets deleted. Permanent.`}
          confirmLabel="Reset all bots"
          persistKey={resetAllPersistKey}
          busy={resetAllBusy}
          onConfirm={resetAll}
        />
      )}
    >
      <BotList
        bots={neuralBots}
        mine
        emptyText={emptyText}
        onDeleted={() => { /* NN bots aren't deletable; no-op */ }}
        onUpdated={onUpdated}
        onVisibilityError={onVisibilityError}
        onResetError={onResetError}
      />
    </CollapsibleSection>
  )
}

function ColorReel({ value, onChange }) {
  const idx = Math.max(0, BOT_COLOR_PRESETS.findIndex(c => c.hex === value?.toLowerCase()))
  function step(offset) {
    const total = BOT_COLOR_PRESETS.length
    onChange(BOT_COLOR_PRESETS[(idx + offset + total) % total].hex)
  }
  return (
    <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/80 px-4 py-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-white">Color</div>
          <div className="text-xs font-bold text-zinc-300">{BOT_COLOR_PRESETS[idx]?.name || 'custom'}</div>
        </div>
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Avatar</div>
      </div>

      <div className="relative mx-auto h-24 max-w-[420px] overflow-hidden px-12 sm:px-14">
        <button
          type="button"
          onClick={() => step(-1)}
          className="absolute left-2 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900/90 text-sm font-black text-white shadow-lg transition-colors hover:bg-zinc-700 sm:left-3"
          aria-label="Previous color"
        >
          &lt;
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          className="absolute right-2 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900/90 text-sm font-black text-white shadow-lg transition-colors hover:bg-zinc-700 sm:right-3"
          aria-label="Next color"
        >
          &gt;
        </button>

        <div className="flex h-full items-center justify-center">
          <div
            className="h-16 w-16 rounded-full shadow-lg ring-2 ring-white/30"
            style={{ background: value }}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {BOT_COLOR_PRESETS.map(c => {
          const selected = c.hex === value?.toLowerCase()
          return (
            <button
              key={c.hex}
              type="button"
              onClick={() => onChange(c.hex)}
              aria-label={c.name}
              title={c.name}
              className={`h-5 w-5 rounded-full transition-transform ${selected ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'}`}
              style={{ background: c.hex }}
            />
          )
        })}
      </div>
    </div>
  )
}

function CreatePanel({ onCreated }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setError(null)
    if (!name.trim()) { setError('Name required'); return }
    if (!isValidHex(color)) { setError('Pick a color'); return }
    setSubmitting(true)
    try {
      const { bot } = await api.createBot({ name: name.trim(), color })
      setName('')
      if (onCreated) onCreated(bot)
      router.push(`/poker/bots/${bot.id}`)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to create')
    } finally {
      setSubmitting(false)
    }
  }

  // (Limit-reached errors flow back through the same `setError` path; the
  // detail string from the server explains the limit so users know to
  // delete an existing bot first.)

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="grid w-full grid-cols-[auto_1fr] items-center gap-3 rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-3 shadow-lg">
        <BotAvatar name={name || 'New'} color={color} size={48} />
        <input
          className="bg-zinc-900/90 border border-zinc-500/50 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-300 shadow-sm"
          placeholder="Bot name"
          maxLength={32}
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !submitting && submit()}
        />
      </div>

      <ColorReel value={color} onChange={setColor} />

      {error && (
        <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 text-center">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !name.trim()}
        className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 py-4 rounded-xl text-base font-bold text-white transition-colors border border-emerald-500/50 shadow-lg"
      >
        {submitting ? 'Creating…' : 'Create & open editor →'}
      </button>

      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300 text-center">
        Bots are private by default. Toggle public from the list to share.
      </div>
    </div>
  )
}

// Small "i" button on neural bot rows. Pops a description card with
// the algorithm label, family, architecture, and blurb so users can
// see how each policy works without diving into the detail page.
//
// The popover renders via a portal to document.body — the BotList
// scroll container has `overflow-y-auto max-h-[60vh]`, which creates a
// clipping context that swallowed absolutely-positioned children. A
// portal escapes that container entirely so the popover is always
// visible. Position is recomputed from the button's bounding rect on
// open + on window resize/scroll so the card stays anchored.
function NeuralInfoButton({ bot }) {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState(null)
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)
  const info = infoForKind(bot.neuralKind)

  // Recompute the portal position whenever the popover is open. We
  // listen to scroll on every ancestor (capture phase so scrolling the
  // BotList container fires too) and to resize. The math itself is a
  // single getBoundingClientRect call — cheap to run on every frame.
  useEffect(() => {
    if (!open) return
    function reposition() {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r) setAnchorRect({ top: r.bottom, right: window.innerWidth - r.right })
    }
    reposition()
    window.addEventListener('resize', reposition)
    // Capture-phase scroll so we catch scrolls on the inner BotList
    // container, not just window-level scrolls.
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (buttonRef.current?.contains(e.target)) return
      if (popoverRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!info) return null

  const popover = open && anchorRect && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${info.label} description`}
          className="fixed z-[200] w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-cyan-400/50 bg-zinc-900/98 p-3 shadow-2xl backdrop-blur-md"
          style={{ top: anchorRect.top + 6, right: anchorRect.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-cyan-200">
              {info.label}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              {info.family}
            </div>
          </div>
          <div className="mb-2 rounded-md border border-zinc-700/70 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] font-bold text-zinc-200">
            {info.arch}
          </div>
          <div className="text-[11px] font-medium leading-snug text-zinc-200">
            {info.blurb}
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        aria-label={`About ${info.label}`}
        aria-expanded={open}
        title="See how this bot works"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-[11px] font-black text-cyan-200 transition-colors hover:bg-cyan-500/25"
      >
        i
      </button>
      {popover}
    </>
  )
}

function BotRow({ bot, mine, onDeleted, onUpdated, onVisibilityError, onResetError }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [visBusy, setVisBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const href = `/poker/bots/${bot.id}`

  async function destroy(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete bot "${bot.name}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      await api.deleteBot(bot.id)
      onDeleted(bot.id)
    } finally { setBusy(false) }
  }

  // Wipe a neural bot's weights back to random init. Permanent — by
  // design — so it sits behind a ConfirmPopoverButton like delete.
  async function resetNeural() {
    setResetBusy(true)
    try {
      const { bot: updated } = await api.resetNeuralBot(bot.id)
      onUpdated?.(updated)
    } catch (err) {
      onResetError?.(err.detail || err.message || 'Reset failed')
    } finally {
      setResetBusy(false)
    }
  }

  // Stats-only reset. Works for any bot type — wipes ELO + lifetime
  // counters + hand history without touching code / weights / super
  // members. Used after the ELO overhaul so users can clean up
  // ratings from the old inflationary scoring without losing the bot.
  async function resetStats() {
    setResetBusy(true)
    try {
      const { bot: updated } = await api.resetBotStats(bot.id)
      onUpdated?.(updated)
    } catch (err) {
      onResetError?.(err.detail || err.message || 'Reset failed')
    } finally {
      setResetBusy(false)
    }
  }

  // One-click visibility flip. Handles the 10-public-cap error from the
  // server by surfacing it up to the page-level banner so the user sees
  // exactly why it didn't go through.
  async function toggleVisibility(e) {
    e.preventDefault()
    e.stopPropagation()
    setVisBusy(true)
    try {
      const { bot: updated } = await api.updateBot(bot.id, { isPublic: !bot.isPublic })
      onUpdated?.(updated)
    } catch (err) {
      onVisibilityError?.(err.detail || err.message || 'Visibility change failed')
    } finally {
      setVisBusy(false)
    }
  }

  function openDetail(e) {
    // Anything clickable inside (buttons, links) handles its own click — let it bubble out for the row only when nothing else handled it.
    if (e.defaultPrevented) return
    router.push(href)
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(href) } }}
      className="group cursor-pointer rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-3 transition-colors hover:border-zinc-500/60 hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-zinc-400/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <BotAvatar name={bot.name} color={bot.color} textColor={bot.textColor} avatarUrl={bot.avatarUrl} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-black text-white">{bot.name}</span>
              {/* Bot-kind badge — one of (JS code, clone tier, neural variant)
                  so list rows are scannable. The label for NN bots reflects
                  the underlying learning algorithm so users can tell their
                  REINFORCE bots apart from the MLP / Q-learning ones. */}
              {bot.isSuper ? (
                <span className="rounded border border-violet-400/40 bg-violet-500/10 px-1 py-px text-[9px] font-black uppercase tracking-widest text-violet-200">
                  SUPER · {bot.superMemberIds?.length || 0}
                </span>
              ) : bot.isNeural ? (
                <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-1 py-px text-[9px] font-black uppercase tracking-widest text-cyan-200">
                  {bot.neuralKind === 'mlp' ? 'MLP 1×8'
                    : bot.neuralKind === 'mlp_16' ? 'MLP 1×16'
                    : bot.neuralKind === 'mlp_32' ? 'MLP 1×32'
                    : bot.neuralKind === 'mlp_2x16' ? 'MLP 2×16'
                    : bot.neuralKind === 'mlp_2x32' ? 'MLP 2×32'
                    : bot.neuralKind === 'mlp_3x16' ? 'MLP 3×16'
                    : bot.neuralKind === 'qlearning' ? 'Q-LEARN'
                    : bot.neuralKind === 'reinforce_baseline' ? 'PG+BL'
                    : 'PG'}
                </span>
              ) : bot.isClone ? (
                <span className="rounded border border-amber-400/40 bg-amber-500/10 px-1 py-px text-[9px] font-black uppercase tracking-widest text-amber-200">
                  CLONE v{bot.cloneTier}
                </span>
              ) : bot.codeEnabled ? (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-px text-[9px] font-black uppercase tracking-widest text-emerald-200">
                  JS
                </span>
              ) : null}
            </div>
            <div className="truncate text-[10px] font-bold text-zinc-300">
              ELO {bot.elo} · {bot.stats.handsPlayed} HANDS · BY {(bot.ownerDisplayName || 'UNKNOWN').toUpperCase()}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Info popover — only for neural bots (the only kind with
              non-trivial architecture to explain). Sits first in the
              action cluster so users can see "what is this?" before
              touching public / reset. */}
          {bot.isNeural && <NeuralInfoButton bot={bot} />}
          {/* Quick visibility toggle on owner rows. Public = emerald
              "shared", private = zinc "private only" — colors mirror the
              public-roster filter accent so the state is scannable.
              Server enforces the 10-public cap; we surface the error
              up to the page-level banner. */}
          {mine && (
            <button
              type="button"
              onClick={toggleVisibility}
              disabled={visBusy}
              title={bot.isPublic
                ? 'Public — anyone can sit this bot. Click to make private.'
                : 'Private — only you can sit this bot. Click to share.'}
              className={`rounded-md border px-2 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                bot.isPublic
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                  : 'border-zinc-600/60 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              {visBusy ? '…' : (bot.isPublic ? 'Public ✓' : 'Private')}
            </button>
          )}
          <Link
            href={href}
            className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-600"
          >
            {mine ? 'Edit →' : 'Open →'}
          </Link>
          {/* Clone bots are permanent — show a small lock chip so the
              missing Delete button isn't confusing. The kind badge
              above already says which type it is. */}
          {mine && bot.isClone && (
            <span
              title="Clone bots can't be deleted — recalculate or edit instead"
              className="rounded-md border border-zinc-500/30 bg-zinc-700/30 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300"
            >
              🔒
            </span>
          )}
          {/* Neural bots aren't deletable either, but they ARE
              resettable. Inline reset saves the user a click into the
              detail page just to wipe weights. ConfirmPopoverButton
              makes it a two-step action so a misclick can't nuke
              hundreds of trained hands. */}
          {mine && bot.isNeural && (
            <ConfirmPopoverButton
              triggerLabel={resetBusy ? '…' : 'Reset'}
              triggerClassName="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              description={`Fully reset ${bot.name} to day one? This re-initializes the neural weights, wipes ELO back to 500, zeros out every lifetime stat (${(bot.stats?.handsPlayed ?? 0).toLocaleString()} hands played, ${(bot.stats?.handsWon ?? 0).toLocaleString()} won, ELO ${bot.elo ?? 500}), and deletes the hand history that drives the ELO chart and head-to-head numbers. Permanent.`}
              confirmLabel="Reset bot"
              persistKey={`bots:reset-neural-confirmed:${bot.id}`}
              busy={resetBusy}
              onConfirm={resetNeural}
            />
          )}
          {/* Stats-only reset for non-neural bots (rule / clone /
              super). Neural bots get the full "Reset bot" above which
              already does the same stat wipe plus weights, so a
              second button there would be redundant. */}
          {mine && !bot.isNeural && (
            <ConfirmPopoverButton
              triggerLabel={resetBusy ? '…' : 'Reset stats'}
              triggerClassName="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              description={`Reset ${bot.name}'s ELO + hand history? ELO drops to 500 and every lifetime stat (${(bot.stats?.handsPlayed ?? 0).toLocaleString()} hands played, ${(bot.stats?.handsWon ?? 0).toLocaleString()} won, ELO ${bot.elo ?? 500}) zeros out. ${bot.isClone ? 'The clone code stays' : bot.isSuper ? 'The lineup + bandit state stay' : 'Your JS code stays'} — only the stats and the per-hand history get wiped. Permanent.`}
              confirmLabel="Reset stats"
              persistKey={`bots:reset-stats-confirmed:${bot.id}`}
              busy={resetBusy}
              onConfirm={resetStats}
            />
          )}
          {mine && !bot.isClone && !bot.isNeural && (
            <button
              type="button"
              onClick={destroy}
              disabled={busy}
              className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-bold text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function BotList({ bots, mine, onDeleted, onUpdated, onVisibilityError, onResetError, emptyText }) {
  if (bots.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-300">
        {emptyText}
      </div>
    )
  }
  return (
    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
      {bots.map(b => (
        <BotRow
          key={b.id}
          bot={b}
          mine={mine}
          onDeleted={onDeleted}
          onUpdated={onUpdated}
          onVisibilityError={onVisibilityError}
          onResetError={onResetError}
        />
      ))}
    </div>
  )
}

// Mirror server botRoutes.MAX_BOTS_PER_USER. Hardcoded so we can show the
// limit before the user even tries to create one. The server-side value
// wins once /mine resolves (response carries `limit` and `publicLimit`).
const MAX_BOTS_PER_USER = 10
const MAX_PUBLIC_BOTS_PER_USER = 10

// Next 13+/14+/16 requires any component that calls useSearchParams() to
// be rendered inside a <Suspense> boundary, otherwise the production build
// errors out with "useSearchParams() should be wrapped in a suspense
// boundary at page /poker/bots". We render an empty fallback because the
// page below has its own loading states once the search params resolve.
export default function BotsPage() {
  return (
    <Suspense fallback={null}>
      <BotsPageInner />
    </Suspense>
  )
}

function BotsPageInner() {
  const { user, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  // Honor /poker/bots?build=tierN — auto-fires that specific tier's build
  // once the preview confirms it's unlocked. Comes from the achievement
  // toast's CTA. Legacy `?build=me` maps to tier 1.
  const buildParam = searchParams.get('build') || ''
  const tierMatch = buildParam.match(/^tier(\d)$/)
  const autoBuildTier = tierMatch ? Number(tierMatch[1])
                       : buildParam === 'me' ? 1
                       : null
  const [tab, setTab] = useState(autoBuildTier ? 'mine' : 'public')
  const [myBots, setMyBots] = useState([])
  const [publicLimit, setPublicLimit] = useState(MAX_PUBLIC_BOTS_PER_USER)
  const [publicBots, setPublicBots] = useState([])
  const [botLimit, setBotLimit] = useState(MAX_BOTS_PER_USER)
  const [loading, setLoading] = useState(true)
  // Two distinct error channels so a transient validation error (e.g.
  // "at the bot limit, can't create more") doesn't bleed into the
  // Public Roster panel which only cares about load failures.
  //   * validationError — soft click-time validation; banner above tabs,
  //                       auto-dismisses, clears on tab change.
  //   * loadError       — `reload()` failed; shown inside the affected
  //                       tab body so it's scoped to the data that failed.
  const [validationError, setValidationError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // Anonymous-only paywall. Set to a string to open; null to close.
  const [authGateMessage, setAuthGateMessage] = useState(null)

  // Auto-dismiss soft validation errors after 5s so they don't linger.
  // Each `setValidationError` schedules a fresh dismiss; clears restart
  // the timer cleanly. Page-level state, so unmount cancels.
  useEffect(() => {
    if (!validationError) return
    const t = setTimeout(() => setValidationError(null), 5000)
    return () => clearTimeout(t)
  }, [validationError])

  // Helper: tab buttons always clear the page-level validation error so
  // it never lingers across navigation. The validation message is a
  // *response* to the previous click, not a property of the new tab.
  function switchTab(next) {
    setValidationError(null)
    setTab(next)
  }

  async function reload() {
    setLoading(true)
    setLoadError(null)
    try {
      const [mine, pub] = await Promise.all([
        user ? api.listMyBots() : Promise.resolve({ bots: [], limit: MAX_BOTS_PER_USER }),
        api.listPublicBots()
      ])
      setMyBots(mine.bots)
      setBotLimit(mine.limit ?? MAX_BOTS_PER_USER)
      setPublicLimit(mine.publicLimit ?? MAX_PUBLIC_BOTS_PER_USER)
      setPublicBots(pub.bots)
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    // Default landing tab once we know auth status: My Bots for signed-in,
    // Public for anonymous (since they can't have a "mine" list).
    if (user && tab === 'public') setTab('mine')
    if (!user && tab === 'mine') setTab('public')
    reload()
  }, [authLoading, user?.id])

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-4 pt-4 pb-12">
      {/* Local back-link sits just to the LEFT of the AccountDock
          (right-3/right-4 fixed). right-14/16 reserves the dock's
          column. */}
      <div className="absolute right-14 top-3 z-10 flex items-center gap-2 sm:right-16 sm:top-4">
        <Link
          href="/poker"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
        >
          <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
          <span className="hidden sm:inline">Lobby</span>
        </Link>
      </div>

      <div className="mt-12 flex flex-col items-center gap-6 w-full max-w-[620px]">
        <div className="text-sm sm:text-base px-6 py-2.5 rounded-full font-bold shadow-sm bg-zinc-950/35 text-white border border-zinc-700/70">
          Poker Bots
        </div>

        {/* 4-tab strip. Wraps to 2x2 on mobile so each tab keeps a
            comfortable tap target; one row of 4 on sm+ keeps the
            classic look. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 w-full bg-zinc-800/80 p-2 gap-2 rounded-xl border border-zinc-600/50 shadow-md">
          <button
            onClick={() => {
              if (!user) { setAuthGateMessage('Sign in to manage your bots.'); return }
              switchTab('mine')
            }}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'mine' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            My Bots
          </button>
          <button
            onClick={() => {
              if (!user) { setAuthGateMessage('Sign in to create your own bots.'); return }
              // At the limit → route back to My Bots and explain. The
              // validation banner auto-dismisses, so the user isn't
              // staring at the warning forever.
              if (myBots.length >= botLimit) {
                setValidationError(`You can only have up to ${botLimit} bots per account. Delete one to make room.`)
                setTab('mine')
                return
              }
              switchTab('create')
            }}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'create' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            Create
          </button>
          <button
            onClick={() => switchTab('public')}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'public' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            Public
          </button>
          <button
            onClick={() => {
              if (!user) { setAuthGateMessage('Sign in to run the training simulator.'); return }
              switchTab('train')
            }}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'train' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            Train
          </button>
        </div>

        {/* Validation banner — soft errors only. Click the × to dismiss
            immediately; otherwise auto-clears after 5s. */}
        {validationError && (
          <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200">
            <span className="flex-1 text-center">{validationError}</span>
            <button
              type="button"
              onClick={() => setValidationError(null)}
              aria-label="Dismiss"
              className="cursor-pointer rounded px-1 text-amber-300 hover:bg-amber-500/20 hover:text-amber-100"
            >×</button>
          </div>
        )}

        {/* Order: My Bots first (the active editing surface), then neural
            (your trained pets), then clones (the auto-built history). Most
            users open this page to edit a manual bot — putting it on top
            saves a scroll. */}
        {user && tab === 'mine' && (() => {
          // Manual bots = neither clone nor neural. The limit only counts
          // these — clones live in their own shelf and neural bots are
          // permanent slots that the user didn't create by hand.
          const manualBots = myBots.filter(b => !b.isClone && !b.isNeural && !b.isSuper)
          const publicCount = myBots.filter(b => b.isPublic).length
          // Common visibility-update handler: replace the bot in-place
          // across both lists (public roster also caches manual+public).
          const onBotUpdated = (updated) => {
            setMyBots(prev => prev.map(x => x.id === updated.id ? updated : x))
            setPublicBots(prev => {
              const filtered = prev.filter(x => x.id !== updated.id)
              return updated.isPublic ? [updated, ...filtered] : filtered
            })
          }
          const onVisibilityError = (msg) => setValidationError(msg)
          return (
            <CollapsibleSection
              collapseKey="manual"
              title={`My Bots (${manualBots.length}/${botLimit})`}
              subtitle={`User-coded bots — edit code, share publicly, or sit them at a table. ${publicCount}/${publicLimit} of your bots are currently public.`}
              accent="zinc"
              headerRight={
                <div className="flex items-center gap-1.5">
                  {manualBots.length > 0 && (
                    <ResetAllStatsButton
                      bots={manualBots}
                      onUpdated={onBotUpdated}
                      onError={setValidationError}
                      persistKey="bots:reset-all-manual-stats-confirmed"
                      sectionLabel="of your manual bots"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (manualBots.length >= botLimit) {
                        setValidationError(`You can only have up to ${botLimit} manual bots per account. Delete one to make room. (Clone + neural slots don't count.)`)
                        return
                      }
                      setTab('create')
                    }}
                    className="rounded-md border border-emerald-500/50 bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600"
                  >
                    + New bot
                  </button>
                </div>
              }
            >
              {loading ? (
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-300">
                  Loading…
                </div>
              ) : (
                <BotList
                  bots={manualBots}
                  mine
                  emptyText="No manual bots yet. Tap + New bot to build one."
                  onDeleted={(id) => {
                    setMyBots(prev => prev.filter(x => x.id !== id))
                    setPublicBots(prev => prev.filter(x => x.id !== id))
                  }}
                  onUpdated={onBotUpdated}
                  onVisibilityError={onVisibilityError}
                />
              )}
            </CollapsibleSection>
          )
        })()}

        {user && tab === 'mine' && (
          <PlayerSuperShelf
            superBots={myBots.filter(b => b.isSuper)}
            availableBots={myBots.filter(b => !b.isSuper)}
            onCreated={(bot) => setMyBots(prev => [bot, ...prev])}
            onUpdated={(updated) => setMyBots(prev => prev.map(x => x.id === updated.id ? updated : x))}
            onDeleted={(id) => setMyBots(prev => prev.filter(x => x.id !== id))}
            onVisibilityError={(msg) => setValidationError(msg)}
            setValidationError={setValidationError}
          />
        )}

        {/* Two neural shelves: baseline algorithms (one per family) at
            tiers 1-5, then the deep-MLP architecture variants at tiers
            6-10. The shelves stack so users can compare baseline ELOs
            with the bigger-net ELOs without scrolling past 10 rows in
            one section. */}
        {user && tab === 'mine' && (
          <PlayerNeuralShelf
            neuralBots={myBots.filter(b => b.isNeural && (b.neuralTier ?? 0) <= 5)}
            title="Your neural bots"
            subtitle="Five auto-provisioned learners — each uses a different ML algorithm and updates its weights every hand it plays."
            collapseKey="neural"
            resetAllPersistKey="bots:reset-all-neural-confirmed"
            emptyText="No neural bots yet — they're auto-provisioned on your next /poker/bots load."
            onUpdated={(updated) => setMyBots(prev => prev.map(x => x.id === updated.id ? updated : x))}
            onVisibilityError={(msg) => setValidationError(msg)}
            onResetError={(msg) => setValidationError(msg)}
          />
        )}

        {user && tab === 'mine' && (
          <PlayerNeuralShelf
            neuralBots={myBots.filter(b => b.isNeural && (b.neuralTier ?? 0) >= 6)}
            title="Your deep MLP bots"
            subtitle="Five architecture variants of the MLP policy — same REINFORCE training, different layer counts and widths. Ranked by parameter count (smallest → largest)."
            collapseKey="deep-mlp"
            resetAllPersistKey="bots:reset-all-deep-mlp-confirmed"
            emptyText="No deep MLP bots yet — they're auto-provisioned on your next /poker/bots load."
            onUpdated={(updated) => setMyBots(prev => prev.map(x => x.id === updated.id ? updated : x))}
            onVisibilityError={(msg) => setValidationError(msg)}
            onResetError={(msg) => setValidationError(msg)}
          />
        )}

        {user && tab === 'mine' && (
          <PlayerCloneShelf
            user={user}
            autoBuildTier={autoBuildTier}
            onCreated={(bot) => setMyBots(prev => [bot, ...prev])}
            onVisibilityError={(msg) => setValidationError(msg)}
            onResetError={(msg) => setValidationError(msg)}
          />
        )}

        {user && tab === 'create' && (
          <CreatePanel
            onCreated={(b) => {
              setMyBots(prev => [b, ...prev])
              setPublicBots(prev => [b, ...prev])
              setTab('mine')
            }}
          />
        )}

        {!user && tab === 'mine' && (
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-4 shadow-lg flex flex-col items-center gap-3">
            <div className="text-sm font-black text-white">Sign in to build bots</div>
            <div className="text-xs font-bold text-zinc-300 text-center">
              Save bots to your account so anyone can sit them at a table.
            </div>
            <AccountMenu />
          </div>
        )}

        {/* Training Simulator tab — headless arena. Owns its own UI
            state; we just hand it the two roster lists + a callback
            that refreshes /mine when neural weights get persisted (so
            the My Bots view shows fresh ELO immediately). */}
        {user && tab === 'train' && (
          <TrainingSimulatorPanel
            myBots={myBots}
            publicBots={publicBots}
            onPersistResult={reload}
          />
        )}

        {tab === 'public' && (
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-3 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-white">Public Roster</div>
                <div className="text-xs font-bold text-zinc-300">Anyone can sit these at a table.</div>
              </div>
              <button
                type="button"
                onClick={reload}
                className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-600"
              >
                Refresh
              </button>
            </div>
            {loading ? (
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-300">
                Loading…
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 text-xs font-bold text-red-200">
                {loadError}
              </div>
            ) : (
              <BotList
                bots={publicBots}
                mine={false}
                emptyText="No public bots yet. Be the first."
                onDeleted={() => {}}
              />
            )}
          </div>
        )}
      </div>
      <AuthGateModal
        open={!!authGateMessage}
        message={authGateMessage}
        onClose={() => setAuthGateMessage(null)}
      />
    </div>
  )
}

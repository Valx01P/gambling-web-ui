'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import HomeBackLink from '../../components/HomeBackLink'
import AccountMenu from '../../components/AccountMenu'
import AuthGateModal from '../../components/AuthGateModal'
import ConfirmPopoverButton from '../../components/ConfirmPopoverButton'
import BotAvatar from '../../components/BotAvatar'
import { useAuth } from '../../lib/useAuth'
import { api } from '../../lib/api'
import { BOT_COLOR_PRESETS, isValidHex } from '../../lib/botColors'

// Renders a single clone tier's slot in the My Bots shelf. Three states:
//   * built: existing bot — links to editor, shows ELO badge
//   * unlocked but not built: shows derived stats + Build button
//   * locked: progress meter ("3 more hands until v2")
function CloneSlot({ slot, onBuilt, onUpdated, autoBuild = false }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [error, setError] = useState(null)
  const [recalcOk, setRecalcOk] = useState(false)
  const [autoTriggered, setAutoTriggered] = useState(false)

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
function PlayerCloneShelf({ user, onCreated, autoBuildTier = null }) {
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
      <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 shadow-lg">
        <div className="text-xs font-bold text-amber-100">Reading your play data…</div>
      </div>
    )
  }
  if (!preview) return null

  return (
    <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-white">Your clone bots</div>
          <div className="text-[10px] font-bold text-zinc-300">
            Five reserved slots. Each new one is more accurate — built from more of your hands. Played: <span className="text-amber-200">{preview.handsSeated ?? 0}</span> hands.
          </div>
        </div>
      </div>
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
          />
        ))}
      </div>
    </div>
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
        Bots are public. Anyone can sit them at a table.
      </div>
    </div>
  )
}

function BotRow({ bot, mine, onDeleted }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
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
              {bot.codeEnabled && (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-px text-[9px] font-black uppercase tracking-widest text-emerald-200">
                  JS
                </span>
              )}
            </div>
            <div className="truncate text-[10px] font-bold text-zinc-300">
              ELO {bot.elo} · {bot.stats.handsPlayed} HANDS · BY {(bot.ownerDisplayName || 'UNKNOWN').toUpperCase()}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Link
            href={href}
            className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-600"
          >
            {mine ? 'Edit →' : 'Open →'}
          </Link>
          {/* Clones are permanent slots and can't be deleted; show a small
              lock indicator so the missing button isn't confusing. */}
          {mine && bot.isClone && (
            <span
              title="Clone bots can't be deleted — recalculate or edit instead"
              className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-200"
            >
              v{bot.cloneTier}
            </span>
          )}
          {mine && !bot.isClone && (
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

function BotList({ bots, mine, onDeleted, emptyText }) {
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
        <BotRow key={b.id} bot={b} mine={mine} onDeleted={onDeleted} />
      ))}
    </div>
  )
}

// Mirror server botRoutes.MAX_BOTS_PER_USER. Hardcoded so we can show the
// limit before the user even tries to create one.
const MAX_BOTS_PER_USER = 10

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
  const [publicBots, setPublicBots] = useState([])
  const [botLimit, setBotLimit] = useState(MAX_BOTS_PER_USER)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Anonymous-only paywall. Set to a string to open; null to close.
  const [authGateMessage, setAuthGateMessage] = useState(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [mine, pub] = await Promise.all([
        user ? api.listMyBots() : Promise.resolve({ bots: [], limit: MAX_BOTS_PER_USER }),
        api.listPublicBots()
      ])
      setMyBots(mine.bots)
      setBotLimit(mine.limit ?? MAX_BOTS_PER_USER)
      setPublicBots(pub.bots)
    } catch (err) {
      setError(err.message || 'Failed to load')
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
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <Link
          href="/poker"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
        >
          <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
          <span className="hidden sm:inline">Lobby</span>
        </Link>
        <AccountMenu />
      </div>

      <div className="mt-12 flex flex-col items-center gap-6 w-full max-w-[620px]">
        <div className="text-sm sm:text-base px-6 py-2.5 rounded-full font-bold shadow-sm bg-zinc-950/35 text-white border border-zinc-700/70">
          Poker Bots
        </div>

        <div className="grid grid-cols-3 w-full bg-zinc-800/80 p-2 gap-2 rounded-xl border border-zinc-600/50 shadow-md">
          <button
            onClick={() => {
              if (!user) { setAuthGateMessage('Sign in to manage your bots.'); return }
              setTab('mine')
            }}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'mine' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            My Bots
          </button>
          <button
            onClick={() => {
              if (!user) { setAuthGateMessage('Sign in to create your own bots.'); return }
              if (myBots.length >= botLimit) {
                setError(`You can only have up to ${botLimit} bots per account. Delete one to make room.`)
                setTab('mine')
                return
              }
              setTab('create')
            }}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'create' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            Create
          </button>
          <button
            onClick={() => setTab('public')}
            className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${tab === 'public' ? 'bg-zinc-950/35 border border-zinc-700/70 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
          >
            Public
          </button>
        </div>

        {error && (
          <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 text-center">
            {error}
          </div>
        )}

        {user && tab === 'mine' && (
          <PlayerCloneShelf
            user={user}
            autoBuildTier={autoBuildTier}
            onCreated={(bot) => setMyBots(prev => [bot, ...prev])}
          />
        )}

        {user && tab === 'mine' && (() => {
          // Clones live in the shelf above; this list is for manual bots
          // only so the user sees one count (manual / 10) that matches the
          // server-side cap.
          const manualBots = myBots.filter(b => !b.isClone)
          return (
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-3 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-white">My Bots <span className="text-zinc-400 font-bold">({manualBots.length}/{botLimit})</span></div>
                <div className="text-xs font-bold text-zinc-300">Manual bots — edit code, share publicly, or sit them at a table.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (manualBots.length >= botLimit) {
                    setError(`You can only have up to ${botLimit} manual bots per account. Delete one to make room. (Clone slots don't count.)`)
                    return
                  }
                  setTab('create')
                }}
                className="rounded-md border border-emerald-500/50 bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600"
              >
                + New bot
              </button>
            </div>
            {loading ? (
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-300">
                Loading…
              </div>
            ) : (
              <BotList
                bots={manualBots}
                mine
                emptyText="No manual bots yet. Tap Create to build one."
                onDeleted={(id) => {
                  setMyBots(prev => prev.filter(x => x.id !== id))
                  setPublicBots(prev => prev.filter(x => x.id !== id))
                }}
              />
            )}
          </div>
          )
        })()}

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
            ) : error ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 text-xs font-bold text-red-200">
                {error}
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

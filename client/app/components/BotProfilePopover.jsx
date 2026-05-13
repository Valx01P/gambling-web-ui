'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import BotAvatar from './BotAvatar'

// Seat-click popover for bot seats. Sibling to PlayerProfilePopover —
// shares positioning rules so swapping between a human seat and a bot
// seat at the same table feels visually consistent. Reads everything
// from the seat payload that PokerGame._buildPlayerSeat emits, so
// even private bots that the viewer couldn't fetch via /api/bots/:id
// render correctly when they're sat at a table.

const POPOVER_WIDTH = 280
const POPOVER_HEIGHT = 240
const POPOVER_MARGIN = 8

// Mirrors server/src/bots/neural/registry.js. Stays in sync because
// changing variants is a deliberate cross-cutting change; duplicating
// here keeps the popover from pulling a server-only module.
const NEURAL_LABELS = {
  reinforce:          'REINFORCE',
  reinforce_baseline: 'REINFORCE + baseline',
  mlp:                'MLP (1 hidden)',
  qlearning:          'Q-learning · ε-greedy'
}

function kindBadge(seat) {
  if (seat.botKind === 'neural') {
    return {
      label: 'Neural net',
      detail: NEURAL_LABELS[seat.botNeuralKind] || seat.botNeuralKind || 'unknown',
      cls: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200'
    }
  }
  if (seat.botKind === 'clone') {
    return {
      label: 'Clone',
      detail: `tier v${seat.botCloneTier || '?'}`,
      cls: 'border-amber-400/50 bg-amber-500/10 text-amber-200'
    }
  }
  return {
    label: 'Custom bot',
    detail: 'user-coded JS',
    cls: 'border-zinc-500/50 bg-zinc-700/30 text-zinc-200'
  }
}

function fmtPct(num, den) {
  if (!den || den <= 0) return '—'
  return `${Math.round((100 * num) / den)}%`
}

export default function BotProfilePopover({
  open,
  onClose,
  anchorSeatId,
  seat,
  viewerUserId    // current signed-in user id (if any) — drives the "Edit bot" link
}) {
  const popRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Position-tracking rAF loop — identical to PlayerProfilePopover so the
  // two feel like one component when the user clicks between human and
  // bot seats. Auto-closes if the anchor disappears (bot left the table).
  useEffect(() => {
    if (!open || !anchorSeatId || typeof window === 'undefined') return
    let rafId = 0
    let cancelled = false
    function tick() {
      if (cancelled) return
      const pop = popRef.current
      const el = document.querySelector(`[data-seat-id="${CSS.escape(anchorSeatId)}"]`)
      if (!el) {
        cancelled = true
        onCloseRef.current?.()
        return
      }
      if (pop) {
        const rect = el.getBoundingClientRect()
        const placeBelow = rect.top - POPOVER_HEIGHT - POPOVER_MARGIN < 0
        const left = Math.max(
          POPOVER_MARGIN,
          Math.min(
            window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN,
            rect.left + rect.width / 2 - POPOVER_WIDTH / 2
          )
        )
        const top = placeBelow
          ? rect.bottom + POPOVER_MARGIN
          : rect.top - POPOVER_HEIGHT - POPOVER_MARGIN
        pop.style.left = `${left}px`
        pop.style.top = `${top}px`
        if (pop.style.opacity !== '1') pop.style.opacity = '1'
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(rafId) }
  }, [open, anchorSeatId])

  useEffect(() => {
    if (!open) return
    function onPointer(e) { if (popRef.current?.contains(e.target)) return; onClose?.() }
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open || !seat) return null
  if (typeof document === 'undefined') return null

  const initialStyle = {
    position: 'fixed', zIndex: 350, left: 0, top: 0, opacity: 0,
    transition: 'left 120ms ease-out, top 120ms ease-out, opacity 90ms ease-out'
  }

  const badge = kindBadge(seat)
  const isOwner = !!viewerUserId && viewerUserId === seat.botOwnerUserId
  const handsPlayed = seat.botHandsPlayed ?? 0
  const handsWon = seat.botHandsWon ?? 0
  const showdownsPlayed = seat.botShowdownsPlayed ?? 0
  const showdownsWon = seat.botShowdownsWon ?? 0
  const sessionProfit = (seat.chips ?? 0) - (seat.buyIn ?? seat.pokerBuyIn ?? 0)

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Profile for bot ${seat.username || 'bot'}`}
      className="w-[280px] rounded-xl border border-zinc-600/60 bg-zinc-900/98 p-3 shadow-2xl"
      style={initialStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        <BotAvatar
          name={seat.username}
          color={seat.botColor || '#3b82f6'}
          textColor={seat.botTextColor || 'auto'}
          avatarUrl={seat.botAvatarUrl}
          size={48}
          className="ring-2 ring-zinc-700"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-white">{seat.username || 'Bot'}</div>
          <div className={`mt-0.5 inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${badge.cls}`}>
            <span>{badge.label}</span>
            <span className="opacity-70">·</span>
            <span className="opacity-90">{badge.detail}</span>
          </div>
          {seat.ownerDisplayName && (
            <div className="mt-1 truncate text-[10px] font-bold text-zinc-400">
              by <span className="text-zinc-200">{seat.ownerDisplayName}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >×</button>
      </div>

      {/* Lifetime stats — same shape as the human popover's stat grid so
          users can mentally compare a bot to a human at a glance. */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="ELO" value={seat.botElo ?? '—'} accent="amber" />
        <Stat label="Hands" value={handsPlayed.toLocaleString()} />
        <Stat label="Win%" value={fmtPct(handsWon, handsPlayed)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <Stat label="Showdowns" value={`${showdownsWon}/${showdownsPlayed}`} />
        <Stat
          label="Session P/L"
          value={`${sessionProfit >= 0 ? '+' : '-'}$${Math.abs(sessionProfit).toLocaleString()}`}
          accent={sessionProfit >= 0 ? 'emerald' : 'red'}
        />
      </div>

      <div className="mt-3 flex gap-2">
        {/* Owner can jump straight to the edit page. Non-owners get a
            view-only link if the bot is public; private-bot non-owners
            see nothing (the page would 404). */}
        {(isOwner || seat.botIsPublic) && seat.botId && (
          <a
            href={`/poker/bots/${seat.botId}`}
            className="flex-1 rounded-md border border-zinc-500/60 bg-zinc-800 px-3 py-1.5 text-center text-xs font-black uppercase tracking-widest text-white hover:bg-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            {isOwner ? 'Edit bot →' : 'View bot →'}
          </a>
        )}
      </div>
    </div>,
    document.body
  )
}

function Stat({ label, value, accent = 'zinc' }) {
  const tone = {
    zinc:    'text-white',
    amber:   'text-amber-200',
    emerald: 'text-emerald-300',
    red:     'text-red-300'
  }[accent] || 'text-white'
  return (
    <div className="rounded-md border border-zinc-700/60 bg-zinc-950/40 px-2 py-1">
      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`text-sm font-black ${tone}`}>{value}</div>
    </div>
  )
}

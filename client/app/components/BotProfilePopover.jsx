'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import BotAvatar from './BotAvatar'

// Seat-click popover for bot seats. Sibling to PlayerProfilePopover —
// shares positioning rules so swapping between a human seat and a bot
// seat at the same table feels visually consistent. Reads everything
// from the seat payload that PokerGame._buildPlayerSeat emits, so
// even private bots that the viewer couldn't fetch via /api/bots/:id
// render correctly when they're sat at a table.

const POPOVER_WIDTH = 240
const POPOVER_HEIGHT = 220
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
  viewerUserId,    // current signed-in user id (if any) — drives the "Edit bot" link
  // Kick controls. Server rule: the player who added the bot can
  // kick it immediately; if the adder is no longer at the table
  // (left / kicked / never reseated), anyone present can kick. The
  // parent computes `canKick` from the same rule (so the button only
  // appears when the action would actually succeed) and supplies
  // `onKick(botSeatId)` to dispatch the WS message.
  canKick = false,
  onKick = null,
}) {
  const popRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Two-click confirm for the Kick button. First click arms it
  // (button color + label change), second click within ~2.5s fires
  // the kick. Auto-disarms after the window passes; resets on
  // popover close so re-opening on another bot starts fresh.
  const [kickArmed, setKickArmed] = useState(false)
  useEffect(() => {
    if (!kickArmed) return
    const t = setTimeout(() => setKickArmed(false), 2500)
    return () => clearTimeout(t)
  }, [kickArmed])
  useEffect(() => { if (!open) setKickArmed(false) }, [open])

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
      className="w-[240px] rounded-xl border border-zinc-600/60 bg-zinc-900/98 p-2.5 shadow-2xl"
      style={initialStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <BotAvatar
          name={seat.username}
          color={seat.botColor || '#3b82f6'}
          textColor={seat.botTextColor || 'auto'}
          avatarUrl={seat.botAvatarUrl}
          size={36}
          className="ring-1 ring-zinc-700"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-black text-white leading-tight">{seat.username || 'Bot'}</div>
          <div className={`mt-0.5 inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[8px] font-black uppercase tracking-widest ${badge.cls}`}>
            <span>{badge.label}</span>
            <span className="opacity-70">·</span>
            <span className="opacity-90">{badge.detail}</span>
          </div>
          {seat.ownerDisplayName && (
            <div className="mt-0.5 truncate text-[9px] font-bold text-zinc-400 leading-tight">
              by <span className="text-zinc-200">{seat.ownerDisplayName}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-0.5 rounded-md px-1 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >×</button>
      </div>

      {/* Lifetime stats — compact 3-column row so the popover stays
          short. The matching PlayerProfilePopover uses similar
          density, so swapping between a human and a bot seat at the
          same table doesn't shift layout much. */}
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <Stat label="ELO" value={seat.botElo ?? '—'} accent="amber" />
        <Stat label="Hands" value={handsPlayed.toLocaleString()} />
        <Stat label="Win%" value={fmtPct(handsWon, handsPlayed)} />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center">
        <Stat label="Show" value={`${showdownsWon}/${showdownsPlayed}`} />
        <Stat
          label="Session P/L"
          value={`${sessionProfit >= 0 ? '+' : '-'}$${Math.abs(sessionProfit).toLocaleString()}`}
          accent={sessionProfit >= 0 ? 'emerald' : 'red'}
        />
      </div>

      <div className="mt-2 flex gap-2">
        {/* "View bot →" and "Edit Bot" both removed from this popover.
            Edit Bot first (live-edit at the table had a stale-load race
            + the seated bot doesn't pick up code changes until next
            hand). View bot was removed afterward — surfacing other
            users' (or app-bot) internals from the seat click read as
            confusing and never panned out as a feature. Owners and
            curious users go through /poker/bots from the Tools menu.
            Only the Kick action stays here. */}
        {/* Kick — only rendered when the server would actually accept
            the action (parent computes the rule). Server rules:
              • you added the bot → kick immediately
              • the player who added the bot has left the table → anyone
                can kick the abandoned bot
            Outside those, the button is hidden so the user doesn't
            think they have the option and then see an error.
            Two-click confirm: first click arms (red glow + label
            change), second click within ~2.5s actually kicks. Same
            pattern used elsewhere in the app (skin-revert button) to
            keep mis-clicks from yanking a bot off the table. */}
        {canKick && onKick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (!kickArmed) {
                setKickArmed(true)
                return
              }
              onKick(seat.id)
              setKickArmed(false)
              onClose?.()
            }}
            className={`flex-1 rounded-md border px-2 py-1 text-center text-[11px] font-black uppercase tracking-widest transition-colors ${
              kickArmed
                ? 'border-red-300/80 bg-red-500/30 text-white shadow-[0_0_10px_rgba(239,68,68,0.45)] animate-pulse'
                : 'border-red-400/60 bg-red-500/15 text-red-100 hover:bg-red-500/25'
            }`}
            title={kickArmed
              ? 'Click again to confirm — or wait to cancel'
              : 'Remove this bot from the table'}
          >
            {kickArmed ? 'Click again to confirm' : 'Kick from table'}
          </button>
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
    <div className="rounded-md border border-zinc-700/60 bg-zinc-950/40 px-1.5 py-0.5">
      <div className="text-[8px] font-black uppercase tracking-widest text-zinc-500 leading-tight">{label}</div>
      <div className={`text-[11px] font-black leading-tight ${tone}`}>{value}</div>
    </div>
  )
}

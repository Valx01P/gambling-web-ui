'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { ProfileAvatar } from './ProfileSelector'
import AchievementsGrid from './AchievementsGrid'
import PeerLoanPanel from './PeerLoanPanel'

// Seat-click popover. Two modes:
//   * Linked  — `publicUserId` is set: we fetch the public slice from the
//               server and surface ELO, hands, status, follow button.
//   * Anonymous — no userId on the seat: we render only the session info
//                 the caller already has (chips, P/L for this session).
//
// Bot seats use BotAvatar elsewhere; this component is for human seats.

const STATUS_COLOR = {
  online:  'bg-emerald-400',
  recent:  'bg-amber-300',
  offline: 'bg-zinc-600'
}

const STATUS_LABEL = {
  online:  'Online',
  recent:  'Active recently',
  offline: 'Offline'
}

function formatRelative(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

function fmtChips(n) {
  const v = Number(n) || 0
  const sign = v >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(v).toLocaleString()}`
}

// Width + height the layout math sizes against. Kept in JS (rather than
// reading from the live element on every frame) because the popover's
// own size is a stable design value — the click animation would jitter
// if we recomputed off an animating shadow.
const POPOVER_WIDTH = 280
const POPOVER_HEIGHT = 260
const POPOVER_MARGIN = 8

export default function PlayerProfilePopover({
  open,
  onClose,
  anchorSeatId,  // id of the seat to follow — looked up via [data-seat-id]
  seat,          // { publicUserId, username, avatarUrl, avatarId, chips, pokerBuyIn, isBot, ... }
  // Peer-loan props — optional. When provided the panel renders an
  // offer / counter / accept / repay UI against this seat. Wired by
  // poker/page.jsx; safe to omit on screens that don't have a room.
  // `viewerIsSpectator` hides the panel for spectators — peer loans are
  // strictly a seated-player thing (the server rejects them anyway, but
  // hiding the UI keeps spectators from seeing buttons that always fail).
  myId,
  myChips,
  myPeerLoans,
  negotiations,
  onPeerLoanSend,
  viewerIsSpectator = false,
  // Kick-vote: `kickState` is the server snapshot ({ threshold, humanCount,
  // polls }); `onKickVote(targetId)` dispatches the vote message.
  kickState = null,
  onKickVote = null,
}) {
  const { user: viewer } = useAuth()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [followBusy, setFollowBusy] = useState(false)
  const popRef = useRef(null)
  // onClose lives in a ref so the rAF effect doesn't re-subscribe every
  // time the parent re-renders with a new function identity.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Re-position every animation frame while the popover is open. The
  // anchor is a live DOM node queried by [data-seat-id], so seat
  // rearrangements (player kicked, reseat) AND page scroll both stay in
  // sync. Direct style mutation via ref avoids the React re-render cost
  // of doing this through setState 60×/sec.
  //
  // If the anchor disappears entirely (kicked, removed), we auto-close
  // instead of leaving a dangling popover pointing at empty space.
  useEffect(() => {
    if (!open || !anchorSeatId || typeof window === 'undefined') return
    let rafId = 0
    let cancelled = false
    function tick() {
      if (cancelled) return
      const pop = popRef.current
      const el = document.querySelector(`[data-seat-id="${CSS.escape(anchorSeatId)}"]`)
      if (!el) {
        // Anchor seat is no longer in the DOM (player kicked / left / page
        // scrolled to a different view). Close cleanly.
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
        // The very first frame after open: the popover started at opacity 0
        // so it doesn't flash at (0, 0). Reveal once positioned.
        if (pop.style.opacity !== '1') pop.style.opacity = '1'
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(rafId) }
  }, [open, anchorSeatId])

  // Fetch the linked profile (if any) when the popover opens. Resets on
  // close so a different seat doesn't briefly show stale data.
  useEffect(() => {
    if (!open) { setInfo(null); setError(null); return }
    if (!seat?.publicUserId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api.publicUser(seat.publicUserId)
      .then(r => { if (!cancelled) setInfo(r.user) })
      .catch(err => { if (!cancelled) setError(err.detail || err.message || 'Failed to load profile') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, seat?.publicUserId])

  // Close on outside click / ESC. Capture-phase pointerdown is friendly
  // with the table's existing click handlers — we close THIS popover
  // first, the underlying click still fires (e.g. you can click another
  // seat to swap straight into its popover).
  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (popRef.current?.contains(e.target)) return
      onClose?.()
    }
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

  // Open at opacity 0 — the rAF effect above sets the real left/top on the
  // first frame and bumps opacity to 1. Stops the popover from flashing at
  // the top-left corner before its position is computed. `transition`
  // smooths small seat-position changes (a stack changes width, a player
  // joins/leaves and seats reflow) into a glide instead of a teleport.
  const initialStyle = {
    position: 'fixed',
    zIndex: 350,
    left: 0,
    top: 0,
    opacity: 0,
    transition: 'left 120ms ease-out, top 120ms ease-out, opacity 90ms ease-out',
  }

  async function toggleFollow() {
    if (!info || !viewer) return
    setFollowBusy(true)
    try {
      if (info.isFollowedByMe) {
        await api.unfollowUser(info.id)
        setInfo(prev => prev ? { ...prev, isFollowedByMe: false, followersCount: Math.max(0, prev.followersCount - 1) } : prev)
      } else {
        await api.followUser(info.id)
        setInfo(prev => prev ? { ...prev, isFollowedByMe: true, followersCount: prev.followersCount + 1 } : prev)
      }
    } catch (err) {
      setError(err.detail || err.message || 'Action failed')
    } finally {
      setFollowBusy(false)
    }
  }

  const isLinked = !!seat.publicUserId
  const sessionProfit = (seat.chips ?? 0) - (seat.pokerBuyIn ?? 0)

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Profile for ${seat.username || 'player'}`}
      className="w-[280px] rounded-xl border border-zinc-600/60 bg-zinc-900/98 p-3 shadow-2xl"
      style={initialStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <ProfileAvatar
            avatarUrl={info?.avatarUrl || seat.avatarUrl}
            avatarId={seat.avatarId}
            name={info?.displayName || seat.username}
            nameKey={info?.id || seat.id || seat.username}
            size={48}
            className="ring-2 ring-zinc-700"
          />
          {isLinked && info?.status && (
            <span
              className={`absolute -right-0 -bottom-0 inline-block h-3 w-3 rounded-full ring-2 ring-zinc-900 ${STATUS_COLOR[info.status] || STATUS_COLOR.offline}`}
              aria-label={STATUS_LABEL[info.status] || ''}
              title={STATUS_LABEL[info.status] || ''}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-white">{info?.displayName || seat.username || 'Player'}</div>
          {isLinked ? (
            info?.status && (
              <div className="text-[10px] font-bold text-zinc-400">
                {STATUS_LABEL[info.status]}
                {info.status !== 'online' && info.lastActiveAt && ` · seen ${formatRelative(info.lastActiveAt)}`}
              </div>
            )
          ) : (
            <div className="text-[10px] font-bold text-zinc-500">Anonymous — no profile</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >×</button>
      </div>

      {/* Linked profile body */}
      {isLinked && (
        <>
          {loading && (
            <div className="mt-3 text-[11px] font-bold text-zinc-500">Loading…</div>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] font-bold text-red-200">{error}</div>
          )}
          {info && !loading && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="ELO" value={info.elo} accent="amber" />
                <Stat label="Hands" value={info.handsPlayed} />
                <Stat label="Win%" value={info.handsPlayed > 0 ? `${Math.round(100 * info.handsWon / info.handsPlayed)}%` : '—'} />
              </div>
              {/* Luck row — combined side-bet + all-in underdog history.
                  Score is 5 (neutral) until the player has a handful of
                  resolved events; new accounts start there too. */}
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <Stat label="Luck" value={`${info.luckScore ?? 5}/10`} accent={luckAccent(info.luckScore)} />
                <Stat label="Side bets won" value={info.sideBetsWon ?? 0} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <Stat label="Followers" value={info.followersCount} />
                <Stat label="Following" value={info.followingCount} />
              </div>
              {info.isSelf && (
                <div className="mt-3">
                  <AchievementsGrid userIdHint={info.id} />
                </div>
              )}
              {viewer && !info.isSelf && (
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={`mt-3 w-full rounded-md border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-60 ${
                    info.isFollowedByMe
                      ? 'border-zinc-500/50 bg-zinc-800 text-white hover:bg-zinc-700'
                      : 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                  }`}
                >
                  {followBusy ? '…' : info.isFollowedByMe ? 'Following ✓' : '+ Follow'}
                </button>
              )}
              {!viewer && (
                <div className="mt-3 text-center text-[10px] font-bold text-zinc-500">Sign in to follow players.</div>
              )}
            </>
          )}
        </>
      )}

      {/* Anonymous body — only session signal exists */}
      {!isLinked && (
        <div className="mt-3 rounded-md border border-zinc-700/60 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-300">This session</div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <Stat label="Chips" value={`$${(seat.chips ?? 0).toLocaleString()}`} />
            <Stat label="P/L" value={fmtChips(sessionProfit)} accent={sessionProfit >= 0 ? 'emerald' : 'red'} />
          </div>
          <div className="mt-2 text-[10px] font-bold text-zinc-500">
            Anonymous players don't keep an ELO — they'd need to "Play as YOU" from the lobby for their hands to count.
          </div>
        </div>
      )}

      {/* Peer loans live outside the linked/anonymous split — works the
          same whether the target seat published their userId or not.
          Spectators don't get the panel: they can't lend OR borrow at
          the table (server-side _validateParties rejects on missing
          seat anyway, but the UI gate keeps the option from showing). */}
      {onPeerLoanSend && !viewerIsSpectator && seat?.id !== myId && !seat?.isBot && (
        <PeerLoanPanel
          myId={myId}
          myChips={myChips}
          targetSeat={seat}
          negotiations={negotiations}
          myPeerLoans={myPeerLoans}
          onSend={onPeerLoanSend}
        />
      )}

      {/* Vote-to-kick. Visible to seated humans only, when the target is
          another human seat. Thresholds scale with table size — server
          rejects if below 3 humans, so we just hide the button there. */}
      {onKickVote && !viewerIsSpectator && seat?.id !== myId && !seat?.isBot && (() => {
        const threshold = kickState?.threshold
        const poll = kickState?.polls?.[seat.id]
        const votes = poll?.votes || 0
        const canKick = Number.isFinite(threshold) && threshold > 0
        return (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-950/30 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-red-300">Vote to kick</div>
                <div className="text-[10px] font-bold text-zinc-400 leading-snug">
                  {canKick
                    ? `${votes}/${threshold} votes · resets every 3 min`
                    : 'Need 3+ players at the table'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onKickVote(seat.id)}
                disabled={!canKick}
                className="shrink-0 rounded-md border border-red-400/60 bg-red-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Kick
              </button>
            </div>
            {canKick && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-red-400 transition-all"
                  style={{ width: `${Math.min(100, (votes / threshold) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )
      })()}
    </div>,
    document.body
  )
}

// Pick a tint for the Luck stat based on its 0-10 score. 7+ glows green
// (running hot), 4 or below tints red (cold streak), middle stays neutral.
// Anything missing falls back to neutral via the default.
function luckAccent(score) {
  if (typeof score !== 'number') return 'zinc'
  if (score >= 7) return 'emerald'
  if (score <= 3) return 'red'
  return 'zinc'
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

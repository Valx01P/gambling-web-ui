'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { ProfileAvatar } from './ProfileSelector'

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

export default function PlayerProfilePopover({
  open,
  onClose,
  anchorRect,    // DOMRect of the clicked nameplate; used to position the popover
  seat           // { publicUserId, username, avatarUrl, avatarId, chips, pokerBuyIn, isBot, ... }
}) {
  const { user: viewer } = useAuth()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [followBusy, setFollowBusy] = useState(false)
  const popRef = useRef(null)

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

  // Position above the nameplate when there's room, below otherwise. We
  // do this in plain inline styles to avoid pulling in a positioning
  // library; the table is well-bounded so the math stays simple.
  let style = { position: 'fixed', zIndex: 350 }
  if (anchorRect) {
    const popHeight = 260
    const margin = 8
    const placeBelow = anchorRect.top - popHeight - margin < 0
    style.left = Math.max(8, Math.min(window.innerWidth - 280, anchorRect.left + anchorRect.width / 2 - 140))
    style.top = placeBelow
      ? anchorRect.bottom + margin
      : anchorRect.top - popHeight - margin
  } else {
    style.left = '50%'
    style.top = '50%'
    style.transform = 'translate(-50%, -50%)'
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
      style={style}
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
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <Stat label="Followers" value={info.followersCount} />
                <Stat label="Following" value={info.followingCount} />
              </div>
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

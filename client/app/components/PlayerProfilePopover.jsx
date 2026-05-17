'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { getTrophyTier } from '../lib/trophies'
import { ProfileAvatar } from './ProfileSelector'
import AchievementsGrid from './AchievementsGrid'
import PeerLoanPanel from './PeerLoanPanel'
import HandRangeMatrix from './HandRangeMatrix'

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
const POPOVER_WIDTH = 240
const POPOVER_HEIGHT = 220
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
  // Viewer's bank balance — used by PeerLoanPanel to decide whether the
  // viewer can offer vs only request a loan. Loan eligibility is based
  // on bank balance (the off-table wallet), not chips at the table.
  myBankBalance = 0,
  myPeerLoans,
  negotiations,
  onPeerLoanSend,
  viewerIsSpectator = false,
  // Kick-vote: `kickState` is the server snapshot ({ threshold, humanCount,
  // polls }); `onKickVote(targetId)` dispatches the vote message.
  kickState = null,
  onKickVote = null,
  // Nudge: dispatch a session notification to this seat ("X nudged you").
  // Server-side rate-limited to one every 8s per sender so this can't
  // be a spam vector. Optional — popover hides the button if absent.
  onNudge = null,
  // Insert `@username ` into the table chat and focus the input. Used as
  // the anon-target equivalent of "Send DM" — anons have no userId, so
  // direct DMs aren't possible; @ in chat is the next best discoverable
  // channel.
  onMentionInChat = null,
  // Send a session-scoped DM to this seat. Lands as a toast on the
  // recipient via SESSION_NOTIF — works for anon recipients too,
  // unlike the persisted DM system. Optional; popover hides the
  // composer when absent.
  onSessionDm = null,
  // Self-only quick-glance: poker buy-in budget. Everything else
  // (skin, name, avatar, felt color, achievements, ELO) lives in the
  // Tools menu / AccountMenu — this popover stays small.
  //
  // `onSelfBudgetCommit(value | null)` fires when the user commits
  // their change (Enter or blur). null = "clear budget". The server
  // is the source of truth for the actual seat numbers; we display
  // seat.chips / seat.pokerReserves / seat.pokerBudget directly.
  onSelfBudgetCommit = null,
  // Clicking the avatar or name in the self-popover should jump to
  // the in-page Edit Profile tool (the one inside the Tools menu,
  // NOT the global AccountMenu modal — those are separate). The
  // parent supplies this callback; we just fire it on click and
  // close the popover.
  onSelfEditProfile = null,
}) {
  const { user: viewer } = useAuth()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [followBusy, setFollowBusy] = useState(false)
  // Lazy-open the hand-range matrix so the popover stays compact for
  // users who just want stats. Resets on close so re-opening on a
  // different seat starts collapsed.
  const [showRangeMatrix, setShowRangeMatrix] = useState(false)
  useEffect(() => { if (!open) setShowRangeMatrix(false) }, [open])
  // Local draft for the "chips to play with" input. We sync it from
  // seat.pokerBudget every time the popover opens or the seat changes
  // — so a server-driven adjustment (auto-rebuy from reserves) doesn't
  // get clobbered by a stale draft.
  const [budgetDraft, setBudgetDraft] = useState('')
  useEffect(() => {
    if (open && seat?.id === myId) {
      const live = typeof seat.pokerBudget === 'number' ? seat.pokerBudget : ''
      setBudgetDraft(live === '' ? '' : String(live))
    }
  }, [open, seat?.id, seat?.pokerBudget, myId])
  // Session-DM composer — collapsed by default to keep the popover
  // compact. Opens on click; the input is purely local until Enter
  // dispatches it through onSessionDm. Resets on popover close.
  const [sessionDmOpen, setSessionDmOpen] = useState(false)
  const [sessionDmDraft, setSessionDmDraft] = useState('')
  useEffect(() => {
    if (!open) { setSessionDmOpen(false); setSessionDmDraft('') }
  }, [open])
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
        // First frame after open: the popover started at opacity 0
        // and only transitions opacity (no left/top) so it can't
        // visibly slide from (0,0). Reveal once positioned, then
        // install the left/top transitions on the NEXT frame so
        // future reflows (seats shifting around) still glide.
        if (pop.style.opacity !== '1') {
          pop.style.opacity = '1'
          requestAnimationFrame(() => {
            if (!pop || cancelled) return
            pop.style.transition = 'left 120ms ease-out, top 120ms ease-out, opacity 90ms ease-out'
          })
        }
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
  // the top-left corner before its position is computed.
  //
  // Important: the initial style only transitions OPACITY, never
  // left/top. The popover mounts at (0,0) and the rAF tick below
  // moves it to the anchor in the same frame — if we transitioned
  // left/top here, the user would see the popover visibly slide
  // in from the top-left corner of the screen (bug). The rAF tick
  // installs the position transitions AFTER the first paint, so
  // subsequent reflows (seat moves, layout changes) still glide.
  const initialStyle = {
    position: 'fixed',
    zIndex: 350,
    left: 0,
    top: 0,
    opacity: 0,
    transition: 'opacity 90ms ease-out',
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
  // Poker P/L. Prefer the server-computed `profit` when present
  // (that's the field the gameState seat-view publishes — it
  // already folds in mid-hand bets + open side-bet stake so posting
  // a blind doesn't show as an instant loss). Fall back to a
  // client-side compute against either field name the seat might
  // carry: `pokerBuyIn` from the room_update broadcast (Player.toJSON)
  // or `buyIn` from the gameState broadcast (_buildPlayerView).
  // Without that dual fallback, a fresh seat looked +$1000 because
  // gameState publishes `buyIn` and the popover was only checking
  // `pokerBuyIn` — undefined → profit = chips − 0 = +chips.
  const sessionProfit = typeof seat.profit === 'number'
    ? seat.profit
    : (seat.chips ?? 0) - (seat.pokerBuyIn ?? seat.buyIn ?? 0)
  // Bank P/L = how the off-table wallet has moved vs its starting
  // balance. Stocks, options, crypto, assets, jobs all settle here,
  // so this is the "investing / scamming" score, independent of poker.
  const bankProfit = (seat.bankBalance ?? 0) - (seat.bankStartBalance ?? 0)

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Profile for ${seat.username || 'player'}`}
      className="w-[240px] rounded-xl border border-zinc-600/60 bg-zinc-900/98 p-2.5 shadow-2xl"
      style={initialStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        {/* Self-shortcut: clicking the avatar or the username on your
            OWN seat opens the in-Tools "Edit Profile" panel (the one
            that lives at activePokerPanel === 'profile' — username
            input + ProfileSelector + Save). Works for both anon and
            signed-in users because that tools panel is the same
            surface anyone uses to change their table identity. */}
        {(() => {
          const isSelf = seat?.id === myId
          const canEdit = isSelf && typeof onSelfEditProfile === 'function'
          const Wrap = canEdit ? 'button' : 'div'
          const wrapProps = canEdit
            ? {
                type: 'button',
                onClick: () => { onSelfEditProfile(); onClose?.() },
                title: 'Edit your profile',
                className: 'flex flex-1 items-center gap-2 min-w-0 rounded-md text-left transition-colors hover:bg-zinc-800/40 -mx-1 -my-1 px-1 py-1',
              }
            : { className: 'flex flex-1 items-center gap-2 min-w-0' }
          return (
            <Wrap {...wrapProps}>
              <div className="relative shrink-0">
                <ProfileAvatar
                  avatarUrl={info?.avatarUrl || seat.avatarUrl}
                  avatarId={seat.avatarId}
                  name={info?.displayName || seat.username}
                  nameKey={info?.id || seat.id || seat.username}
                  size={36}
                  className="ring-1 ring-zinc-700"
                />
                {isLinked && info?.status && (
                  <span
                    className={`absolute -right-0 -bottom-0 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-zinc-900 ${STATUS_COLOR[info.status] || STATUS_COLOR.offline}`}
                    aria-label={STATUS_LABEL[info.status] || ''}
                    title={STATUS_LABEL[info.status] || ''}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-black text-white leading-tight">{info?.displayName || seat.username || 'Player'}</div>
                {canEdit ? (
                  <div className="text-[9px] font-bold text-zinc-400 leading-tight">Edit profile →</div>
                ) : isLinked ? (
                  info?.status && (
                    <div className="text-[9px] font-bold text-zinc-400 leading-tight">
                      {STATUS_LABEL[info.status]}
                      {info.status !== 'online' && info.lastActiveAt && ` · seen ${formatRelative(info.lastActiveAt)}`}
                    </div>
                  )
                ) : seat?.id !== myId && (
                  <div className="text-[9px] font-bold text-zinc-500 leading-tight">Anonymous</div>
                )}
              </div>
            </Wrap>
          )
        })()}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-0.5 rounded-md px-1 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >×</button>
      </div>

      {/* Self quick-glance: chips at the table + poker buy-in budget.
          Everything else (skin, name, avatar, felt color, achievements,
          ELO stats) lives in the Tools menu / AccountMenu — kept this
          popover small per the design ask after the first iteration
          ran tall and pulled a scrollbar. */}
      {seat?.id === myId && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-800/60 pt-2">
          {/* Money: chips at the table + off-table reserves + P/L.
              Reserves row only renders when there's something
              actually shelved, to keep the card tight. */}
          <div className="rounded-md border border-zinc-700/60 bg-zinc-950/40 px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">At the table</span>
              <span className="text-xs font-black tabular-nums text-white">${(seat.chips ?? 0).toLocaleString()}</span>
            </div>
            {(seat.pokerReserves ?? 0) > 0 && (
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Reserves</span>
                <span className="text-xs font-black tabular-nums text-amber-200">${seat.pokerReserves.toLocaleString()}</span>
              </div>
            )}
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Poker P/L</span>
              <span className={`text-xs font-black tabular-nums ${sessionProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {fmtChips(sessionProfit)}
              </span>
            </div>
          </div>
          {/* Bank wallet — separate score for the off-table money game
              (stocks, options, crypto, assets, jobs, etc). Always
              rendered for self so the player tracks the two
              independently. */}
          {(() => {
            const overdrawn = (seat.bankBalance ?? 0) < 0
            return (
              <div className={`rounded-md border px-2 py-1.5 ${overdrawn ? 'border-red-500/50 bg-red-950/30' : 'border-sky-700/40 bg-sky-950/20'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-sky-200">Bank balance</span>
                  <span className={`text-xs font-black tabular-nums ${overdrawn ? 'text-red-300' : 'text-white'}`}>${(seat.bankBalance ?? 0).toLocaleString()}</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-sky-200">Bank P/L</span>
                  <span className={`text-xs font-black tabular-nums ${bankProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {fmtChips(bankProfit)}
                  </span>
                </div>
                {overdrawn ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Tell the page to swap the active tools panel
                      // to the bank loan UI. Page.jsx listens for this
                      // event so the popover doesn't need a direct
                      // panel-router prop.
                      window.dispatchEvent(new CustomEvent('gwu:open-bank-panel'))
                      onClose?.()
                    }}
                    className="mt-1 inline-flex w-full items-center justify-center rounded-md border border-red-400/60 bg-red-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25"
                  >
                    Take a bank loan →
                  </button>
                ) : (
                  <div className="mt-0.5 text-[9px] font-bold text-sky-300/70">
                    Stocks · options · crypto · assets · jobs settle here.
                  </div>
                )}
              </div>
            )
          })()}
          {/* "Chips to play with" input intentionally removed. The
              poker stack is hard-capped at CHIP_STACK_MAX (1000) and
              auto-rebuy draws from the bank wallet, so a per-seat
              budget knob no longer has a job. */}
        </div>
      )}

      {/* Linked profile body — only renders for OTHER players. For
          the viewer's own seat we keep the popover minimal (money +
          budget above); the long stats grid + achievements + follow
          state belongs in the Tools menu / AccountMenu instead. */}
      {isLinked && seat?.id !== myId && (
        <>
          {loading && (
            <div className="mt-3 text-[11px] font-bold text-zinc-500">Loading…</div>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] font-bold text-red-200">{error}</div>
          )}
          {info && !loading && (
            <>
              {/* Daily-challenge trophy. Earned by completing daily
                  challenges (1/5/10/15/20/25/30/35/40/50). Shown to
                  every viewer so the upgrade is publicly visible. */}
              {(() => {
                const { current, next } = getTrophyTier(info.dailiesCompleted)
                if (!current && !next) return null
                return (
                  <div
                    className="mt-3 flex items-center gap-2 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1.5"
                    title={current
                      ? `${current.name} trophy — ${info.dailiesCompleted || 0} dailies completed${next ? `. Next: ${next.name} at ${next.min}.` : ' — top tier'}`
                      : `No trophy yet — ${Math.max(0, (next?.min || 1) - (info.dailiesCompleted || 0))} dailies until ${next?.name || 'Bronze'}`}
                  >
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-2 bg-zinc-950 text-base shrink-0 ${current ? current.ring : 'ring-zinc-700 opacity-60'}`}
                      style={current ? { boxShadow: `0 0 12px ${current.color}55` } : undefined}
                    >
                      {current ? current.emoji : '🏆'}
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      {current ? (
                        <>
                          <div className="text-[11px] font-black tracking-wide" style={{ color: current.color }}>
                            {current.name} trophy
                          </div>
                          <div className="text-[9px] font-bold text-zinc-500">
                            {info.dailiesCompleted || 0} dailies{next ? ` · next ${next.name} @ ${next.min}` : ' · top tier'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[11px] font-black text-zinc-300">No trophy yet</div>
                          <div className="text-[9px] font-bold text-zinc-500">
                            Finish {Math.max(0, (next?.min || 1) - (info.dailiesCompleted || 0))} {(next?.min || 1) === 1 ? 'daily' : 'dailies'} for {next?.name || 'Bronze'}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })()}
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
              {/* Bank wallet card — visible to other viewers too, since
                  the user explicitly wants the bank balance to surface
                  when someone clicks your profile (lender knows how
                  rich the borrower is before quoting a peer loan). */}
              {(seat.bankBalance != null || seat.bankStartBalance != null) && (
                <div className="mt-2 rounded-md border border-sky-700/40 bg-sky-950/20 px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-sky-200">Bank balance</span>
                    <span className={`text-xs font-black tabular-nums ${(seat.bankBalance ?? 0) < 0 ? 'text-red-300' : 'text-white'}`}>
                      ${(seat.bankBalance ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-sky-200">Bank P/L</span>
                    <span className={`text-xs font-black tabular-nums ${bankProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {fmtChips(bankProfit)}
                    </span>
                  </div>
                </div>
              )}
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

      {/* Anonymous body — only session signals exist. Splits the two
          P/Ls (poker chip P/L vs bank wallet P/L) so the viewer can
          see at a glance who's the best poker player vs who's the
          best business scammer. Compact layout mirrors the self-view
          rows above: small label/value pairs in two thin cards, no
          oversized Stat tiles — keeps the popover from running tall. */}
      {!isLinked && seat?.id !== myId && (
        <div className="mt-2 space-y-1.5">
          <div className="rounded-md border border-zinc-700/60 bg-zinc-950/40 px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">At the table</span>
              <span className="text-xs font-black tabular-nums text-white">${(seat.chips ?? 0).toLocaleString()}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Poker P/L</span>
              <span className={`text-xs font-black tabular-nums ${sessionProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {fmtChips(sessionProfit)}
              </span>
            </div>
          </div>
          {(() => {
            const overdrawn = (seat.bankBalance ?? 0) < 0
            return (
              <div className={`rounded-md border px-2 py-1.5 ${overdrawn ? 'border-red-500/50 bg-red-950/30' : 'border-sky-700/40 bg-sky-950/20'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-sky-200">Bank balance</span>
                  <span className={`text-xs font-black tabular-nums ${overdrawn ? 'text-red-300' : 'text-white'}`}>${(seat.bankBalance ?? 0).toLocaleString()}</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-sky-200">Bank P/L</span>
                  <span className={`text-xs font-black tabular-nums ${bankProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {fmtChips(bankProfit)}
                  </span>
                </div>
              </div>
            )
          })()}
          <div className="text-[9px] font-bold text-zinc-500 leading-snug">
            Anonymous — no ELO until they "Play as YOU".
          </div>
        </div>
      )}

      {/* Quick-contact row. Compact px-2 py-1 buttons so the popover
          chrome doesn't dwarf the loan panel below — the loan form is
          the headline action on a seat-click popover, everything else
          is supporting. Hidden for self and bots. */}
      {seat?.id !== myId && !seat?.isBot && (onNudge || isLinked || onMentionInChat) && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {isLinked && info?.id && (
            <button
              type="button"
              onClick={() => {
                if (typeof window === 'undefined') return
                window.dispatchEvent(new CustomEvent('gwu:open-dm', {
                  detail: {
                    user: {
                      id: info.id,
                      handle: info.handle,
                      displayName: info.displayName,
                      avatarUrl: info.avatarUrl,
                      avatarId: info.avatarId,
                    }
                  }
                }))
                onClose?.()
              }}
              className="rounded-md border border-sky-400/60 bg-sky-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-100 hover:bg-sky-500/25"
              title={`DM ${info?.displayName || seat.username}`}
            >
              DM
            </button>
          )}
          {!isLinked && onMentionInChat && (
            <button
              type="button"
              onClick={() => { onMentionInChat(seat.username || 'player'); onClose?.() }}
              className="rounded-md border border-sky-400/60 bg-sky-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-100 hover:bg-sky-500/25"
              title={`Mention ${seat.username} in chat — they'll see a session toast`}
            >
              @ chat
            </button>
          )}
          {onNudge && (
            <button
              type="button"
              onClick={() => onNudge(seat.id)}
              className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/20"
              title="Send a subtle toast — works whether they're signed in or not"
            >
              Nudge
            </button>
          )}
        </div>
      )}

      {/* Session-DM composer — quick one-off message that lands as a
          toast on the recipient. Works for anon recipients (the only
          path for talking to someone with no account). Collapses
          itself away when the popover closes. */}
      {onSessionDm && seat?.id !== myId && !seat?.isBot && (
        <div className="mt-1.5">
          {!sessionDmOpen ? (
            <button
              type="button"
              onClick={() => setSessionDmOpen(true)}
              className="w-full rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20"
              title="One-off session message — toast for them, no history"
            >
              Send session message
            </button>
          ) : (
            <div className="rounded-md border border-cyan-500/40 bg-zinc-950/40 p-2">
              <input
                autoFocus
                type="text"
                value={sessionDmDraft}
                maxLength={200}
                placeholder={`Message ${seat.username || 'this player'}…`}
                onChange={(e) => setSessionDmDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setSessionDmOpen(false); setSessionDmDraft('') }
                  if (e.key === 'Enter') {
                    const msg = sessionDmDraft.trim()
                    if (!msg) return
                    onSessionDm(seat.id, msg)
                    setSessionDmOpen(false)
                    setSessionDmDraft('')
                  }
                }}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-bold text-white outline-none focus:border-cyan-500"
              />
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="text-[9px] font-bold text-zinc-500">Enter to send · Esc to cancel</span>
                <button
                  type="button"
                  onClick={() => {
                    const msg = sessionDmDraft.trim()
                    if (!msg) return
                    onSessionDm(seat.id, msg)
                    setSessionDmOpen(false)
                    setSessionDmDraft('')
                  }}
                  disabled={sessionDmDraft.trim().length === 0}
                  className="rounded-md border border-cyan-400/60 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hand-range matrix — teaching aid. The 169-cell grid colors
          each starting hand by a synthesized preflop strength so the
          viewer can eyeball "what could this seat reasonably have here."
          Hidden for self (your own seat — useless) and bots (their
          range is whatever they were coded with, not a guess). Toggles
          inline; the popover grows vertically when opened. */}
      {seat?.id !== myId && !seat?.isBot && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowRangeMatrix(s => !s)}
            className="w-full rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
          >
            {showRangeMatrix ? 'Hide hand range' : 'Show hand range'}
          </button>
          {showRangeMatrix && (
            <div className="mt-2">
              <HandRangeMatrix title={`Likely hands for ${seat.username || 'this player'}`} />
            </div>
          )}
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
          myBankBalance={myBankBalance}
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
          <div className="mt-1.5 rounded-md border border-red-500/30 bg-red-950/30 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-widest text-red-300">Vote to kick</div>
                <div className="text-[9px] font-bold text-zinc-400 leading-snug">
                  {canKick
                    ? `${votes}/${threshold} votes · 3-min reset`
                    : 'Need 3+ players'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onKickVote(seat.id)}
                disabled={!canKick}
                className="shrink-0 rounded-md border border-red-400/60 bg-red-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Kick
              </button>
            </div>
            {canKick && (
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-zinc-800">
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

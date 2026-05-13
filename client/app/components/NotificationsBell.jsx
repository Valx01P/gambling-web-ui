'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../lib/useAuth'
import { useNotifications } from '../lib/useNotifications'
import { ProfileAvatar } from './ProfileSelector'

// One-line summary of each notification. Lives client-side because the
// renderer needs i18n-friendly strings, not server-side placeholders.
// Keep it stupid simple: a verb + actor + (optional) target.
function describe(notif) {
  const who = notif.sender?.displayName || notif.sender?.username || 'someone'
  switch (notif.kind) {
    case 'follow':         return `${who} started following you.`
    case 'mention':        return `${who} mentioned you in a ${notif.payload?.context || 'post'}.`
    case 'post_reply':     return `${who} replied to your post.`
    case 'comment_reply':  return `${who} replied to your comment.`
    case 'dm':             return `${who} sent you a message.`
    case 'table_invite':   return `${who} invited you to their table.`
    default:               return notif.payload?.message || `${who} did something.`
  }
}

// Where clicking a notification should take you. Returning null leaves
// the bell open so we can show a "no link" notification quietly.
function linkFor(notif) {
  if (notif.kind === 'follow' && notif.sender?.id) return `/users/${notif.sender.id}`
  if (notif.kind === 'table_invite' && notif.payload?.tableId) {
    return `/poker?table=${encodeURIComponent(notif.payload.tableId)}`
  }
  if (notif.kind === 'dm' && notif.sender?.id) return `/messages/${notif.sender.id}`
  if ((notif.kind === 'mention' || notif.kind === 'post_reply' || notif.kind === 'comment_reply') && notif.payload?.postId) {
    return `/feed/${notif.payload.postId}`
  }
  return null
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d`
  return new Date(ts).toLocaleDateString()
}

export default function NotificationsBell() {
  const { user } = useAuth()
  const { unread, items, loading, refresh, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (wrapRef.current?.contains(e.target)) return
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

  // Refetch on open so the dropdown shows the absolute latest when the
  // user actually looks at it (poll-based cache may be 30s stale).
  useEffect(() => { if (open) refresh() }, [open, refresh])

  if (!user) return null

  return (
    <div ref={wrapRef} className="relative inline-flex h-9 items-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        // Solid backdrop on the button so it reads cleanly over any
        // background. Matches the DMs button + profile avatar in the
        // global AccountDock.
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-500/50 bg-zinc-800/80 text-zinc-200 shadow-sm transition-colors hover:bg-zinc-700/90 hover:text-white"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full border border-zinc-900 bg-rose-500 px-1 text-[9px] font-black leading-[14px] text-white"
            aria-hidden
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[200] mt-2 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
            <div className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Notifications</div>
            {items.length > 0 && unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[10px] font-black uppercase tracking-widest text-amber-300 hover:text-amber-100"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <li className="px-3 py-4 text-center text-[11px] font-bold text-zinc-500">Loading…</li>
            )}
            {!loading && items.length === 0 && (
              <li className="px-3 py-6 text-center text-[11px] font-bold text-zinc-500">
                No notifications yet. Mentions, replies, and table invites land here.
              </li>
            )}
            {items.map(n => {
              const href = linkFor(n)
              const unreadDot = !n.readAt
              const inner = (
                <div className={`flex items-start gap-2 px-3 py-2 transition-colors hover:bg-zinc-800/60 ${unreadDot ? 'bg-zinc-950/40' : ''}`}>
                  {n.sender ? (
                    <ProfileAvatar
                      avatarUrl={n.sender.avatarUrl}
                      name={n.sender.displayName || n.sender.username}
                      nameKey={n.sender.id || n.sender.username}
                      size={28}
                    />
                  ) : (
                    <div className="h-7 w-7 shrink-0 rounded-full bg-zinc-700" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold text-zinc-100">{describe(n)}</div>
                    <div className="text-[10px] font-bold text-zinc-500">{timeAgo(n.createdAt)}</div>
                  </div>
                  {unreadDot && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-400" aria-label="unread" />
                  )}
                </div>
              )
              const onClick = () => { if (unreadDot) markRead(n.id); setOpen(false) }
              return (
                <li key={n.id} className="border-b border-zinc-800/60 last:border-b-0">
                  {href ? (
                    <Link href={href} onClick={onClick} className="block">
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" onClick={onClick} className="block w-full text-left">
                      {inner}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

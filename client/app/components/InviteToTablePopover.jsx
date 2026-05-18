'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { ProfileAvatar } from './ProfileSelector'

// Compact "search a user and invite them to this table" popover. Calls
// /api/dms/:userId with kind='table_invite' so the recipient gets both
// a chat bubble (the "Join table →" card) and a notification.
//
// Trigger element should be passed in via `triggerRef` (anchor) — we
// position the popover under it. Closed by click outside or ESC.

export default function InviteToTablePopover({ open, onClose, roomId, fromDisplayName }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  // Recent DM convo partners — pre-populated as quick-pick rows when the
  // search box is empty so the user can reinvite their last 5 contacts in
  // one click. Pulled lazily on open; the conversations endpoint already
  // sorts by last_message_at DESC.
  const [recents, setRecents] = useState([])
  const [sentTo, setSentTo] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  // Arrow-key cursor over the visible list (results when typing, recents
  // when not). Mirrors the DmsPopup pattern — Enter sends the invite to
  // whichever row the cursor is on, no mouse needed.
  const [cursor, setCursor] = useState(0)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setQ(''); setResults([]); setSentTo(null); setError(null); setBusyId(null); setCursor(0)
      return
    }
    function onPointer(e) { if (wrapRef.current?.contains(e.target)) return; onClose?.() }
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    // Pre-load recent contacts when the popover first opens. listDms is
    // already cheap (single indexed query) and we cap to 5 below — no
    // need to paginate or filter beyond the empty-query default.
    api.listDms()
      .then(({ conversations }) => setRecents((conversations || []).slice(0, 5)))
      .catch(() => setRecents([]))
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Debounced user search — only fires once typing pauses, keeps the
  // search endpoint quiet while the user is mid-word.
  useEffect(() => {
    if (!open) return
    if (q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(q.trim())
        setResults(users || [])
      } catch { setResults([]) }
    }, 200)
    return () => clearTimeout(t)
  }, [q, open])

  const isSearching = q.trim().length >= 2
  // Normalize recents → same {id, displayName, username, avatarUrl} shape
  // the search results have, so the row renderer doesn't have to branch.
  const recentUsers = recents
    .map(c => c.other)
    .filter(u => u && u.id)
  const visibleList = isSearching ? results : recentUsers
  useEffect(() => {
    setCursor(prev => Math.min(prev, Math.max(0, visibleList.length - 1)))
  }, [visibleList.length])

  async function invite(u) {
    if (!roomId) { setError('No active table — refresh.'); return }
    setBusyId(u.id); setError(null)
    try {
      await api.sendMessage(u.id, {
        body: `${fromDisplayName || 'A friend'} invited you to a poker table — join in!`,
        kind: 'table_invite',
        metadata: { tableId: roomId }
      })
      setSentTo(u.id)
      // Auto-clear "sent" badge after a beat so the row reads "send again"
      // if the user wants to remind them.
      setTimeout(() => setSentTo(prev => (prev === u.id ? null : prev)), 2500)
    } catch (err) {
      setError(err.detail || err.message || 'Couldn\'t send invite.')
    } finally { setBusyId(null) }
  }

  if (!open) return null

  return (
    <div
      ref={wrapRef}
      role="dialog"
      aria-modal="false"
      aria-label="Invite to table"
      // z-[900] keeps the invite popover above the equity widget and
      // top chrome (z-[500]), the popups (260+), the active tool
      // panel (z-[600] base / z-[900] for elevated panels), and the
      // docked Tools menu (z-[800]). It's a user-initiated action
      // overlay, so it should sit at the top of the chrome stack
      // while it's open.
      className="fixed right-3 top-16 z-[900] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md sm:right-6 sm:top-20"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Invite to this table</div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">×</button>
      </div>
      <div className="px-3 py-2">
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Arrow-nav over visibleList (search results when typing,
            // recent contacts when empty). Enter sends the invite to
            // whichever row the cursor is on.
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor(c => Math.min(visibleList.length - 1, c + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor(c => Math.max(0, c - 1))
            } else if (e.key === 'Enter') {
              const pick = visibleList[cursor]
              if (pick) { e.preventDefault(); invite(pick) }
            }
          }}
          placeholder="Search username or display name"
          // text-sm matches the rest of the app's inputs on desktop.
          // The 16px mobile floor in globals.css still applies.
          className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm font-bold text-white placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500"
        />
      </div>
      {error && <div className="px-3 pb-2 text-[10px] font-bold text-rose-300">{error}</div>}
      {/* Section label only when showing recents — search results don't
          need a header (the input already labels itself). */}
      {!isSearching && visibleList.length > 0 && (
        <div className="px-3 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">
          Recent
        </div>
      )}
      <ul className="max-h-[50vh] overflow-y-auto">
        {visibleList.length === 0 && isSearching && (
          <li className="px-3 py-3 text-center text-[11px] font-bold text-zinc-500">No matches.</li>
        )}
        {visibleList.length === 0 && !isSearching && (
          <li className="px-3 py-3 text-center text-[11px] font-bold text-zinc-500">
            Type a username — or message someone first to fill this list.
          </li>
        )}
        {visibleList.map((u, i) => {
          const sent = sentTo === u.id
          const busy = busyId === u.id
          return (
            <li
              key={u.id}
              className={`border-b border-zinc-800/60 last:border-b-0 ${i === cursor ? 'bg-zinc-800/60' : ''}`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <ProfileAvatar
                  avatarUrl={u.avatarUrl}
                  name={u.displayName || u.username}
                  nameKey={u.id}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-bold text-white">{u.displayName || u.username}</div>
                  {u.username && <div className="truncate text-[10px] font-bold text-zinc-400">@{u.username}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => invite(u)}
                  disabled={busy}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
                    sent
                      ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                      : 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-50'
                  }`}
                >
                  {sent ? 'Sent ✓' : (busy ? '…' : 'Invite')}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

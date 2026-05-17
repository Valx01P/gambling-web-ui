'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { useDms, DM_EVENT } from '../lib/useDms'
import { ProfileAvatar } from './ProfileSelector'

// Compact "Facebook-chat" style popup that lives in the top-right nav,
// next to the notifications bell. Two states inside the dropdown:
//   - List of conversations (default)
//   - Open conversation: message history + composer (when one selected)
// Plus a sub-mode for finding a new user to start a DM with.

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d`
  return new Date(ts).toLocaleDateString()
}

function previewBody(text, max = 60) {
  if (!text) return ''
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine
}

// Renders one user search result row for the "new DM" picker.
function UserResultRow({ user, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick(user)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-800/60"
    >
      <ProfileAvatar
        avatarUrl={user.avatarUrl}
        name={user.displayName || user.username}
        nameKey={user.id}
        size={28}
      />
      <div className="min-w-0">
        <div className="truncate text-[12px] font-bold text-white">{user.displayName || user.username}</div>
        {user.username && <div className="truncate text-[10px] font-bold text-zinc-400">@{user.username}</div>}
      </div>
    </button>
  )
}

// Single conversation row in the list view.
function ConversationRow({ conv, meId, onOpen }) {
  const fromMe = conv.lastSenderId === meId
  return (
    <button
      type="button"
      onClick={() => onOpen(conv)}
      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-800/60 ${conv.unread > 0 ? 'bg-zinc-950/40' : ''}`}
    >
      <ProfileAvatar
        avatarUrl={conv.other.avatarUrl}
        name={conv.other.displayName || conv.other.username}
        nameKey={conv.other.id}
        size={32}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-[12px] font-black text-white">{conv.other.displayName || conv.other.username}</div>
          <div className="shrink-0 text-[10px] font-bold text-zinc-500">{timeAgo(conv.lastMessageAt)}</div>
        </div>
        <div className="truncate text-[11px] font-bold text-zinc-400">
          {fromMe && <span className="text-zinc-500">You: </span>}
          {conv.lastKind === 'table_invite' ? '🎰 Table invite' : previewBody(conv.lastBody)}
        </div>
      </div>
      {conv.unread > 0 && (
        <span className="mt-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
          {conv.unread > 9 ? '9+' : conv.unread}
        </span>
      )}
    </button>
  )
}

// Server-side TTL for table invites. Mirror the constant client-side so
// we can grey out the join button as soon as the row crosses 60s — even
// if the periodic dm:deleted sweep hasn't fired yet (worst case 30s lag).
const INVITE_TTL_MS = 60_000

// Single message bubble. Sender on the right (own), recipient on left.
function MessageBubble({ msg, fromMe }) {
  const isInvite = msg.kind === 'table_invite' && msg.metadata?.tableId
  const inviteExpired = isInvite &&
    msg.created_at && (Date.now() - new Date(msg.created_at).getTime() > INVITE_TTL_MS)
  return (
    <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-[12px] font-bold leading-snug ${
        fromMe
          ? 'bg-amber-500/20 text-amber-100 border border-amber-400/30'
          : 'bg-zinc-800 text-zinc-100 border border-zinc-700'
      }`}>
        {isInvite ? (
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-200">
              Table invite{inviteExpired ? ' · expired' : ''}
            </div>
            <div className="mt-0.5">{msg.body}</div>
            {inviteExpired ? (
              <div className="mt-1 inline-block rounded border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Expired
              </div>
            ) : (
              <a
                href={`/poker?table=${encodeURIComponent(msg.metadata.tableId)}`}
                className="mt-1 inline-block rounded border border-amber-400/60 bg-amber-500/30 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/40"
              >
                Join table →
              </a>
            )}
          </div>
        ) : (
          msg.body
        )}
        <div className="mt-0.5 text-right text-[9px] font-bold opacity-60">{timeAgo(msg.created_at)}</div>
      </div>
    </div>
  )
}

export default function DmsPopup() {
  const { user } = useAuth()
  const { conversations, unread, loading, refresh, refreshCount } = useDms()
  const [open, setOpen] = useState(false)
  // Two view states only:
  //   activeChat null  → unified search + conversation list (search input
  //                       is ALWAYS visible; results vs conversations is
  //                       driven purely by how much the user has typed).
  //   activeChat {...} → open chat with the picked user.
  // The old `searchMode` toggle is gone — it forced users to click an
  // extra ✎ button and produced two awkward X icons side-by-side in the
  // header. Now you just open the dock and start typing.
  const [activeChat, setActiveChat] = useState(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  // Arrow-key cursor over whichever list is currently rendered (search
  // results when typing, conversations when empty). Reset to 0 each time
  // the underlying list changes so the highlight always lands on a real row.
  const [cursor, setCursor] = useState(0)
  const wrapRef = useRef(null)

  // ── Click outside / ESC ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onPointer(e) { if (wrapRef.current?.contains(e.target)) return; setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => { if (open) refresh() }, [open, refresh])

  // Programmatic open hook. Fire `window.dispatchEvent(new CustomEvent(
  // 'gwu:open-dm', { detail: { user: {id, handle, displayName, ...} } }))`
  // to pop the dock open onto a specific person's chat. Used by the
  // table seat popover's "DM" button so clicking a logged-in player
  // jumps straight into a conversation. Falls back gracefully if the
  // event lacks a `user`.
  useEffect(() => {
    function handler(e) {
      const u = e?.detail?.user
      if (!u || !u.id) return
      setOpen(true)
      setActiveChat(u)
    }
    window.addEventListener('gwu:open-dm', handler)
    return () => window.removeEventListener('gwu:open-dm', handler)
  }, [])

  // Clear the search box whenever the popup closes or the user opens a
  // chat. Keeps the next session-open fresh — no stale query left over
  // from last time.
  useEffect(() => {
    if (!open || activeChat) { setSearchQ(''); setSearchResults([]) }
  }, [open, activeChat])

  // ── User search (debounced) ─────────────────────────────────────────
  // Runs purely off the query length. The search input is always
  // mounted while the popup is open + no chat is active.
  useEffect(() => {
    if (!open || activeChat) return
    if (searchQ.trim().length < 2) { setSearchResults([]); return }
    const handle = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(searchQ.trim())
        setSearchResults(users || [])
      } catch { setSearchResults([]) }
    }, 200)
    return () => clearTimeout(handle)
  }, [open, activeChat, searchQ])

  // Whichever list is currently shown — search results or conversations.
  // The cursor + Enter handler both read from this so we don't have to
  // branch on "which list is visible" twice.
  const isSearching = searchQ.trim().length >= 2
  const visibleList = isSearching
    ? searchResults.map(u => ({ pickAs: u, key: u.id }))
    : conversations.slice(0, 5).map(c => ({ pickAs: c.other, key: c.conversationId }))
  // Reset the highlight whenever the underlying list changes (new query,
  // new conversations array). Clamp to the new length so the cursor never
  // points past the end.
  useEffect(() => {
    setCursor(prev => Math.min(prev, Math.max(0, visibleList.length - 1)))
  }, [visibleList.length])

  if (!user) return null

  return (
    <div ref={wrapRef} className="relative inline-flex h-9 items-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Messages${unread > 0 ? ` (${unread} unread)` : ''}`}
        // Solid backdrop on the button itself so it reads cleanly when
        // it floats over the green poker felt or any other background.
        // Matches the visual weight of the sibling profile avatar in the
        // global AccountDock.
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-500/50 bg-zinc-800/80 text-zinc-200 shadow-sm transition-colors hover:bg-zinc-700/90 hover:text-white"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="h-5 w-5" aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full border border-zinc-900 bg-rose-500 px-1 text-[9px] font-black leading-[14px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[200] mt-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
          {activeChat ? (
            <>
              <ChatHeader chat={activeChat} onBack={() => setActiveChat(null)} />
              <ChatView other={activeChat} meId={user.id} onSend={() => refreshCount()} />
            </>
          ) : (
            <>
              {/* Single header — just the title + close button. The
                  search input lives in the body and is always visible,
                  so there's nothing to toggle from up here. */}
              <ListHeader onClose={() => setOpen(false)} />
              <div className="border-t border-zinc-800/80 px-3 py-2">
                <input
                  autoFocus
                  type="text"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => {
                    // Arrow-key cursor over `visibleList` (search results
                    // when typing, recent conversations when not). Enter
                    // picks whichever row the cursor is on, so users can
                    // start a chat without ever touching the mouse.
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setCursor(c => Math.min(visibleList.length - 1, c + 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setCursor(c => Math.max(0, c - 1))
                    } else if (e.key === 'Enter') {
                      const pick = visibleList[cursor]?.pickAs
                      if (pick) { e.preventDefault(); setActiveChat(pick); setSearchQ('') }
                    }
                  }}
                  placeholder="Search a user to start a new message"
                  // text-sm = 14px desktop (matches the lobby + bot
                  // editor inputs). globals.css already forces 16px
                  // under the 640px breakpoint so iOS doesn't zoom on
                  // focus — but the visual style now ALSO matches the
                  // rest of the app's inputs on desktop.
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm font-bold text-white placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500"
                />
              </div>
              {/* Body: while the query is too short to search (<2 chars)
                  show the existing conversation list. Once the user
                  types 2+ chars, swap to user search results. No mode
                  toggle — the input drives everything. */}
              {isSearching ? (
                <ul className="max-h-[60vh] overflow-y-auto">
                  {searchResults.length === 0 && (
                    <li className="px-3 py-2.5 text-center text-[11px] font-bold text-zinc-500">No matches.</li>
                  )}
                  {searchResults.map((u, i) => (
                    <li
                      key={u.id}
                      className={`border-b border-zinc-800/60 last:border-b-0 ${i === cursor ? 'bg-zinc-800/60' : ''}`}
                    >
                      <UserResultRow user={u} onPick={(u) => { setActiveChat(u); setSearchQ('') }} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="max-h-[60vh] overflow-y-auto">
                  {/* Pinned "Table chat" entry — opens the in-page chat
                      dock via a window event. Only shown on /poker
                      where the dock exists; elsewhere the entry would
                      be a dead link. We check pathname at click-time
                      (not render-time) so a user who navigates while
                      the popup is open doesn't see a stale state. */}
                  {typeof window !== 'undefined' && window.location?.pathname?.startsWith('/poker') && (
                    <li className="border-b border-zinc-800/60">
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('gwu:open-table-chat'))
                          setOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-bold text-cyan-200 hover:bg-zinc-800/60"
                      >
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-[10px]">#</span>
                        <span className="min-w-0 flex-1 truncate">Table chat</span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-cyan-400/70">open</span>
                      </button>
                    </li>
                  )}
                  {loading && conversations.length === 0 && (
                    <li className="px-3 py-3 text-center text-[11px] font-bold text-zinc-500">Loading…</li>
                  )}
                  {!loading && conversations.length === 0 && (
                    <li className="px-3 py-4 text-center text-[11px] font-bold text-zinc-500">
                      No DMs yet. Search above to start one.
                    </li>
                  )}
                  {/* Cap the recent-conversations strip at 5 — the cursor
                      list stays in lockstep so arrow-nav lines up with
                      what's visible. Older conversations remain reachable
                      via search. */}
                  {conversations.slice(0, 5).map((c, i) => (
                    <li
                      key={c.conversationId}
                      className={`border-b border-zinc-800/60 last:border-b-0 ${i === cursor ? 'bg-zinc-800/60' : ''}`}
                    >
                      <ConversationRow conv={c} meId={user.id} onOpen={() => setActiveChat(c.other)} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ListHeader({ onClose }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
      <div className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Messages</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
      >×</button>
    </div>
  )
}

function ChatHeader({ chat, onBack }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800/80 px-2 py-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
      >‹</button>
      <ProfileAvatar
        avatarUrl={chat.avatarUrl}
        name={chat.displayName || chat.username}
        nameKey={chat.id}
        size={28}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-black text-white">{chat.displayName || chat.username}</div>
        {chat.username && <div className="truncate text-[10px] font-bold text-zinc-400">@{chat.username}</div>}
      </div>
    </div>
  )
}

// Loads message history for `other`, listens for live `dm:new` events
// while open, marks the conversation read on open, and provides a
// composer with cmd/ctrl-enter to send.
function ChatView({ other, meId, onSend }) {
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [body, setBody] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const { messages } = await api.listMessages(other.id, { limit: 80 })
      setMessages(messages || [])
      api.markConversationRead(other.id).catch(() => {})
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load')
    }
  }, [other.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Live WS push: append new messages from the open conversation as
    // they arrive. Ignore pushes for other conversations.
    function onDm(e) {
      const msg = e.detail
      if (!msg) return
      // Stale-invite eviction (host left their table). Drop the message
      // from the open thread immediately so the recipient doesn't try to
      // click into an empty table. Server already deleted the row.
      if (msg.type === 'dm:deleted') {
        const id = msg.data?.messageId
        if (id == null) return
        setMessages(prev => prev.filter(m => m.id !== id))
        return
      }
      if (msg.type !== 'dm:new') return
      const data = msg.data
      if (!data?.message) return
      if (data.otherId !== other.id && data.message.sender_user_id !== other.id) return
      setMessages(prev => {
        if (prev.some(m => m.id === data.message.id)) return prev
        return [...prev, data.message]
      })
      if (data.message.sender_user_id === other.id) {
        // We saw the message — mark it read.
        api.markConversationRead(other.id).catch(() => {})
      }
    }
    window.addEventListener(DM_EVENT, onDm)
    return () => window.removeEventListener(DM_EVENT, onDm)
  }, [other.id])

  // Keep the scroll pinned to the bottom on update.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const send = useCallback(async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true); setError(null)
    try {
      const { message } = await api.sendMessage(other.id, { body: text })
      // The server fires a `dm:new` push to the sender's other tabs at
      // the same time it returns the HTTP response — and `pushToUser`
      // delivers to THIS tab too. So the WS handler may have already
      // appended this message by the time we get here. Dedupe by id.
      setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message])
      setBody('')
      onSend?.()
    } catch (err) {
      setError(err.detail || err.message || 'Send failed')
    } finally {
      setBusy(false)
      // Re-focus the textarea so the user can keep typing without
      // having to click back into it. The disabled-while-busy attribute
      // momentarily steals focus, so we restore it after the toggle.
      // requestAnimationFrame waits one tick for React to re-enable the
      // input before .focus() lands.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [body, other.id, onSend])

  return (
    <div className="flex h-[60vh] max-h-[480px] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <div className="text-center text-[11px] font-bold text-zinc-500">No messages yet — say hi.</div>
        )}
        {messages.map(m => (
          <MessageBubble key={m.id} msg={m} fromMe={m.sender_user_id === meId} />
        ))}
      </div>
      <div className="border-t border-zinc-800/80 p-2">
        {error && <div className="mb-1 text-[10px] font-bold text-rose-300">{error}</div>}
        <div className="flex items-end gap-1">
          <textarea
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder="Write a message — Enter to send"
            rows={1}
            disabled={busy}
            className="max-h-24 min-h-[36px] flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-sm font-bold text-white outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !body.trim()}
            className="shrink-0 rounded-md border border-amber-400/60 bg-amber-500 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useUpload } from '../lib/useUpload'
import { useAuth } from '../lib/useAuth'
import { ProfileAvatar } from './ProfileSelector'

const MAX_BODY = 2000

// @-mention suggestion list. Triggers when the caret is right after an
// `@` followed by 0+ valid handle characters. We feed the partial
// handle to /api/users/search and pop a dropdown anchored under the
// textarea.
function useMentionSuggestions(text, caret) {
  const [results, setResults] = useState([])
  const [active, setActive] = useState(null) // { start, length, query } or null

  useEffect(() => {
    if (typeof text !== 'string') { setActive(null); return }
    // Walk back from caret looking for @. Stop at whitespace or @.
    let i = caret - 1
    while (i >= 0) {
      const ch = text[i]
      if (ch === '@') break
      if (!/[a-z0-9_]/i.test(ch)) { setActive(null); return }
      i--
    }
    if (i < 0 || text[i] !== '@') { setActive(null); return }
    // Make sure @ is at start-of-text or after whitespace — avoids
    // triggering on email-like substrings.
    if (i > 0 && !/\s/.test(text[i - 1])) { setActive(null); return }
    const query = text.slice(i + 1, caret).toLowerCase()
    setActive({ start: i, length: caret - i, query })
  }, [text, caret])

  useEffect(() => {
    if (!active) { setResults([]); return }
    if (active.query.length < 1) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(active.query)
        setResults(users || [])
      } catch { setResults([]) }
    }, 150)
    return () => clearTimeout(t)
  }, [active])

  return { active, results, clear: () => setActive(null) }
}

export default function PostComposer({ onPosted, defaultBody = '', defaultTableId = null }) {
  const { user } = useAuth()
  const [body, setBody] = useState(defaultBody)
  const [tableId, setTableId] = useState(defaultTableId)
  const [imageUrl, setImageUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [caret, setCaret] = useState(0)
  const textareaRef = useRef(null)
  const fileRef = useRef(null)

  const { upload, busy: uploading, error: uploadError } = useUpload()
  const { active, results, clear } = useMentionSuggestions(body, caret)

  const insertMention = useCallback((username) => {
    if (!active) return
    const before = body.slice(0, active.start)
    const after = body.slice(active.start + active.length)
    const replaced = `@${username} `
    const nextBody = before + replaced + after
    setBody(nextBody)
    clear()
    const nextCaret = (before + replaced).length
    // Restore focus + caret position in the textarea after React reflow.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
        setCaret(nextCaret)
      }
    })
  }, [active, body, clear])

  async function pickImage(file) {
    if (!file) return
    setError(null)
    try {
      const { publicUrl } = await upload(file, { kind: 'post', saveToHistory: false })
      setImageUrl(publicUrl)
    } catch (err) {
      setError(err.detail || err.message || 'Image upload failed')
    }
  }

  async function submit() {
    if (busy || uploading) return
    const trimmed = body.trim()
    if (!trimmed && !imageUrl) { setError('Add some text or an image.'); return }
    setBusy(true); setError(null)
    try {
      const { post } = await api.createPost({
        body: trimmed, imageUrl, tableId: tableId || null
      })
      // Reset composer to empty state.
      setBody(''); setImageUrl(null); setTableId(defaultTableId || null)
      onPosted?.(post)
    } catch (err) {
      setError(err.detail || err.message || 'Post failed')
    } finally { setBusy(false) }
  }

  if (!user) {
    // Click → fire the global open-signin event. The AccountDock's
    // AccountMenu listens for this and pops its sign-in dropdown open
    // at the top-right, so the user lands on the right action without
    // having to find the dock button themselves.
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('pokerxyz:open-signin'))}
        className="block w-full rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-3 text-center text-[11px] font-bold text-zinc-300 transition-colors hover:border-amber-400/40 hover:bg-zinc-800/60 hover:text-amber-200 sm:p-4 sm:text-[12px]"
      >
        Sign in to post →
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/60 p-2 sm:p-2.5">
      {/* Compact avatar + tighter gap to claw back vertical space —
          the textarea is forced to 16px on phones (iOS zoom floor) so
          the rest of the card scales around it. Shorter placeholder
          so it doesn't visually truncate inside the narrow feed window. */}
      <div className="flex items-start gap-1.5 sm:gap-2">
        <ProfileAvatar
          avatarUrl={user.avatarUrl}
          name={user.displayName || user.username}
          nameKey={user.id}
          size={26}
        />
        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value.slice(0, MAX_BODY))
              setCaret(e.target.selectionStart)
            }}
            onKeyUp={(e) => setCaret(e.target.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
            }}
            placeholder="Share a hand, a thought, a table…  @mention to ping."
            // 2 rows always — keeps the composer footprint small so it
            // doesn't dominate the feed window on cramped viewports.
            // The 16px iOS floor in globals.css keeps focus from zooming.
            rows={2}
            disabled={busy}
            className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-[13px] font-bold text-white outline-none disabled:opacity-50 sm:px-2.5 sm:py-1.5 sm:text-sm"
          />

          {/* Mention suggestions popdown — appears under the textarea
              while the caret is inside an @handle. Clicking a row
              replaces the partial handle with a full @username + space. */}
          {active && results.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 shadow-lg">
              {results.map(u => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => insertMention(u.username || u.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-800"
                  >
                    <ProfileAvatar
                      avatarUrl={u.avatarUrl}
                      name={u.displayName || u.username}
                      nameKey={u.id}
                      size={22}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold text-white">{u.displayName || u.username}</div>
                      {u.username && <div className="truncate text-[10px] font-bold text-zinc-400">@{u.username}</div>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {imageUrl && (
            <div className="mt-2 relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" className="block max-h-64 w-full rounded-md object-contain bg-black border border-zinc-800" />
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                className="absolute right-2 top-2 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[10px] font-bold text-zinc-200 hover:bg-zinc-800"
              >
                Remove
              </button>
            </div>
          )}

          {tableId && (
            <div className="mt-2 flex items-center justify-between rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-100">
              <span>Sharing table {tableId}</span>
              <button type="button" onClick={() => setTableId(null)} className="text-amber-200/80 hover:text-white">Remove</button>
            </div>
          )}

          {(error || uploadError) && (
            <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-200">
              {error || uploadError}
            </div>
          )}

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || busy}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              >
                {uploading ? 'Up…' : (imageUrl ? 'Swap img' : '📷')}
              </button>
              <span className="ml-1 text-[9px] font-bold text-zinc-500 tabular-nums">
                {body.length}/{MAX_BODY}
              </span>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={busy || uploading || (!body.trim() && !imageUrl)}
              className="rounded-md border border-amber-400/60 bg-amber-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

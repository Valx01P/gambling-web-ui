'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { api } from '../lib/api'
import { ProfileAvatar } from './ProfileSelector'

// Render a post body with @mention highlighting + URL detection. Output
// is React nodes so any text we render stays safe — no dangerouslySet.
const MENTION_RE = /@([a-z0-9_]{3,24})/g
const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>(),.!?]/g

export function FormattedBody({ text }) {
  if (!text) return null
  // Tokenize: walk through both mention + url matches and emit slices
  // between them as plain text. Single pass — O(n) in body length.
  const out = []
  let lastIndex = 0
  const matches = []
  let m
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    matches.push({ kind: 'mention', index: m.index, length: m[0].length, value: m[1] })
  }
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    matches.push({ kind: 'url', index: m.index, length: m[0].length, value: m[0] })
  }
  matches.sort((a, b) => a.index - b.index)
  for (const m of matches) {
    if (m.index < lastIndex) continue
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index))
    if (m.kind === 'mention') {
      out.push(
        <Link
          key={`m-${m.index}`}
          href={`/users/${m.value}`}
          className="text-amber-300 hover:text-amber-100 hover:underline"
        >@{m.value}</Link>
      )
    } else {
      out.push(
        <a
          key={`u-${m.index}`}
          href={m.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-300 hover:text-cyan-100 hover:underline break-all"
        >{m.value}</a>
      )
    }
    lastIndex = m.index + m.length
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex))
  return <>{out.map((node, i) => typeof node === 'string'
    ? <span key={i}>{node}</span>
    : node)}</>
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

export default function PostCard({ post, viewerId, onChanged, onDeleted, dense = false }) {
  const [liked, setLiked] = useState(!!post.likedByMe)
  const [likeCount, setLikeCount] = useState(post.likeCount || 0)
  const [likeBusy, setLikeBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const toggleLike = useCallback(async () => {
    if (likeBusy) return
    setLikeBusy(true)
    const wasLiked = liked
    // Optimistic: flip immediately, revert on error.
    setLiked(!wasLiked)
    setLikeCount(c => Math.max(0, c + (wasLiked ? -1 : 1)))
    try {
      const r = wasLiked ? await api.unlikePost(post.id) : await api.likePost(post.id)
      if (typeof r.likeCount === 'number') setLikeCount(r.likeCount)
      onChanged?.()
    } catch {
      setLiked(wasLiked)
      setLikeCount(c => Math.max(0, c + (wasLiked ? 1 : -1)))
    } finally { setLikeBusy(false) }
  }, [liked, likeBusy, post.id, onChanged])

  async function destroy() {
    if (deleting) return
    if (!confirm('Delete this post?')) return
    setDeleting(true)
    try { await api.deletePost(post.id); onDeleted?.(post.id) }
    catch { setDeleting(false) }
  }

  const isMine = viewerId && viewerId === post.authorId

  return (
    <article className={`rounded-xl border border-zinc-700/70 bg-zinc-900/60 ${dense ? 'p-2.5 sm:p-3' : 'p-3 sm:p-4'} transition-colors hover:border-zinc-600/70`}>
      <header className="flex items-start gap-2 sm:gap-3">
        <Link href={`/users/${post.author?.username || post.authorId}`} className="shrink-0">
          <ProfileAvatar
            avatarUrl={post.author?.avatarUrl}
            name={post.author?.displayName || post.author?.username}
            nameKey={post.author?.id}
            size={32}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/users/${post.author?.username || post.authorId}`}
                className="truncate text-xs font-black text-white hover:underline sm:text-sm"
              >
                {post.author?.displayName || post.author?.username || 'Anon'}
              </Link>
              {post.author?.username && (
                <span className="ml-1 text-[10px] font-bold text-zinc-500 sm:text-[11px]">@{post.author.username}</span>
              )}
            </div>
            <Link href={`/feed/${post.id}`} className="shrink-0 text-[10px] font-bold text-zinc-500 hover:text-zinc-300 sm:text-[11px]">
              {timeAgo(post.createdAt)}
            </Link>
          </div>
        </div>
      </header>

      {post.body && (
        <div className="mt-2 whitespace-pre-wrap break-words text-xs font-bold leading-relaxed text-zinc-100 sm:text-sm">
          <FormattedBody text={post.body} />
        </div>
      )}

      {post.imageUrl && (
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.imageUrl}
            alt=""
            className="block max-h-[60vh] w-full object-contain bg-black"
            loading="lazy"
          />
        </div>
      )}

      {post.tableId && (
        <a
          href={`/poker?table=${encodeURIComponent(post.tableId)}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-amber-200 hover:bg-amber-500/20"
        >
          🎰 Join shared table →
        </a>
      )}

      <footer className="mt-3 flex items-center gap-3 text-[11px] font-bold text-zinc-400">
        <button
          type="button"
          onClick={toggleLike}
          disabled={likeBusy}
          aria-pressed={liked}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-zinc-800 ${liked ? 'text-rose-300' : 'text-zinc-400 hover:text-white'}`}
        >
          <span>{liked ? '♥' : '♡'}</span>
          <span>{likeCount}</span>
        </button>
        <Link href={`/feed/${post.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-800 hover:text-white">
          💬 {post.commentCount || 0}
        </Link>
        <div className="flex-1" />
        {isMine && (
          <button
            type="button"
            onClick={destroy}
            disabled={deleting}
            className="rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:bg-rose-500/15 hover:text-rose-200"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        )}
      </footer>
    </article>
  )
}

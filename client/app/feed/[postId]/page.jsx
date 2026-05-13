'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import HomeBackLink from '../../components/HomeBackLink'
// AccountMenu (profile + DMs + notifications) is mounted globally via
// AccountDock in the root layout.
import PostCard, { FormattedBody } from '../../components/PostCard'
import { ProfileAvatar } from '../../components/ProfileSelector'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`
  return new Date(ts).toLocaleDateString()
}

function CommentRow({ c, viewerId, onDelete, onReply }) {
  const isMine = viewerId && viewerId === c.authorId
  return (
    <div className="flex items-start gap-2 py-2">
      <Link href={`/users/${c.author?.username || c.authorId}`} className="shrink-0">
        <ProfileAvatar
          avatarUrl={c.author?.avatarUrl}
          name={c.author?.displayName || c.author?.username}
          nameKey={c.author?.id}
          size={28}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link
            href={`/users/${c.author?.username || c.authorId}`}
            className="truncate text-[12px] font-black text-white hover:underline"
          >
            {c.author?.displayName || c.author?.username}
          </Link>
          <span className="text-[10px] font-bold text-zinc-500">{timeAgo(c.createdAt)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-[13px] font-bold leading-snug text-zinc-100">
          <FormattedBody text={c.body} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-zinc-500">
          <button type="button" onClick={() => onReply(c)} className="hover:text-amber-200">Reply</button>
          {isMine && (
            <button type="button" onClick={() => onDelete(c.id)} className="hover:text-rose-200">Delete</button>
          )}
        </div>
      </div>
    </div>
  )
}

// Threading: render top-level comments first; under each, list its
// children indented. Two-level only (parent_comment_id can point to a
// top-level OR another reply, but we flatten all replies under the
// nearest top-level for display).
function CommentThreads({ comments, viewerId, onDelete, onReply }) {
  const byParent = new Map()
  const topLevel = []
  for (const c of comments) {
    if (c.parentCommentId) {
      const list = byParent.get(c.parentCommentId) || []
      list.push(c)
      byParent.set(c.parentCommentId, list)
    } else {
      topLevel.push(c)
    }
  }
  // Flatten: each parent comment ID resolves to a chain of descendants.
  function descendantsOf(id) {
    const out = []
    const stack = [id]
    while (stack.length) {
      const cur = stack.shift()
      const kids = byParent.get(cur) || []
      for (const k of kids) { out.push(k); stack.push(k.id) }
    }
    return out
  }
  return (
    <ul className="divide-y divide-zinc-800/60">
      {topLevel.map(c => (
        <li key={c.id} className="px-1">
          <CommentRow c={c} viewerId={viewerId} onDelete={onDelete} onReply={onReply} />
          <ul className="ml-6 border-l border-zinc-800 pl-3">
            {descendantsOf(c.id).map(child => (
              <li key={child.id}>
                <CommentRow c={child} viewerId={viewerId} onDelete={onDelete} onReply={onReply} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

export default function PostDetailPage({ params }) {
  const { postId } = use(params)
  const { user } = useAuth()
  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState(null) // { id, author }
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { post, comments } = await api.getPost(postId)
      setPost(post); setComments(comments || [])
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load')
    } finally { setLoading(false) }
  }, [postId])

  useEffect(() => { load() }, [load])

  async function submit() {
    const trimmed = body.trim()
    if (!trimmed) return
    setSending(true)
    try {
      const { comment } = await api.addComment(postId, {
        body: trimmed,
        parentCommentId: replyTo?.id || null
      })
      setComments(prev => [...prev, comment])
      setBody(''); setReplyTo(null)
      // Bump the post's comment_count optimistically.
      setPost(p => p ? { ...p, commentCount: (p.commentCount || 0) + 1 } : p)
    } catch (err) {
      setError(err.detail || err.message || 'Comment failed')
    } finally { setSending(false) }
  }

  async function onCommentDelete(id) {
    if (!confirm('Delete this comment?')) return
    try {
      await api.deleteComment(id)
      setComments(prev => prev.filter(c => c.id !== id))
      setPost(p => p ? { ...p, commentCount: Math.max(0, (p.commentCount || 0) - 1) } : p)
    } catch (err) {
      setError(err.detail || err.message || 'Delete failed')
    }
  }

  return (
    <div className="min-h-screen px-4 pb-12 pt-4 text-white">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {/* Right side reserved for the global AccountDock. */}
        <header className="flex items-center justify-between gap-2 pr-12 sm:pr-14">
          <HomeBackLink />
          <Link href="/feed" className="text-[11px] font-black uppercase tracking-widest text-zinc-300 hover:text-white">← Feed</Link>
          <div className="w-9" aria-hidden="true" />
        </header>

        {loading && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-6 text-center text-sm font-bold text-zinc-400">
            Loading…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-bold text-rose-200">
            {error}
          </div>
        )}
        {!loading && !error && !post && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-6 text-center text-sm font-bold text-zinc-400">
            This post doesn't exist or was deleted.
          </div>
        )}

        {post && (
          <>
            <PostCard post={post} viewerId={user?.id} />

            <section className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-3">
              <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">
                {comments.length} comment{comments.length === 1 ? '' : 's'}
              </div>
              <CommentThreads
                comments={comments}
                viewerId={user?.id}
                onDelete={onCommentDelete}
                onReply={(c) => setReplyTo({ id: c.id, author: c.author })}
              />

              {user ? (
                <div className="mt-3">
                  {replyTo && (
                    <div className="mb-1 flex items-center justify-between rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-100">
                      <span>Replying to {replyTo.author?.displayName || replyTo.author?.username}</span>
                      <button type="button" onClick={() => setReplyTo(null)} className="text-amber-200/80 hover:text-white">×</button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value.slice(0, 2000))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                      }}
                      placeholder={replyTo ? 'Write a reply' : 'Write a comment'}
                      rows={1}
                      disabled={sending}
                      className="max-h-24 min-h-[34px] flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-[13px] font-bold text-white outline-none disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={submit}
                      disabled={sending || !body.trim()}
                      className="shrink-0 rounded-md border border-amber-400/60 bg-amber-500 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending ? '…' : 'Reply'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-zinc-700/70 bg-zinc-950/40 px-3 py-2 text-center text-[11px] font-bold text-zinc-400">
                  Sign in to comment.
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

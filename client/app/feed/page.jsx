'use client'

import { useCallback, useEffect, useState } from 'react'
import HomeBackLink from '../components/HomeBackLink'
// AccountMenu (profile + DMs + notifications) is mounted globally via
// AccountDock in the root layout.
import PostComposer from '../components/PostComposer'
import PostCard from '../components/PostCard'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'

// Top-level social feed. Composer at the top (signed-in only), reverse-
// chronological global timeline below. Anonymous viewers can browse but
// not interact — every action route is authRequired server-side.
export default function FeedPage() {
  const { user } = useAuth()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [endReached, setEndReached] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchInitial = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { posts } = await api.listFeed({ limit: 20 })
      setPosts(posts || [])
      setEndReached((posts || []).length < 20)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load feed')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchInitial() }, [fetchInitial])

  const loadMore = useCallback(async () => {
    if (loadingMore || endReached || posts.length === 0) return
    setLoadingMore(true)
    try {
      const last = posts[posts.length - 1]
      const { posts: more } = await api.listFeed({ beforeId: last.id, limit: 20 })
      setPosts(prev => [...prev, ...(more || [])])
      if ((more || []).length < 20) setEndReached(true)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load more')
    } finally { setLoadingMore(false) }
  }, [posts, loadingMore, endReached])

  function onPosted(post) {
    setPosts(prev => [post, ...prev])
  }
  function onDeleted(id) {
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  return (
    // Tighter outer padding + gaps on mobile so the feed reads at the
    // same density as the rest of the app (bot rows, lobby cards) on
    // narrow screens. sm:+ keeps the original generous spacing for
    // tablets/desktop. Top padding bumped so the centered content
    // starts below the fixed Home / Sign-in chips at top-left/right.
    <div className="min-h-screen px-3 pb-8 pt-14 text-white sm:px-4 sm:pb-12 sm:pt-16">
      {/* Home pinned to the viewport's LEFT edge so it mirrors the
          AccountDock (Sign-in / profile cluster) at the viewport's
          RIGHT edge. Both are fixed-position chips at the same height
          and roughly the same width, so the page chrome reads
          symmetrically instead of one nav being in-flow-left and the
          other floating-right. */}
      <div className="fixed left-3 top-3 z-20 sm:left-4 sm:top-4">
        <HomeBackLink />
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-2.5 sm:gap-4">
        <header className="flex items-center justify-center gap-2">
          <div className="text-xs font-black uppercase tracking-widest text-zinc-300 sm:text-sm">Feed</div>
        </header>

        <PostComposer onPosted={onPosted} />

        {loading && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-4 text-center text-xs font-bold text-zinc-400 sm:p-6 sm:text-sm">
            Loading the feed…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-200 sm:text-sm">
            {error}
          </div>
        )}
        {!loading && posts.length === 0 && !error && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-4 text-center text-xs font-bold text-zinc-400 sm:p-6 sm:text-sm">
            Nothing here yet. Be the first to post.
          </div>
        )}

        <div className="flex flex-col gap-2.5 sm:gap-3">
          {posts.map(p => (
            <PostCard
              key={p.id}
              post={p}
              viewerId={user?.id}
              onDeleted={onDeleted}
            />
          ))}
        </div>

        {!endReached && posts.length > 0 && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="self-center rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
        {endReached && posts.length > 0 && (
          <div className="self-center text-[10px] font-bold text-zinc-600">— the bottom of the feed —</div>
        )}
      </div>
    </div>
  )
}

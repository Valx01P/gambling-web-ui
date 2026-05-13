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
    <div className="min-h-screen px-4 pb-12 pt-4 text-white">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {/* Right side reserved for the global AccountDock; pr-12/14
            keeps the centered Feed title from drifting under it. */}
        <header className="flex items-center justify-between gap-2 pr-12 sm:pr-14">
          <HomeBackLink />
          <div className="text-sm font-black uppercase tracking-widest text-zinc-300">Feed</div>
          <div className="w-9" aria-hidden="true" />
        </header>

        <PostComposer onPosted={onPosted} />

        {loading && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-6 text-center text-sm font-bold text-zinc-400">
            Loading the feed…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-bold text-rose-200">
            {error}
          </div>
        )}
        {!loading && posts.length === 0 && !error && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-6 text-center text-sm font-bold text-zinc-400">
            Nothing here yet. Be the first to post.
          </div>
        )}

        <div className="flex flex-col gap-3">
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

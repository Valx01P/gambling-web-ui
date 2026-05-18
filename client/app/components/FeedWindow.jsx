'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import PostComposer from './PostComposer'
import PostCard from './PostCard'
import FloatingWindow from './FloatingWindow'

// Social-feed window — composer + scrollable post list inside a
// draggable/resizable shell. All the chrome (title bar, drag, resize,
// position persistence, reset, refresh) lives in FloatingWindow; this
// file is just the feed-specific body + data loading.

export default function FeedWindow({ open, onClose }) {
  const { user } = useAuth()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [endReached, setEndReached] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  // `loadedOnce` gates the auto-fetch effect. Without it, an empty feed
  // (posts.length === 0 after a successful fetch) would retrigger the
  // effect every render because the dependencies still match — causing
  // the visible "Loading… / Nothing here yet" flicker.
  const [loadedOnce, setLoadedOnce] = useState(false)

  const fetchInitial = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { posts } = await api.listFeed({ limit: 20 })
      setPosts(posts || [])
      setEndReached((posts || []).length < 20)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load feed')
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [])

  // Lazy-fetch only on the FIRST open. After that, the empty-state UI
  // gives the user a Reload button instead of auto-retrying.
  useEffect(() => {
    if (open && !loadedOnce && !loading) fetchInitial()
  }, [open, loadedOnce, loading, fetchInitial])

  const loadMore = useCallback(async () => {
    if (loadingMore || endReached || posts.length === 0) return
    setLoadingMore(true)
    try {
      const last = posts[posts.length - 1]
      const { posts: more } = await api.listFeed({ beforeId: last.id, limit: 20 })
      setPosts(prev => [...prev, ...(more || [])])
      if ((more || []).length < 20) setEndReached(true)
    } catch {} finally { setLoadingMore(false) }
  }, [posts, loadingMore, endReached])

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      // Intentionally no onBack — Feed is a long-form popup; Tools
      // stays reachable from its own nav button.
      onRefresh={fetchInitial}
      refreshing={loading}
      title="Social"
      icon="★"
      accent="violet"
      storageKey="pokerxyz:feedwin"
      defaultWidth={380}
      defaultHeight={520}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5 text-white sm:gap-2 sm:p-2">
        {user && <PostComposer onPosted={(p) => setPosts(prev => [p, ...prev])} />}
        {loading && (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/40 p-3 text-center text-[11px] font-bold text-zinc-400 sm:p-4 sm:text-xs">
            Loading the feed…
          </div>
        )}
        {error && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] font-bold text-rose-200 sm:p-3 sm:text-xs">
            <span>{error}</span>
            <button
              type="button"
              onClick={fetchInitial}
              className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-rose-100 hover:bg-rose-500/20"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && posts.length === 0 && !error && loadedOnce && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-900/40 p-3 text-center text-[11px] font-bold text-zinc-400 sm:p-4 sm:text-xs">
            <span>Nothing here yet.</span>
            <button
              type="button"
              onClick={fetchInitial}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-800"
            >
              Reload
            </button>
          </div>
        )}
        {posts.map(p => (
          <PostCard
            key={p.id}
            post={p}
            viewerId={user?.id}
            onDeleted={(id) => setPosts(prev => prev.filter(x => x.id !== id))}
            dense
          />
        ))}
        {!endReached && posts.length > 0 && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="self-center rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </FloatingWindow>
  )
}

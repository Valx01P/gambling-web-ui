'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, getStoredToken } from './api'

// Polling cadence for the unread-count fallback when the page doesn't
// have an open WS (Bots list, profile, etc). 30s is a reasonable trade
// between freshness and request volume; the bell will refresh on focus
// on top of this so a user coming back from another tab sees the dot
// flip immediately if anything landed.
const POLL_MS = 30_000

// Cross-tab message bus the WS layer pumps notif events into. Keeping
// this as a CustomEvent on window means /poker (where the WS lives) and
// /poker/bots (where it doesn't) share a single API for getting live
// updates; pages without WS just don't get the push and rely on the
// poll above.
export const NOTIF_EVENT = 'pokerxyz:notif'
export function emitNotifEvent(payload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTIF_EVENT, { detail: payload }))
}

// Headline state every consumer (bell + future panel) needs. Holds the
// unread count plus a 30-item "recent" cache so the dropdown opens
// instantly with whatever the last fetch returned. Initial load is gated
// on having a JWT so we don't fire an unauthorized request for anon
// visitors.
export function useNotifications() {
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !getStoredToken()) return
    setLoading(true)
    try {
      const { notifications, unread } = await api.listNotifications({ limit: 30 })
      setItems(notifications || [])
      setUnread(unread || 0)
    } catch {
      /* swallow — bell stays at last-known state */
    } finally { setLoading(false) }
  }, [])

  const refreshCount = useCallback(async () => {
    if (typeof window === 'undefined' || !getStoredToken()) return
    try {
      const { unread } = await api.notificationsUnreadCount()
      setUnread(unread || 0)
    } catch {}
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!getStoredToken()) return
    refresh()
    const id = setInterval(refreshCount, POLL_MS)
    function onVisible() { if (!document.hidden) refreshCount() }
    document.addEventListener('visibilitychange', onVisible)
    function onAuthChange() {
      if (getStoredToken()) refresh()
      else { setItems([]); setUnread(0) }
    }
    window.addEventListener('gwu:auth-changed', onAuthChange)
    // WS bridge: /poker's open socket emits these on each notif:new /
    // notif:unread. Other pages just rely on the poll above.
    function onNotifEvent(e) {
      const msg = e.detail
      if (!msg) return
      if (msg.type === 'notif:new' && msg.data) {
        setItems(prev => {
          if (prev.some(p => p.id === msg.data.id)) return prev
          return [msg.data, ...prev].slice(0, 30)
        })
        setUnread(u => u + 1)
      } else if (msg.type === 'notif:unread' && typeof msg.data?.unread === 'number') {
        setUnread(msg.data.unread)
      }
    }
    window.addEventListener(NOTIF_EVENT, onNotifEvent)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('gwu:auth-changed', onAuthChange)
      window.removeEventListener(NOTIF_EVENT, onNotifEvent)
    }
  }, [refresh, refreshCount])

  const markRead = useCallback(async (id) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n))
    setUnread(u => Math.max(0, u - 1))
    try { await api.markNotificationRead(id) }
    catch {}
  }, [])

  const markAllRead = useCallback(async () => {
    setItems(prev => prev.map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
    setUnread(0)
    try { await api.markAllNotificationsRead() }
    catch {}
  }, [])

  return { unread, items, loading, refresh, markRead, markAllRead }
}

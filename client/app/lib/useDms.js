'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, getStoredToken } from './api'

const POLL_MS = 30_000
export const DM_EVENT = 'pokerxyz:dm'
export function emitDmEvent(payload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DM_EVENT, { detail: payload }))
}

// Conversation list + unread badge state for the nav popup. WS pushes
// from /poker forward `dm:new` / `dm:read` / `dm:unread` through
// emitDmEvent; pages without the WS poll every 30s.
export function useDms() {
  const [conversations, setConversations] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !getStoredToken()) return
    setLoading(true)
    try {
      const { conversations, unread } = await api.listDms()
      setConversations(conversations || [])
      setUnread(unread || 0)
    } catch {} finally { setLoading(false) }
  }, [])

  const refreshCount = useCallback(async () => {
    if (typeof window === 'undefined' || !getStoredToken()) return
    try {
      const { unread } = await api.dmsUnreadCount()
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
      else { setConversations([]); setUnread(0) }
    }
    window.addEventListener('gwu:auth-changed', onAuthChange)
    // WS bridge: dm:new / dm:unread events from the open WS on /poker.
    function onDmEvent(e) {
      const msg = e.detail
      if (!msg) return
      if (msg.type === 'dm:new' && msg.data) {
        // Optimistic merge — bump the conversation to the top with
        // the new message preview. If the conversation isn't in our
        // cache yet, refetch the list.
        const { conversationId, message, otherId } = msg.data
        setConversations(prev => {
          const existing = prev.find(c => c.conversationId === conversationId)
          if (!existing) {
            // Schedule a real fetch — we don't have the other user's
            // username/avatar in this push payload.
            refresh()
            return prev
          }
          const next = prev.filter(c => c.conversationId !== conversationId)
          return [{
            ...existing,
            lastMessageAt: message.created_at || new Date().toISOString(),
            lastBody: message.body,
            lastKind: message.kind ?? null,
            lastSenderId: message.sender_user_id,
            // Only bump unread if THIS tab's user is the recipient.
            unread: message.sender_user_id !== otherId ? existing.unread : (existing.unread + 1)
          }, ...next]
        })
        // Pull a fresh unread count to handle the edge cases above.
        refreshCount()
      } else if (msg.type === 'dm:unread' && typeof msg.data?.unread === 'number') {
        setUnread(msg.data.unread)
      }
    }
    window.addEventListener(DM_EVENT, onDmEvent)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('gwu:auth-changed', onAuthChange)
      window.removeEventListener(DM_EVENT, onDmEvent)
    }
  }, [refresh, refreshCount])

  return { conversations, unread, loading, refresh, refreshCount, setConversations }
}

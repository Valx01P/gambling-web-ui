'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, getStoredToken, getStoredUser, setSession, clearSession } from './api'

// Module-level dedup. Every page that uses useAuth previously fired its own
// `api.me()` on mount — with AccountMenu in the header + the page body each
// calling useAuth, that's 2+ identical requests per navigation. Now: the
// first mount triggers the refresh, every other consumer awaits the same
// promise, and we cache the result for a short window so back-nav doesn't
// re-hit the server.
const REFRESH_TTL_MS = 60 * 1000
let _refreshing = null     // Promise<User|null> currently in flight
let _refreshedAt = 0       // ms timestamp of last successful refresh

function refreshMeOnce() {
  if (_refreshing) return _refreshing
  if (Date.now() - _refreshedAt < REFRESH_TTL_MS) {
    return Promise.resolve(getStoredUser())
  }
  _refreshing = api.me()
    .then(data => {
      _refreshedAt = Date.now()
      setSession({ token: getStoredToken(), user: data.user })
      return data.user
    })
    .catch(err => {
      if (err.status === 401) {
        clearSession()
        return null
      }
      // Network / other error — leave whatever's in storage in place so the
      // UI doesn't flicker between logged-in and logged-out states.
      return getStoredUser()
    })
    .finally(() => { _refreshing = null })
  return _refreshing
}

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = getStoredUser()
    if (stored && getStoredToken()) {
      setUser(stored)
      refreshMeOnce()
        .then(nextUser => setUser(nextUser))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }

    const onChange = () => setUser(getStoredUser())
    window.addEventListener('gwu:auth-changed', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('gwu:auth-changed', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const signOut = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  const signInWithGoogle = useCallback(async (credential) => {
    const data = await api.google(credential)
    setSession({ token: data.token, user: data.user })
    setUser(data.user)
    return data.user
  }, [])

  // Native-auth flows share the same "JWT + user → set session" plumbing
  // as the Google path. Each returns the user so the caller can pop the
  // modal closed only after successful login.
  const signInWithPassword = useCallback(async ({ email, password }) => {
    const data = await api.authLogin({ email, password })
    setSession({ token: data.token, user: data.user })
    setUser(data.user)
    return data.user
  }, [])

  const completeVerifyCode = useCallback(async ({ email, code }) => {
    const data = await api.authVerify({ email, code })
    setSession({ token: data.token, user: data.user })
    setUser(data.user)
    return data.user
  }, [])

  const completePasswordReset = useCallback(async ({ email, code, newPassword }) => {
    const data = await api.authReset({ email, code, newPassword })
    setSession({ token: data.token, user: data.user })
    setUser(data.user)
    return data.user
  }, [])

  // Forces an /auth/me re-fetch, bypassing the TTL cache. Use after the
  // user mutates their own profile (PATCH /auth/me) so the cached User
  // reflects the new displayName / avatarUrl across every consumer.
  const refreshUser = useCallback(async () => {
    _refreshedAt = 0
    _refreshing = null
    const next = await refreshMeOnce()
    setUser(next)
    return next
  }, [])

  return {
    user, loading,
    signInWithGoogle, signInWithPassword,
    completeVerifyCode, completePasswordReset,
    signOut, refreshUser
  }
}

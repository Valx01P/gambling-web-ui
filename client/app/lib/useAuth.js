'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, getStoredToken, getStoredUser, setSession, clearSession } from './api'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = getStoredUser()
    if (stored && getStoredToken()) {
      setUser(stored)
      // Refresh in the background to catch profile updates / token expiry.
      api.me()
        .then(data => {
          setUser(data.user)
          setSession({ token: getStoredToken(), user: data.user })
        })
        .catch(err => {
          if (err.status === 401) {
            clearSession()
            setUser(null)
          }
        })
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

  return { user, loading, signInWithGoogle, signOut }
}

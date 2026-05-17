'use client'

import { useEffect } from 'react'
import { useAuth } from '../lib/useAuth'
import { hydrateFromLocalStorage, hydrateFromServerUser } from '../lib/feltColor'

// Tiny client component mounted once in the root layout. Responsible
// for getting the site-wide felt color into the shared store on every
// page load:
//
//   1. First effect — sync from localStorage. Runs immediately so the
//      noise canvas (FuzzyBackground) repaints with the user's saved
//      color before they even see the default emerald flicker. This is
//      a no-op for users who never picked anything.
//
//   2. Second effect — sync from /auth/me. useAuth refreshes the user
//      object on mount; when it lands we hydrate from the DB-saved
//      preference and mirror it back to localStorage. Signed-out users
//      skip this branch entirely (user === null).
//
// Renders nothing — pure side effect at the root of the React tree.
export default function FeltBootstrap() {
  const { user } = useAuth()

  useEffect(() => {
    hydrateFromLocalStorage()
  }, [])

  useEffect(() => {
    if (user) hydrateFromServerUser(user)
  }, [user])

  return null
}

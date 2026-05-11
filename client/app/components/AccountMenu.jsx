'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/useAuth'
import { colorForKey, getInitials } from '../lib/initials'

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

let scriptPromise = null
function loadGsi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
  return scriptPromise
}

function InitialsCircle({ name, color }) {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white shadow-sm"
      style={{ background: color }}
      aria-label={name || 'Account'}
    >
      {getInitials(name)}
    </span>
  )
}

export default function AccountMenu() {
  const { user, signInWithGoogle, signOut } = useAuth()
  const wrapperRef = useRef(null)
  const gsiHostRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e) {
      if (wrapperRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (user) return
    if (!open) return
    if (!GOOGLE_CLIENT_ID) { setError('Google client ID not configured'); return }
    let cancelled = false
    loadGsi()
      .then(() => {
        if (cancelled || !gsiHostRef.current) return
        if (!initialized.current) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (response) => {
              try {
                await signInWithGoogle(response.credential)
                setOpen(false)
              } catch (err) {
                setError(err.message || 'Sign-in failed')
              }
            }
          })
          initialized.current = true
        }
        gsiHostRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(gsiHostRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 220
        })
      })
      .catch(err => setError(err.message || 'Failed to load Google sign-in'))
    return () => { cancelled = true }
  }, [open, user, signInWithGoogle])

  if (!user) {
    return (
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => { setError(null); setOpen(prev => !prev) }}
          className="text-xs sm:text-sm font-bold text-white bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg border border-zinc-500/50 shadow-sm"
        >
          Sign in
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 z-[100] w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
            <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">
              Sign in to build bots
            </div>
            <div className="px-3 pb-3 pt-1 flex justify-center">
              <div ref={gsiHostRef} />
            </div>
            {error && <div className="px-3 pb-3 text-xs font-bold text-red-300">{error}</div>}
          </div>
        )}
      </div>
    )
  }

  const color = colorForKey(user.id || user.email)
  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        title={user.displayName}
        aria-label={user.displayName}
        className="rounded-full ring-1 ring-zinc-500/50 hover:ring-zinc-300/80 transition shadow-sm"
      >
        <InitialsCircle name={user.displayName} color={color} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-[100] w-[min(14rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
          <div className="px-3 py-2 border-b border-zinc-700/70">
            <div className="text-xs font-black text-white truncate">{user.displayName}</div>
            <div className="text-[10px] font-bold text-zinc-300 truncate">{user.email}</div>
          </div>
          <Link
            href="/poker/bots"
            onClick={() => setOpen(false)}
            className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800"
          >
            My Bots
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); signOut() }}
            className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

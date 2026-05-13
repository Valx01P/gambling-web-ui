'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/useAuth'
import { useZoom } from '../lib/useZoom'
import { colorForKey, getInitials } from '../lib/initials'
import { ProfileAvatar } from './ProfileSelector'
import ProfileModal from './ProfileModal'
// DMs + Notifications used to mount inline here as siblings of the
// profile avatar. They now live alongside the avatar inside the global
// AccountDock instead, so this component just owns the profile button.

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
  const { zoom, adjust: adjustZoom, MIN: ZOOM_MIN, MAX: ZOOM_MAX, STEP: ZOOM_STEP } = useZoom()
  const wrapperRef = useRef(null)
  const gsiHostRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  // profileOpen has to live up here, not after the `!user` early return.
  // Hook order must be identical on every render — a useState declared
  // only on the signed-in branch flips the hook count when the user
  // signs in mid-session and React throws "change in the order of Hooks".
  const [profileOpen, setProfileOpen] = useState(false)
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
      <div ref={wrapperRef} className="relative inline-flex h-9 items-center">
        <button
          type="button"
          onClick={() => { setError(null); setOpen(prev => !prev) }}
          className="inline-flex h-9 items-center rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-zinc-700/80 sm:px-3 sm:text-sm"
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
    <>
      {/* Wrapper is explicitly h-9 so it lines up flush with the sibling
          back-link (also h-9). Without an explicit height the wrapper
          auto-sized to its child but the flex parent still treated it as
          a block-level item which could subtly mis-baseline against the
          back-link in some browsers. */}
      <div ref={wrapperRef} className="relative inline-flex h-9 items-center">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-label={user.displayName}
        // Explicit h-9 w-9 matches the sibling Lobby/Bots back-link's
        // rendered height (`py-1.5 text-sm` plus 2px border ≈ 36px) so
        // the parent `flex items-center` lines them up on the same
        // centerline. p-0 + inline-flex zero out the UA button padding
        // that would otherwise stretch the wrapper into an oval and
        // make the ring trace a non-circle.
        className="inline-flex h-9 w-9 items-center justify-center rounded-full p-0 ring-1 ring-zinc-500/50 hover:ring-zinc-300/80 transition shadow-sm"
      >
        {/* ProfileAvatar handles both: shows the uploaded image when
            present, otherwise the initials circle. Earlier this branch
            rendered a raw <img> which surfaced a broken-image artifact
            when avatarUrl was set but failed to load. */}
        <ProfileAvatar
          avatarUrl={user.avatarUrl}
          name={user.displayName}
          nameKey={user.id || user.email}
          size={36}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-[100] w-[min(14rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
          <div className="px-3 py-2 border-b border-zinc-700/70">
            <div className="text-xs font-black text-white truncate">{user.displayName}</div>
            <div className="text-[10px] font-bold text-zinc-300 truncate">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); setProfileOpen(true) }}
            className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800"
          >
            Profile
          </button>
          <Link
            href="/poker/bots"
            onClick={() => setOpen(false)}
            className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800"
          >
            My Bots
          </Link>
          {/* Page zoom — reuses the same localStorage key the poker
              tools menu writes to. Available from any page so the user
              can scale the UI without diving into a poker table. */}
          <div className="flex items-center justify-between gap-2 border-t border-zinc-700/70 px-3 py-2 text-xs font-bold text-white">
            <span>Zoom</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => adjustZoom(-ZOOM_STEP)}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
                className="h-6 w-6 cursor-pointer rounded-md border border-zinc-600/60 bg-zinc-800 text-sm font-black text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >−</button>
              <span className="min-w-[44px] text-center text-xs font-black tabular-nums">{zoom}%</span>
              <button
                type="button"
                onClick={() => adjustZoom(ZOOM_STEP)}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
                className="h-6 w-6 cursor-pointer rounded-md border border-zinc-600/60 bg-zinc-800 text-sm font-black text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >+</button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); signOut() }}
            className="block w-full border-t border-zinc-700/70 px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      )}
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
    </>
  )
}

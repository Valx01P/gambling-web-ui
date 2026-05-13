'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/useAuth'
import { useZoom } from '../lib/useZoom'
import { colorForKey, getInitials } from '../lib/initials'
import { ProfileAvatar } from './ProfileSelector'
import ProfileModal from './ProfileModal'
import AuthGateModal from './AuthGateModal'
// DMs + Notifications used to mount inline here as siblings of the
// profile avatar. They now live alongside the avatar inside the global
// AccountDock instead, so this component just owns the profile button.

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
  const { user, signOut } = useAuth()
  const { zoom, adjust: adjustZoom, MIN: ZOOM_MIN, MAX: ZOOM_MAX, STEP: ZOOM_STEP } = useZoom()
  const wrapperRef = useRef(null)
  const [open, setOpen] = useState(false)
  // profileOpen has to live up here, not after the `!user` early return.
  // Hook order must be identical on every render — a useState declared
  // only on the signed-in branch flips the hook count when the user
  // signs in mid-session and React throws "change in the order of Hooks".
  const [profileOpen, setProfileOpen] = useState(false)
  // Signed-out auth modal. Used to render a Google-only dropdown here;
  // that hid the native email/password flow entirely. Now the Sign-in
  // chip opens the full AuthGateModal (signin + signup + verify code +
  // forgot/reset + Google), which is the same modal other parts of the
  // app already use to gate actions.
  const [authOpen, setAuthOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e) {
      if (wrapperRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  // Listen for the global "open the sign-in popup" event. Other
  // components (notably PostComposer's "Sign in to post" empty state)
  // dispatch this so the user can land in the auth modal without
  // hunting for the top-right button. No-op when already signed in.
  useEffect(() => {
    if (user) return
    function onOpen() { setAuthOpen(true) }
    window.addEventListener('pokerxyz:open-signin', onOpen)
    return () => window.removeEventListener('pokerxyz:open-signin', onOpen)
  }, [user])

  if (!user) {
    return (
      // Text "Sign in" chip — labelled clearly so users don't have to
      // decode an icon. Clicking opens AuthGateModal which exposes BOTH
      // native email/password (signin/signup/verify/reset) AND Google.
      // The earlier dropdown rendered only the Google button, which
      // made the native option invisible even though the server has
      // supported it since migration 022.
      <>
        <div ref={wrapperRef} className="relative inline-flex h-9 items-center">
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 sm:px-3 sm:text-sm"
          >
            Sign in
          </button>
        </div>
        <AuthGateModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </>
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

'use client'

import { useAuth } from '../lib/useAuth'

// Right-side route-local nav. Sits to the LEFT of the global AccountDock
// at top-3 / sm:top-4 — same baseline as the AccountDock chips and the
// fixed HomeBackLink on /feed-style pages.
//
// Why the right-offset is dynamic, not a single constant:
//   • signed-out  → AccountDock shows the "Sign in" text chip (~75-80px)
//   • signed-in   → AccountDock collapses to a 36px (h-9 w-9) avatar
//                   circle. The DMs + Notifications bells stack BELOW
//                   the avatar, not beside it, so the dock's horizontal
//                   footprint is just 36px in both states' widest row.
//
// Hard-coding `right-24 sm:right-28` (the signed-out reservation)
// everywhere left a ~50px dead gap between the route nav and the avatar
// once signed in. Now: keep the wide offset only while signed out, drop
// to `right-14 sm:right-16` when the avatar is showing. That puts ~8-12px
// of breathing room between the nav's right edge and the avatar — same
// rhythm in both states.
//
// The `as` prop preserves semantic intent — the home page's nav is
// rendered as a <header>, other routes use a plain <div>.
export default function RouteNavCluster({ as: As = 'div', className = '', children, ...rest }) {
  const { user } = useAuth()
  const offset = user ? 'right-14 sm:right-16' : 'right-24 sm:right-28'
  return (
    <As
      className={`absolute ${offset} top-3 z-10 flex items-center gap-2 sm:top-4 ${className}`}
      {...rest}
    >
      {children}
    </As>
  )
}

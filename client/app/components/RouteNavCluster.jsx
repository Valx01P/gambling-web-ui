'use client'

import { useAuth } from '../lib/useAuth'

// Inline Sign-in chip rendered as a direct flex sibling of the route-
// local nav buttons (Tools/Lobby on /poker, Home on others). The chip
// historically lived in the AccountDock — but AccountDock is mounted
// outside ZoomLayer, and ZoomLayer's CSS `zoom` property creates a new
// containing block for fixed descendants in some browsers, even at
// 100%. The result was a sub-pixel y-offset between the dock's chip
// and the cluster's buttons. Putting them in the same flex row makes
// alignment definitive.
function SignInChip() {
  return (
    <button
      type="button"
      onClick={() => {
        // Same global event AccountMenu listens for. We dispatch it
        // here so the modal (which still lives in AccountMenu in the
        // dock) opens — no need to re-implement the modal locally.
        if (typeof window === 'undefined') return
        window.dispatchEvent(new CustomEvent('pokerxyz:open-signin'))
      }}
      className="inline-flex h-9 items-center rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 sm:px-3 sm:text-sm"
    >
      Sign in
    </button>
  )
}

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
//
// `fixed` (not `absolute`) is intentional. The in-game poker page wraps
// its content in `max-w-7xl mx-auto`, so on wide desktops the centered
// container is narrower than the viewport. An absolute child inside
// would resolve relative to that container's right edge — leaving a
// huge gap on wide screens, because the dock is fixed to the *viewport*.
// `fixed` puts both the cluster and the dock in the same coordinate
// system, so the offset math is meaningful on every viewport width.
// On the other routes (LobbyView, bot pages, home) the outer wrapper
// already spans the viewport, so fixed and absolute behave identically.
export default function RouteNavCluster({ as: As = 'div', className = '', children, ...rest }) {
  const { user } = useAuth()
  // The `right` offset is `max(<mobile-offset>, calc((100vw - 80rem) / 2 + <mobile-offset>))`
  // so on viewports wider than the `max-w-7xl` (80rem = 1280px) content
  // band, the cluster tracks the content's right edge instead of drifting
  // out to the viewport edge alongside the AccountDock. Mirrors the dock's
  // offset math so the two stay aligned at every width.
  // Auth-aware right offset:
  //   • signed-IN  → reserve 3.5rem/4rem so the cluster clears the
  //                  AccountDock's avatar (and DMs/Notifications/
  //                  BotSpeed icons stacked below it).
  //   • signed-OUT → drop to the viewport gutter (0.75rem/1rem) — on
  //                  RouteNavCluster routes the dock suppresses its
  //                  Sign-in chip, DMs/Notifications are hidden, and
  //                  BotSpeed only shows on /poker with bots. Leaving
  //                  3.5rem of empty space there looks off-center;
  //                  the tighter gutter pushes the cluster (which now
  //                  contains the Sign-in chip itself) flush to the
  //                  same right edge the dock uses on signed-in routes.
  const offset = user
    ? 'right-[max(3.5rem,calc((100vw-80rem)/2+3.5rem))] sm:right-[max(4rem,calc((100vw-80rem)/2+4rem))]'
    : 'right-[max(0.75rem,calc((100vw-80rem)/2+0.75rem))] sm:right-[max(1rem,calc((100vw-80rem)/2+1rem))]'
  return (
    <As
      className={`fixed ${offset} top-3 z-[500] flex items-center gap-2 sm:top-4 ${className}`}
      {...rest}
    >
      {children}
      {/* Signed-out chip rendered as the LAST flex sibling so its
          center sits on the same horizontal axis as Tools/Lobby/Home.
          Avatar mode stays in the global AccountDock — only the chip
          moves here. */}
      {!user && <SignInChip />}
    </As>
  )
}

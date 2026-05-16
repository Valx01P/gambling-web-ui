'use client'

import AccountMenu from './AccountMenu'
import DmsPopup from './DmsPopup'
import NotificationsBell from './NotificationsBell'

// Global top-right account dock mounted once in the root layout. Lays
// out the profile / DMs / notifications buttons in a vertical stack so
// they sit in the same spot on every route and never compete with
// route-local nav links. Each button has its own backdrop (see the
// child components) so the dock reads cleanly on top of the poker
// felt, the landing page, the bot editor — anywhere.
//
//   ┌─────────┐
//   │ avatar  │  ← AccountMenu (or "Sign in" if logged out)
//   ├─────────┤
//   │  ✉ N    │  ← DmsPopup
//   ├─────────┤
//   │  🔔 N   │  ← NotificationsBell
//   └─────────┘
//
// Both DMs and Notifications hide themselves when logged out, so
// anonymous visitors just see the "Sign in" button.
export default function AccountDock() {
  return (
    <div
      // pointer-events-none on the wrapper lets clicks pass through to
      // the page in the empty space around the stack; each child re-
      // enables pointer-events via the button itself. z-[120] keeps the
      // dock above page-level chrome (z-50 header rows etc.) without
      // racing the very-top modal layer (z-200+).
      // The `right` offset is `max(<mobile-offset>, calc((100vw - 80rem) / 2 + <mobile-offset>))`
      // so on viewports wider than the `max-w-7xl` (80rem = 1280px) content
      // band, the dock tracks the content's right edge instead of drifting
      // to the viewport edge. Below 80rem it stays at the original 12/16px
      // viewport gutter. Mirrors the RouteNavCluster offset math.
      className="pointer-events-none fixed top-3 z-[120] flex flex-col items-end gap-2 sm:top-4 right-[max(0.75rem,calc((100vw-80rem)/2+0.75rem))] sm:right-[max(1rem,calc((100vw-80rem)/2+1rem))]"
    >
      <div className="pointer-events-auto"><AccountMenu /></div>
      <div className="pointer-events-auto"><DmsPopup /></div>
      <div className="pointer-events-auto"><NotificationsBell /></div>
    </div>
  )
}

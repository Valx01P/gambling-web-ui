'use client'

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import AccountMenu from './AccountMenu'
import DmsPopup from './DmsPopup'
import NotificationsBell from './NotificationsBell'
import BotSpeedDock from '../poker/components/BotSpeedDock'
import { useAuth } from '../lib/useAuth'

// Routes that already mount a RouteNavCluster — on those routes the
// Sign-in chip is rendered INSIDE the cluster (as a flex sibling of
// Tools/Lobby/Home) so its center lines up with those buttons. The
// dock here suppresses its own AccountMenu chip on those routes to
// avoid a duplicate. Pathnames are exact-or-prefix checks; the array
// stays small and explicit so it's obvious when adding new routes.
function routeHasNavCluster(pathname) {
  if (!pathname) return false
  if (pathname === '/' || pathname === '/poker') return true
  if (pathname.startsWith('/poker/bots')) return true
  return false
}

// Global top-right account dock mounted once in the root layout. Lays
// out the profile / DMs / notifications / (optional) bot-speed buttons
// in a vertical stack so they sit in the same spot on every route and
// never compete with route-local nav links. Each button has its own
// backdrop (see the child components) so the dock reads cleanly on top
// of the poker felt, the landing page, the bot editor — anywhere.
//
//   ┌─────────┐
//   │ avatar  │  ← AccountMenu (or "Sign in" if logged out)
//   ├─────────┤
//   │  ✉ N    │  ← DmsPopup
//   ├─────────┤
//   │  🔔 N   │  ← NotificationsBell
//   ├─────────┤
//   │  🤖     │  ← BotSpeedDock (only at a poker table with bots)
//   └─────────┘
//
// Both DMs and Notifications hide themselves when logged out, so
// anonymous visitors just see the "Sign in" button.
//
// The BotSpeedDock used to live in a SEPARATE fixed column the poker
// page rendered at the same `top` offset. That looked aligned on
// paper but the two flex containers resolved their gaps independently
// — a single pixel of rounding/baseline drift made the robot icon
// land visibly closer to the bell than the bell was to the messages.
// Mounting it INSIDE this same container makes the `gap-2` rule
// govern every adjacent pair literally, with no separate math.
//
// The bot-speed config lives on the poker page (it talks to the
// arena's WS). We bridge it here via a small module-level pub/sub
// so the poker page can call setDockBotSpeed() without props/context
// gymnastics — keeps AccountDock free of any poker-specific deps in
// the React tree.

let _dockBotSpeed = null
const _dockBotSpeedListeners = new Set()

// Called by the poker page: pass `{ value, onChange }` while at a
// table that has at least one bot; pass `null` (or omit) to hide
// the icon. Idempotent, safe to call from any effect. The setter
// notifies all subscribers synchronously so the dock re-renders in
// the same tick — no flicker.
export function setDockBotSpeed(cfg) {
  _dockBotSpeed = cfg && typeof cfg === 'object' ? cfg : null
  for (const l of _dockBotSpeedListeners) l()
}
function _subscribeDockBotSpeed(listener) {
  _dockBotSpeedListeners.add(listener)
  return () => _dockBotSpeedListeners.delete(listener)
}
function _getDockBotSpeed() { return _dockBotSpeed }
function _getServerDockBotSpeed() { return null }

export default function AccountDock() {
  const { user } = useAuth()
  const botSpeed = useSyncExternalStore(_subscribeDockBotSpeed, _getDockBotSpeed, _getServerDockBotSpeed)
  // Route guard. The bot-speed icon is ONLY meaningful at the poker
  // table (/poker exactly — not /poker/bots, not /poker/bots/[id]).
  // We had a bug where:
  //   • the poker page mounts, sets the singleton with a bot config
  //   • the user clicks Lobby/Home — Next.js renders the new route
  //   • React runs the old page's cleanup, but only AFTER the new
  //     route's first paint, so for one frame the bot icon shows
  //     on a page where it shouldn't.
  //   • a Hard-refresh of /feed could also briefly hydrate with the
  //     singleton value populated from an SSR mismatch.
  // The unmount cleanup in the poker page still runs as a backup,
  // but this pathname check is the safety net — the bot button
  // never paints on the wrong route, period.
  const pathname = usePathname()
  const onPokerTable = pathname === '/poker'
  const showBotSpeed = botSpeed && onPokerTable
  // When signed-OUT on a route that has RouteNavCluster, the Sign-in
  // chip is rendered inside that cluster. Skip the dock's own
  // AccountMenu render in that case so there aren't two chips on
  // screen. Signed-IN users still see the avatar here.
  const suppressSignedOutChip = !user && routeHasNavCluster(pathname)
  return (
    <div
      // pointer-events-none on the wrapper lets clicks pass through to
      // the page in the empty space around the stack; each child re-
      // enables pointer-events via the button itself. z-[500] keeps
      // the dock above the floating-window popup range (260+) so the
      // profile / DMs / notifications stay clickable even when a popup
      // is in front of the table. The active tool panel (z-[600]) and
      // anchored Tools menu (z-[700]) still outrank it intentionally.
      // The `right` offset is `max(<mobile-offset>, calc((100vw - 80rem) / 2 + <mobile-offset>))`
      // so on viewports wider than the `max-w-7xl` (80rem = 1280px) content
      // band, the dock tracks the content's right edge instead of drifting
      // to the viewport edge. Below 80rem it stays at the original 12/16px
      // viewport gutter. Mirrors the RouteNavCluster offset math.
      className="pointer-events-none fixed top-3 z-[500] flex flex-col items-end gap-2 sm:top-4 right-[max(0.75rem,calc((100vw-80rem)/2+0.75rem))] sm:right-[max(1rem,calc((100vw-80rem)/2+1rem))]"
    >
      {/* AccountMenu still mounts even when its visible chip is
          suppressed — it owns the AuthGateModal portal and the global
          `pokerxyz:open-signin` event listener. We tell it to hide
          just the chip via a prop so the modal still works when a
          PostComposer or the in-cluster Sign-in button dispatches
          the open-signin event. */}
      <div className="pointer-events-auto"><AccountMenu hideSignedOutChip={suppressSignedOutChip} /></div>
      <div className="pointer-events-auto"><DmsPopup /></div>
      <div className="pointer-events-auto"><NotificationsBell /></div>
      {showBotSpeed && (
        <div className="pointer-events-auto">
          <BotSpeedDock value={botSpeed.value} onChange={botSpeed.onChange} />
        </div>
      )}
    </div>
  )
}

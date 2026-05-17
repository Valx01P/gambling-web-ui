'use client'

import { useSyncExternalStore } from 'react'
import AccountMenu from './AccountMenu'
import DmsPopup from './DmsPopup'
import NotificationsBell from './NotificationsBell'
import BotSpeedDock from '../poker/components/BotSpeedDock'

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
  const botSpeed = useSyncExternalStore(_subscribeDockBotSpeed, _getDockBotSpeed, _getServerDockBotSpeed)
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
      {botSpeed && (
        <div className="pointer-events-auto">
          <BotSpeedDock value={botSpeed.value} onChange={botSpeed.onChange} />
        </div>
      )}
    </div>
  )
}

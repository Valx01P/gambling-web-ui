'use client'

import { memo, useState } from 'react'
import { formatPercent } from '../lib/pokerOdds'
import { ProfileAvatar } from './ProfileSelector'
import BotAvatar from './BotAvatar'
import CardSprite from './CardSprite'

function EyeIcon({ closed = false }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {closed && (
        <path
          d="M4 4l16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

function actionText(action) {
  if (!action?.action) return ''
  if (action.text) return action.text
  return action.action.replace('_', ' ').toUpperCase()
}

// Pair of hole-card thumbnails sized for the wider panel. Larger than the
// row-fitting thumbs we used to render — the spectator panel is the primary
// place a watcher reads each bot's hand, so cards need to be legible.
function HoleCardThumbs({ player, revealed }) {
  const cards = player.cards || []
  return (
    <div className="flex shrink-0 items-center gap-1">
      {[0, 1].map(idx => {
        const card = cards[idx]
        const visible = revealed && card?.rank && card?.suit
        return (
          <div key={idx} className="h-[52px] w-9 overflow-hidden">
            {cards.length === 0 ? (
              <div className="h-full w-full rounded-[4px] bg-zinc-900/60" />
            ) : visible ? (
              <CardSprite card={card} className="w-9" />
            ) : (
              <CardSprite card={null} className="w-9" />
            )}
          </div>
        )
      })}
    </div>
  )
}

function PlayerAvatar({ player, sizeClass = 'h-[42px] w-[42px]', size = 42 }) {
  // Bots get their actual color/initials instead of the generic profile
  // avatar — much easier to tell apart at a glance during arena matches.
  if (player.isBot) {
    return <BotAvatar name={player.username} color={player.botColor} textColor={player.botTextColor} size={size} />
  }
  return (
    <ProfileAvatar
      avatarId={player.avatarId}
      avatarUrl={player.avatarUrl}
      className={sizeClass}
    />
  )
}

function SpectatorPanelImpl({
  players = [],
  oddsByPlayer,
  blindMode,
  revealAll = false,
  visiblePlayerIds,
  activePlayerId = null,
  isArena = false,
  arenaRunning = false,
  chatVisible = true,
  onToggleBlind,
  onToggleRevealAll,
  onTogglePlayer,
  onToggleArenaRunning,
}) {
  // 'expanded' = full panel (default), 'compact' = single-row strip with
  // active-player chip + controls (no per-player rows). Lets watchers free up
  // vertical space without losing the pause / reveal-all controls.
  const [view, setView] = useState('expanded')
  const isCompact = view === 'compact'
  const activePlayer = players.find(p => p.id === activePlayerId) || null
  // When the chat dock is visible we need to stack above it; when it's been
  // toggled off via Tools, drop to the flat safe-area-aware bottom offset.
  const bottomAnchorClass = chatVisible ? 'spectator-stack-bottom' : 'safe-bottom-offset'

  return (
    <div className={`fixed ${bottomAnchorClass} left-3 right-3 z-50 rounded-xl border border-zinc-600/60 bg-zinc-900/95 shadow-2xl backdrop-blur-md sm:left-4 sm:right-auto sm:w-[calc(100vw-1.5rem)] ${isCompact ? 'sm:max-w-[420px] px-2 py-2' : 'sm:max-w-[460px] px-3 py-3'}`}>
      <div className={`flex items-center justify-between gap-2 ${isCompact ? 'mb-0' : 'mb-2'}`}>
        <div className="min-w-0 flex items-center gap-2">
          {isCompact && activePlayer ? (
            <>
              <PlayerAvatar player={activePlayer} sizeClass="h-7 w-7" size={28} />
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-white">{activePlayer.username}</div>
                <div className="truncate text-[9px] font-bold text-amber-200">
                  {actionText(activePlayer.lastAction) || 'Acting…'}
                </div>
              </div>
            </>
          ) : isCompact ? (
            <div className="text-xs font-black text-white">Spectating · {players.length} seated</div>
          ) : (
            <div>
              <div className="text-sm font-black text-white">Spectator View</div>
              <div className="text-[10px] font-bold text-zinc-400">
                {players.length} seated · {revealAll ? 'all cards revealed' : `${visiblePlayerIds.size} pinned · hover to peek`}
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Arena pause/start — only renders for arenas, mirrors arenaRunning. */}
          {isArena && (
            <button
              type="button"
              onClick={onToggleArenaRunning}
              className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
                arenaRunning
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
                  : 'border-emerald-400/60 bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
              title={arenaRunning ? 'Pause the arena (freezes the game)' : 'Resume the arena'}
            >
              {arenaRunning ? '❚❚ Pause' : '▶ Start'}
            </button>
          )}
          {/* Master toggle: reveal everyone's hole cards at once. */}
          <button
            type="button"
            onClick={onToggleRevealAll}
            disabled={blindMode}
            className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              revealAll && !blindMode
                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                : 'border-zinc-600/60 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
            }`}
            title={revealAll ? 'Hide all hole cards' : 'Reveal every hole card'}
          >
            {revealAll ? 'All ✓' : 'All'}
          </button>
          {/* Blind mode hides every card regardless of pins. */}
          <button
            type="button"
            onClick={onToggleBlind}
            className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              blindMode
                ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                : 'border-amber-400/50 bg-amber-500/15 text-amber-100'
            }`}
            title={blindMode ? 'Turn off blind mode' : 'Turn on blind mode'}
            aria-label={blindMode ? 'Turn off blind mode' : 'Turn on blind mode'}
          >
            <EyeIcon closed={blindMode} />
          </button>
          {/* Collapse / expand — vertical-space saver for mobile or for
              uncluttering the table view while still keeping the controls. */}
          <button
            type="button"
            onClick={() => setView(prev => prev === 'compact' ? 'expanded' : 'compact')}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-600/60 bg-zinc-800 text-zinc-200 transition-colors hover:bg-zinc-700"
            title={isCompact ? 'Expand spectator view' : 'Collapse spectator view'}
            aria-label={isCompact ? 'Expand spectator view' : 'Collapse spectator view'}
          >
            <span className={`text-xs font-black transition-transform ${isCompact ? '' : 'rotate-180'}`}>▾</span>
          </button>
        </div>
      </div>

      {!isCompact && (
      <div className="max-h-[58dvh] space-y-2 overflow-y-auto overscroll-contain pr-1">
        {players.map((player) => {
          const odds = oddsByPlayer.get(player.id)
          const pinned = visiblePlayerIds.has(player.id)
          const revealed = !blindMode && pinned && Array.isArray(player.cards) && player.cards.length > 0
          const disabled = blindMode || player.waitingNextHand || !player.cards?.length
          const equityPercent = blindMode || !odds ? null : Math.min(100, Math.max(0, odds.equity))
          const isActive = activePlayerId && player.id === activePlayerId && !player.folded && !player.waitingNextHand
          const last = actionText(player.lastAction)
          const statusText = player.folded
            ? 'Folded'
            : player.allIn
              ? 'All In'
              : player.waitingNextHand
                ? 'Sitting out'
                : last || `${player.chips?.toLocaleString?.() ?? player.chips} chips`

          return (
            <div
              key={player.id}
              className={`rounded-lg border px-2.5 py-2 transition-colors ${
                isActive
                  ? 'border-amber-300/80 bg-amber-400/15 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]'
                  : pinned && !blindMode
                    ? 'border-amber-400/50 bg-amber-500/10'
                    : 'border-zinc-700/70 bg-zinc-950/45'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="relative shrink-0">
                  <PlayerAvatar player={player} sizeClass="h-[42px] w-[42px]" size={42} />
                  {isActive && (
                    <span className="absolute -inset-0.5 rounded-full ring-2 ring-amber-300 animate-pulse pointer-events-none" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-black leading-tight text-white">
                      {player.username}
                    </span>
                    {isActive && (
                      <span className="rounded border border-amber-400/60 bg-amber-400/20 px-1 py-px text-[8px] font-black uppercase tracking-widest text-amber-100">
                        Acting
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] font-bold leading-tight text-zinc-300">
                    {statusText}
                    {!player.folded && !player.waitingNextHand && (
                      <span className="text-zinc-500"> · {player.chips?.toLocaleString?.() ?? player.chips} chips</span>
                    )}
                  </div>
                  {/* Bigger equity bar so the percentage is readable at a glance. */}
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full ${isActive ? 'bg-amber-300' : 'bg-amber-400'}`}
                        style={{ width: `${equityPercent ?? 0}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[12px] font-black tabular-nums text-amber-200 min-w-[42px] text-right">
                      {equityPercent !== null ? formatPercent(odds.equity, 1) : '--'}
                    </span>
                  </div>
                </div>
                <HoleCardThumbs player={player} revealed={revealed} />
                <button
                  type="button"
                  onClick={() => onTogglePlayer(player.id)}
                  disabled={disabled}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                    pinned && !blindMode
                      ? 'border-amber-400/60 bg-amber-500/20 text-amber-100'
                      : 'border-zinc-600/60 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                  title={pinned ? 'Hide cards' : 'Show cards'}
                  aria-label={pinned ? 'Hide cards' : 'Show cards'}
                >
                  <EyeIcon closed={!pinned || blindMode} />
                </button>
              </div>
            </div>
          )
        })}

        {players.length === 0 && (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-3 text-xs font-bold text-zinc-400">
            Waiting for seated players.
          </div>
        )}
      </div>
      )}
    </div>
  )
}

// Memoized — the panel is the most expensive thing on screen during arena
// matches (one row per seat with its own equity bar + card thumbs), and its
// props change far less often than the parent re-renders. Prop reference
// stability comes from useMemo/useCallback in PokerPage.
const SpectatorPanel = memo(SpectatorPanelImpl)
export default SpectatorPanel

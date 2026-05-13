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

// Pair of hole-card thumbnails. 50×36 each — the largest the panel can
// fit without scrolling at 5-6 seats. CardSprite is 80:110 aspect, so
// w-9 (36px) renders ~49px tall, matching the container's h-[50px].
function HoleCardThumbs({ player, revealed }) {
  const cards = player.cards || []
  return (
    <div className="flex shrink-0 items-center gap-1">
      {[0, 1].map(idx => {
        const card = cards[idx]
        const visible = revealed && card?.rank && card?.suit
        return (
          <div key={idx} className="h-[50px] w-9 overflow-hidden">
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
  onToggleBlind,
  onToggleRevealAll,
  onTogglePlayer,
  onToggleArenaRunning,
}) {
  // Three view modes:
  //   'expanded' — big rows: avatar, hole cards, equity bar, status, chips.
  //                The "primary watching" view; takes ~80px per player.
  //   'compact'  — tight per-player strip: 24px avatar + name + chips +
  //                inline equity % + acting state, no hole cards, no bar.
  //                ~28-32px per player. Best for arenas with many seats
  //                or for mobile where vertical space is scarce.
  //   'minimal'  — single-line header strip with active player + controls.
  //                Frees up the entire bottom of the screen.
  //
  // Cycle on the toggle button: expanded → compact → minimal → expanded.
  const [view, setView] = useState('expanded')
  const isExpanded = view === 'expanded'
  const isCompact = view === 'compact'
  const isMinimal = view === 'minimal'
  const cycleView = () => setView(prev =>
    prev === 'expanded' ? 'compact' : prev === 'compact' ? 'minimal' : 'expanded'
  )
  const activePlayer = players.find(p => p.id === activePlayerId) || null
  // Tighter padding everywhere — the panel is a glance widget, not a
  // page, so cramming the chrome is fine.
  const padClass = isMinimal ? 'px-2 py-2' : 'px-2.5 py-2'
  // No max-h, no internal scroll. With the row dimensions shrunk
  // (avatar 32px, hole cards 32px, py-1), 5 players fit at ~225px and
  // 10 players at ~440px — the panel sizes itself naturally and the
  // bottom-UI wrapper (mt-auto) lets the table area auto-shrink to
  // the remaining flex-1 space above.

  return (
    <div className={`w-full flex flex-col rounded-xl border border-zinc-600/60 bg-zinc-900/95 shadow-2xl backdrop-blur-md ${padClass}`}>
      <div className={`flex items-center justify-between gap-2 ${isMinimal ? 'mb-0' : 'mb-1.5'}`}>
        <div className="min-w-0 flex items-center gap-2">
          {isMinimal && activePlayer ? (
            <>
              <PlayerAvatar player={activePlayer} sizeClass="h-6 w-6" size={24} />
              <div className="min-w-0 flex items-baseline gap-1.5">
                <div className="truncate text-[11px] font-black text-white">{activePlayer.username}</div>
                <div className="truncate text-[9px] font-bold text-amber-200">
                  {actionText(activePlayer.lastAction) || 'Acting…'}
                </div>
              </div>
            </>
          ) : (
            // Single-word title — every player is visible in the list
            // below, so showing the count up here is redundant and
            // just steals horizontal room from the toolbar buttons on
            // narrow panels.
            <div className="truncate text-xs font-black text-white">
              Spectator
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
          {/* Three-state density cycle: expanded → compact → minimal →
              expanded. Each state shows the next state's label as the
              tooltip so the user can predict the click. */}
          <button
            type="button"
            onClick={cycleView}
            className="flex h-7 w-auto items-center justify-center gap-0.5 rounded-md border border-zinc-600/60 bg-zinc-800 px-1.5 text-zinc-200 transition-colors hover:bg-zinc-700"
            title={
              isExpanded ? 'Switch to compact view'
              : isCompact ? 'Switch to minimal view'
              : 'Switch to expanded view'
            }
            aria-label={
              isExpanded ? 'Switch to compact view'
              : isCompact ? 'Switch to minimal view'
              : 'Switch to expanded view'
            }
          >
            {/* Visual indicator of current density: three dots, one filled
                for the active state. Reads as a state-meter that the next
                click advances. */}
            <span className={`h-1.5 w-1.5 rounded-full ${isExpanded ? 'bg-amber-300' : 'bg-zinc-600'}`} />
            <span className={`h-1.5 w-1.5 rounded-full ${isCompact ? 'bg-amber-300' : 'bg-zinc-600'}`} />
            <span className={`h-1.5 w-1.5 rounded-full ${isMinimal ? 'bg-amber-300' : 'bg-zinc-600'}`} />
          </button>
        </div>
      </div>

      {/* Compact rows: one tight per-player strip per seat. ~28-30px
          each. No internal scroll — let it grow to whatever height the
          seat count needs. */}
      {isCompact && (
      <div className="space-y-1">
        {players.map(player => {
          const odds = oddsByPlayer.get(player.id)
          const pinned = visiblePlayerIds.has(player.id)
          const disabled = blindMode || player.waitingNextHand || !player.cards?.length
          const equityPercent = blindMode || !odds ? null : Math.min(100, Math.max(0, odds.equity))
          const isActive = activePlayerId && player.id === activePlayerId && !player.folded && !player.waitingNextHand
          const last = actionText(player.lastAction)
          const statusText = player.folded
            ? 'Fold'
            : player.allIn
              ? 'All In'
              : player.waitingNextHand
                ? 'Sit out'
                : last || ''
          return (
            <div
              key={player.id}
              className={`flex items-center gap-2 rounded-md border px-2 py-1 ${
                isActive
                  ? 'border-amber-300/80 bg-amber-400/15'
                  : pinned && !blindMode
                    ? 'border-amber-400/40 bg-amber-500/5'
                    : 'border-zinc-700/70 bg-zinc-950/40'
              }`}
            >
              <PlayerAvatar player={player} sizeClass="h-6 w-6" size={24} />
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="truncate text-[11px] font-black text-white">{player.username}</span>
                {isActive && (
                  <span className="shrink-0 rounded bg-amber-400/25 px-1 text-[8px] font-black uppercase tracking-widest text-amber-100">●</span>
                )}
                {statusText && (
                  <span className="truncate text-[9px] font-bold text-zinc-400">{statusText}</span>
                )}
              </div>
              <span className="shrink-0 text-[10px] font-bold tabular-nums text-zinc-400">
                {(player.chips ?? 0).toLocaleString()}
              </span>
              <span className="shrink-0 w-10 text-right text-[11px] font-black tabular-nums text-amber-200">
                {equityPercent !== null ? formatPercent(odds.equity, 0) : '--'}
              </span>
              <button
                type="button"
                onClick={() => onTogglePlayer(player.id)}
                disabled={disabled}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
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
          )
        })}
        {players.length === 0 && (
          <div className="rounded-md border border-zinc-700/70 bg-zinc-950/45 px-2 py-2 text-[11px] font-bold text-zinc-400">
            Waiting for seated players.
          </div>
        )}
      </div>
      )}

      {isExpanded && (
      // No scroll — the rows are now sized so all seats fit naturally.
      // (avatar 32 + hole cards 32 + py-1 = ~40px per row, so 10 seats
      // ≈ 400px which is still under half a typical mobile viewport.)
      <div className="space-y-1">
        {players.map((player) => {
          const odds = oddsByPlayer.get(player.id)
          const pinned = visiblePlayerIds.has(player.id)
          const revealed = !blindMode && pinned && Array.isArray(player.cards) && player.cards.length > 0
          const disabled = blindMode || player.waitingNextHand || !player.cards?.length
          const equityPercent = blindMode || !odds ? null : Math.min(100, Math.max(0, odds.equity))
          const isActive = activePlayerId && player.id === activePlayerId && !player.folded && !player.waitingNextHand
          const last = actionText(player.lastAction)
          // Status is now folded into the chip count on the lower line
          // ("Fold · 1,000" / "1,000 · CALL 50") so the name + bar can
          // each have their own dedicated single line instead of three
          // stacked lines. Drops total row height by ~10-12px.
          const statusText = player.folded
            ? 'Fold'
            : player.allIn
              ? 'All In'
              : player.waitingNextHand
                ? 'Out'
                : last || ''
          const chipsText = (player.chips ?? 0).toLocaleString()

          return (
            <div
              key={player.id}
              className={`rounded-md border px-2 py-1.5 transition-colors ${
                isActive
                  ? 'border-amber-300/80 bg-amber-400/15 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]'
                  : pinned && !blindMode
                    ? 'border-amber-400/50 bg-amber-500/10'
                    : 'border-zinc-700/70 bg-zinc-950/45'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="relative shrink-0">
                  <PlayerAvatar player={player} sizeClass="h-9 w-9" size={36} />
                  {isActive && (
                    <span className="absolute -inset-0.5 rounded-full ring-2 ring-amber-300 animate-pulse pointer-events-none" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {/* Line 1: name (+ status fragment if any) */}
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-xs font-black leading-tight text-white">
                      {player.username}
                    </span>
                    {statusText && (
                      <span className="shrink-0 truncate text-[9px] font-bold uppercase tracking-widest leading-tight text-zinc-400">
                        {statusText}
                      </span>
                    )}
                  </div>
                  {/* Line 2: equity bar (fills width) + chips + % */}
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full ${isActive ? 'bg-amber-300' : 'bg-amber-400'}`}
                        style={{ width: `${equityPercent ?? 0}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] font-bold tabular-nums text-zinc-500">
                      {chipsText}
                    </span>
                    <span className="shrink-0 text-[11px] font-black tabular-nums text-amber-200 min-w-[30px] text-right">
                      {equityPercent !== null ? formatPercent(odds.equity, 0) : '--'}
                    </span>
                  </div>
                </div>
                <HoleCardThumbs player={player} revealed={revealed} />
                <button
                  type="button"
                  onClick={() => onTogglePlayer(player.id)}
                  disabled={disabled}
                  // Smaller eye button (h-7 instead of h-8) gives the
                  // hole-card thumbs more horizontal room. The icon
                  // inside is still h-4 so the actual hit target loses
                  // only ~4px each side, well within tap-target spec.
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
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
          <div className="rounded-md border border-zinc-700/70 bg-zinc-950/45 px-2 py-2 text-[11px] font-bold text-zinc-400">
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

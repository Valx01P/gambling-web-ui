'use client'

import { formatPercent } from '../lib/pokerOdds'
import { ProfileAvatar } from './ProfileSelector'

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

export default function SpectatorPanel({
  players = [],
  oddsByPlayer,
  blindMode,
  visiblePlayerIds,
  onToggleBlind,
  onTogglePlayer,
}) {
  return (
    <div className="fixed bottom-3 left-3 z-50 w-[calc(100vw-1.5rem)] max-w-[360px] rounded-xl border border-zinc-600/60 bg-zinc-900/95 px-3 py-3 shadow-2xl backdrop-blur-md sm:bottom-4 sm:left-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-white">Spectator View</div>
          <div className="text-[10px] font-bold text-zinc-500">
            {players.length} seated - cards reveal on hover or eye
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleBlind}
          className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
            blindMode
              ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
              : 'border-amber-400/50 bg-amber-500/15 text-amber-100'
          }`}
          title={blindMode ? 'Turn off blind mode' : 'Turn on blind mode'}
          aria-label={blindMode ? 'Turn off blind mode' : 'Turn on blind mode'}
        >
          <EyeIcon closed={blindMode} />
        </button>
      </div>

      <div className="max-h-[42vh] space-y-1.5 overflow-y-auto pr-1">
        {players.map((player) => {
          const odds = oddsByPlayer.get(player.id)
          const selected = visiblePlayerIds.has(player.id)
          const disabled = blindMode || player.waitingNextHand || !player.cards?.length

          return (
            <div
              key={player.id}
              className={`rounded-lg border px-2.5 py-2 ${
                selected && !blindMode
                  ? 'border-amber-400/50 bg-amber-500/10'
                  : 'border-zinc-700/70 bg-zinc-950/45'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ProfileAvatar
                    avatarId={player.avatarId}
                    avatarUrl={player.avatarUrl}
                    className="h-8 w-8"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-black text-white">
                      {player.username}
                    </div>
                    <div className="truncate text-[10px] font-bold text-zinc-500">
                      {player.folded ? 'Folded' : player.allIn ? 'All In' : actionText(player.lastAction) || `${player.chips} chips`}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="min-w-[3rem] text-right text-xs font-black text-amber-200">
                    {blindMode ? '--' : odds ? formatPercent(odds.equity, 1) : '--'}
                  </div>
                  <button
                    type="button"
                    onClick={() => onTogglePlayer(player.id)}
                    disabled={disabled}
                    className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                      selected && !blindMode
                        ? 'border-amber-400/60 bg-amber-500/20 text-amber-100'
                        : 'border-zinc-600/60 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                    title={selected ? 'Hide cards' : 'Show only these cards'}
                    aria-label={selected ? 'Hide cards' : 'Show only these cards'}
                  >
                    <EyeIcon closed={!selected || blindMode} />
                  </button>
                </div>
              </div>
              {!blindMode && odds && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${Math.min(100, Math.max(0, odds.equity))}%` }}
                  />
                </div>
              )}
            </div>
          )
        })}

        {players.length === 0 && (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-3 text-xs font-bold text-zinc-500">
            Waiting for seated players.
          </div>
        )}
      </div>
    </div>
  )
}

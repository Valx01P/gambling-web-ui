'use client'

import { formatPercent } from '../lib/pokerOdds'

function StatBlock({ label, value, sub }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-600/50 bg-zinc-900/55 px-3 py-2">
      <div className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-sm sm:text-base font-black text-white">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] sm:text-xs font-bold text-zinc-400">{sub}</div>}
    </div>
  )
}

function PercentBar({ label, percent, sub }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] sm:text-xs font-bold text-zinc-200">{label}</span>
        <span className="shrink-0 text-[10px] sm:text-xs font-black text-white">{formatPercent(percent)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-950/80">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      {sub && <div className="mt-1 truncate text-[10px] text-zinc-500">{sub}</div>}
    </div>
  )
}

function EmptyLine({ children }) {
  return <div className="text-xs font-bold text-zinc-500">{children}</div>
}

export default function StatsPanel({ statistics, expanded = false, onToggleExpanded, onClose }) {
  const hero = statistics?.hero
  const allIn = statistics?.allIn
  const outsCount = hero?.outs?.reduce((sum, out) => sum + out.count, 0) || 0
  const outsSummary = hero?.outs?.length
    ? hero.outs.slice(0, 2).map((out) => `${out.label} ${out.count}`).join(' - ')
    : null

  if (!statistics?.available) {
    return (
      <div className="mt-2 w-full rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-4 py-3 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black text-white">Statistics</div>
          <div className="flex items-center gap-1.5">
            {onToggleExpanded && (
              <button
                type="button"
                onClick={onToggleExpanded}
                className="rounded-md border border-zinc-600/50 bg-zinc-900/70 px-2 py-1 text-[10px] font-black text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                {expanded ? 'Less' : 'Details'}
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-600/50 bg-zinc-900/70 px-2 py-1 text-[10px] font-black text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                Close
              </button>
            )}
          </div>
        </div>
        <EmptyLine>Join a hand to see live odds.</EmptyLine>
      </div>
    )
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-3 sm:px-4 py-3 shadow-2xl backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm sm:text-base font-black text-white">Statistics</div>
          <div className="text-[10px] sm:text-xs font-bold text-zinc-500">
            {statistics.phase?.toUpperCase()} - {statistics.boardCards}/5 board cards
          </div>
        </div>
        {allIn && (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-[10px] sm:text-xs font-black text-amber-200">
            {allIn.mode} all-in equity - {allIn.totalRunouts.toLocaleString()} runouts
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              className="rounded-md border border-zinc-600/50 bg-zinc-900/70 px-2.5 py-1.5 text-[10px] sm:text-xs font-black text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              {expanded ? 'Less' : 'Details'}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-600/50 bg-zinc-900/70 px-2.5 py-1.5 text-[10px] sm:text-xs font-black text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Close
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <section className="min-w-0 space-y-3">
          {hero ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatBlock
                  label="Hand"
                  value={hero.startingHand?.code || '--'}
                  sub={hero.startingHand?.label}
                />
                <StatBlock
                  label="Equity"
                  value={hero.equity ? formatPercent(hero.equity.equity) : '--'}
                  sub={hero.equity ? `${hero.equity.mode}${hero.equity.sampleSize ? ` - ${hero.equity.sampleSize.toLocaleString()}` : ''}` : null}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <StatBlock label="Now" value={hero.currentHand || 'Preflop'} sub={hero.startingHand?.traits?.join(' - ')} />
                <StatBlock
                  label="Opponents"
                  value={hero.opponentCount}
                  sub={hero.equity ? `${formatPercent(hero.equity.win)} wins - ${formatPercent(hero.equity.tie)} ties` : null}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatBlock
                  label="Outs"
                  value={statistics.boardCards >= 3 && statistics.boardCards < 5 ? outsCount : '--'}
                  sub={statistics.boardCards >= 5 ? 'River complete' : outsSummary || 'From flop onward'}
                />
                <StatBlock
                  label="Best Path"
                  value={hero.outs?.[0]?.label || hero.currentHand || 'Preflop'}
                  sub={hero.outs?.[0]?.cards?.slice(0, 4).join(' ') || null}
                />
              </div>
            </>
          ) : (
            <EmptyLine>No personal hand stats available.</EmptyLine>
          )}

          {allIn && (
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">All-In Odds</div>
              {allIn.players.map((player) => (
                <PercentBar
                  key={player.id}
                  label={player.username || player.id.slice(0, 6)}
                  percent={player.equity}
                  sub={`${formatPercent(player.win)} wins - ${formatPercent(player.tie)} ties`}
                />
              ))}
            </div>
          )}
        </section>

        {expanded && (
          <>
            <section className="min-w-0 space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Made-Hand Range</div>
                  {hero?.potential && (
                    <div className="text-[10px] font-bold text-zinc-500">
                      {hero.potential.mode}{hero.potential.sampleSize ? ` - ${hero.potential.sampleSize.toLocaleString()}` : ''}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {hero?.potential?.hands?.length ? hero.potential.hands.slice(0, 6).map((hand) => (
                    <PercentBar key={hand.label} label={hand.label} percent={hand.percent} />
                  )) : <EmptyLine>No range available.</EmptyLine>}
                </div>
              </div>
            </section>

            <section className="min-w-0 space-y-3">
              <div>
                <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">Outs</div>
                <div className="space-y-2">
                  {hero?.outs?.length ? hero.outs.map((out) => (
                    <div key={out.label} className="rounded-lg border border-zinc-600/40 bg-zinc-900/45 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-black text-white">{out.label}</span>
                        <span className="text-xs font-black text-amber-300">{out.count}</span>
                      </div>
                      <div className="mt-1 truncate text-[10px] font-bold text-zinc-500">{out.cards.join(' ')}</div>
                    </div>
                  )) : (
                    <EmptyLine>{statistics.boardCards >= 5 ? 'No cards to come.' : 'Outs appear from the flop onward.'}</EmptyLine>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">Losing To</div>
                <div className="space-y-1.5">
                  {hero?.threats?.length ? hero.threats.map((threat) => (
                    <div key={threat.label} className="flex items-center justify-between gap-2 rounded-md bg-zinc-900/45 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-[10px] sm:text-xs font-bold text-zinc-200">{threat.label}</div>
                        <div className="truncate text-[10px] text-zinc-500">{threat.examples.join(' - ')}</div>
                      </div>
                      <div className="shrink-0 text-[10px] font-black text-zinc-400">{threat.count}</div>
                    </div>
                  )) : (
                    <EmptyLine>{statistics.boardCards >= 3 ? 'No made hands currently beat you.' : 'Threats appear from the flop onward.'}</EmptyLine>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {!expanded && hero && (
          <div className="text-[10px] font-bold text-zinc-500">
            Details expands range, outs, and losing-hand breakdowns.
          </div>
        )}
      </div>
    </div>
  )
}

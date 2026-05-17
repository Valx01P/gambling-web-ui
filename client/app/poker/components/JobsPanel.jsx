'use client'

import CatalogIcon from './CatalogIcon'

// Per-tier styling map. Visual hierarchy mirrors the reward scale —
// starter tier reads as humble grey/zinc, planetary jobs glow amber
// to signal "this is rare and huge".
const TIER_STYLES = {
  starter:     { label: 'Starter',     chipBg: 'bg-zinc-700/40 text-zinc-300',     border: 'border-zinc-700/70' },
  bluecollar:  { label: 'Blue collar', chipBg: 'bg-blue-900/40 text-blue-200',     border: 'border-blue-800/40' },
  whitecollar: { label: 'White collar',chipBg: 'bg-teal-900/40 text-teal-200',     border: 'border-teal-800/40' },
  exec:        { label: 'Executive',   chipBg: 'bg-violet-900/40 text-violet-200', border: 'border-violet-800/40' },
  sovereign:   { label: 'Sovereign',   chipBg: 'bg-fuchsia-900/40 text-fuchsia-200',border:'border-fuchsia-800/40' },
  planetary:   { label: 'Planetary',   chipBg: 'bg-amber-900/40 text-amber-200',   border: 'border-amber-700/60 shadow-[0_0_12px_rgba(251,191,36,0.4)]' },
}

// Jobs board panel — rotating gigs the player can claim for chips.
// The "you always have a way to make money" floor for busted-out
// players. Server pushes the snapshot via 'jobs:state' on join,
// hand-end, and after every claim.
//
// 2026-05: jobs are no longer competitive between players. Each player
// rolls independently on the same gig — what was a zero-sum "first to
// apply burns it for everyone" board is now a free chance for the
// whole table. Per-player outcomes come down as job.claimedByMe /
// job.failedByMe on each snapshot.
export default function JobsPanel({ jobsState, joined, onClaim }) {
  const jobs = jobsState?.jobs || []

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Today's gigs</div>
        <div className="mt-1 text-[11px] font-bold text-zinc-300 leading-snug">
          Three new jobs every hand. <span className="text-amber-300">Applying is a luck roll</span> — each gig shows its odds. Everyone at the table can attempt every gig; one try per gig per hand.
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-6 text-center text-[11px] font-bold text-zinc-500">
          Board is being shuffled — check back next hand.
        </div>
      ) : (
        jobs.map(job => {
          const claimedByMe = !!job.claimedByMe
          const failedByMe = !!job.failedByMe
          const disabled = !joined || claimedByMe || failedByMe
          const tier = TIER_STYLES[job.tier] || TIER_STYLES.bluecollar
          const successPct = Math.round((job.successPercent ?? 0.5) * 100)
          // Color the odds chip so the player reads "easy / risky / hail
          // mary" at a glance. >=70 emerald, 40-69 amber, <40 red.
          const oddsColor = successPct >= 70
            ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/40'
            : successPct >= 40
              ? 'bg-amber-900/40 text-amber-200 border-amber-700/40'
              : 'bg-red-900/40 text-red-200 border-red-700/40'
          return (
            <div key={job.id} className={`rounded-lg border bg-zinc-950/45 p-3 ${tier.border} ${failedByMe ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <CatalogIcon
                  id={job.jobId}
                  name={job.title}
                  className="h-14 w-20 shrink-0 sm:h-16 sm:w-24"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-black text-white">{job.title}</span>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${tier.chipBg}`}>
                      {tier.label}
                    </span>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${oddsColor}`}>
                      {successPct}% odds
                    </span>
                  </div>
                  <div className="text-[10px] font-medium text-zinc-400 leading-snug">{job.flavor}</div>
                  <div className="mt-1 text-[11px] font-bold">
                    <span className="text-zinc-300">Pays </span>
                    <span className="text-emerald-300">+${job.reward.toLocaleString()}</span>
                    {claimedByMe && (
                      <span className="ml-2 text-emerald-300">· You pulled it off</span>
                    )}
                    {failedByMe && (
                      <span className="ml-2 text-red-300">· You flopped this one</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onClaim(job.id)}
                  disabled={disabled}
                  title={`Roll for $${job.reward.toLocaleString()} with ${successPct}% odds`}
                  className="shrink-0 rounded-md border border-orange-400/60 bg-orange-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-orange-100 hover:bg-orange-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {claimedByMe ? 'Done' : failedByMe ? 'Failed' : 'Apply'}
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

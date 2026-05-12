'use client'

import { memo, useEffect, useMemo, useState } from 'react'

// Run-it-twice vote panel. Compact floating banner at top-center so the
// table cards, stack/odds, and side-bet markets all stay visible while the
// vote is open — players need that info to decide if running the board N
// times is worth it.
//
// Vote rules (server-enforced — UI just relays clicks):
//   • picking ×1 + Confirm = veto. Resolves as 1 instantly, regardless of
//     what the other player picked.
//   • both pick the same N (>1) + Confirm = run N times.
//   • mismatched picks on >1 = keep waiting. Players can change their
//     minds (re-submit) until they match, someone vetoes with 1, or the
//     timer (60s, never reset) fires → 1 by default.
//
// Layout: pointer-events-none on the outer so unrelated clicks pass through
// to the table; pointer-events-auto on the inner panel only.

const RUN_OPTIONS = [1, 2, 3, 4]
const RING_RED = '#dc2626'    // tailwind red-600
const RING_GREEN = '#16a34a'  // tailwind green-600

function fmtChips(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return Math.round(n).toString()
}

const RunItTwiceVote = memo(function RunItTwiceVote({
  vote,
  myPlayerId,
  submissions,
  onSubmit,
}) {
  const [choice, setChoice] = useState(2)
  const [now, setNow] = useState(() => Date.now())

  // Reset the local pick when a new vote opens. NOTE: we deliberately do
  // NOT keep a local `confirmed` flag — the server is authoritative. The
  // moment the server clears choices on a mismatch, mySubmittedChoice goes
  // null and the buttons re-enable automatically.
  useEffect(() => {
    setChoice(2)
  }, [vote?.voteId])

  useEffect(() => {
    if (!vote) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [vote?.voteId])

  if (!vote) return null

  const isEligible = (vote.eligiblePlayers || []).some(p => p.playerId === myPlayerId)
  const opponent = (vote.eligiblePlayers || []).find(p => p.playerId !== myPlayerId)
  const opponentSubmission = (submissions || []).find(s => s.playerId === opponent?.playerId)
  const mySubmission = (submissions || []).find(s => s.playerId === myPlayerId)
  const mySubmittedChoice = mySubmission?.choice ?? null
  // Lock is purely derived from server state. If the server clears the
  // submission slot (mismatch path), `confirmed` flips back to false and
  // the buttons go interactive again.
  const confirmed = mySubmittedChoice != null

  const total = Math.max(1, vote.timeoutMs || 60_000)
  const elapsed = Math.max(0, now - vote.startedAt)
  const remaining = Math.max(0, vote.expiresAt - now)
  const fraction = Math.min(1, elapsed / total)
  const redAngle = Math.round(fraction * 360)
  const secondsLeft = Math.ceil(remaining / 1000)

  function handleConfirm() {
    if (!isEligible || confirmed) return
    onSubmit?.(choice)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[64px] z-30 flex justify-center px-3 sm:top-[72px]">
      <div className="pointer-events-auto w-full max-w-[460px] rounded-xl border border-amber-500/60 bg-zinc-900/95 px-3 py-2 shadow-2xl backdrop-blur-md animate-sidebet-enter">
        <div className="flex items-center gap-3">
          <RingTimer redAngle={redAngle} secondsLeft={secondsLeft} />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Run it twice?
              </div>
              <div className="text-[10px] text-zinc-400">
                Pot <span className="font-bold text-amber-200">{fmtChips(vote.pot)}</span>
              </div>
            </div>

            <div className="mt-1 flex items-center gap-1">
              {RUN_OPTIONS.map(n => {
                const isSelected = choice === n
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => isEligible && !confirmed && setChoice(n)}
                    disabled={!isEligible || confirmed}
                    aria-label={n === 1 ? 'Run once (veto)' : `Run ${n} times`}
                    title={n === 1 ? 'Confirming ×1 immediately runs once (veto)' : `Run ${n} times`}
                    className={`flex-1 rounded-md border px-1 py-1 text-xs font-black transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                        : 'border-zinc-600 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700/80'
                    }`}
                  >
                    ×{n}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isEligible || confirmed}
                className={`ml-1 shrink-0 rounded-md px-3 py-1 text-xs font-black transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                  confirmed
                    ? 'bg-emerald-700 text-emerald-100'
                    : choice === 1
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : 'bg-amber-600 text-white hover:bg-amber-500'
                }`}
              >
                {confirmed ? `Locked ×${mySubmittedChoice ?? choice}` : `Confirm ×${choice}`}
              </button>
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate text-zinc-400">
                {!isEligible
                  ? 'Spectating — only the all-in players vote.'
                  : opponent
                    ? opponentSubmission?.confirmed
                      ? <>{opponent.username}: <span className="font-bold text-emerald-300">×{opponentSubmission.choice}</span></>
                      : <>{opponent.username}: <span className="italic">deciding…</span></>
                    : 'Waiting…'}
              </span>
              <span className="shrink-0 text-zinc-500">
                ×1 vetoes · default ×1 on timeout
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export default RunItTwiceVote

// Small ring timer (60px). Outer + inner borders sandwich a conic-gradient
// band that fills red clockwise from 12 o'clock as time elapses.
function RingTimer({ redAngle, secondsLeft }) {
  const bandStyle = useMemo(() => ({
    background: `conic-gradient(${RING_RED} 0deg ${redAngle}deg, ${RING_GREEN} ${redAngle}deg 360deg)`,
  }), [redAngle])

  return (
    <div className="relative h-[60px] w-[60px] shrink-0 rounded-full border-2 border-zinc-600 bg-zinc-900">
      <div className="absolute inset-[2px] rounded-full" style={bandStyle} />
      <div className="absolute inset-[10px] flex items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-900">
        <span className="text-[13px] font-black tabular-nums text-white">{secondsLeft}</span>
      </div>
    </div>
  )
}

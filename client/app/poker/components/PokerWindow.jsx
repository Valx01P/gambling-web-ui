'use client'

import CardSprite from '../../components/CardSprite'
import FloatingWindow from '../../components/FloatingWindow'
import { ActionBadge, formatChipsCompact } from './ActionBadge'

// Floating PiP-style poker window. Mirrors the main table's state
// (parent passes everything in as props) and routes actions through
// the same `send()` callback the main view uses — so a click inside
// here moves the real game forward and the underlying table updates
// in sync. Window chrome lives in FloatingWindow.

function fmt(n) {
  const v = Math.max(0, Math.round(Number(n) || 0))
  return formatChipsCompact(v)
}

// PRE-FLOP / FLOP / TURN / RIVER / SHOWDOWN — derived from phase so the
// header reads like the main felt's status pill instead of the raw
// internal phase name.
function streetLabelFor(phase, communityCount) {
  if (phase === 'showdown') return 'SHOWDOWN'
  if (phase === 'waiting') return 'WAITING'
  if (communityCount >= 5) return 'RIVER'
  if (communityCount >= 4) return 'TURN'
  if (communityCount >= 3) return 'FLOP'
  return 'PRE-FLOP'
}

export default function PokerWindow({
  open,
  onClose,
  // Game state — same shape the main view consumes.
  gameState,
  playerId,
  isSpectator,
  // Pre-derived locally by the parent so we don't duplicate the
  // computation. Each one feeds the right control.
  myPlayer,
  myHoleCards = [],
  canAct,
  toCall = 0,
  minRaise = 0,
  hasRaiseRoom = false,
  raiseAmount = 0,
  setRaiseAmount,
  safeRaise = 0,
  // Turn-clock state — passed from parent so the mini view uses the
  // same estimated-server-time clock the main felt does (no drift).
  activeTurnTimeRemaining = null,
  isActiveTurnWarning = false,
  // Action callback. `kind` is one of 'fold'|'check'|'call'|'raise'|'all_in'.
  onAction,
}) {
  // ── Derived display state ─────────────────────────────────────────
  const seats = gameState?.players || []
  const community = gameState?.communityCards || []
  const pot = gameState?.pot || 0
  const phase = gameState?.phase || 'waiting'
  const activeId = gameState?.activePlayerId
  const dealerIndex = gameState?.dealerIndex
  const dealerId = Number.isInteger(dealerIndex) ? seats[dealerIndex]?.id : null
  const street = streetLabelFor(phase, community.length)
  const isMyTurn = activeId === playerId && !isSpectator
  // Format the turn timer to a one-decimal seconds remaining — matches the
  // main table's countdown vibe. Hide when not in an active hand or when
  // the active seat has no timer (no-humans-waiting → server suppresses).
  const turnSecondsLeft = activeTurnTimeRemaining != null && activeTurnTimeRemaining > 0
    ? Math.ceil(activeTurnTimeRemaining / 1000)
    : null

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      // Intentionally no onBack — the mini table is a permanent
      // companion popup and doesn't need a back-to-Tools shortcut.
      title={`Table · ${street}`}
      icon="♠"
      accent="emerald"
      storageKey="pokerxyz:pokerwin"
      defaultWidth={340}
      defaultHeight={520}
      minHeight={360}
      minWidth={280}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-white">
        {/* Pot + community ────────────────────────────────────────── */}
        <div className="rounded-md border border-emerald-500/30 bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 p-2">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-emerald-200">
            <span>Pot · {street}</span>
            <span className="tabular-nums">${fmt(pot)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {Array.from({ length: 5 }).map((_, i) => {
              const c = community[i]
              if (!c) {
                return (
                  <div key={i} className="h-16 w-12 rounded border border-dashed border-emerald-500/30 bg-emerald-950/30" />
                )
              }
              // CardSprite reads `card.rank` + `card.suit` off ONE prop
              // (passing rank/suit separately silently falls back to the
              // face-down 5th-row sprite — which is what was happening
              // pre-2026-05).
              return <CardSprite key={i} card={c} className="h-16 w-12" />
            })}
          </div>
        </div>

        {/* Seats list. Each row mirrors the main felt: dealer-button
            chip, SB/BB blind tag, current-bet pill, last-action badge
            (RAISE 20 / RE-RAISE / 4-BET / CALL ALL-IN — labels come
            straight from the server's getAggressionLabel via
            player.lastAction.text). Folded seats fade + strike. The
            actor of the moment gets the amber ring (or red if
            warning) so the eye lands on it the same way the main
            table draws focus. */}
        <div className="space-y-1">
          {seats.map(seat => {
            const isMe = seat.id === playerId
            const isActive = seat.id === activeId
            const isWarn = isActive && isActiveTurnWarning
            const isDealer = seat.id === dealerId
            const isSB = seat?.lastAction?.action === 'sb'
            const isBB = seat?.lastAction?.action === 'bb'
            const bet = seat.currentBet || 0
            const ringCls = isActive
              ? (isWarn
                  ? 'border-red-400/80 bg-red-950/40 ring-2 ring-red-400 shadow-[0_0_16px_rgba(239,68,68,0.55)]'
                  : 'border-amber-300/80 bg-amber-950/30 ring-2 ring-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.55)]')
              : 'border-zinc-700/60 bg-zinc-950/40'
            // Server's rich aggression text — "Bet" / "Raise" /
            // "Re-raise" / "4-Bet" / "Re-raise All-In" / "Call
            // All-In" / "FOLD" / "CHECK" / "CALL" — comes through on
            // seat.lastAction.text + .amount via PokerGame.playerActions.
            // SB/BB get the same ActionBadge styling but render in the
            // identity slot before voluntary action takes over.
            const showRichAction = seat.lastAction && !isSB && !isBB && seat.lastAction.action
            // Standalone fold/all-in pills only when lastAction was
            // cleared by the server (e.g. street advanced after the
            // fold) — otherwise the badge already conveys the state.
            const showFoldPill = seat.folded && (!seat.lastAction || seat.lastAction.action !== 'fold')
            const showAllInPill = seat.allIn && (!seat.lastAction || seat.lastAction.action !== 'all_in')
            return (
              <div
                key={seat.id}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${ringCls} ${isMe ? 'outline outline-1 outline-emerald-400/40 -outline-offset-1' : ''}`}
              >
                {/* Dealer chip — small white circle, identical to the
                    main felt's dealer marker. */}
                {isDealer && (
                  <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white text-[8px] font-black text-black shadow-sm border border-zinc-300" title="Dealer button">D</span>
                )}
                <span className={`min-w-0 flex-1 truncate font-black ${seat.folded ? 'text-zinc-500 line-through' : 'text-white'}`}>
                  {isMe ? 'You' : (seat.username || 'Player')}
                  {seat.isBot ? <span className="ml-1 text-[9px] font-bold uppercase text-zinc-500">bot</span> : null}
                </span>
                {/* Action badge sits immediately after the name and
                    BEFORE the stack so the user's eye doesn't have to
                    skip past the chip count. shrink-0 + whitespace-
                    nowrap on the badge keep it intact at every window
                    width; the name's flex-1 + min-w-0 + truncate
                    yields width first when space is tight. */}
                {(isSB || isBB) && !seat.folded && (
                  <ActionBadge action={seat.lastAction} size="sm" />
                )}
                {showRichAction && (
                  <ActionBadge action={seat.lastAction} size="sm" />
                )}
                {showFoldPill && (
                  <span className="shrink-0 rounded bg-red-500/15 px-1 py-0.5 text-[9px] font-black uppercase text-red-300">fold</span>
                )}
                {showAllInPill && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-black uppercase text-amber-200">all-in</span>
                )}
                {bet > 0 && (
                  <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-black uppercase text-amber-200 tabular-nums">
                    +${fmt(bet)}
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-zinc-300">${fmt(seat.chips || 0)}</span>
              </div>
            )
          })}
          {seats.length === 0 && (
            <div className="rounded-md border border-zinc-700/60 bg-zinc-950/40 p-2 text-center text-[11px] font-bold text-zinc-500">
              Waiting for players…
            </div>
          )}
        </div>

        {/* Your cards. When it's your turn the wrapper takes on the
            same amber/red ring the main table's nameplate uses for
            the active seat — so the mini view tells you "act now" the
            same way the felt does. The countdown pill in the top-
            right of this card surfaces the turn clock seconds. */}
        {!isSpectator && myHoleCards.length > 0 && (
          <div
            className={`relative rounded-md border p-2 transition-colors ${
              isMyTurn
                ? (isActiveTurnWarning
                    ? 'border-red-400/80 bg-red-950/40 ring-2 ring-red-400 shadow-[0_0_18px_rgba(239,68,68,0.65)]'
                    : 'border-amber-300/80 bg-amber-950/30 ring-2 ring-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.65)]')
                : 'border-zinc-700/60 bg-zinc-950/40'
            }`}
          >
            <div className="mb-1 flex items-center justify-between">
              <div className={`text-[9px] font-black uppercase tracking-widest ${isMyTurn ? (isActiveTurnWarning ? 'text-red-200' : 'text-amber-200') : 'text-zinc-500'}`}>
                Your hand{isMyTurn ? ' · your turn' : ''}
              </div>
              {isMyTurn && turnSecondsLeft != null && (
                <div className={`rounded-full px-2 py-0.5 text-[9px] font-black tabular-nums ${isActiveTurnWarning ? 'bg-red-500/30 text-red-100' : 'bg-amber-500/25 text-amber-100'}`}>
                  {turnSecondsLeft}s
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-2.5">
              {myHoleCards.map((c, i) => (
                <CardSprite key={i} card={c} className="h-20 w-14" />
              ))}
            </div>
          </div>
        )}

        {/* Action controls. Disabled when not your turn. Same WS
            messages as the main view — actions move the real game. */}
        {!isSpectator && (
          <div className="space-y-1.5 rounded-md border border-zinc-700/60 bg-zinc-950/60 p-2">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => onAction?.('fold')}
                disabled={!canAct}
                className="rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-1 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-600 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Fold
              </button>
              {toCall === 0 ? (
                <button
                  type="button"
                  onClick={() => onAction?.('check')}
                  disabled={!canAct}
                  className="rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-1 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-600 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Check
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAction?.('call')}
                  disabled={!canAct}
                  className="rounded-md border border-emerald-400/50 bg-emerald-600 px-2 py-1 text-xs font-black text-white shadow-sm transition-colors hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Call ${fmt(Math.min(toCall, myPlayer?.chips || 0))}
                </button>
              )}
              <button
                type="button"
                onClick={() => onAction?.('all_in')}
                disabled={!canAct || !(myPlayer?.chips > 0)}
                className="col-span-2 rounded-md border border-amber-400/50 bg-amber-600 px-2 py-1 text-xs font-black text-white shadow-sm transition-colors hover:bg-amber-500 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                All In · ${fmt(myPlayer?.chips || 0)}
              </button>
            </div>

            {/* Raise row — input + slider + quick-bets. Mirrors the
                main view; all three controls feed the same parent
                `raiseAmount` state so flipping between this window
                and the full table keeps the value in sync. */}
            <div className={`flex flex-col gap-1 ${(!canAct || !hasRaiseRoom) ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={raiseAmount > 0 ? safeRaise.toLocaleString() : ''}
                  placeholder={`min $${fmt(minRaise)}`}
                  onChange={(e) => {
                    const cleaned = String(e.target.value || '').replace(/[^0-9.]/g, '')
                    const n = parseFloat(cleaned)
                    setRaiseAmount?.(Number.isFinite(n) ? Math.floor(n) : 0)
                  }}
                  disabled={!canAct || !hasRaiseRoom}
                  className="min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs font-bold text-white outline-none focus:border-zinc-300 disabled:cursor-not-allowed tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => onAction?.('raise')}
                  disabled={!canAct || !hasRaiseRoom || safeRaise < minRaise}
                  className="shrink-0 rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-1 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-600 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Raise ${fmt(safeRaise)}
                </button>
              </div>
              <input
                type="range"
                min={minRaise}
                max={Math.max(minRaise, myPlayer?.chips || minRaise)}
                step={Math.max(1, Math.floor(((myPlayer?.chips || minRaise)) / 200))}
                value={safeRaise}
                onChange={e => setRaiseAmount?.(parseInt(e.target.value, 10))}
                disabled={!canAct || !hasRaiseRoom}
                title="Drag to bet — finer control via the input box"
                className="h-1 w-full rounded-full bg-zinc-900 accent-amber-400 disabled:cursor-not-allowed"
              />
              <div className="grid grid-cols-4 gap-1">
                {(() => {
                  const myChips = myPlayer?.chips || 0
                  const clampVal = (n) => Math.max(minRaise, Math.min(myChips, Math.floor(n)))
                  const presets = [
                    { label: '¼ pot', amount: clampVal(pot * 0.25) },
                    { label: '½ pot', amount: clampVal(pot * 0.5) },
                    { label: 'pot',   amount: clampVal(pot) },
                    { label: 'max',   amount: clampVal(myChips) },
                  ]
                  return presets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setRaiseAmount?.(p.amount)}
                      disabled={!canAct || !hasRaiseRoom || p.amount < minRaise}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {p.label}
                    </button>
                  ))
                })()}
              </div>
            </div>
          </div>
        )}
        {isSpectator && (
          <div className="rounded-md border border-zinc-700/60 bg-zinc-950/40 p-2 text-center text-[11px] font-bold text-zinc-500">
            Spectating — actions are disabled.
          </div>
        )}
      </div>
    </FloatingWindow>
  )
}

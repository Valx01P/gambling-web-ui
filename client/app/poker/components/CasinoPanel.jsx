'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// Casino — slots / craps / lottery. Server is the source of truth for
// every result; this panel just renders the wager input, plays the
// spin/roll animation, and shows what came back.
//
// Three lifetime-of-panel telemetry rows (one per game) feed a P/L
// readout in the header so the user can see exactly how much the
// house has taken from each surface this session. The numbers reset
// on panel close — there's no DB persistence.

// ─── symbol metadata ───────────────────────────────────────────────

const SYMBOL_LABEL = {
  cherry:  'Cherry',
  lemon:   'Lemon',
  grape:   'Grape',
  bell:    'Bell',
  diamond: 'Diamond',
  seven:   'Seven',
  blank:   '—',
}

const SYMBOL_ACCENT = {
  cherry:  'text-rose-300',
  lemon:   'text-yellow-300',
  grape:   'text-violet-300',
  bell:    'text-amber-300',
  diamond: 'text-cyan-300',
  seven:   'text-red-300',
  blank:   'text-zinc-500',
}

// Reel strip — what the player sees scrolling by. Each cell is one
// symbol on the virtual drum. We don't care about exact rarity here
// (the server already did the weighted roll); this strip just has to
// feel "varied" while the reel is moving.
const REEL_STRIP_ORDER = [
  'cherry', 'lemon', 'cherry', 'grape',
  'cherry', 'lemon', 'bell',   'cherry',
  'grape',  'diamond','cherry','lemon',
  'bell',   'grape', 'cherry', 'seven',
  'lemon',  'cherry','grape',  'bell',
  'cherry', 'lemon', 'diamond','cherry',
  'grape',  'lemon', 'bell',   'cherry',
  'lemon',  'grape', 'cherry', 'lemon',
]

// ─── SVG symbols ───────────────────────────────────────────────────

function SymbolSVG({ id, className = '' }) {
  switch (id) {
    case 'cherry':
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <defs>
            <radialGradient id="cherry-glow" cx="35%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#fda4af" />
              <stop offset="60%" stopColor="#e11d48" />
              <stop offset="100%" stopColor="#881337" />
            </radialGradient>
            <radialGradient id="cherry-glow2" cx="35%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#fb7185" />
              <stop offset="60%" stopColor="#be123c" />
              <stop offset="100%" stopColor="#4c0519" />
            </radialGradient>
          </defs>
          <path d="M 35 65 Q 45 30 60 20" stroke="#16a34a" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 65 60 Q 60 30 60 20" stroke="#16a34a" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 60 20 Q 80 15 78 32 Q 65 28 60 20 Z" fill="#22c55e" stroke="#15803d" strokeWidth="1" />
          <circle cx="35" cy="70" r="18" fill="url(#cherry-glow)" />
          <circle cx="65" cy="74" r="20" fill="url(#cherry-glow2)" />
          <circle cx="29" cy="62" r="4.5" fill="#fecdd3" opacity="0.85" />
          <circle cx="58" cy="65" r="4.5" fill="#fecdd3" opacity="0.85" />
        </svg>
      )
    case 'lemon':
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <defs>
            <radialGradient id="lemon-glow" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="55%" stopColor="#facc15" />
              <stop offset="100%" stopColor="#a16207" />
            </radialGradient>
          </defs>
          <ellipse cx="50" cy="52" rx="34" ry="28" fill="url(#lemon-glow)" transform="rotate(-15 50 52)" />
          <path d="M 18 50 Q 14 46 12 50 Q 14 54 18 52 Z" fill="#facc15" />
          <path d="M 82 54 Q 86 50 88 54 Q 86 58 82 56 Z" fill="#a16207" />
          <ellipse cx="36" cy="42" rx="10" ry="5" fill="#fef08a" opacity="0.7" />
          <path d="M 30 22 L 36 32 L 26 30 Z" fill="#22c55e" />
        </svg>
      )
    case 'grape':
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <defs>
            <radialGradient id="grape-glow" cx="35%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#e9d5ff" />
              <stop offset="60%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#4c1d95" />
            </radialGradient>
          </defs>
          <path d="M 50 25 Q 45 12 60 10 Q 70 18 60 28 Z" fill="#22c55e" stroke="#15803d" strokeWidth="1" />
          <path d="M 50 30 L 50 38" stroke="#15803d" strokeWidth="2" />
          {[
            [35,42],[50,42],[65,42],
            [42,55],[58,55],
            [35,65],[50,65],[65,65],
            [42,78],[58,78],
            [50,88],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="9" fill="url(#grape-glow)" />
          ))}
        </svg>
      )
    case 'bell':
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <defs>
            <linearGradient id="bell-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#facc15" />
              <stop offset="100%" stopColor="#a16207" />
            </linearGradient>
          </defs>
          <path d="M 50 18 Q 50 12 56 12 L 56 18 L 56 22 Q 78 32 78 60 L 82 70 L 18 70 L 22 60 Q 22 32 44 22 L 44 18 L 44 12 Q 50 12 50 18 Z" fill="url(#bell-grad)" stroke="#854d0e" strokeWidth="2" />
          <ellipse cx="50" cy="82" rx="8" ry="6" fill="#a16207" stroke="#451a03" strokeWidth="1.5" />
          <line x1="42" y1="34" x2="40" y2="56" stroke="#fef9c3" strokeWidth="3" opacity="0.5" strokeLinecap="round" />
        </svg>
      )
    case 'diamond':
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <defs>
            <linearGradient id="dia-1" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#cffafe" />
              <stop offset="60%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#0e7490" />
            </linearGradient>
            <linearGradient id="dia-2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#67e8f9" />
              <stop offset="100%" stopColor="#155e75" />
            </linearGradient>
          </defs>
          <path d="M 20 38 L 50 12 L 80 38 L 50 90 Z" fill="url(#dia-1)" stroke="#0e7490" strokeWidth="2" />
          <path d="M 20 38 L 80 38 L 50 90 Z" fill="url(#dia-2)" opacity="0.6" />
          <path d="M 20 38 L 35 22 L 50 38 L 35 54 Z" fill="#a5f3fc" opacity="0.4" />
          <path d="M 50 12 L 35 38 L 50 38 L 65 38 Z" fill="#ecfeff" opacity="0.5" />
        </svg>
      )
    case 'seven':
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <defs>
            <linearGradient id="seven-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fecaca" />
              <stop offset="50%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#7f1d1d" />
            </linearGradient>
            <linearGradient id="seven-grad-2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fde047" />
              <stop offset="100%" stopColor="#a16207" />
            </linearGradient>
          </defs>
          <rect x="10" y="10" width="80" height="80" rx="10" fill="#1e1b4b" stroke="url(#seven-grad-2)" strokeWidth="3" />
          <text x="50" y="74" fontSize="64" fontWeight="900" textAnchor="middle" fontFamily="Impact, sans-serif" fill="url(#seven-grad)" stroke="#fde047" strokeWidth="1.5">7</text>
        </svg>
      )
    case 'blank':
    default:
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <rect x="20" y="20" width="60" height="60" rx="8" fill="#27272a" stroke="#3f3f46" strokeWidth="2" strokeDasharray="3 3" />
        </svg>
      )
  }
}

// ─── shared helpers ────────────────────────────────────────────────

function fmtChips(n) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(v % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(v / 1_000_000_000).toFixed(v % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(v / 1000)}K`
  return v.toLocaleString()
}

function fmtSigned(n) {
  const v = Number(n) || 0
  if (v === 0) return '$0'
  return v > 0 ? `+$${fmtChips(v)}` : `−$${fmtChips(Math.abs(v))}`
}

function pnlClass(n) {
  if (n > 0) return 'text-emerald-300'
  if (n < 0) return 'text-rose-300'
  return 'text-zinc-400'
}

function parseBet(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(/^\$/, '').replace(/,/g, '').toUpperCase()
  if (!s) return null
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMBT]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const mul = ({ '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 })[m[2]] ?? 1
  if (!Number.isFinite(n)) return null
  return Math.floor(n * mul)
}

// Dot positions for a d6 face in a 100×100 viewBox.
function dotsFor(v) {
  const TL = [28, 28], TR = [72, 28]
  const ML = [28, 50], MC = [50, 50], MR = [72, 50]
  const BL = [28, 72], BR = [72, 72]
  switch (v) {
    case 1: return [MC]
    case 2: return [TL, BR]
    case 3: return [TL, MC, BR]
    case 4: return [TL, TR, BL, BR]
    case 5: return [TL, TR, MC, BL, BR]
    case 6: return [TL, TR, ML, MR, BL, BR]
    default: return [MC]
  }
}

// Small dice face glyph for the craps bet grid. The bet buttons are
// text-free now — these glyphs carry the meaning.
function DieGlyph({ v, size = 28, tone = 'light' }) {
  const fill = tone === 'light' ? '#fafafa' : '#27272a'
  const stroke = tone === 'light' ? '#27272a' : '#fafafa'
  const dot = tone === 'light' ? '#27272a' : '#fafafa'
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <rect x="6" y="6" width="88" height="88" rx="14" fill={fill} stroke={stroke} strokeWidth="3" />
      {dotsFor(v).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="8" fill={dot} />
      ))}
    </svg>
  )
}

// ─── SLOTS TAB ─────────────────────────────────────────────────────

// Each visible reel cell. Bumped slightly larger so symbols breathe
// (the user explicitly asked for "a bit more padding at the top and
// bottom of each").
const SYMBOL_H = 88
const STRIP_LEN = 32   // total symbols on the virtual drum strip

// Per-reel resting symbol — what each reel shows when there's no
// real result yet. Three DIFFERENT fruit symbols on purpose: an idle
// machine that "happens" to show three cherries or three sevens
// teases the player with a phantom win they didn't earn. The trio
// here can't form any payable combo (mixed fruits, none of them
// cherry-cherry-cherry or two-cherry).
const REEL_REST_SYMBOLS = ['lemon', 'grape', 'bell']

function SlotsTab({
  casinoState, myBank, joined,
  onSpin, lastSpin, spinning, setSpinning,
  pnl, spinId,
}) {
  const cfg = casinoState?.slots
  const minBet = cfg?.minBet ?? 1
  // Engine-level cap (the slots table limit). NOT clamped to myBank —
  // doing that made every preset chip silently collapse to the bank
  // balance when funds were low, which felt like the buttons weren't
  // working. We let the user dial any legal bet and just disable the
  // Spin / Auto buttons when bet > myBank so the feedback is loud.
  const maxBet = cfg?.maxBet ?? 10_000_000
  const [bet, setBet] = useState(25)
  const [betInput, setBetInput] = useState('25')
  // Turbo mode halves the settle animation — for the player who's
  // farmed slots to muscle memory and wants the next pull faster.
  const [turbo, setTurbo] = useState(false)
  // Auto-spin queue. Decrements after each completed spin until 0.
  // Cancelable with a click; pauses if the player runs out of bank.
  const [autoSpinsLeft, setAutoSpinsLeft] = useState(0)
  // spinId is owned by the parent CasinoPanel so it survives this tab
  // unmounting (the user switching to Craps or Lottery and back). The
  // Reel uses an internal "animated for spinId X" ref so a remount
  // with the current spinId does NOT replay the spin animation — the
  // ceremonial intro pull on the very first panel mount is the only
  // one we ever want to see for free.

  // Reel-stop staggering. Right reel finishes last for the suspense
  // beat slot machines build their reputation on. Turbo clips both
  // the per-reel duration and the inter-reel offsets.
  const baseDuration = turbo ? 700 : 1300
  const reelDelays = turbo ? [0, 140, 320] : [0, 280, 620]
  const totalSettleMs = baseDuration + reelDelays[2] + 120
  useEffect(() => {
    if (spinId === 0 || !spinning) return
    const t = setTimeout(() => setSpinning(false), totalSettleMs)
    return () => clearTimeout(t)
  }, [spinId, spinning, totalSettleMs, setSpinning])

  // Auto-spin loop: each time a spin settles, fire the next.
  useEffect(() => {
    if (autoSpinsLeft <= 0 || spinning) return
    if (bet > myBank) { setAutoSpinsLeft(0); return }
    // Tiny breath between spins so the win banner is readable.
    const t = setTimeout(() => {
      setAutoSpinsLeft(n => n - 1)
      setSpinning(true)
      onSpin(bet)
    }, turbo ? 150 : 400)
    return () => clearTimeout(t)
  }, [autoSpinsLeft, spinning, bet, myBank, turbo, onSpin, setSpinning])

  const commitBet = (n) => {
    const clamped = Math.max(minBet, Math.min(maxBet, Math.floor(n)))
    setBet(clamped)
    setBetInput(String(clamped))
  }
  const spinIt = () => {
    if (spinning) return
    if (bet < minBet || bet > myBank) return
    setSpinning(true)
    onSpin(bet)
  }
  const startAutoSpin = (n) => {
    if (spinning || autoSpinsLeft > 0) {
      setAutoSpinsLeft(0)
      return
    }
    setAutoSpinsLeft(n)
  }

  const winTone = (() => {
    if (!lastSpin || spinning) return null
    if (lastSpin.winType === 'three_of_a_kind' && lastSpin.symbol === 'seven') return 'jackpot'
    if (lastSpin.winType === 'three_of_a_kind') return 'big'
    if (lastSpin.winType === 'two_cherry') return 'small'
    return 'lose'
  })()

  // Per-reel "winning" flag for the glow + pulse highlight.
  const reelIsWinning = (i) => {
    if (spinning || !lastSpin) return false
    if (lastSpin.winType === 'three_of_a_kind') return true
    if (lastSpin.winType === 'two_cherry') return lastSpin.reels?.[i] === 'cherry'
    return false
  }

  return (
    <div className="space-y-3">
      {/* Reel viewport — back to the original moody amber/zinc blend.
          A bright outer frame on win was hijacking the eye to all 9
          symbols when the actual payline is just the centre row. */}
      <div className={`relative rounded-xl border-2 p-3 shadow-[0_0_22px_rgba(245,158,11,0.25)_inset] ${winTone === 'jackpot' ? 'border-amber-300 bg-gradient-to-b from-amber-900/70 via-zinc-950 to-amber-900/70 animate-pulse' : 'border-amber-500/40 bg-gradient-to-b from-amber-950/60 via-zinc-950 to-amber-950/60'}`}>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map(i => (
            <Reel
              key={i}
              result={lastSpin?.reels?.[i]}
              spinId={spinId}
              delayMs={reelDelays[i]}
              baseDuration={baseDuration}
              isWinning={reelIsWinning(i)}
              restSymbol={REEL_REST_SYMBOLS[i]}
            />
          ))}
        </div>

        {/* Win banner — bigger and louder than before so a win
            actually feels like a win. */}
        <div className={`mt-3 min-h-[52px] rounded-lg border px-3 py-2 text-center ${winTone === 'jackpot' ? 'border-amber-300 bg-amber-500/20 shadow-[0_0_24px_rgba(245,158,11,0.55)]' : winTone === 'big' ? 'border-emerald-500/60 bg-emerald-500/10' : winTone === 'small' ? 'border-rose-500/40 bg-rose-500/10' : 'border-zinc-800 bg-zinc-950/70'}`}>
          {spinning ? (
            <div className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Spinning…</div>
          ) : !lastSpin ? (
            <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Place a bet and pull the lever.</div>
          ) : winTone === 'jackpot' ? (
            <div className="text-sm font-black uppercase tracking-widest text-amber-100">
              🔥 JACKPOT — 7-7-7 — ×{lastSpin.multiplier}
              <div className="text-xl tabular-nums text-amber-200">+${fmtChips(lastSpin.payout)}</div>
            </div>
          ) : winTone === 'big' ? (
            <div>
              <div className={`text-[11px] font-black uppercase tracking-widest ${SYMBOL_ACCENT[lastSpin.symbol] || 'text-emerald-200'}`}>
                {SYMBOL_LABEL[lastSpin.symbol]} × 3 · ×{lastSpin.multiplier}
              </div>
              <div className="text-lg font-black tabular-nums text-emerald-200">+${fmtChips(lastSpin.payout)}</div>
            </div>
          ) : winTone === 'small' ? (
            <div>
              <div className="text-[11px] font-black uppercase tracking-widest text-rose-200">Two cherries · ×{lastSpin.multiplier}</div>
              <div className="text-base font-black tabular-nums text-rose-100">+${fmtChips(lastSpin.payout)}</div>
            </div>
          ) : (
            <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
              No win · −${fmtChips(lastSpin.bet)}
            </div>
          )}
        </div>
      </div>

      {/* Spin row — pulled out of the bet-controls card and placed
          flush against the reel viewport so the player's eye and
          thumb never have to leave the slot machine. Turbo lives on
          the same row at a fixed width; Spin grabs the rest. */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={spinIt}
          disabled={!joined || spinning || autoSpinsLeft > 0 || bet < minBet || bet > myBank}
          className="flex-1 rounded-lg border-2 border-amber-400/60 bg-gradient-to-b from-amber-500 to-amber-700 px-3 py-3 text-base font-black uppercase tracking-widest text-zinc-950 shadow-[0_0_18px_rgba(245,158,11,0.35)] hover:from-amber-400 hover:to-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {spinning ? 'Spinning…' : bet > myBank ? `Need $${fmtChips(bet - myBank)} more` : `Spin · $${fmtChips(bet)}`}
        </button>
        <button
          type="button"
          onClick={() => setTurbo(t => !t)}
          title="Turbo mode — shorter animation per spin"
          className={`shrink-0 rounded-lg border-2 px-3 text-[11px] font-black uppercase tracking-widest ${turbo ? 'border-amber-300 bg-amber-500/30 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.35)]' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          ⚡<br />Turbo
        </button>
      </div>

      {/* Bet controls — moved BELOW the spin button now that the
          spin button is anchored to the reel viewport. The bet input
          is the focal point of this card. */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Bet amount</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-emerald-300 font-black text-base">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={betInput}
                onChange={(e) => setBetInput(e.target.value)}
                onBlur={() => {
                  const n = parseBet(betInput)
                  commitBet(n ?? bet)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="w-full max-w-[10rem] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-lg font-black tabular-nums text-white outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5 text-[10px] font-black uppercase tracking-widest">
          {[25, 100, 1000, 10_000, 100_000].map(v => (
            <button key={v} type="button" onClick={() => commitBet(v)} className="rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1.5 text-zinc-200 hover:bg-zinc-800">
              ${fmtChips(v)}
            </button>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-[10px] font-black uppercase tracking-widest">
          <button type="button" onClick={() => commitBet(Math.max(minBet, Math.floor(bet / 2)))} className="rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1.5 text-zinc-300 hover:bg-zinc-800">½</button>
          <button type="button" onClick={() => commitBet(bet * 2)} className="rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1.5 text-zinc-300 hover:bg-zinc-800">2×</button>
          <button type="button" onClick={() => commitBet(bet * 10)} className="rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1.5 text-zinc-300 hover:bg-zinc-800">10×</button>
          <button type="button" onClick={() => commitBet(Math.min(maxBet, myBank))} className="rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1.5 text-zinc-300 hover:bg-zinc-800">Max</button>
        </div>

        {/* Auto-spin — three quick-set chips + a stop button */}
        <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px] font-black uppercase tracking-widest">
          {[10, 50, 250].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => startAutoSpin(n)}
              disabled={!joined || bet > myBank}
              className="rounded-md border border-amber-700/60 bg-amber-950/40 px-1 py-1.5 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
            >
              Auto ×{n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAutoSpinsLeft(0)}
            disabled={autoSpinsLeft === 0}
            className="rounded-md border border-rose-700/60 bg-rose-950/40 px-1 py-1.5 text-rose-200 hover:bg-rose-900/40 disabled:opacity-30"
          >
            {autoSpinsLeft > 0 ? `Stop (${autoSpinsLeft})` : 'Stop'}
          </button>
        </div>
      </div>

      {/* Session stats — spins counter, hit rate, biggest win */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-2">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Spins</div>
            <div className="text-sm font-black tabular-nums text-white">{pnl.spins.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Hit rate</div>
            <div className="text-sm font-black tabular-nums text-white">
              {pnl.spins > 0 ? `${Math.round((pnl.wins / pnl.spins) * 100)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Biggest hit</div>
            <div className={`text-sm font-black tabular-nums ${pnl.biggest > 0 ? 'text-amber-300' : 'text-zinc-500'}`}>
              {pnl.biggest > 0 ? `+$${fmtChips(pnl.biggest)}` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Payout table */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Payouts</div>
        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px]">
          {[
            { id: 'seven',   mul: cfg?.threeOfAKind?.seven   ?? 4000, count: 3, label: '7-7-7 JACKPOT' },
            { id: 'diamond', mul: cfg?.threeOfAKind?.diamond ?? 750,  count: 3 },
            { id: 'bell',    mul: cfg?.threeOfAKind?.bell    ?? 100,  count: 3 },
            { id: 'grape',   mul: cfg?.threeOfAKind?.grape   ?? 30,   count: 3 },
            { id: 'lemon',   mul: cfg?.threeOfAKind?.lemon   ?? 8,    count: 3 },
            { id: 'cherry',  mul: cfg?.threeOfAKind?.cherry  ?? 3,    count: 3 },
            { id: 'cherry',  mul: cfg?.twoCherry ?? 0.5,             count: 2, label: '2 cherries' },
          ].map((row, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 rounded-md bg-zinc-900/70 px-2 py-1">
              <div className="flex items-center gap-1">
                {Array.from({ length: row.count }).map((_, i) => (
                  <span key={i} className="inline-block">
                    <SymbolSVG id={row.id} className="h-6 w-6" />
                  </span>
                ))}
                <span className={`ml-2 text-[10px] font-black tracking-widest ${SYMBOL_ACCENT[row.id] || 'text-zinc-300'}`}>
                  {row.label || `${SYMBOL_LABEL[row.id]} × 3`}
                </span>
              </div>
              <span className="font-black tabular-nums text-amber-300">×{row.mul}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Reel({ result, spinId, delayMs, baseDuration, isWinning, restSymbol = 'lemon' }) {
  // Initialize to the current spinId so a remount (tab switch) with
  // an unchanged spinId skips the animation. Only an actual bump from
  // the parent (new spin, or intro at first panel mount) is treated
  // as a fresh event worth animating.
  const animatedRef = useRef(spinId)
  // Build a fresh strip each spin. The last three entries are the
  // visible final state (top placeholder, payline, bottom placeholder)
  // — that lets the CSS transition land the result exactly on the
  // payline row no matter how fast or slow the duration is.
  const strip = useMemo(() => {
    const arr = []
    // Filler symbols — randomized but deterministic per spinId so a
    // resize during a spin doesn't reshuffle the visible cells.
    let seed = (spinId * 9301 + 49297) % 233280
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    for (let i = 0; i < STRIP_LEN - 3; i += 1) {
      arr.push(REEL_STRIP_ORDER[Math.floor(rand() * REEL_STRIP_ORDER.length)])
    }
    arr.push(REEL_STRIP_ORDER[Math.floor(rand() * REEL_STRIP_ORDER.length)]) // visible top after settle
    // Default the payline to a per-reel resting fruit until a real
    // spin lands. The three reels' rest symbols are deliberately
    // mismatched (see REEL_REST_SYMBOLS) so the idle machine looks
    // alive and bright but never accidentally reads as a winning
    // combo the player didn't earn.
    arr.push(result || restSymbol)
    arr.push(REEL_STRIP_ORDER[Math.floor(rand() * REEL_STRIP_ORDER.length)]) // visible bottom after settle
    return arr
  }, [spinId, result])

  // Three render stages:
  //   'idle'  — pre-first-spin or post-settle. Show payline static.
  //   'snap'  — instant translateY(0). No transition.
  //   'spin'  — translateY to final offset with cubic-bezier ease-out.
  const [stage, setStage] = useState('idle')

  useEffect(() => {
    if (spinId === animatedRef.current) return
    animatedRef.current = spinId
    if (spinId === 0) return
    setStage('snap')
    // Double-RAF: ensure the snap-to-top render commits BEFORE the
    // transition-bearing render flips it to the final offset. Without
    // it the browser collapses both into one paint and we get a
    // teleport instead of a spin.
    let r1, r2
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setStage('spin'))
    })
    return () => {
      if (r1) cancelAnimationFrame(r1)
      if (r2) cancelAnimationFrame(r2)
    }
  }, [spinId])

  // Final offset lands the payline (strip index STRIP_LEN - 2) on the
  // middle of the 3-row viewport. With the strip starting flush at
  // the top of the viewport (translateY 0), translating by
  // -(STRIP_LEN - 3) × SYMBOL_H scrolls the last three entries into
  // the visible window.
  const finalOffset = -(STRIP_LEN - 3) * SYMBOL_H

  let transform
  let transition
  if (stage === 'snap') {
    transform = 'translateY(0px)'
    transition = 'none'
  } else if (stage === 'spin') {
    transform = `translateY(${finalOffset}px)`
    // cubic-bezier(.12, .62, .18, 1) — quick wind-up then a long
    // luxurious slow-down. Feels like a real drum.
    transition = `transform ${baseDuration + delayMs}ms cubic-bezier(.12, .62, .18, 1)`
  } else {
    transform = `translateY(${finalOffset}px)`
    transition = 'none'
  }

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-amber-900/60 bg-zinc-950 shadow-[0_2px_8px_rgba(0,0,0,0.6)_inset]"
      style={{ height: SYMBOL_H * 3 }}
    >
      {/* Payline highlight — z-10, BEHIND the symbol strip. When the
          reel is part of a winning combo, this is the element that
          glows / pulses; the symbol on top keeps its native color
          (the amber glow shines THROUGH the SVG's transparent
          gutters around the fruit, not OVER it). */}
      <div
        className={`pointer-events-none absolute inset-x-0 z-10 border-y ${isWinning ? 'border-amber-300 bg-gradient-to-b from-amber-400/0 via-amber-400/55 to-amber-400/0 shadow-[0_0_22px_rgba(245,158,11,0.7)] animate-[casino-win-pulse_0.9s_ease-in-out_infinite]' : 'border-amber-500/40 bg-gradient-to-b from-amber-500/0 via-amber-500/15 to-amber-500/0'}`}
        style={{ top: SYMBOL_H, height: SYMBOL_H }}
      />
      {/* Symbol strip — z-20, ABOVE the payline highlight so the
          fruit colors are never tinted by the glow. */}
      <div className="absolute inset-x-0 top-0 z-20 flex flex-col" style={{ transform, transition, willChange: 'transform' }}>
        {strip.map((s, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center justify-center"
            style={{ height: SYMBOL_H, padding: '8px 0' }}
          >
            <SymbolSVG id={s} className="h-14 w-14 sm:h-16 sm:w-16" />
          </div>
        ))}
      </div>
      {/* Top + bottom vignettes — z-30, ON TOP of everything so they
          dim the non-payline symbols (preserving the "3D drum" feel)
          without covering the centre row where the payline glow + the
          winning symbol live. Split into two band-scoped gradients so
          the middle row is left fully transparent. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-zinc-950/90 via-zinc-950/40 to-transparent" style={{ height: SYMBOL_H }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-zinc-950/90 via-zinc-950/40 to-transparent" style={{ height: SYMBOL_H }} />
    </div>
  )
}

// ─── CRAPS TAB ─────────────────────────────────────────────────────

// Two bet sections, both visual-only (no descriptive prose):
//   • Sum bets — pick the total the two dice will add up to. Eleven
//     buttons (2 through 12), payout ratios mirror real Vegas table
//     pays so 6 / 8 are the player-friendly bets and 7 is the
//     suckered-by-house edge bet that gets all the action anyway.
//   • Hard pair bets — bet on a specific dice pair (2-2 / 3-3 /
//     4-4 / 5-5). Same total-sum probability as the corresponding
//     num_X bet but with bigger pays because the dice have to match.
const CRAPS_SUM_BETS = [
  { id: 'num_2',  num: 2,  pay: '30:1' },
  { id: 'num_3',  num: 3,  pay: '15:1' },
  { id: 'num_4',  num: 4,  pay: '9:1' },
  { id: 'num_5',  num: 5,  pay: '7:1' },
  { id: 'num_6',  num: 6,  pay: '6:1' },
  { id: 'num_7',  num: 7,  pay: '4:1' },
  { id: 'num_8',  num: 8,  pay: '6:1' },
  { id: 'num_9',  num: 9,  pay: '7:1' },
  { id: 'num_10', num: 10, pay: '9:1' },
  { id: 'num_11', num: 11, pay: '15:1' },
  { id: 'num_12', num: 12, pay: '30:1' },
]
const CRAPS_HARD_BETS = [
  { id: 'hard_4',  v: 2, pay: '30:1' },
  { id: 'hard_6',  v: 3, pay: '9:1' },
  { id: 'hard_8',  v: 4, pay: '9:1' },
  { id: 'hard_10', v: 5, pay: '30:1' },
]

function CrapsTab({
  casinoState, myBank, joined,
  onRoll, lastRoll, rolling, setRolling,
  pnl,
}) {
  const cfg = casinoState?.craps
  const minBet = cfg?.minBet ?? 1
  const maxBet = cfg?.maxBet ?? 10_000_000
  const [wagers, setWagers] = useState({})
  const [chipSize, setChipSize] = useState(25)
  const [animState, setAnimState] = useState('idle')
  const [dispDice, setDispDice] = useState([6, 6])

  useEffect(() => {
    if (!lastRoll || !rolling) return
    setAnimState('tumble')
    const intervalId = setInterval(() => {
      setDispDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)])
    }, 70)
    const stopId = setTimeout(() => {
      clearInterval(intervalId)
      setDispDice([lastRoll.dice[0], lastRoll.dice[1]])
      setAnimState('settled')
      setRolling(false)
    }, 950)
    return () => {
      clearInterval(intervalId)
      clearTimeout(stopId)
    }
  }, [lastRoll, rolling, setRolling])

  const totalWager = useMemo(() => Object.values(wagers).reduce((a, b) => a + (Number(b) || 0), 0), [wagers])
  const canRoll = joined && !rolling && totalWager > 0 && totalWager <= myBank

  const addToBet = (id) => {
    setWagers(prev => {
      const cur = Number(prev[id]) || 0
      const next = Math.max(0, Math.min(maxBet, cur + chipSize))
      const out = { ...prev }
      if (next === 0) delete out[id]
      else out[id] = next
      return out
    })
  }
  const clearBet = (id) => setWagers(prev => {
    const out = { ...prev }
    delete out[id]
    return out
  })
  const clearAll = () => setWagers({})
  const roll = () => {
    if (!canRoll) return
    const bets = Object.entries(wagers)
      .filter(([, amt]) => amt >= minBet)
      .map(([type, amount]) => ({ type, amount }))
    if (bets.length === 0) return
    setRolling(true)
    setAnimState('tumble')
    onRoll(bets)
  }

  return (
    <div className="space-y-3">
      {/* Dice display */}
      <div className="relative rounded-xl border-2 border-emerald-700/40 bg-gradient-to-b from-emerald-950/70 via-emerald-950/40 to-emerald-950/70 p-4 shadow-[0_0_18px_rgba(5,150,105,0.2)_inset]">
        <div className="flex items-center justify-center gap-8 py-2">
          <BigDie value={dispDice[0]} tumble={animState === 'tumble'} />
          <BigDie value={dispDice[1]} tumble={animState === 'tumble'} delayMs={120} />
        </div>
        <div className="mt-1 min-h-[40px] text-center">
          {rolling ? (
            <div className="text-[12px] font-black uppercase tracking-widest text-emerald-200/80">Rolling…</div>
          ) : !lastRoll ? (
            <div className="text-[12px] font-black uppercase tracking-widest text-zinc-400">
              Tap bets to load up. Roll resolves them all.
            </div>
          ) : (
            <div>
              <div className="text-2xl font-black tabular-nums text-emerald-100">
                {lastRoll.total}
              </div>
              <div className={`text-sm font-black tabular-nums ${lastRoll.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {fmtSigned(lastRoll.net)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chip-size selector + total wager + roll */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Wagered</div>
            <div className="mt-0.5 text-base font-black tabular-nums text-white">${fmtChips(totalWager)}</div>
          </div>
          {totalWager > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
            >
              Clear
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
          <span className="text-zinc-400">Chip:</span>
          {[5, 25, 100, 1000, 10_000, 100_000, 1_000_000].map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setChipSize(v)}
              className={`rounded-md border px-2 py-1 ${chipSize === v ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}
            >
              ${fmtChips(v)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={roll}
          disabled={!canRoll}
          className="mt-3 w-full rounded-lg border-2 border-emerald-400/60 bg-gradient-to-b from-emerald-500 to-emerald-700 px-3 py-3 text-base font-black uppercase tracking-widest text-zinc-950 shadow-[0_0_14px_rgba(16,185,129,0.4)] hover:from-emerald-400 hover:to-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {rolling ? 'Rolling…' : `Roll the Dice · $${fmtChips(totalWager)}`}
        </button>
      </div>

      {/* Bet board — sum bets up top (11 numbers, 4 cols, last row
          centers itself), hard-pair bets in a 4-column footer. Pure
          visual; no descriptive prose. */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2">
        <div className="px-1 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">
          Bet a total
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {CRAPS_SUM_BETS.map(({ id, num, pay }, idx) => {
            const amt = wagers[id] || 0
            const result = lastRoll?.results?.find(r => r.type === id)
            const tone = !result || rolling
              ? (amt > 0 ? 'border-amber-400/40 bg-amber-500/5' : 'border-zinc-700 bg-zinc-900')
              : result.won
                ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                : (result.amount > 0 ? 'border-rose-700/50 bg-rose-900/20 opacity-70' : 'border-zinc-700 bg-zinc-900')
            // Center the last row: idx 8/9/10 are the only entries in
            // row 3 (since 11 items in a 4-col grid leaves the row
            // unbalanced). col-start-1/2/3 puts them in the middle
            // of the 4-col grid.
            const isLastRow = idx >= 8
            const colStart = idx === 8 ? 'col-start-1' : ''
            return (
              <button
                key={id}
                type="button"
                onClick={() => addToBet(id)}
                disabled={!joined || rolling || (totalWager + chipSize) > myBank}
                className={`relative rounded-lg border p-2 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${isLastRow ? colStart : ''}`}
              >
                <span className="absolute right-1 top-1 text-[9px] font-black tabular-nums text-amber-300">{pay}</span>
                <div className="flex h-12 items-center justify-center">
                  <span className={`text-3xl font-black tabular-nums ${num === 7 ? 'text-amber-200' : 'text-white'}`}>{num}</span>
                </div>
                {amt > 0 && (
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-zinc-950 shadow-sm">
                      ${fmtChips(amt)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); clearBet(id) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); clearBet(id) } }}
                      className="cursor-pointer rounded-full bg-zinc-700/80 px-1.5 text-[10px] font-black text-zinc-200 hover:bg-zinc-600"
                    >×</span>
                  </div>
                )}
                {result && !rolling && result.won && (
                  <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-emerald-500/40 text-center text-[9px] font-black uppercase tracking-widest text-emerald-50">
                    +${fmtChips(result.winnings)}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-3 border-t border-zinc-800 pt-2 px-1 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">
          Bet an exact pair
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {CRAPS_HARD_BETS.map(({ id, v, pay }) => {
            const amt = wagers[id] || 0
            const result = lastRoll?.results?.find(r => r.type === id)
            const tone = !result || rolling
              ? (amt > 0 ? 'border-amber-400/40 bg-amber-500/5' : 'border-zinc-700 bg-zinc-900')
              : result.won
                ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                : (result.amount > 0 ? 'border-rose-700/50 bg-rose-900/20 opacity-70' : 'border-zinc-700 bg-zinc-900')
            return (
              <button
                key={id}
                type="button"
                onClick={() => addToBet(id)}
                disabled={!joined || rolling || (totalWager + chipSize) > myBank}
                className={`relative rounded-lg border p-2 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
              >
                <span className="absolute right-1 top-1 text-[9px] font-black tabular-nums text-amber-300">{pay}</span>
                <div className="flex h-12 items-center justify-center gap-1">
                  <DieGlyph v={v} size={26} />
                  <DieGlyph v={v} size={26} />
                </div>
                {amt > 0 && (
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-zinc-950 shadow-sm">
                      ${fmtChips(amt)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); clearBet(id) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); clearBet(id) } }}
                      className="cursor-pointer rounded-full bg-zinc-700/80 px-1.5 text-[10px] font-black text-zinc-200 hover:bg-zinc-600"
                    >×</span>
                  </div>
                )}
                {result && !rolling && result.won && (
                  <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-emerald-500/40 text-center text-[9px] font-black uppercase tracking-widest text-emerald-50">
                    +${fmtChips(result.winnings)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Session breakdown by bet count + biggest bagged win */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-2">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Rolls</div>
            <div className="text-sm font-black tabular-nums text-white">{pnl.rolls.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Hits</div>
            <div className="text-sm font-black tabular-nums text-white">{pnl.wins.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Biggest hit</div>
            <div className={`text-sm font-black tabular-nums ${pnl.biggest > 0 ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {pnl.biggest > 0 ? `+$${fmtChips(pnl.biggest)}` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BigDie({ value, tumble, delayMs = 0 }) {
  const v = Math.max(1, Math.min(6, Math.floor(value) || 1))
  return (
    <div
      className="relative"
      style={tumble ? { animation: `casino-die-tumble 0.42s ease-in-out infinite`, animationDelay: `${delayMs}ms` } : undefined}
    >
      <svg viewBox="0 0 100 100" className="h-16 w-16 sm:h-20 sm:w-20 drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)]">
        <defs>
          <linearGradient id="die-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fafafa" />
            <stop offset="100%" stopColor="#d4d4d8" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="88" height="88" rx="14" fill="url(#die-grad)" stroke="#27272a" strokeWidth="3" />
        {dotsFor(v).map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="7.5" fill="#27272a" />
        ))}
      </svg>
    </div>
  )
}

// ─── LOTTERY TAB ───────────────────────────────────────────────────

function LotteryTab({
  casinoState, myBank, joined,
  onBuy, lastBuy, buying, setBuying,
  pnl,
}) {
  const cfg = casinoState?.lottery
  const ticketPrice = cfg?.ticketPrice ?? 10
  const maxTickets = cfg?.maxTicketsPerBuy ?? 1_000_000
  const tiers = cfg?.tiers || []
  // Single source of truth: the input string. Count + cost are derived
  // on every keystroke so the cost preview updates instantly — no
  // commit-on-blur step, no quick-buy chips. If the input is empty or
  // garbage, count is 0 and the buy button stays disabled until it
  // parses cleanly.
  const [countInput, setCountInput] = useState('10')
  const count = useMemo(() => {
    const n = parseBet(countInput)
    if (n == null || n < 1) return 0
    return Math.min(maxTickets, Math.floor(n))
  }, [countInput, maxTickets])
  const totalCost = count * ticketPrice

  useEffect(() => {
    if (!buying || !lastBuy) return
    setBuying(false)
  }, [lastBuy, buying, setBuying])

  const buy = () => {
    if (buying) return
    if (count < 1 || totalCost > myBank) return
    setBuying(true)
    onBuy(count)
  }

  const sortedTiers = useMemo(() => [...tiers].sort((a, b) => a.prize - b.prize), [tiers])
  const fmtOdds = (p) => {
    if (!p || p <= 0) return '—'
    const inv = Math.round(1 / p)
    return `1 in ${inv.toLocaleString()}`
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-purple-500/40 bg-gradient-to-b from-purple-950/60 via-zinc-950 to-purple-950/60 p-3 shadow-[0_0_18px_rgba(168,85,247,0.25)_inset]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-purple-300">Megaball Lottery</div>
            <div className="mt-0.5 text-[11px] font-bold text-zinc-300 leading-snug">
              ${ticketPrice} a ticket. Twelve prize tiers up to a <span className="text-amber-300 font-black">$10,000,000,000</span> jackpot at 1 in 10<sup>15</sup>.
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-end gap-3">
          <div className="flex-1">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Tickets</div>
            <input
              type="text"
              inputMode="numeric"
              value={countInput}
              onChange={(e) => setCountInput(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-lg font-black tabular-nums text-white outline-none focus:border-purple-500"
            />
          </div>
          <div className="text-right">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Total cost</div>
            <div className="mt-1 text-lg font-black tabular-nums text-rose-200">${fmtChips(totalCost)}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={buy}
          disabled={!joined || buying || count < 1 || totalCost > myBank}
          className="mt-3 w-full rounded-lg border-2 border-purple-400/60 bg-gradient-to-b from-purple-500 to-purple-700 px-3 py-3 text-base font-black uppercase tracking-widest text-white shadow-[0_0_18px_rgba(168,85,247,0.35)] hover:from-purple-400 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {buying ? 'Drawing tickets…' : count < 1 ? 'Enter ticket count' : `Buy ${count.toLocaleString()} ticket${count === 1 ? '' : 's'} · −$${fmtChips(totalCost)}`}
        </button>
      </div>

      {/* Last buy results */}
      {lastBuy && !buying && (
        <div className={`rounded-lg border-2 p-3 ${lastBuy.jackpotHit ? 'border-amber-400 bg-amber-500/15 shadow-[0_0_18px_rgba(245,158,11,0.4)] animate-pulse' : 'border-zinc-700/70 bg-zinc-950/45'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {lastBuy.jackpotHit ? '🔥 JACKPOT 🔥 — Results' : 'Last draw'}
            </div>
            <div className={`text-base font-black tabular-nums ${lastBuy.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {fmtSigned(lastBuy.net)}
            </div>
          </div>
          <div className="mt-1 text-[10px] font-bold text-zinc-400">
            Bought <span className="tabular-nums text-white">{lastBuy.tickets.toLocaleString()}</span> · Cost <span className="tabular-nums text-rose-200">${fmtChips(lastBuy.totalCost)}</span> · Won <span className="tabular-nums text-emerald-200">${fmtChips(lastBuy.totalWon)}</span>
          </div>
          <div className="mt-2 space-y-1">
            {lastBuy.breakdown.length === 0 ? (
              <div className="rounded-md bg-zinc-900/70 px-2 py-2 text-center text-[11px] font-bold text-zinc-500">
                No winners. Pour one out for your bank.
              </div>
            ) : (
              lastBuy.breakdown.map(({ prize, count: cnt }) => {
                const isJackpot = prize >= 10_000_000_000
                const isBig     = prize >= 1_000_000_000
                const tone = isJackpot
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-100'
                  : isBig
                    ? 'bg-purple-500/20 border-purple-400/60 text-purple-100'
                    : 'bg-zinc-900/70 border-zinc-800 text-zinc-200'
                return (
                  <div key={prize} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${tone}`}>
                    <div className="text-[11px] font-black">
                      <span className="tabular-nums">×{cnt.toLocaleString()}</span> · ${fmtChips(prize)} {isJackpot ? 'JACKPOT' : ''}
                    </div>
                    <div className="text-[11px] font-black tabular-nums text-emerald-300">
                      +${fmtChips(cnt * prize)}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Session tally */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 px-3 py-2">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Tickets</div>
            <div className="text-sm font-black tabular-nums text-white">{pnl.tickets.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Draws</div>
            <div className="text-sm font-black tabular-nums text-white">{pnl.draws.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Biggest hit</div>
            <div className={`text-sm font-black tabular-nums ${pnl.biggest > 0 ? 'text-purple-300' : 'text-zinc-500'}`}>
              {pnl.biggest > 0 ? `+$${fmtChips(pnl.biggest)}` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Prize table */}
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Prize table</div>
        <div className="mt-2 space-y-1">
          {sortedTiers.map((t, i) => {
            const isJackpot = t.prize >= 10_000_000_000
            const isBig     = t.prize >= 1_000_000_000
            const tone = isJackpot
              ? 'bg-amber-500/10 border-amber-400/50 text-amber-100'
              : isBig
                ? 'bg-purple-500/10 border-purple-400/40 text-purple-100'
                : 'bg-zinc-900/70 border-zinc-800 text-zinc-200'
            return (
              <div key={i} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${tone}`}>
                <div className="text-[11px] font-black tabular-nums">
                  ${fmtChips(t.prize)} {isJackpot ? <span className="ml-1 text-[9px] uppercase tracking-widest">Jackpot</span> : ''}
                </div>
                <div className="text-[10px] font-bold tabular-nums text-zinc-400">{fmtOdds(t.prob)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── ROOT PANEL ────────────────────────────────────────────────────

const EMPTY_PNL = { wagered: 0, won: 0, spins: 0, wins: 0, biggest: 0, rolls: 0, tickets: 0, draws: 0 }

export default function CasinoPanel({
  casinoState,
  myBank = 0,
  joined,
  onSpinSlots,
  onRollCraps,
  onBuyLottery,
  lastSpin,
  lastRoll,
  lastBuy,
  spinning, setSpinning,
  rolling, setRolling,
  buying, setBuying,
}) {
  const [tab, setTab] = useState('slots')

  // Per-game session P/L. Lives here so it survives tab-switching but
  // resets when the panel unmounts (close/reopen). Each game's ledger
  // is keyed off the last* prop reference — when the server sends a
  // new result, the ref changes and we bump the tally exactly once.
  const [slotPnl, setSlotPnl] = useState({ wagered: 0, won: 0, spins: 0, wins: 0, biggest: 0 })
  const [crapsPnl, setCrapsPnl] = useState({ wagered: 0, won: 0, rolls: 0, wins: 0, biggest: 0 })
  const [lotteryPnl, setLotteryPnl] = useState({ wagered: 0, won: 0, tickets: 0, draws: 0, biggest: 0 })

  // Three independent dedupe refs — each game completes asynchronously
  // and we want a tally tick to fire exactly once per server result.
  // seenSpin is initialized to the CURRENT lastSpin so a reopen with a
  // prior result doesn't trigger a phantom animation — only a fresh
  // server-side spin (a new ref) bumps spinId.
  const seenSpin = useRef(lastSpin)
  const seenRoll = useRef(null)
  const seenBuy = useRef(null)

  // `spinId` drives the slot-reel animation. Owned here so it survives
  // the SlotsTab unmounting on tab switch — the tab-return Reel sees
  // the same spinId it had before, so its animatedRef trick suppresses
  // the spin. No ceremonial intro: removed because the random idle
  // symbols could happen to land on cherries / diamonds and the player
  // would feel the house "stole" a win that was never theirs.
  const [spinId, setSpinId] = useState(0)

  useEffect(() => {
    if (lastSpin && lastSpin !== seenSpin.current) {
      seenSpin.current = lastSpin
      setSpinId(id => id + 1)
      setSlotPnl(p => ({
        wagered: p.wagered + (lastSpin.bet || 0),
        won:     p.won     + (lastSpin.payout || 0),
        spins:   p.spins + 1,
        wins:    p.wins  + (lastSpin.payout > 0 ? 1 : 0),
        biggest: Math.max(p.biggest, lastSpin.payout || 0),
      }))
    }
  }, [lastSpin])
  useEffect(() => {
    if (lastRoll && lastRoll !== seenRoll.current) {
      seenRoll.current = lastRoll
      const wins = (lastRoll.results || []).filter(r => r.won).length
      const biggest = (lastRoll.results || []).reduce((m, r) => Math.max(m, r.winnings || 0), 0)
      setCrapsPnl(p => ({
        wagered: p.wagered + (lastRoll.totalWager || 0),
        won:     p.won     + (lastRoll.totalPayout || 0),
        rolls:   p.rolls + 1,
        wins:    p.wins + wins,
        biggest: Math.max(p.biggest, biggest),
      }))
    }
  }, [lastRoll])
  useEffect(() => {
    if (lastBuy && lastBuy !== seenBuy.current) {
      seenBuy.current = lastBuy
      // The "biggest hit" is the largest single-ticket prize in this
      // batch — taken from the breakdown so a 1M-ticket grind that
      // hits one $25K still records that as the high-water mark.
      const biggest = (lastBuy.breakdown || []).reduce((m, b) => Math.max(m, b.prize), 0)
      setLotteryPnl(p => ({
        wagered: p.wagered + (lastBuy.totalCost || 0),
        won:     p.won     + (lastBuy.totalWon || 0),
        tickets: p.tickets + (lastBuy.tickets || 0),
        draws:   p.draws + 1,
        biggest: Math.max(p.biggest, biggest),
      }))
    }
  }, [lastBuy])

  const slotNet    = slotPnl.won    - slotPnl.wagered
  const crapsNet   = crapsPnl.won   - crapsPnl.wagered
  const lotteryNet = lotteryPnl.won - lotteryPnl.wagered
  const totalNet   = slotNet + crapsNet + lotteryNet

  return (
    <div className="space-y-3">
      {/* Local keyframes — kept inside the panel so they ship with the
          component and don't pollute globals.css. */}
      <style jsx global>{`
        @keyframes casino-die-tumble {
          0%   { transform: rotate(0deg)   translateY(0)   scale(1); }
          25%  { transform: rotate(120deg) translateY(-6px) scale(1.05); }
          50%  { transform: rotate(240deg) translateY(2px)  scale(0.95); }
          75%  { transform: rotate(360deg) translateY(-3px) scale(1.03); }
          100% { transform: rotate(480deg) translateY(0)   scale(1); }
        }
        @keyframes casino-win-pulse {
          0%, 100% { box-shadow: 0 0 14px rgba(245,158,11,0.45), inset 0 2px 8px rgba(0,0,0,0.6); }
          50%      { box-shadow: 0 0 28px rgba(245,158,11,0.9),  inset 0 2px 8px rgba(0,0,0,0.6); }
        }
      `}</style>

      {/* Header — bank balance is now the loudest thing on screen so
          the user can see at a glance how much ammunition they have
          left. Per-game P/L pills sit underneath so "exactly how bad
          you're losing" is always one glance away. */}
      <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-[0_0_18px_rgba(0,0,0,0.4)_inset]">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Bank balance</div>
            <div className="text-3xl font-black tabular-nums text-white leading-tight">
              ${fmtChips(myBank)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Casino P/L</div>
            <div className={`text-2xl font-black tabular-nums leading-tight ${pnlClass(totalNet)}`}>
              {fmtSigned(totalNet)}
            </div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-black uppercase tracking-widest">
          <div className="rounded-md border border-amber-700/40 bg-amber-950/20 px-2 py-1.5">
            <div className="text-[9px] text-amber-300/70">Slots</div>
            <div className={`tabular-nums ${pnlClass(slotNet)}`}>{fmtSigned(slotNet)}</div>
          </div>
          <div className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2 py-1.5">
            <div className="text-[9px] text-emerald-300/70">Craps</div>
            <div className={`tabular-nums ${pnlClass(crapsNet)}`}>{fmtSigned(crapsNet)}</div>
          </div>
          <div className="rounded-md border border-purple-700/40 bg-purple-950/20 px-2 py-1.5">
            <div className="text-[9px] text-purple-300/70">Lotto</div>
            <div className={`tabular-nums ${pnlClass(lotteryNet)}`}>{fmtSigned(lotteryNet)}</div>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="grid grid-cols-3 gap-1.5 text-[10px] font-black uppercase tracking-widest">
        <button
          type="button"
          onClick={() => setTab('slots')}
          className={`rounded-md border px-2 py-2 ${tab === 'slots' ? 'border-amber-500/60 bg-amber-500/20 text-amber-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          🎰 Slots
        </button>
        <button
          type="button"
          onClick={() => setTab('craps')}
          className={`rounded-md border px-2 py-2 ${tab === 'craps' ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          🎲 Craps
        </button>
        <button
          type="button"
          onClick={() => setTab('lottery')}
          className={`rounded-md border px-2 py-2 ${tab === 'lottery' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          🎟 Lottery
        </button>
      </div>

      {tab === 'slots' && (
        <SlotsTab
          casinoState={casinoState}
          myBank={myBank}
          joined={joined}
          onSpin={onSpinSlots}
          lastSpin={lastSpin}
          spinning={spinning}
          setSpinning={setSpinning}
          pnl={slotPnl}
          spinId={spinId}
        />
      )}
      {tab === 'craps' && (
        <CrapsTab
          casinoState={casinoState}
          myBank={myBank}
          joined={joined}
          onRoll={onRollCraps}
          lastRoll={lastRoll}
          rolling={rolling}
          setRolling={setRolling}
          pnl={crapsPnl}
        />
      )}
      {tab === 'lottery' && (
        <LotteryTab
          casinoState={casinoState}
          myBank={myBank}
          joined={joined}
          onBuy={onBuyLottery}
          lastBuy={lastBuy}
          buying={buying}
          setBuying={setBuying}
          pnl={lotteryPnl}
        />
      )}
    </div>
  )
}

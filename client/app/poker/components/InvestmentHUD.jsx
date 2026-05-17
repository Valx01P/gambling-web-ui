'use client'

// Investment HUD — financial summary widget that lives in the same
// column as the chat / side-bets dock, sitting just ABOVE them.
//
// Positioning is intentionally NOT self-contained:
//   • The component renders as a normal block element.
//   • Its parent is the dock column (`flex flex-col items-end gap-3`),
//     which is `md:absolute md:bottom-0 md:right-0` on desktop — so the
//     HUD is out of layout flow on desktop (doesn't push anything
//     around) and grows the column upward above the dock.
//   • On mobile the same column is in flow + centered, so the HUD
//     joins the centered stack like a normal element.
//
// On/off is controlled from Tools → Widgets (`poker_investment_hud_enabled`).
// The × on the header offers a quick local close that flips the same
// state. The Finances pill in the page header also toggles it on.
//
// 2026-05: split "Chips" (table stack) from "Money" (bank cash). The
// bank balance is the player's persistent off-table wallet — every
// investment, asset yield, job claim, etc. settles there. Chips at
// the table are betting money only and are capped at 1000.

function fmtCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(abs % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${sign}${(abs / 1_000_000_000).toFixed(abs % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${sign}${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${sign}${Math.round(abs / 1000)}K`
  return n.toLocaleString()
}

export default function InvestmentHUD({
  // Bank cash — money not in any asset. Used for buys, rebuys, debt
  // payoffs. Red when negative (overdraft).
  myBank,
  // Poker chips at the table (capped at CHIP_STACK_MAX = 1000).
  myChips,
  cryptoState,
  assetsState,
  stocksState,
  worldState,
  // Bank loans (lender debt the player owes — accrues interest per
  // hand). `loans = [{ owed, interestRate, ... }]`.
  bankLoans = [],
  // Peer-loan list, with `myPlayerId` so we can net (lender) +
  // (borrower) sides.
  peerLoans = [],
  myPlayerId,
  onOpenPanel,
  onClose,
}) {
  // Aggregate positions across every engine.
  const coinIndex = new Map((cryptoState?.coins || []).map(c => [c.id, c]))
  let cryptoValue = 0, cryptoCost = 0
  for (const p of (cryptoState?.myPositions || [])) {
    const c = coinIndex.get(p.coinId)
    if (!c) continue
    cryptoValue += (p.shares || 0) * (c.price || 0)
    cryptoCost += p.costBasis || 0
  }
  const assetsValue = (assetsState?.myPositions || []).reduce((s, p) => s + (p.currentValue || 0), 0)
  const assetsYield = (assetsState?.myPositions || []).reduce((s, p) => {
    const e = (assetsState?.catalog || []).find(c => c.id === p.assetId)
    return s + (e?.yieldPerHand || 0) * (p.units || 0)
  }, 0)
  const stocksValue = (stocksState?.myPositions || []).reduce((s, p) => s + (p.currentValue || 0), 0)
  const stocksCost  = (stocksState?.myPositions || []).reduce((s, p) => s + (p.costBasis || 0), 0)
  const territories = (worldState?.territories || []).filter(t => t.isMine)
  const worldYield = territories.reduce(
    (s, t) => s + Math.floor((t.yieldBase || 0) * (worldState?.yieldMultiplier ?? 1)),
    0
  )

  // Debt accrual: every hand bank loans add (owed × rate) to the
  // owed balance, and peer loans grow the same way. Net these into
  // passive income as NEGATIVE flow — sitting on a $100k loan at 5%/h
  // is a $5k/hand drag on your wallet regardless of investments.
  const bankInterestPerHand = (bankLoans || []).reduce(
    (s, l) => s + Math.round((l.owed || 0) * (l.interestRate || 0)),
    0
  )
  let peerInterestNet = 0  // positive when net lender
  for (const l of (peerLoans || [])) {
    const accrual = Math.round((l.owed || 0) * (l.rate || 0))
    if (l.lenderId === myPlayerId) peerInterestNet += accrual
    else if (l.borrowerId === myPlayerId) peerInterestNet -= accrual
  }

  const positiveYield = assetsYield + worldYield + Math.max(0, peerInterestNet)
  const negativeYield = bankInterestPerHand + Math.max(0, -peerInterestNet)
  const passiveIncome = positiveYield - negativeYield

  // Net worth: liquid cash + all positions. Excludes debt — owed
  // amounts are an outflow per hand, not a snapshot subtraction
  // (the bank already lent them the money, which is in the wallet
  // now). The Bank panel surfaces the debt summary separately.
  const totalNetWorth = (myBank || 0) + (myChips || 0) + cryptoValue + assetsValue + stocksValue

  // Tile cell — small, label on top, value below. Strong hover so
  // it's obvious which tile the pointer is over. cursor-pointer is
  // explicit (matches the app-wide rule but stays robust if the
  // global selector ever stops matching this element).
  const Tile = ({ label, value, accent, onClick, title }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="min-w-0 flex flex-col items-start rounded-md px-1.5 py-1 text-left cursor-pointer transition-colors hover:bg-zinc-700/80 hover:ring-1 hover:ring-amber-400/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/70"
    >
      <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500 leading-none">{label}</span>
      <span className={`mt-0.5 text-[11px] font-black tabular-nums truncate w-full ${accent || 'text-white'}`}>{value}</span>
    </button>
  )

  const moneyAccent = (myBank || 0) < 0 ? 'text-red-300' : 'text-sky-200'

  return (
    <div className="w-full md:w-[320px] overflow-hidden rounded-xl border border-zinc-600/50 bg-zinc-800/95 shadow-2xl backdrop-blur-md shrink-0">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-700/60 bg-zinc-900/60 px-3 py-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-amber-300">
          Investment HUD
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide HUD"
            title="Hide HUD (re-enable from Tools → Widgets)"
            className="-mr-2 rounded-md px-1.5 text-base leading-none text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
          >
            ×
          </button>
        )}
      </div>
      {/* 3-column tile grid. Money + Chips occupy the first two cells
          so the two wallet types read at a glance. Passive/h goes red
          when net debt accrual outweighs yields. */}
      <div className="grid grid-cols-3 gap-px bg-zinc-800/60 p-1">
        <Tile
          label="Money"
          value={`$${fmtCompact(myBank)}`}
          accent={moneyAccent}
          onClick={() => onOpenPanel('bank')}
          title={(myBank || 0) < 0
            ? `Bank balance overdrawn ($${fmtCompact(myBank)}). Pay off debts or take a bank loan.`
            : 'Bank cash — not in any asset. Used to invest, rebuy, pay debts.'}
        />
        <Tile
          label="Chips"
          value={`$${fmtCompact(myChips)}`}
          accent="text-white"
          onClick={() => onOpenPanel('bank')}
          title="Poker chips on the table — capped at 1000. Wins above the cap sweep to bank."
        />
        <Tile label="Crypto" value={`$${fmtCompact(cryptoValue)}`} accent={cryptoValue >= cryptoCost ? 'text-emerald-300' : 'text-red-300'} onClick={() => onOpenPanel('crypto')} />
        <Tile label="Stocks" value={`$${fmtCompact(stocksValue)}`} accent={stocksValue >= stocksCost ? 'text-emerald-300' : 'text-red-300'} onClick={() => onOpenPanel('stocks')} />
        <Tile label="Real est." value={`$${fmtCompact(assetsValue)}`} accent="text-emerald-200" onClick={() => onOpenPanel('assets')} />
        <Tile label="Territories" value={territories.length} accent="text-purple-300" onClick={() => onOpenPanel('world')} />
      </div>
      {/* Passive income row — read-only summary. NOT a button: it
          doesn't open any panel since the breakdown's components
          (assets / territories / bank loans) each have their own
          tiles above. Plain div with default cursor. */}
      <div
        title="Asset + territory yields per hand minus debt interest accruing on bank + peer loans."
        className="flex w-full items-center justify-between border-t border-zinc-700/60 bg-zinc-900/40 px-3 py-1 text-[10px] font-black uppercase tracking-widest cursor-default"
      >
        <span className="text-zinc-400">Passive / hand</span>
        <span className="flex items-center gap-2 tabular-nums">
          {positiveYield > 0 && (
            <span className="text-emerald-300">+${fmtCompact(positiveYield)}</span>
          )}
          {negativeYield > 0 && (
            <span className="text-red-300">−${fmtCompact(negativeYield)}</span>
          )}
          <span className={passiveIncome === 0 ? 'text-zinc-400' : passiveIncome > 0 ? 'text-emerald-300' : 'text-red-300'}>
            {passiveIncome >= 0 ? '+' : '−'}${fmtCompact(Math.abs(passiveIncome))}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => onOpenPanel('finances')}
        className="flex w-full items-center justify-between border-t border-zinc-700/60 bg-zinc-900/40 px-3 py-1 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800"
      >
        <span className="text-zinc-400">Net worth</span>
        <span className="text-amber-300 tabular-nums">${fmtCompact(totalNetWorth)}</span>
      </button>
      {worldState?.pandemicActive && (
        <div className="border-t border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-200 text-center">
          ☣️ Pandemic active
        </div>
      )}
    </div>
  )
}

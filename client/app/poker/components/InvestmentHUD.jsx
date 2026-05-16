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
// state.

function fmtCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

export default function InvestmentHUD({ myChips, cryptoState, assetsState, stocksState, worldState, onOpenPanel, onClose }) {
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

  const totalLiquidValue = (myChips || 0) + cryptoValue + assetsValue + stocksValue
  const passiveIncome = assetsYield + worldYield

  const Row = ({ label, value, accent, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[10px] font-bold hover:bg-zinc-800"
    >
      <span className="text-zinc-400">{label}</span>
      <span className={accent || 'text-white'}>${value}</span>
    </button>
  )

  return (
    // Width tracks the dock items (sidebets / chat are `md:w-[320px]`,
    // mobile w-full) so the HUD aligns with whatever's sitting under it.
    <div className="w-full md:w-[320px] overflow-hidden rounded-xl border border-zinc-600/50 bg-zinc-800/95 shadow-2xl backdrop-blur-md shrink-0">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5">
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
      <div className="p-2">
        <Row label="Chips" value={fmtCompact(myChips)} accent="text-white" onClick={() => onOpenPanel('bank')} />
        <Row label="Crypto" value={fmtCompact(cryptoValue)} accent={cryptoValue >= cryptoCost ? 'text-emerald-300' : 'text-red-300'} onClick={() => onOpenPanel('crypto')} />
        <Row label="Stocks" value={fmtCompact(stocksValue)} accent={stocksValue >= stocksCost ? 'text-emerald-300' : 'text-red-300'} onClick={() => onOpenPanel('stocks')} />
        <Row label="Real estate" value={fmtCompact(assetsValue)} accent="text-emerald-200" onClick={() => onOpenPanel('assets')} />
        <Row label="Territories" value={territories.length} accent="text-purple-300" onClick={() => onOpenPanel('world')} />
        <div className="my-1 border-t border-zinc-800" />
        <Row label="Net worth" value={fmtCompact(totalLiquidValue)} accent="text-amber-300 font-black" onClick={() => onOpenPanel('finances')} />
        {passiveIncome > 0 && (
          <Row label="Passive / hand" value={`+${fmtCompact(passiveIncome)}`} accent="text-emerald-300" onClick={() => onOpenPanel('assets')} />
        )}
        {worldState?.pandemicActive && (
          <div className="mt-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-200">
            ☣️ Pandemic active
          </div>
        )}
      </div>
    </div>
  )
}

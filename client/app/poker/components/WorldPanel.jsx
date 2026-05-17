'use client'

import { useState } from 'react'
import CatalogIcon from './CatalogIcon'
import WorldMapView from './WorldMapView'

// World-map tycoon panel. Two views: a flat grid Map View where
// territories are laid out by region with owner colors painted on
// the cells, and a List View with full per-territory details.

function fmtCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

// Region groups for the flat map layout — order top-to-bottom.
// "orbital" floats above earth; polar regions bracket the world.
const REGION_GROUPS = [
  { id: 'orbital',   label: 'Off-World' },
  { id: 'polar',     label: 'Polar' },
  { id: 'americas',  label: 'Americas' },
  { id: 'eurasia',   label: 'Eurasia' },
  { id: 'africa',    label: 'Africa' },
  { id: 'oceania',   label: 'Oceania / Pacific' },
  { id: 'other',     label: 'Other' },
]

// Single territory card in the list view. Three states:
//   - unowned: "Claim for $X" button.
//   - owned by another player: offer input + "Make offer" button +
//     visibility into the player's own pending offer (if any) with
//     a Cancel.
//   - owned by viewer: "Owned" badge + an Offers section listing
//     every pending bid with Accept / Decline buttons.
function TerritoryRow({ t, myChips, joined, yieldMul, onClaim, onMakeOffer, onAcceptOffer, onDeclineOffer, onCancelOffer }) {
  const owned = !!t.ownerId
  const canAfford = (myChips || 0) >= t.currentCost
  const yieldPct = ((t.yieldRate || 0.07) * 100).toFixed(1)
  const yieldDollars = Math.floor((t.currentCost || 0) * (t.yieldRate || 0.07) * (yieldMul || 1))
  // Offer state — only shown for non-mine owned regions.
  const [offerDraft, setOfferDraft] = useState('')
  const myOffer = owned && !t.isMine
    ? (t.offers || []).find(o => !t.isMine && Number.isFinite(o.price) && o.id && o.buyerName)
    : null
  return (
    <div className={`rounded-lg border p-3 ${t.isMine ? 'border-emerald-500/50 bg-emerald-950/30' : 'border-zinc-700/70 bg-zinc-950/45'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <CatalogIcon
            id={t.id}
            name={t.name}
            color={t.ownerColor || undefined}
            className="h-14 w-20 shrink-0 sm:h-16 sm:w-24"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-white truncate">{t.name}</div>
            <div className="text-[10px] font-bold">
              <span className="text-zinc-300">Yield </span>
              <span className="text-emerald-300">{yieldPct}%/h</span>
              <span className="text-zinc-500"> · </span>
              <span className="text-emerald-300">+${fmtCompact(yieldDollars)}/hand</span>
              <span className="ml-2 text-zinc-300">Cost </span>
              <span className="text-white">${fmtCompact(t.currentCost)}</span>
            </div>
            {owned && (
              <div className="text-[10px] font-bold text-zinc-400 flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: t.ownerColor || '#94a3b8' }} />
                Held by {t.isMine ? <span className="text-emerald-300">you</span> : <span className="text-amber-300">{t.ownerName}</span>}
                {(t.offerCount || 0) > 0 && (
                  <span className="ml-1 rounded border border-amber-400/40 bg-amber-500/15 px-1 text-[8px] tracking-widest text-amber-200">
                    {t.offerCount} OFFER{t.offerCount === 1 ? '' : 'S'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Right-side action */}
        {!owned ? (
          <button
            type="button"
            onClick={() => onClaim(t.id)}
            disabled={!joined || !canAfford}
            title={!canAfford ? `Need $${fmtCompact(t.currentCost)} — short $${fmtCompact(t.currentCost - (myChips || 0))}` : `Claim ${t.name}`}
            className="shrink-0 rounded-md border border-purple-400/60 bg-purple-500/15 px-3 py-2 text-xs font-black uppercase tracking-widest text-purple-100 hover:bg-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {!canAfford ? `Need $${fmtCompact(t.currentCost - (myChips || 0))}` : 'Claim'}
          </button>
        ) : t.isMine ? (
          <span className="shrink-0 rounded-md border border-emerald-500/50 bg-emerald-950/40 px-3 py-2 text-xs font-black uppercase tracking-widest text-emerald-200">
            Owned
          </span>
        ) : null}
      </div>

      {/* Offer-to-buy panel, only when someone else owns the region. */}
      {owned && !t.isMine && (() => {
        const draft = Math.max(0, Math.floor(Number(offerDraft) || 0))
        const insufficient = draft > 0 && (myChips || 0) < draft
        const myEscrowed = (t.offers || []).find(o => o.id) // best-effort: server already filtered to my offers
        return (
          <div className="mt-2 rounded-md border border-zinc-700/60 bg-zinc-900/60 p-2 space-y-1.5">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Make an offer</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                value={offerDraft}
                onChange={(e) => setOfferDraft(e.target.value)}
                placeholder={`Bid (>=$${fmtCompact(t.currentCost)})`}
                className="flex-1 min-w-0 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-xs font-bold text-white outline-none focus:border-zinc-400 tabular-nums"
              />
              <button
                type="button"
                disabled={!joined || draft <= 0 || insufficient}
                onClick={() => { onMakeOffer?.(t.id, draft); setOfferDraft('') }}
                title={insufficient ? `Need $${draft.toLocaleString()} in bank` : `Escrow $${draft.toLocaleString()} as an offer to ${t.ownerName}`}
                className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-widest disabled:cursor-not-allowed ${insufficient ? 'border-red-500/60 bg-red-950/40 text-red-200 opacity-90' : 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-40'}`}
              >
                {insufficient ? `Need $${fmtCompact(draft - (myChips || 0))}` : 'Offer'}
              </button>
            </div>
            {myEscrowed && (
              <div className="flex items-center justify-between rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold">
                <span className="text-amber-200">Pending offer: <span className="tabular-nums text-amber-100">${myEscrowed.price.toLocaleString()}</span></span>
                <button
                  type="button"
                  onClick={() => onCancelOffer?.(t.id, myEscrowed.id)}
                  className="rounded border border-zinc-500/60 bg-zinc-800 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="text-[9px] font-bold text-zinc-500 leading-snug">
              The bid escrows from your bank until {t.ownerName} accepts or declines. Cancel to get it back.
            </div>
          </div>
        )
      })()}

      {/* Owner's offer inbox, only on regions the viewer owns. */}
      {t.isMine && (t.offers || []).length > 0 && (
        <div className="mt-2 rounded-md border border-amber-700/40 bg-amber-950/20 p-2 space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-200">Pending offers</div>
          {t.offers.map(o => (
            <div key={o.id} className="flex items-center justify-between rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold gap-2">
              <span className="min-w-0 flex-1 truncate text-amber-100">
                {o.buyerName} → <span className="tabular-nums">${o.price.toLocaleString()}</span>
              </span>
              <button
                type="button"
                onClick={() => onAcceptOffer?.(t.id, o.id)}
                className="rounded border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => onDeclineOffer?.(t.id, o.id)}
                className="rounded border border-red-500/60 bg-red-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/25"
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WorldPanel({ worldState, myChips, joined, myPlayerId, onClaim, onPandemic, onMakeOffer, onAcceptOffer, onDeclineOffer, onCancelOffer }) {
  // 'globe' = real SVG world map with country borders
  // 'map'   = stylized regional grid (faster, no network for the topojson)
  // 'list'  = full detail per territory
  const [view, setView] = useState('globe')
  const territories = worldState?.territories || []
  const myOwned = territories.filter(t => t.isMine).length
  const yieldMul = worldState?.yieldMultiplier ?? 1
  const myYield = territories
    .filter(t => t.isMine)
    .reduce((s, t) => s + Math.floor((t.yieldBase || 0) * yieldMul), 0)
  const pandemicCost = Math.max(100_000,
    Math.floor(territories.reduce((s, t) => s + (t.currentCost || 0), 0) * 0.05))
  const myColor = worldState?.myColor || '#10b981'

  // Group by region for the map layout. Empty regions are skipped so
  // the layout doesn't show ghost headers.
  const byRegion = new Map()
  for (const t of territories) {
    const r = t.region || 'other'
    if (!byRegion.has(r)) byRegion.set(r, [])
    byRegion.get(r).push(t)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Your Empire</div>
            <div className="text-sm font-black text-white flex items-center gap-2">
              {myOwned > 0 && (
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: myColor }} title="Your territory color" />
              )}
              <span>{myOwned} {myOwned === 1 ? 'territory' : 'territories'}</span>
              {myOwned > 0 && (
                <span className="text-emerald-300">+${fmtCompact(myYield)}/hand</span>
              )}
            </div>
          </div>
          <div className={`text-[10px] font-black uppercase tracking-widest ${worldState?.pandemicActive ? 'text-red-300' : 'text-zinc-500'}`}>
            {worldState?.pandemicActive ? `Pandemic · ${worldState.pandemicEndsInHands ?? '?'}h` : 'World stable'}
          </div>
        </div>
        {worldState?.pandemicActive && (
          <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-200 leading-snug">
            Yields cut to {(worldState.yieldMultiplier * 100).toFixed(0)}%. Real-estate + stocks also crashed.
          </div>
        )}
        {/* Bank balance always visible — claims and offers escrow from
            the bank, so the player needs to know what they can actually
            afford without flipping to another tab. */}
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-800/80 pt-2 text-[10px] font-bold text-zinc-400">
          <span>Bank balance: <span className="tabular-nums text-white">${fmtCompact(myChips)}</span></span>
          <span className="text-zinc-500">Claims + offers escrow from your bank.</span>
        </div>
      </div>

      <div className="flex gap-1.5 text-[10px] font-black uppercase tracking-widest">
        <button
          type="button"
          onClick={() => setView('globe')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${view === 'globe' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Globe
        </button>
        <button
          type="button"
          onClick={() => setView('map')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${view === 'map' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          Regions
        </button>
        <button
          type="button"
          onClick={() => setView('list')}
          className={`flex-1 rounded-md border px-2 py-1.5 ${view === 'list' ? 'border-purple-500/60 bg-purple-500/20 text-purple-100' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
        >
          List
        </button>
      </div>

      <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-red-200">☣️ Release Pandemic</div>
            <div className="text-[10px] font-bold text-red-100/80 leading-snug">
              Crash worldwide yields + real-estate + stocks for 6 hands. Cost: ${fmtCompact(pandemicCost)}.
            </div>
          </div>
          <button
            type="button"
            onClick={onPandemic}
            disabled={!joined || worldState?.pandemicActive || (myChips || 0) < pandemicCost}
            className="shrink-0 rounded-md border border-red-400/60 bg-red-500/30 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-50 hover:bg-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Release
          </button>
        </div>
      </div>

      {view === 'globe' ? (
        <WorldMapView
          territories={territories}
          myChips={myChips}
          joined={joined}
          yieldMultiplier={yieldMul}
          onClaim={onClaim}
        />
      ) : view === 'map' ? (
        <div className="space-y-2">
          {REGION_GROUPS.map(group => {
            const tiles = byRegion.get(group.id) || []
            if (tiles.length === 0) return null
            return (
              <div key={group.id} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2">
                <div className="px-1 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">{group.label}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {tiles.map(t => {
                    const owned = !!t.ownerId
                    const fillColor = t.ownerColor || (owned ? '#475569' : 'transparent')
                    const canAfford = (myChips || 0) >= t.currentCost
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onClaim(t.id)}
                        disabled={!joined || t.isMine || !canAfford}
                        title={owned
                          ? (t.isMine ? 'Yours' : `Held by ${t.ownerName} · ${fmtCompact(t.currentCost)} to take`)
                          : !canAfford
                            ? `Need ${fmtCompact(t.currentCost)} — not enough chips`
                            : `Claim for ${fmtCompact(t.currentCost)}`}
                        className={`relative overflow-hidden rounded-md border px-2 py-2 text-left transition-all disabled:opacity-70 ${
                          t.isMine ? 'border-emerald-400/70' : owned ? 'border-amber-400/40' : 'border-zinc-700/70 hover:border-zinc-500'
                        }`}
                        style={owned
                          ? { background: `linear-gradient(to right, ${fillColor}80, ${fillColor}30)` }
                          : undefined}
                      >
                        <div className="text-[11px] font-black text-white truncate leading-tight">{t.name}</div>
                        <div className="mt-0.5 text-[9px] font-bold leading-tight">
                          <span className="text-emerald-200">+${fmtCompact(Math.floor(t.yieldBase * yieldMul))}/h</span>
                          <span className="ml-1 text-zinc-200">· ${fmtCompact(t.currentCost)}</span>
                        </div>
                        {owned && (
                          <div className="mt-0.5 text-[9px] font-bold truncate">
                            {t.isMine ? (
                              <span className="text-emerald-300">★ YOURS</span>
                            ) : (
                              <span className="text-amber-200">{t.ownerName}</span>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {territories.map(t => (
            <TerritoryRow
              key={t.id}
              t={t}
              myChips={myChips}
              joined={joined}
              yieldMul={yieldMul}
              onClaim={onClaim}
              onMakeOffer={onMakeOffer}
              onAcceptOffer={onAcceptOffer}
              onDeclineOffer={onDeclineOffer}
              onCancelOffer={onCancelOffer}
            />
          ))}
        </div>
      )}
    </div>
  )
}

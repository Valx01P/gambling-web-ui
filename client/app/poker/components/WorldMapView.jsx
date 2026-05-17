'use client'

import { useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'

// Standard 110m-resolution world borders from world-atlas. Vendored
// locally (`public/world-110m.json`, ~105KB) because the third-party
// CDN was silently failing for some users — browser extensions, strict
// content-blockers, and offline dev all break the CDN path. Local file
// = guaranteed render. Cached by the browser like any other static asset.
const GEO_URL = '/world-110m.json'

// Render-only world map. Receives the territories array (each with a
// `countries` field listing country names that the world-atlas TopoJSON
// recognizes). Builds a quick country-name → territory lookup, then
// paints each country path with the owner's color (or the territory's
// own color if unclaimed). Click a country to focus its territory; a
// floating popover lets the player claim/take/own it.
function fmtCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

export default function WorldMapView({ territories, myChips, joined, yieldMultiplier, onClaim }) {
  const [focused, setFocused] = useState(null)

  // Country → territory lookup, rebuilt only when the territories list
  // shape changes. Includes hash so we don't rebuild on color updates
  // alone (those are cheap).
  const countryIndex = useMemo(() => {
    const m = new Map()
    for (const t of territories || []) {
      for (const country of (t.countries || [])) {
        m.set(country, t)
      }
    }
    return m
  }, [territories])

  function fillFor(countryName) {
    const t = countryIndex.get(countryName)
    if (!t) return '#1f2937'   // unmapped country — dim grey
    if (t.ownerColor) return t.ownerColor
    // Unclaimed territories stay COLORLESS — neutral slate so the map
    // reads as "blank canvas, paint it by claiming". The owner's seat
    // color (assigned in claim order by the world engine) only appears
    // once they actually own the territory.
    return '#374151'
  }

  function onCountryClick(geo) {
    const name = geo.properties?.name
    const t = countryIndex.get(name)
    if (!t) return
    setFocused(t)
  }

  const t = focused
  const tile = t  // alias for clarity

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-zinc-700/70 bg-zinc-950/45 px-3 py-2 text-[10px] font-bold text-zinc-300 leading-snug">
        Tap a country to focus its territory. Owned regions are painted in
        the owner's color. Other players can outbid you for a region you
        already own — costs scale with each takeover.
      </div>
      <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 overflow-hidden">
        {/* The map itself. Constrained aspect so it doesn't dominate
            the tools panel on mobile. ZoomableGroup lets the user
            pan / zoom into smaller regions; default zoom shows the
            whole globe. */}
        <ComposableMap
          projection="geoEqualEarth"
          projectionConfig={{ scale: 145 }}
          width={800}
          height={400}
          style={{ width: '100%', height: 'auto' }}
        >
          <ZoomableGroup center={[0, 20]} zoom={1} maxZoom={5}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) => (geographies || []).map(geo => {
                const name = geo.properties?.name
                const matched = countryIndex.get(name)
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onClick={() => onCountryClick(geo)}
                    style={{
                      default: {
                        fill: fillFor(name),
                        stroke: '#0a0a0a',
                        strokeWidth: 0.4,
                        outline: 'none',
                      },
                      hover: {
                        fill: matched ? (matched.ownerColor || matched.color || '#71717a') : '#52525b',
                        stroke: '#fafafa',
                        strokeWidth: 0.7,
                        outline: 'none',
                        cursor: matched ? 'pointer' : 'default',
                      },
                      pressed: { fill: '#fde047', outline: 'none' },
                    }}
                  />
                )
              })}
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
      </div>

      {/* Focused-territory popover. Stays in the layout flow under the
          map (instead of an absolute-positioned tooltip) so it works
          on touch devices without finicky hover. */}
      {tile ? (() => {
        const canAfford = (myChips || 0) >= (tile.currentCost || 0)
        const shortBy = Math.max(0, (tile.currentCost || 0) - (myChips || 0))
        const claimDisabled = !joined || tile.isMine || !canAfford
        return (
        <div
          className={`rounded-lg border p-3 ${tile.isMine ? 'border-emerald-500/50 bg-emerald-950/30' : !canAfford && !tile.isMine ? 'border-red-500/40 bg-red-950/20' : 'border-zinc-700/70 bg-zinc-950/45'}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: tile.ownerColor || tile.color || '#52525b' }} />
                <span className="text-sm font-black text-white truncate">{tile.name}</span>
              </div>
              <div className="text-[10px] font-bold mt-0.5">
                <span className="text-zinc-300">Yield </span>
                <span className="text-emerald-300">+${fmtCompact(Math.floor((tile.yieldBase || 0) * (yieldMultiplier ?? 1)))}/hand</span>
                <span className="ml-2 text-zinc-300">Cost </span>
                <span className={canAfford ? 'text-white' : 'text-red-300'}>${fmtCompact(tile.currentCost)}</span>
              </div>
              {tile.ownerId && (
                <div className="text-[10px] font-bold text-zinc-400">
                  Held by {tile.isMine ? <span className="text-emerald-300">you</span> : <span className="text-amber-300">{tile.ownerName}</span>}
                </div>
              )}
              {/* Affordability strip — only when the user can't afford,
                  and only when it's a fresh claim (not their own seat).
                  Spells out "you have X / need Y / short by Z" instead
                  of just silently disabling the button. */}
              {!tile.isMine && !canAfford && (
                <div className="mt-1 rounded-md border border-red-500/40 bg-red-950/40 px-2 py-1 text-[10px] font-black leading-tight">
                  <span className="text-red-200">Not enough chips.</span>
                  <span className="ml-1 text-zinc-300">You have </span>
                  <span className="text-white">${fmtCompact(myChips || 0)}</span>
                  <span className="text-zinc-500"> · </span>
                  <span className="text-zinc-300">short </span>
                  <span className="text-red-200">${fmtCompact(shortBy)}</span>
                </div>
              )}
              {tile.countries?.length > 0 && (
                <div className="text-[10px] text-zinc-500 mt-1 leading-snug">
                  Includes: {tile.countries.slice(0, 5).join(', ')}{tile.countries.length > 5 ? ` +${tile.countries.length - 5}` : ''}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onClaim(tile.id)}
              disabled={claimDisabled}
              title={tile.isMine
                ? 'You already own this'
                : !canAfford
                  ? `Need $${fmtCompact(tile.currentCost)} — you're short $${fmtCompact(shortBy)}`
                  : tile.ownerId
                    ? `Hostile takeover from ${tile.ownerName}`
                    : `Claim ${tile.name}`}
              className={`shrink-0 rounded-md border px-3 py-2 text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed ${
                tile.isMine
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200 opacity-60'
                  : !canAfford
                    ? 'border-red-500/60 bg-red-950/40 text-red-200 opacity-90'
                    : tile.ownerId
                      ? 'border-red-400/60 bg-red-500/15 text-red-100 hover:bg-red-500/25'
                      : 'border-purple-400/60 bg-purple-500/15 text-purple-100 hover:bg-purple-500/25'
              }`}
            >
              {tile.isMine
                ? 'Owned'
                : !canAfford
                  ? `Need $${fmtCompact(shortBy)}`
                  : tile.ownerId ? 'Take' : 'Claim'}
            </button>
          </div>
        </div>
        )
      })() : (
        <div className="rounded-md border border-zinc-700/70 bg-zinc-950/45 px-3 py-2 text-[11px] font-bold text-zinc-400 text-center">
          Tap a country to see the territory it belongs to. Off-world tiles (Mars / Moon / orbit) only show in the List view.
        </div>
      )}
    </div>
  )
}

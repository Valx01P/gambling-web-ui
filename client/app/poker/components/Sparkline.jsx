'use client'

// Tiny inline SVG sparkline for stock/coin price charts. Takes an
// array of history points and renders a smoothed path. Color is
// driven by net change (green if up vs first sample, red if down).
// Fixed-aspect (default 80×24) so it fits in stock cards without
// pushing layout. No tooltips — we save those for the dedicated
// chart view when a stock is expanded.
export default function Sparkline({ history, width = 80, height = 24, fillUnder = true }) {
  if (!Array.isArray(history) || history.length < 2) {
    return (
      <svg width={width} height={height} className="text-zinc-700">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
              stroke="currentColor" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    )
  }
  // Normalize to the available height. Floor the min/max difference
  // so a perfectly flat history doesn't divide by zero.
  const samples = history.map(h => typeof h === 'number' ? h : (h?.p ?? 0))
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const range = Math.max(max - min, 1e-9)
  const stepX = width / (samples.length - 1)
  const pts = samples.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / range) * (height - 2) - 1
    return [x, y]
  })
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  // Filled area path closes back along the bottom for a subtle volume-y vibe.
  const areaPath = fillUnder ? `${path} L${width},${height} L0,${height} Z` : null
  const net = samples[samples.length - 1] - samples[0]
  const color = net >= 0 ? '#34d399' : '#f87171'  // emerald-400 / red-400
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {areaPath && <path d={areaPath} fill={color} fillOpacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

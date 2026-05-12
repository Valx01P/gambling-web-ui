'use client'

// Pure SVG sparkline. Takes an array of numeric prices and renders a single
// polyline scaled to fill the box. Color is derived from first-vs-last:
// green if the series rose, red if it fell, zinc if flat. Sized via the
// `width`/`height` props (default 64×24 — tuned for the market-list rows on
// mobile). No deps, mounts fast enough to drop one into every list row.

import { memo } from 'react'

function buildPath(prices, width, height) {
  if (!Array.isArray(prices) || prices.length < 2) return ''
  let min = Infinity
  let max = -Infinity
  for (const p of prices) {
    if (p < min) min = p
    if (p > max) max = p
  }
  // Flat series → render a horizontal line at mid-height so the chart still
  // shows up. Otherwise the same min/max collapses into NaN.
  if (max - min < 1e-9) {
    const y = (height / 2).toFixed(2)
    return `M0,${y} L${width},${y}`
  }
  const stepX = width / (prices.length - 1)
  let d = ''
  for (let i = 0; i < prices.length; i += 1) {
    const x = (i * stepX).toFixed(2)
    const norm = (prices[i] - min) / (max - min)
    // Invert: SVG y grows downward, but a higher price should sit higher.
    const y = (height - norm * height).toFixed(2)
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`
  }
  return d
}

function MiniChartImpl({ prices, width = 64, height = 24, className = '' }) {
  const path = buildPath(prices, width, height)
  if (!path) return <div className={`inline-block ${className}`} style={{ width, height }} />
  const first = prices[0]
  const last = prices[prices.length - 1]
  const color = last > first ? '#34d399' : last < first ? '#f87171' : '#a1a1aa'
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`inline-block align-middle ${className}`}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default memo(MiniChartImpl)

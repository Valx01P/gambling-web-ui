'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../lib/api'

// Hand-rolled SVG line chart for a bot's ELO over hands played. The
// project doesn't pull in a charting library — this component is the
// only chart so far, and the shape we need (line + axes + a couple of
// annotations) is small enough that adding 30 KB of recharts isn't
// justified.
//
// Self-contained: takes a botId, fetches on mount, handles loading +
// empty + error states. The parent doesn't manage any of this.

const PADDING = { top: 18, right: 16, bottom: 28, left: 44 }
const HEIGHT = 200
const Y_FLOOR = 300 // matches bots.elo CHECK floor

function formatTimeShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = Date.now()
  const ageMs = now - d.getTime()
  if (ageMs < 60_000) return 'just now'
  if (ageMs < 3600_000) return `${Math.floor(ageMs / 60_000)}m ago`
  if (ageMs < 86400_000) return `${Math.floor(ageMs / 3600_000)}h ago`
  return d.toLocaleDateString()
}

export default function EloChart({ botId, currentElo, refreshKey = 0 }) {
  const [points, setPoints] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [width, setWidth] = useState(560)

  // Refetch whenever the parent bumps refreshKey (e.g., after a hand
  // resolves and the bot's elo prop changes upstream).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.botEloHistory(botId)
      .then(({ points }) => { if (!cancelled) setPoints(points || []) })
      .catch(err => { if (!cancelled) setError(err.detail || err.message || 'Failed to load history') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [botId, refreshKey])

  // Responsive width via ResizeObserver on a wrapper div. The chart
  // re-renders when the container resizes (e.g., the user opens a panel
  // that narrows the column).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const el = document.getElementById(`elo-chart-${botId}`)
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width)
        if (w > 0 && w !== width) setWidth(w)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [botId, width])

  const view = useMemo(() => {
    if (!points || points.length === 0) return null
    const innerW = Math.max(80, width - PADDING.left - PADDING.right)
    const innerH = HEIGHT - PADDING.top - PADDING.bottom
    const minElo = Math.min(Y_FLOOR, ...points.map(p => p.elo))
    const maxElo = Math.max(...points.map(p => p.elo))
    // Pad the Y range so the line isn't flush against the top/bottom.
    const range = Math.max(40, maxElo - minElo)
    const yMin = Math.max(Y_FLOOR, Math.floor((minElo - range * 0.1) / 10) * 10)
    const yMax = Math.ceil((maxElo + range * 0.1) / 10) * 10
    const yScale = v => PADDING.top + (1 - (v - yMin) / (yMax - yMin)) * innerH
    const xScale = i => PADDING.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2)
    const pts = points.map((p, i) => `${xScale(i).toFixed(1)},${yScale(p.elo).toFixed(1)}`).join(' ')
    // Y-axis tick marks at round numbers. 4 ticks usually reads well at
    // this height; we round the step to a nice 25/50/100/etc.
    const niceSteps = [25, 50, 100, 200, 500]
    const targetStep = (yMax - yMin) / 4
    const step = niceSteps.find(s => s >= targetStep) || niceSteps[niceSteps.length - 1]
    const ticks = []
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticks.push(v)
    // Highlight the line color by direction over the window.
    const first = points[0].elo
    const last = points[points.length - 1].elo
    const direction = last > first ? 'up' : last < first ? 'down' : 'flat'
    return { pts, yScale, xScale, yMin, yMax, ticks, innerW, innerH, direction, first, last }
  }, [points, width])

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500">
        Loading ELO history…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
        Couldn't load chart: {error}
      </div>
    )
  }
  if (!points || points.length < 2) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
          ELO over hands played
        </div>
        <div className="mt-1">
          Needs at least 2 recorded hands. Currently: {points?.length || 0}.
          {currentElo != null && (
            <> Live rating: <span className="font-bold text-zinc-200">{currentElo}</span>.</>
          )}
        </div>
      </div>
    )
  }

  const lineColor = view.direction === 'up' ? '#34d399'
                  : view.direction === 'down' ? '#fb7185'
                  : '#a1a1aa'

  return (
    <div id={`elo-chart-${botId}`} className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
          ELO over last {points.length} hands
        </div>
        <div className="text-[10px] font-bold text-zinc-400">
          <span className={view.direction === 'up' ? 'text-emerald-300' : view.direction === 'down' ? 'text-rose-300' : 'text-zinc-400'}>
            {view.direction === 'up' ? '▲' : view.direction === 'down' ? '▼' : '·'}
            {view.last - view.first >= 0 ? '+' : ''}{view.last - view.first}
          </span>
          {' '}from {view.first} to {view.last}
        </div>
      </div>
      <svg width={width} height={HEIGHT} className="block">
        {/* Y-axis ticks + gridlines */}
        {view.ticks.map((v, i) => {
          const y = view.yScale(v)
          return (
            <g key={i}>
              <line x1={PADDING.left} y1={y} x2={width - PADDING.right} y2={y}
                stroke="#27272a" strokeDasharray="2 3" />
              <text x={PADDING.left - 6} y={y + 3} textAnchor="end"
                className="fill-zinc-500" fontSize="9">{v}</text>
            </g>
          )
        })}
        {/* X-axis ticks: 5 evenly-spaced "hand N" labels */}
        {Array.from({ length: 5 }).map((_, i) => {
          const handIndex = Math.round((i / 4) * (points.length - 1))
          const x = view.xScale(handIndex)
          const y = HEIGHT - PADDING.bottom + 14
          return (
            <text key={i} x={x} y={y} textAnchor="middle"
              className="fill-zinc-500" fontSize="9">{points[handIndex].handNo}</text>
          )
        })}
        {/* The line itself */}
        <polyline points={view.pts} fill="none" stroke={lineColor} strokeWidth="1.6" />
        {/* Most-recent point as a dot so the end-of-line stands out */}
        <circle
          cx={view.xScale(points.length - 1)}
          cy={view.yScale(points[points.length - 1].elo)}
          r="3"
          fill={lineColor}
        />
      </svg>
      <div className="mt-1 flex items-baseline justify-between text-[9px] text-zinc-500">
        <span>{formatTimeShort(points[0].playedAt)}</span>
        <span>hand # · {points[0].handNo} → {points[points.length - 1].handNo}</span>
        <span>{formatTimeShort(points[points.length - 1].playedAt)}</span>
      </div>
    </div>
  )
}

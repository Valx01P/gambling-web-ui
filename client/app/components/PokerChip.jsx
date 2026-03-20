'use client'

const chipConfig = {
  5: { color: '#DC2626', edgeColor: '#FFFFFF' },
  10: { color: '#2563EB', edgeColor: '#FFFFFF' },
  25: { color: '#16A34A', edgeColor: '#FFFFFF' },
  50: { color: '#EA580C', edgeColor: '#FFFFFF' },
  100: { color: '#18181B', edgeColor: '#FFFFFF' },
  250: { color: '#9333EA', edgeColor: '#FFFFFF' },
  1000: { color: '#EAB308', edgeColor: '#18181B' },
  2500: { color: '#EC4899', edgeColor: '#FFFFFF' },
  5000: { color: '#6366F1', edgeColor: '#FFFFFF' },
  10000: { color: '#F59E0B', edgeColor: '#18181B' },
  25000: { color: '#F97316', edgeColor: '#FFFFFF' },
  100000: { color: '#64748B', edgeColor: '#FFFFFF' },
}

function formatValue(value) {
  if (value >= 1000) {
    const k = value / 1000
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`
  }
  return String(value)
}

export default function PokerChip({ value = 5, className = '' }) {
  const config = chipConfig[value] || chipConfig[5]

  return (
    <svg
      viewBox="0 0 100 100"
      className={`inline-block drop-shadow-md ${className}`}
      aria-label={`${value} chip`}
    >
      <circle cx="50" cy="50" r="48" fill={config.color} />
      {[...Array(16)].map((_, i) => {
        if (i % 2 !== 0) return null
        const a = (i * 360) / 16
        const b = ((i + 1) * 360) / 16
        const rad = (d) => (d - 90) * (Math.PI / 180)
        const x1 = 50 + 48 * Math.cos(rad(a)), y1 = 50 + 48 * Math.sin(rad(a))
        const x2 = 50 + 48 * Math.cos(rad(b)), y2 = 50 + 48 * Math.sin(rad(b))
        const x3 = 50 + 38 * Math.cos(rad(b)), y3 = 50 + 38 * Math.sin(rad(b))
        const x4 = 50 + 38 * Math.cos(rad(a)), y4 = 50 + 38 * Math.sin(rad(a))
        return (
          <path key={i}
            d={`M ${x1} ${y1} A 48 48 0 0 1 ${x2} ${y2} L ${x3} ${y3} A 38 38 0 0 0 ${x4} ${y4} Z`}
            fill={config.edgeColor}
          />
        )
      })}
      <circle cx="50" cy="50" r="36" fill={config.color} />
      <circle cx="50" cy="50" r="28" fill="#FFFFFF" />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="middle"
            fontSize="34" fontWeight="900" fill="#000" fontFamily="Arial, sans-serif" letterSpacing="-1px">
        {formatValue(value)}
      </text>
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
    </svg>
  )
}
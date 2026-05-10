'use client'

function readableTextColor(hex) {
  const c = (hex || '').replace('#', '')
  if (c.length !== 6) return '#fff'
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  // Rec. 709 luma
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luma > 0.6 ? '#111827' : '#ffffff'
}

export function resolveTextColor(bgHex, choice) {
  if (choice === 'white') return '#ffffff'
  if (choice === 'black') return '#111827'
  return readableTextColor(bgHex)
}

export default function BotAvatar({ name, color = '#3b82f6', textColor = 'auto', size = 40, className = '' }) {
  const initials = (name || '?').trim().slice(0, 2).toUpperCase()
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full font-black ${className}`}
      style={{
        width: size,
        height: size,
        background: color,
        color: resolveTextColor(color, textColor),
        fontSize: Math.max(10, Math.floor(size * 0.4))
      }}
      aria-label={`Bot ${name}`}
    >
      {initials}
    </div>
  )
}

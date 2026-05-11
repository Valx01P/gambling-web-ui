'use client'

import { memo, useEffect, useState } from 'react'

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

// Avatar repaints on every parent re-render even though its props rarely
// change. Memoizing eliminates wasted reconciliation across the 5 seated
// players on every WS tick.
//
// `avatarUrl` (optional) — when set, render the uploaded image and skip the
// colored-initials fallback. Owner-uploaded via the same S3 + CloudFront
// pipeline as user PFPs.
function BotAvatarImpl({ name, color = '#3b82f6', textColor = 'auto', avatarUrl = null, size = 40, className = '' }) {
  // Same broken-image guard as ProfileAvatar — if the URL is set but the
  // load fails (404, network, etc.) drop to the color+initials variant
  // instead of showing the browser's broken-image glyph at a seat.
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [avatarUrl])

  if (avatarUrl && !imgFailed) {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-900 ${className}`}
        style={{ width: size, height: size }}
        aria-label={`Bot ${name}`}
      >
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover object-center"
          draggable="false"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      </div>
    )
  }
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

const BotAvatar = memo(BotAvatarImpl)
export default BotAvatar

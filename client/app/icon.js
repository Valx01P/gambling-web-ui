// PNG favicon generated at build time via next/og. Coexists with
// app/icon.svg — Next emits one <link rel="icon"> tag per icon file,
// so older Safari / Android browsers that prefer raster get the PNG
// while modern browsers can take the SVG. The PNG is also what
// Google's SERP favicon thumbnail pulls (it needs a raster at ≥48px).
//
// Visual identity: emerald felt + white spade + amber chip-dot. Same
// shapes as icon.svg so the two reads consistently across platforms.

import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f3521',
          borderRadius: 96,
        }}
      >
        {/* Spade — single big white shape. 512px canvas, glyph sized to
            ~280px so it sits centered with comfortable padding. */}
        <svg viewBox="0 0 24 24" width={320} height={320}>
          <path
            d="M12 3C12 3 4 11 4 15.2C4 17.7 6 18.6 7.4 18.1C6.6 19.3 5.7 20 5.7 20H18.3C18.3 20 17.4 19.3 16.6 18.1C18 18.6 20 17.7 20 15.2C20 11 12 3 12 3Z"
            fill="#ffffff"
          />
          {/* Amber dot under the spade — same accent as icon.svg. */}
          <circle cx="12" cy="22" r="0.9" fill="#fbbf24" />
        </svg>
      </div>
    ),
    { ...size }
  )
}

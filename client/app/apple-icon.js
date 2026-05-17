// Apple touch icon. iOS / iPadOS pull this when a user pins the site
// to their home screen. Same visual identity as icon.js but at the
// 180×180 size Apple recommends (and without rounded corners — iOS
// applies its own mask, so we leave the canvas square so the mask
// doesn't double-corner it).

import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
        }}
      >
        <svg viewBox="0 0 24 24" width={120} height={120}>
          <path
            d="M12 3C12 3 4 11 4 15.2C4 17.7 6 18.6 7.4 18.1C6.6 19.3 5.7 20 5.7 20H18.3C18.3 20 17.4 19.3 16.6 18.1C18 18.6 20 17.7 20 15.2C20 11 12 3 12 3Z"
            fill="#ffffff"
          />
          <circle cx="12" cy="22" r="0.9" fill="#fbbf24" />
        </svg>
      </div>
    ),
    { ...size }
  )
}

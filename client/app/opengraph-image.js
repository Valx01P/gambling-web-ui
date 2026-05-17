// Dynamic OG image, generated at build time (the route is static thanks to
// the runtime: 'edge' isn't needed when there are no per-request inputs).
// Next.js auto-wires this to <meta property="og:image" /> at the root.
//
// Visual: dark felt with the brand wordmark and a tagline. Mirrors the
// landing page's actual look so the social preview reads as "this is the
// same thing I'll land on".

import { ImageResponse } from 'next/og'

export const alt = "PokerXYZ — Poker Bot Developer & Multiplayer Hold'em"
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #14532d 0%, #052e16 60%, #020617 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: 80,
        }}
      >
        <div style={{ display: 'flex', gap: 14, marginBottom: 40, fontSize: 56 }}>
          <span style={{ color: '#f87171' }}>♦</span>
          <span style={{ color: '#fafafa' }}>♣</span>
          <span style={{ color: '#fafafa' }}>♠</span>
          <span style={{ color: '#f87171' }}>♥</span>
        </div>
        <div style={{ display: 'flex', fontSize: 132, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>
          <span>Poker</span><span style={{ color: '#fcd34d' }}>XYZ</span>
        </div>
        <div style={{ marginTop: 18, fontSize: 22, fontWeight: 800, letterSpacing: 6, textTransform: 'uppercase', color: '#fcd34d' }}>
          Poker Bot Developer · Multiplayer Hold&apos;em
        </div>
        <div style={{ marginTop: 22, fontSize: 30, fontWeight: 600, color: '#d4d4d8', textAlign: 'center', maxWidth: 900 }}>
          Build bots in JavaScript. Train neural nets. Sit them at a real table.
        </div>
        <div style={{
          marginTop: 48,
          padding: '12px 28px',
          borderRadius: 9999,
          border: '2px solid rgba(255,255,255,0.18)',
          background: 'rgba(0,0,0,0.4)',
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: '#e4e4e7',
        }}>
          Fake chips · Real strategy · Open lobby
        </div>
      </div>
    ),
    { ...size }
  )
}

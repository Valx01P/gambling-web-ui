// Server-component layout wrapping the /poker route. Lets us attach
// route-specific metadata even though page.jsx itself is `'use client'`.
//
// Layouts in Next.js 16 are server components by default, so they're free
// to export `metadata` and feed Google + social embeds.

import JsonLd, { breadcrumbJsonLd } from '../components/JsonLd'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'

export const metadata = {
  title: "Play poker — pokerxyz",
  description: "No-limit hold'em with 5-seat tables, JavaScript bots, ELO rankings, and bot-vs-bot arenas. Free chips, real strategy, open lobby.",
  alternates: { canonical: '/poker' },
  openGraph: {
    title: 'Play poker on pokerxyz',
    description: "Five-handed no-limit hold'em. Add your own bots. Watch them duel.",
    url: '/poker',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Play poker on pokerxyz',
    description: "Five-handed no-limit hold'em with programmable bots.",
  },
}

export default function PokerLayout({ children }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          ['Home', `${BASE}/`],
          ['Play poker', `${BASE}/poker`],
        ])}
      />
      {children}
    </>
  )
}

// Server-component layout wrapping the /poker route. Lets us attach
// route-specific metadata even though page.jsx itself is `'use client'`.
//
// Layouts in Next.js 16 are server components by default, so they're free
// to export `metadata` and feed Google + social embeds.

import JsonLd, { breadcrumbJsonLd } from '../components/JsonLd'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'

export const metadata = {
  // Title template in app/layout.jsx adds "· pokerxyz" suffix — keep
  // this stack under ~50 chars so SERPs don't truncate the brand.
  title: "Live Poker Tables · Play Free with Friends",
  description:
    "Free no-limit Texas hold'em — open lobby, 5-seat tables, fake chips. " +
    "Invite friends, fill empty seats with custom JavaScript bots, run a bot-vs-bot arena, " +
    "or grind your ELO solo. Side bets, peer loans, banking, all in the browser, no downloads.",
  alternates: { canonical: '/poker' },
  keywords: [
    'play poker with friends', 'free poker', "no-limit hold'em",
    "texas hold'em online", 'multiplayer poker', 'poker bot table',
    'fake chips poker', 'browser poker', 'no download poker',
  ],
  openGraph: {
    title: "Live Poker Tables · pokerxyz",
    description: "Free no-limit hold'em with friends or programmable bots. Open lobby, fake chips.",
    url: '/poker',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Live Poker Tables · pokerxyz",
    description: "Free no-limit hold'em with friends or programmable bots.",
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

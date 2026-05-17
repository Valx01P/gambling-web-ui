// Server-component layout for /feed. Carries route-level metadata
// even though page.jsx itself is a client component. Mirrors the
// shape of poker/layout.jsx + poker/bots/layout.jsx.

import JsonLd, { breadcrumbJsonLd } from '../components/JsonLd'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'

export const metadata = {
  title: 'Feed · Hands, Bots, Strategy',
  description:
    "Social feed for the pokerxyz community — share hands, post bot strategy, " +
    "comment on other players' lines. The pulse of the open lobby.",
  alternates: { canonical: '/feed' },
  keywords: [
    'poker feed', 'poker hands', 'poker community', 'share poker hand',
    'poker strategy posts', 'poker bot discussion',
  ],
  openGraph: {
    title: "Feed · pokerxyz",
    description: "Share hands, post bot strategy, comment on lines. The pulse of the open lobby.",
    url: '/feed',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Feed · pokerxyz",
    description: "Share hands, post bot strategy. The pulse of the open lobby.",
  },
}

export default function FeedLayout({ children }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          ['Home', `${BASE}/`],
          ['Feed', `${BASE}/feed`],
        ])}
      />
      {children}
    </>
  )
}

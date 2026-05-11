// Metadata layout for the bot list + editor routes. The bot editor itself
// is auth-walled and noindex'd via the layout below, but the bot library
// page (/poker/bots) is public and worth indexing.

import JsonLd, { breadcrumbJsonLd } from '../../components/JsonLd'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'

export const metadata = {
  title: 'Poker bots — pokerxyz',
  description: 'Build, edit, and share JavaScript poker bots. Browse the public bot library ranked by ELO.',
  alternates: { canonical: '/poker/bots' },
  openGraph: {
    title: 'Poker bot library — pokerxyz',
    description: 'Public JavaScript bots ranked by ELO. Build your own and sit them at a table.',
    url: '/poker/bots',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Poker bot library — pokerxyz',
    description: 'Browse public bots or build your own in JavaScript.',
  },
}

export default function BotsLayout({ children }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          ['Home', `${BASE}/`],
          ['Play poker', `${BASE}/poker`],
          ['Bot library', `${BASE}/poker/bots`],
        ])}
      />
      {children}
    </>
  )
}

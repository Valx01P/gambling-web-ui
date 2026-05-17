// Metadata layout for the bot list + editor routes. The bot editor itself
// is auth-walled and noindex'd via the layout below, but the bot library
// page (/poker/bots) is public and worth indexing.

import JsonLd, { breadcrumbJsonLd } from '../../components/JsonLd'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'

export const metadata = {
  title: 'Build Poker Bots in JavaScript · Public Bot Library',
  description:
    "Write your own poker bot in JavaScript and sit it at a no-limit hold'em table. " +
    "Browse a public library of bots ranked by ELO, fork them, train a neural net against the field, " +
    "or build a rule-driven super-bot from scratch. Free, in-browser, no downloads.",
  alternates: { canonical: '/poker/bots' },
  keywords: [
    'poker bot builder', 'build poker bot', 'javascript poker bot',
    'programmable poker bot', 'poker bot tutorial', 'poker AI builder',
    'poker bot library', 'poker bot ELO', 'poker neural net',
    'poker bot vs bot', 'open source poker bot',
  ],
  openGraph: {
    title: "Build Poker Bots · pokerxyz",
    description: 'Write JavaScript poker bots, train neural nets, sit them at no-limit hold\'em tables. Browse public bots by ELO.',
    url: '/poker/bots',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Build Poker Bots · pokerxyz",
    description: 'Browse public bots, build your own in JavaScript, watch them duel.',
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

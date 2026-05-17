// The bot detail / editor page. Auth-walled for the owner-as-editor flow;
// public read for everyone else. We tell crawlers not to index — bot pages
// don't have unique content worth surfacing in search and would clutter the
// site's index with hundreds of near-duplicate URLs. The breadcrumb is
// still emitted because rich-link previews (Discord / Slack / Twitter) use
// JSON-LD even when noindex is set.

import JsonLd, { breadcrumbJsonLd } from '../../../components/JsonLd'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'

export const metadata = {
  title: 'Bot Editor — PokerXYZ',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

export default function BotDetailLayout({ children }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          ['Home', `${BASE}/`],
          ['Play poker', `${BASE}/poker`],
          ['Bot library', `${BASE}/poker/bots`],
          ['Bot', `${BASE}/poker/bots`],
        ])}
      />
      {children}
    </>
  )
}

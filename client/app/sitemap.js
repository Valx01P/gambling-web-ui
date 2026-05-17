// Next.js file convention — generates /sitemap.xml.
// Only the truly indexable, content-rich public routes are listed. The bot
// editor (/poker/bots/[id]) is auth-walled, so we skip it.

export default function sitemap() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'
  const now = new Date()
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${base}/poker`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${base}/poker/bots`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${base}/feed`,
      lastModified: now,
      // Feed mutates fast (every new post / comment), so hint Googlebot
      // to revisit aggressively. Real recrawl cadence is heuristic-driven
      // on Google's side, this is just a nudge.
      changeFrequency: 'hourly',
      priority: 0.6,
    },
  ]
}

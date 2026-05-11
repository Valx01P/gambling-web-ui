// Next.js file convention — generates /robots.txt at build time.
// Allows everything except per-user editor routes that have no value for
// crawlers (auth-walled and dynamic). Sitemap link helps Googlebot.

export default function robots() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://pokerxyz.io'
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/poker/bots/'],  // auth-gated editor; nothing useful for SE
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}

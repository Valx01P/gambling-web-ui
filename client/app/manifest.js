// Web app manifest (Next.js file convention → /manifest.webmanifest).
// Tells browsers + Lighthouse this is installable, gives Android a name
// and a theme color, and lets users add-to-home-screen on iOS / Chrome.

export default function manifest() {
  return {
    name: "pokerxyz — No-limit hold'em with bots you can program",
    short_name: 'pokerxyz',
    description: "Multiplayer no-limit Texas hold'em with JavaScript bots, ELO rankings, and bot-vs-bot arenas.",
    start_url: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#0f172a',
    orientation: 'any',
    categories: ['games', 'entertainment'],
    icons: [
      // The /icon.svg route Next emits is already SVG-based, so it covers
      // every density without a separate raster pipeline.
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}

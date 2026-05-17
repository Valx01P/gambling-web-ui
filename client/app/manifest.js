// Web app manifest (Next.js file convention → /manifest.webmanifest).
// Tells browsers + Lighthouse this is installable, gives Android a name
// and a theme color, and lets users add-to-home-screen on iOS / Chrome.

export default function manifest() {
  return {
    name: "PokerXYZ — Poker Bot Developer & Multiplayer Hold'em",
    short_name: 'PokerXYZ',
    description:
      "Build poker bots in JavaScript, train neural nets, sit them at no-limit hold'em tables. " +
      "Free multiplayer with friends, bot-vs-bot arenas, ELO rankings — all in the browser.",
    start_url: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#0f172a',
    orientation: 'any',
    categories: ['games', 'entertainment'],
    icons: [
      // SVG for modern browsers (renders crisp at every density).
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      // 512px PNG from app/icon.js — Chrome's installable-PWA shelf,
      // Android home-screen shortcut, and the SERP favicon thumbnail
      // all want a raster at this size. Marked `maskable` so Android
      // can apply its adaptive icon shape without clipping the spade.
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      // 180px iOS touch icon from app/apple-icon.js. Listed in the
      // manifest too so Lighthouse PWA audits don't ding us.
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  }
}

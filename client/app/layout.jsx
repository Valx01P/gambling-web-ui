import localFont from "next/font/local"
import AccountDock from "./components/AccountDock"
import FuzzyBackground from "./components/FuzzyBackground"
import FeltBootstrap from "./components/FeltBootstrap"
import ZoomLayer from "./components/ZoomLayer"
import "./globals.css"

export const googleSansCode = localFont({
  src: [
    { path: "../public/fonts/GoogleSansCode-Light.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/GoogleSansCode-Light.woff", weight: "300", style: "normal" },
    { path: "../public/fonts/GoogleSansCode-Bold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/GoogleSansCode-Bold.woff", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-google-sans-code",
  preload: true,
})

export const metadata = {
  metadataBase: new URL('https://pokerxyz.io'),
  title: {
    // Brand-forward; "Poker Bot Developer" is the SEO anchor (the
    // niche we want to own) and "Multiplayer" picks up the broader
    // hold'em audience. Lands around ~52 chars so SERPs don't clip
    // either half. Template appends "PokerXYZ" to every child route.
    default: 'PokerXYZ — Poker Bot Developer & Multiplayer Hold\'em',
    template: '%s · PokerXYZ',
  },
  description:
    "PokerXYZ is the poker bot developer's sandbox: write your own bot in JavaScript " +
    "and sit it at a real no-limit hold'em table. " +
    "Live multiplayer tables, bot-vs-bot arenas, ELO rankings, fake chips, no downloads.",
  applicationName: 'PokerXYZ',
  // Keyword list seeds Bing + a handful of vertical search engines. Less
  // load-bearing than the title/description, but cheap to keep current
  // and useful for our long-tail queries — the bot-developer angle leads
  // because that's the niche we want to own.
  keywords: [
    // Headline niche — bot developer / programmer
    'poker bot developer', 'poker bot programming', 'build poker bot',
    'javascript poker bot', 'programmable poker bot', 'poker bot builder',
    'poker bot tutorial', 'poker bot framework', 'poker AI development',
    'poker bot sandbox', 'open source poker bot',
    // Bot-vs-bot + ML angle
    'poker bot arena', 'bot vs bot poker', 'poker neural net',
    'poker reinforcement learning', 'poker ELO ladder',
    // Multiplayer poker — broader audience
    'play poker online', 'play poker with friends', 'free poker',
    "no-limit hold'em", "texas hold'em online", 'multiplayer poker',
    'browser poker', 'online poker free', 'poker with fake chips',
    'poker no real money',
    // Game features
    'poker simulator', 'poker training', 'poker leaderboard',
    'open lobby poker', 'free poker tables', 'no download poker',
  ],
  authors: [{ name: 'Pablo Valdes', url: 'https://www.linkedin.com/in/pablovaldes01/' }],
  creator: 'Pablo Valdes',
  publisher: 'PokerXYZ',
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: 'PokerXYZ — Poker Bot Developer & Multiplayer Hold\'em',
    description:
      "Write your own poker bot in JavaScript, train a neural net, sit it at a real table. " +
      "Multiplayer no-limit hold'em, bot-vs-bot arenas, ELO rankings, fake chips, no downloads.",
    url: 'https://pokerxyz.io',
    siteName: 'PokerXYZ',
    type: 'website',
    locale: 'en_US',
    // og:image is auto-attached by Next.js from app/opengraph-image.js.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PokerXYZ — Poker Bot Developer & Multiplayer Hold\'em',
    description:
      "Build poker bots in JavaScript, train neural nets, watch bot-vs-bot arenas. " +
      "Free multiplayer no-limit hold'em with ELO and fake chips. No downloads.",
    // twitter:image is auto-attached by Next.js from app/twitter-image.js.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

// Viewport extracted from metadata in Next 16 — its own export per the new
// API. Lets us declare `viewportFit: 'cover'` for safe-area-aware mobile
// rendering and the theme color for the mobile address bar.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
    { media: '(prefers-color-scheme: light)', color: '#0f172a' },
  ],
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* The cards sprite is the single largest above-the-fold asset on the
            poker route (every CardSprite + every board card references it).
            Preloading shaves the LCP visibly when navigating from / → /poker.
            Browsers ignore the hint if the asset isn't actually used so it's
            safe to leave on the landing page too. */}
        <link rel="preload" as="image" href="/images/cards.png" fetchPriority="high" />
        {/* DNS warm-up for the remote avatar host. Tiny header line, real win
            on cold connections where TLS handshake to i.ibb.co would otherwise
            block the first avatar paint. */}
        <link rel="dns-prefetch" href="https://i.ibb.co" />
        <link rel="preconnect" href="https://i.ibb.co" crossOrigin="anonymous" />
        {/* Same idea for Google's GSI script — loaded lazily by AccountMenu on
            first menu open. Warming DNS + TLS up front shaves ~200ms off the
            sign-in modal on cold connections without paying the JS download
            cost (the script itself isn't requested until the user clicks). */}
        <link rel="dns-prefetch" href="https://accounts.google.com" />
        <link rel="preconnect" href="https://accounts.google.com" crossOrigin="anonymous" />
      </head>
      <body className={`${googleSansCode.variable} antialiased text-white`}>
        {/* Skip-link for keyboard users. Hidden until focused (see globals.css).
            Lighthouse a11y "bypass blocks" audit looks for this. */}
        <a href="#main-content" className="skip-link">Skip to main content</a>
        {/* Hydrates the shared felt-color store from localStorage on
            first paint and from /auth/me when auth resolves. Mounted
            here so every route inherits the user's site-wide pick
            without each page wiring it up. Renders nothing. */}
        <FeltBootstrap />
        <FuzzyBackground />
        <ZoomLayer>{children}</ZoomLayer>
        {/* Global account dock — profile / DMs / notifications stacked
            top-right and fixed-positioned. Mounted once here so every
            route gets the same dock in the same spot without each page
            needing to wire it up. Sits outside ZoomLayer so the icons
            stay a constant size regardless of the user's page zoom. */}
        <AccountDock />
      </body>
    </html>
  )
}

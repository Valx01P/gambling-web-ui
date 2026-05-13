import localFont from "next/font/local"
import AccountDock from "./components/AccountDock"
import FuzzyBackground from "./components/FuzzyBackground"
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
    default: "pokerxyz — No-limit hold'em with bots you can program",
    // Used by per-route metadata via the title.template merge rules.
    template: '%s — pokerxyz',
  },
  description: "Multiplayer poker tables, JavaScript bots, bot-vs-bot arenas, ELO rankings, and a full banking system. Fake chips, real strategy.",
  applicationName: 'pokerxyz',
  keywords: [
    'poker', "no-limit hold'em", 'texas holdem', 'javascript bot', 'poker bot',
    'bot arena', 'elo', 'multiplayer poker', 'free poker', 'browser poker',
  ],
  authors: [{ name: 'pokerxyz' }],
  creator: 'pokerxyz',
  publisher: 'pokerxyz',
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: "pokerxyz",
    description: "No-limit hold'em with bots you can program.",
    url: 'https://pokerxyz.io',
    siteName: 'pokerxyz',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'pokerxyz',
    description: "No-limit hold'em with bots you can program.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
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

import Link from 'next/link'
import AccountMenu from './components/AccountMenu'

// Inline suit SVGs — kept here so the landing page is a single self-contained
// file. Tiny and tree-shakable, no asset request.
function SuitSpade({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 2C12 2 4 10 4 14C4 17.5 7 19 9 18C7.5 20 6 21 6 21H18C18 21 16.5 20 15 18C17 19 20 17.5 20 14C20 10 12 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  )
}
function SuitDiamond({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,2 22,12 12,22 2,12" fill="currentColor" />
    </svg>
  )
}
function SuitClub({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 3a4.5 4.5 0 0 0-2.9 7.95A4.5 4.5 0 1 0 9 18.4c-.7 1.2-1.6 2.1-2.4 2.6h10.8c-.8-.5-1.7-1.4-2.4-2.6a4.5 4.5 0 1 0-.1-7.45A4.5 4.5 0 0 0 12 3Z"
        fill="currentColor"
      />
    </svg>
  )
}
function SuitHeart({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 21s-8-4.9-8-11.2C4 6.5 6.3 4 9.2 4c1.6 0 2.9.8 3.8 2 .9-1.2 2.2-2 3.8-2C19.7 4 22 6.5 22 9.8 22 16.1 12 21 12 21Z"
        fill="currentColor"
      />
    </svg>
  )
}

// schema.org JSON-LD. Surfaces the site as a structured WebApplication +
// VideoGame to Google so it can build a rich result card. The score / price
// fields tell Google this is free-to-play with no IAP — which avoids it
// getting bucketed alongside paid gambling apps.
const SITE_JSONLD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://pokerxyz.io#site',
      url: 'https://pokerxyz.io',
      name: 'pokerxyz',
      description: "No-limit hold'em with JavaScript bots and bot-vs-bot arenas.",
      inLanguage: 'en',
    },
    {
      '@type': 'VideoGame',
      '@id': 'https://pokerxyz.io#game',
      name: 'pokerxyz',
      description: "Multiplayer no-limit Texas hold'em with programmable JavaScript bots, ELO rankings, and a banking system. Fake chips, real strategy.",
      url: 'https://pokerxyz.io',
      genre: ['Card Game', 'Poker', 'Strategy'],
      playMode: ['MultiPlayer', 'SinglePlayer'],
      gamePlatform: 'Web browser',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any (web browser)',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      isAccessibleForFree: true,
    },
  ],
}

export default function Home() {
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden flex flex-col">
      {/* Structured data for Google. Inline JSON-LD is the most reliable
          way to attach schema metadata — no extra request, no race with
          client hydration. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSONLD) }}
      />
      <header className="absolute right-3 top-3 z-10 flex items-center gap-2 sm:right-4 sm:top-4">
        <Link
          href="/poker/bots"
          className="rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 sm:px-3 sm:text-sm"
        >
          Bots
        </Link>
        <AccountMenu />
      </header>

      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        {/* Suit banner */}
        <div className="mb-6 flex items-center gap-3 text-zinc-400">
          <SuitDiamond className="h-5 w-5 text-red-400" />
          <SuitClub className="h-7 w-7" />
          <SuitSpade className="h-9 w-9 text-white" />
          <SuitHeart className="h-7 w-7 text-red-400" />
          <SuitDiamond className="h-5 w-5 text-red-400" />
        </div>

        {/* Wordmark */}
        <h1 className="text-5xl sm:text-7xl font-black tracking-tight text-white">
          poker<span className="text-amber-300">xyz</span>
        </h1>

        {/* Tagline */}
        <p className="mt-4 max-w-md text-sm sm:text-base font-medium text-zinc-300">
          No-limit hold&apos;em. JavaScript bots. Bot-vs-bot arenas you can watch.
        </p>

        {/* CTAs */}
        <div className="mt-8 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:gap-3">
          <Link
            href="/poker"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/60 bg-amber-400/15 px-6 py-3 text-sm font-black uppercase tracking-widest text-amber-100 shadow-lg transition-colors hover:bg-amber-400/25"
          >
            <SuitSpade className="h-4 w-4" />
            Sit at a Table
          </Link>
          <Link
            href="/poker/bots"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-500/60 bg-zinc-800/80 px-6 py-3 text-sm font-black uppercase tracking-widest text-white shadow-lg transition-colors hover:bg-zinc-700/90"
          >
            Build a Bot
          </Link>
        </div>

        {/* Tiny under-CTA hint — pulled out of zinc-500 (which was eaten by
            the green felt background). White-ish at 70% on a subtle pill. */}
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/40 px-3 py-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-200">
          Fake chips · Real strategy · Open lobby
        </div>
      </main>

      <footer className="px-4 pb-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300/80">
        pokerxyz.io
      </footer>
    </div>
  )
}

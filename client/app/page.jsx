import Link from 'next/link'
import RouteNavCluster from './components/RouteNavCluster'
// AccountMenu (profile + DMs + notifications) is now mounted globally
// via AccountDock in the root layout, so individual routes don't import
// or position it themselves. RouteNavCluster wraps the local nav links
// and is auth-aware: it shrinks the right-offset when the dock collapses
// to a 36px avatar (signed-in), and widens it back to clear the "Sign in"
// chip (signed-out).

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

// schema.org JSON-LD. Surfaces the site as a structured WebSite +
// VideoGame + FAQPage to Google so it can build a rich result card and
// also surface the FAQ as expandable answers in the SERP. The
// price / isAccessibleForFree fields tell Google this is free-to-play
// with no real-money gambling — which keeps us out of the paid-casino
// bucket and lets the FAQ surface in SafeSearch results.
const SITE_JSONLD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://pokerxyz.io#site',
      url: 'https://pokerxyz.io',
      name: 'pokerxyz',
      description:
        "Free no-limit Texas hold'em with friends, fake chips, and JavaScript poker bots " +
        "you can program yourself. Bot-vs-bot arenas, ELO rankings, no downloads.",
      inLanguage: 'en',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://pokerxyz.io/users/{search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'VideoGame',
      '@id': 'https://pokerxyz.io#game',
      name: 'pokerxyz',
      description:
        "Multiplayer no-limit Texas hold'em with programmable JavaScript bots, " +
        "bot-vs-bot arenas, ELO rankings, and a full banking system. " +
        "Fake chips, real strategy, open lobby — no real-money gambling.",
      url: 'https://pokerxyz.io',
      genre: ['Card Game', 'Poker', 'Strategy'],
      playMode: ['MultiPlayer', 'SinglePlayer'],
      gamePlatform: 'Web browser',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any (web browser)',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      isAccessibleForFree: true,
      // Defining capabilities surfaced in a `featureList`. Google
      // doesn't render this as a rich result, but the keywords feed
      // entity-extraction ("can I play poker bots online" matches).
      featureList: [
        "Play no-limit Texas hold'em with friends",
        'Build and edit JavaScript poker bots in-browser',
        'Bot-vs-bot arenas with spectator controls',
        'ELO rankings across every hand',
        'Banking system + side bets + peer loans',
        'Free, no download, no real money',
      ],
    },
    {
      // FAQPage — surfaces as expandable Q&A on the SERP for relevant
      // long-tail queries. Each Q targets a specific search intent
      // ("can I play poker with friends online for free", "how do I
      // build a poker bot", etc.). Google requires the page itself to
      // visibly contain the answers; the landing page's hero copy
      // already does, but if we move things around we should keep at
      // least one paragraph that mirrors each answer.
      '@type': 'FAQPage',
      '@id': 'https://pokerxyz.io#faq',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Can I play poker with friends for free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "Yes — pokerxyz is a free in-browser no-limit Texas hold'em lobby. " +
              "Sit at a 5-seat table, share a link with friends, and play with fake chips. " +
              "No download, no real money, no signup required for a quick game.",
          },
        },
        {
          '@type': 'Question',
          name: 'Can I build my own poker bot on pokerxyz?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "Yes. The bot editor lets you write a JavaScript strategy directly in the browser, " +
              "test it against a public bot library, and sit it at a real table. " +
              "Neural-net bots, rule-based super-bots, and an omniscient Oracle slot are all supported.",
          },
        },
        {
          '@type': 'Question',
          name: 'Is pokerxyz real-money poker or gambling?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "No — pokerxyz uses fake chips only. There's no deposit, no withdrawal, " +
              "no real-money gambling. The banking system, side bets, and ELO are all " +
              "strategy mechanics, not financial transactions.",
          },
        },
        {
          '@type': 'Question',
          name: 'What is a bot-vs-bot arena?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              "A spectator-controlled room where only bots play. You add up to five bots from " +
              "your roster or the public library, hit Start, and watch them duel hand after hand " +
              "with full ELO tracking. Useful for evaluating a strategy without sitting down yourself.",
          },
        },
      ],
    },
  ],
}

// Compact card used by every feature row below. Pulls the visible
// answer text out of each FAQ JSON-LD entry so Google's FAQ rich
// result is anchored to real on-page copy (the FAQ block requires the
// answer to be present in the rendered HTML).
function FeatureCard({ icon, title, blurb, bullets, anchor }) {
  return (
    <section
      id={anchor}
      className="scroll-mt-20 rounded-2xl border border-white/10 bg-zinc-950/55 p-5 backdrop-blur-sm sm:p-6"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="shrink-0 text-2xl sm:text-3xl" aria-hidden="true">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-black text-white sm:text-lg">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-300 sm:text-sm">{blurb}</p>
          {bullets && bullets.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-zinc-300 sm:text-[13px]">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    // `min-h-[100dvh]` (not `h-[100dvh] overflow-hidden`) so the page
    // can scroll past the hero into the feature sections. The hero
    // still fills the first viewport via `min-h-[100dvh]` on the
    // first section itself.
    <div className="relative w-full">
      {/* Structured data for Google. Inline JSON-LD is the most reliable
          way to attach schema metadata — no extra request, no race with
          client hydration. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSONLD) }}
      />
      {/* Route-local nav. RouteNavCluster handles vertical alignment
          + the auth-reactive right-offset so the links sit flush
          beside whichever pill the AccountDock is currently rendering
          (wide "Sign in" chip vs 36px avatar). */}
      <RouteNavCluster as="header">
        <Link
          href="/poker/bots"
          className="inline-flex h-9 items-center rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 sm:px-3 sm:text-sm"
        >
          Bots
        </Link>
        <Link
          href="/feed"
          className="inline-flex h-9 items-center rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 sm:px-3 sm:text-sm"
        >
          Feed
        </Link>
      </RouteNavCluster>

      <main id="main-content" tabIndex={-1}>
        {/* ── HERO ──────────────────────────────────────────────────
            Fills the first viewport. Min-height instead of fixed
            height so an in-page anchor jump (or a tall mobile UI bar)
            doesn't clip the wordmark. */}
        <section className="relative flex min-h-[100dvh] flex-col items-center justify-center px-4 pb-12 pt-20 text-center sm:pt-24">
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

          {/* Tagline — rewritten to lead with the two headline
              activities (play with friends + build bots) before the
              spectator mode. Same character budget as before. */}
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-300 sm:text-base">
            Play free no-limit hold&apos;em with friends, build your own
            poker bots in JavaScript, or sit back and watch them duel
            in bot-vs-bot arenas. Fake chips, real strategy, all in
            your browser.
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

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/40 px-3 py-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-200">
            Fake chips · Real strategy · Open lobby
          </div>

          {/* Scroll affordance — a small chevron that anchors to the
              first feature section. Useful on desktop (scrollbar may
              not be obvious on a one-screen hero) and mobile alike. */}
          <a
            href="#what-is-pokerxyz"
            aria-label="Scroll to features"
            className="mt-10 inline-flex flex-col items-center gap-1 text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400 transition-colors hover:text-amber-200"
          >
            <span>What you can do</span>
            <span aria-hidden className="text-base leading-none">↓</span>
          </a>
        </section>

        {/* ── ABOUT + FEATURE BLOCKS ────────────────────────────────
            Anchored sections so the hero's "↓ What you can do" link
            jumps here. Cards are tight, scannable, and each one
            doubles as the visible answer to one of the FAQPage
            entries in SITE_JSONLD above. */}
        <div className="mx-auto max-w-3xl space-y-4 px-4 pb-20 sm:space-y-5 sm:px-6 sm:pb-28">
          <section id="what-is-pokerxyz" className="scroll-mt-20 pt-8 sm:pt-12">
            <h2 className="text-xl font-black text-white sm:text-2xl">What is pokerxyz?</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300 sm:text-[15px]">
              pokerxyz is a free, in-browser no-limit Texas hold&apos;em lobby
              with a twist: every empty seat at the table can be filled
              with a programmable JavaScript bot. Sit at a 5-seat
              table with friends and fake chips, sit alone and grind
              against a roster of public bots, or boot up a
              spectator-only arena and watch two strategies fight to
              the river. There&apos;s no real-money gambling, no deposits,
              no withdrawals — just the game, the math, and whatever
              code you bring to it.
            </p>
          </section>

          <FeatureCard
            anchor="play-with-friends"
            icon="🎲"
            title="Play with friends"
            blurb="Open a 5-seat table, share the link, and your friends are in. No signup required for a quick game — they sit down with the same starting stack as you and the lobby keeps the seats hot until everyone&apos;s ready."
            bullets={[
              "5-seat no-limit Texas hold'em with auto-rebuy.",
              "Invite by link, by username search, or DM directly.",
              "Vote on blind level changes mid-session.",
              "Side bets, peer loans, in-table chat, emotes, and seat-click toasts.",
            ]}
          />

          <FeatureCard
            anchor="play-solo"
            icon="🃏"
            title="Play solo against bots"
            blurb="Don't want to wait for friends? Click Auto-Fill and the table seats five loose-aggressive app bots — Splashy, Chaser, Maniac, Sticky, Hunter — each with a different style. Or pick from the public bot library, ranked by ELO."
            bullets={[
              "🎲 App bots: five distinct gambler personalities, shuffled per fill.",
              "Public bot library — fork any bot, sit it down, or just clone it.",
              "Neural-net squad of your own: REINFORCE, MLP, Q-learning baselines.",
              "Oracle slot: an omniscient strategy that sees every hole card.",
            ]}
          />

          <FeatureCard
            anchor="build-a-bot"
            icon="🤖"
            title="Build your own poker bot"
            blurb="The bot editor is a JavaScript sandbox with a poker-aware decision context. Write a `decide(ctx)` function, hit save, and your bot can sit at any table — yours, public, or in a bot-vs-bot arena. The same ctx the built-in bots see is fully documented in the editor."
            bullets={[
              "Rich ctx: hand strength, equity vs ranges, opponent patterns, board texture, action history.",
              "Four bot kinds: code, super (rule + transition), neural (4 variants), oracle.",
              "Public visibility toggle: keep it private or ship it to the leaderboard.",
              "Hand-by-hand ELO + bluff stats so you can tell whether your bot is actually getting better.",
            ]}
          />

          <FeatureCard
            anchor="arena"
            icon="🎮"
            title="Bot-vs-bot arenas"
            blurb="A spectator-only room where humans never sit. Add up to five bots from your roster or the public catalog, set the think-delay slider, hit Start, and watch them duel hand after hand with full ELO tracking. The fastest way to evaluate a strategy without sitting down yourself."
            bullets={[
              "Spectator-controlled start/stop and per-turn pace.",
              "Auto-fill the arena with your NN squad, MLP squad, custom bots, or app bots.",
              "Re-runs every hand against the same lineup — perfect for A/B-ing a new strategy.",
            ]}
          />

          <FeatureCard
            anchor="economy"
            icon="💰"
            title="Banking, side bets, peer loans"
            blurb="Every seat carries two wallets: the chip stack on the table and a persistent bank balance off it. Stocks, options, crypto, real-estate, and jobs all run off the bank — a whole investing meta-game on top of poker."
            bullets={[
              "Bank loans with a credit score that tracks your peak P/L swing.",
              "Player-to-player loans with negotiable interest (cap: 10%/hand).",
              "Live stock market with earnings events + IV-pumped options chains.",
              "Crypto sim with auto-minted scam coins per hand.",
              "Real-estate territories with regional yields + a pandemic event.",
            ]}
          />

          <FeatureCard
            anchor="social"
            icon="📡"
            title="Social feed + DMs"
            blurb="Share a hand, post a strategy thought, or @-mention a friend in a table. The feed lives at /feed and the DMs live on every page so you don't lose a conversation when you swap tables."
            bullets={[
              "Image uploads, replies, likes, @-mentions, follow graph.",
              "Direct messages with table-invite cards.",
              "Daily challenges + trophy ladder (Bronze → Legend).",
            ]}
          />

          <FeatureCard
            anchor="not-gambling"
            icon="🛡️"
            title="Fake chips, not gambling"
            blurb="pokerxyz uses fake chips only. There's no deposit, no withdrawal, no real-money gambling. The banking system, side bets, and ELO are all strategy mechanics, not financial transactions. SafeSearch-friendly, no age gate — it's a card game and a programming sandbox."
          />

          {/* Final CTA — matches the hero buttons so a user who scrolled
              all the way down doesn't have to scroll back up to act. */}
          <section className="pt-4 text-center">
            <div className="flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:gap-3">
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
          </section>
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300/80">
        pokerxyz.io
      </footer>
    </div>
  )
}

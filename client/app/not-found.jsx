// Custom 404 page (Next.js App Router convention).
//
// Per the design ask: keep it minimal. One clear "Home" button —
// no Poker Lobby / Feed / My Bots clutter, no flavor copy beyond
// the page title. The visual language inherits from the root
// layout (FuzzyBackground, AccountDock, Google Sans Code).

import Link from 'next/link'

export const metadata = {
  title: 'Page not found',
  description: 'That route doesn\'t exist. Head back to the home page.',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <main className="relative z-10 min-h-[100dvh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-700/60 bg-zinc-900/85 px-6 py-7 shadow-2xl backdrop-blur-md text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">
          404
        </div>
        <h1 className="mt-2 text-2xl font-black text-white leading-tight">
          Lost?
        </h1>
        <p className="mt-2 text-[13px] font-bold text-zinc-300 leading-snug">
          This page doesn't exist.
        </p>

        <Link
          href="/"
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-amber-400/60 bg-amber-500/15 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25 transition-colors"
        >
          ← Go home
        </Link>
      </div>
    </main>
  )
}

'use client'

import Link from 'next/link'

export default function HomeBackLink({ className = '' }) {
  return (
    <Link
      href="/"
      aria-label="Back to home"
      title="Back to home"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm ${className}`}
    >
      <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
      <span className="hidden sm:inline">Home</span>
    </Link>
  )
}

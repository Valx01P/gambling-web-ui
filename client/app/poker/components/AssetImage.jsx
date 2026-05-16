'use client'

import { useState, useEffect, useMemo } from 'react'

// Generic image renderer for asset/stock/territory previews.
//
// Three-tier fallback chain so the UI never shows "nothing":
//   1. The supplied `src` (the catalog's curated imageUrl)
//   2. picsum.photos seeded by the entry's name — returns a real
//      deterministic photo (same name = same photo every time).
//      Not landmark-accurate but always visually rich.
//   3. The labeled colored chip ({fallbackText} on a {fallbackBg}
//      swatch) — the last-resort signpost so the row still reads.
//
// We try tier 1 first; on `onError` we move to tier 2; on tier-2
// error we move to tier 3. This handles the common failure mode
// where a Wikimedia URL has the wrong hash prefix or an Unsplash ID
// was hallucinated — instead of a sea of chips, the panel fills with
// (incorrect-but-real) photos and the user still has visual texture.

function picsumSeed(text) {
  // Use a stable string per entry as the picsum seed. URI-encoded so
  // names with spaces / punctuation produce valid URLs. Truncate to
  // avoid absurdly long seeds (Picsum hashes the seed anyway).
  const t = String(text || 'placeholder').slice(0, 48)
  return encodeURIComponent(t).replace(/%20/g, '+')
}

export default function AssetImage({
  src,
  alt,
  fallbackText,
  fallbackBg = '#1f2937',
  fallbackFg = '#e5e7eb',
  rounded = 'rounded-md',
  className = '',
}) {
  const [stage, setStage] = useState(src ? 'primary' : 'secondary')
  const [loaded, setLoaded] = useState(false)

  // Reset on src change so a fresh entry isn't stuck on the previous
  // entry's failure path.
  useEffect(() => {
    setStage(src ? 'primary' : 'secondary')
    setLoaded(false)
  }, [src])

  // Tier-2 URL — deterministic real photo seeded by the entry's name.
  // Memoized so we don't re-encode the same string on every render.
  const secondarySrc = useMemo(() => {
    const seed = picsumSeed(alt || fallbackText)
    return `https://picsum.photos/seed/${seed}/480/300`
  }, [alt, fallbackText])

  const currentSrc =
    stage === 'primary' ? src
    : stage === 'secondary' ? secondarySrc
    : null

  // Tier-3 chip — both prior tiers failed (or no URL at all).
  if (stage === 'failed') {
    return (
      <div
        role="img"
        aria-label={alt || fallbackText}
        className={`flex items-center justify-center text-center text-[10px] font-black uppercase tracking-widest ${rounded} ${className}`}
        style={{ background: fallbackBg, color: fallbackFg }}
      >
        {fallbackText || alt || '—'}
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden ${rounded} ${className}`} style={{ background: fallbackBg }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentSrc}
        alt={alt || ''}
        loading="lazy"
        decoding="async"
        draggable="false"
        onLoad={() => setLoaded(true)}
        onError={() => {
          // Move down the fallback chain. Reset `loaded` so the
          // placeholder text shows again while the next URL is in
          // flight. Once we hit tier 3 there's no more <img>.
          setLoaded(false)
          setStage(s => s === 'primary' ? 'secondary' : 'failed')
        }}
        className={`h-full w-full object-cover object-center transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* In-flight + post-fallback placeholder text. Hidden once an
          image loads; reappears between tiers while the next fetch
          is pending. */}
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-center text-[10px] font-black uppercase tracking-widest"
          style={{ color: fallbackFg }}
        >
          {fallbackText || alt}
        </div>
      )}
    </div>
  )
}

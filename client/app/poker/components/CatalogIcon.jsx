'use client'

import { useMemo } from 'react'

// Custom SVG icons for catalog tiles — the user's frustration with
// hallucinated photo URLs led to this: every catalog entry gets a
// hand-drawn, deterministic, network-free SVG icon. ~40 archetypes
// cover the 179 entries via keyword-based id matching with a few
// explicit overrides for marquee items.
//
// Each icon is a single React function that returns inline SVG. All
// icons share viewBox 0 0 24 24 and use `currentColor` for strokes
// so the caller's `color` style controls the look. Background tile
// color comes from the wrapping div.

// ───────────────────── ICON DEFINITIONS ─────────────────────
// All icons stroke-only (fill:none) so they read as line art on
// any tile color. ~24px viewBox, 1.6 stroke width default.

const STROKE = 1.6
const c = { fill: 'none', stroke: 'currentColor', strokeWidth: STROKE, strokeLinecap: 'round', strokeLinejoin: 'round' }

const ICONS = {
  // ─── Buildings ─────────────────────────────────────────────
  tower: () => (
    <g {...c}><rect x="8" y="3" width="8" height="19" /><path d="M8 7h8M8 11h8M8 15h8M8 19h8" /><path d="M11 22v-2h2v2" /></g>
  ),
  skyscraper: () => (
    <g {...c}><rect x="3" y="9" width="6" height="13" /><rect x="10" y="3" width="6" height="19" /><rect x="17" y="12" width="4" height="10" /><path d="M11 7h4M11 11h4M11 15h4" /></g>
  ),
  house: () => (
    <g {...c}><path d="M3 11l9-7 9 7v10H3z" /><path d="M10 21v-6h4v6" /></g>
  ),
  mansion: () => (
    <g {...c}><path d="M2 12l10-7 10 7" /><path d="M4 12v9h16v-9" /><path d="M9 21v-5h6v5" /><path d="M6 16h2M16 16h2" /></g>
  ),
  apartment: () => (
    <g {...c}><rect x="4" y="3" width="16" height="19" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" /><path d="M11 22v-3h2v3" /></g>
  ),
  trailer: () => (
    <g {...c}><rect x="2" y="9" width="16" height="9" /><path d="M18 13h3l1 3v2h-4" /><circle cx="7" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M5 12h3v3H5z" /></g>
  ),
  strip_mall: () => (
    <g {...c}><rect x="2" y="9" width="20" height="11" /><path d="M2 13h20" /><path d="M5 9V6h6v3M13 9V6h6v3" /><path d="M6 16h2M11 16h2M16 16h2" /></g>
  ),
  hotel: () => (
    <g {...c}><rect x="4" y="3" width="16" height="19" /><path d="M9 8h6M9 12h6M9 16h6" /><path d="M10 22v-3h4v3" /><circle cx="12" cy="6" r="0.6" fill="currentColor" /></g>
  ),
  chalet: () => (
    <g {...c}><path d="M3 21L12 6l9 15" /><path d="M3 21h18" /><path d="M9 21v-5h6v5" /><path d="M7 21l5-9 5 9" stroke="currentColor" opacity="0.6" /></g>
  ),
  casino: () => (
    <g {...c}><rect x="4" y="4" width="8" height="8" rx="1" /><rect x="12" y="12" width="8" height="8" rx="1" /><circle cx="7" cy="7" r="0.8" fill="currentColor" /><circle cx="10" cy="10" r="0.8" fill="currentColor" /><circle cx="15" cy="15" r="0.8" fill="currentColor" /><circle cx="17" cy="17" r="0.8" fill="currentColor" /><circle cx="15" cy="17" r="0.8" fill="currentColor" /><circle cx="17" cy="15" r="0.8" fill="currentColor" /></g>
  ),
  stadium: () => (
    <g {...c}><ellipse cx="12" cy="12" rx="10" ry="6" /><ellipse cx="12" cy="12" rx="6" ry="3" /><path d="M12 6v12" stroke="currentColor" opacity="0.5" /></g>
  ),
  datacenter: () => (
    <g {...c}><rect x="4" y="3" width="16" height="6" /><rect x="4" y="10" width="16" height="6" /><rect x="4" y="17" width="16" height="5" /><circle cx="7" cy="6" r="0.6" fill="currentColor" /><circle cx="7" cy="13" r="0.6" fill="currentColor" /><circle cx="7" cy="19.5" r="0.6" fill="currentColor" /><path d="M11 6h6M11 13h6M11 19.5h5" /></g>
  ),
  bank: () => (
    <g {...c}><path d="M3 10l9-6 9 6" /><path d="M3 10h18" /><path d="M5 10v9M9 10v9M15 10v9M19 10v9" /><path d="M2 22h20M3 19h18" /></g>
  ),
  factory: () => (
    <g {...c}><path d="M2 22V13l5 3v-3l5 3v-3l5 3v-6h3v15z" /><path d="M5 18h2M10 18h2M15 18h2" /></g>
  ),
  vault: () => (
    <g {...c}><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="12" cy="12" r="4" /><path d="M12 10v4M10 12h4" /><path d="M12 6l-1-1M12 6l1-1M5 12l-1 0M5 12l-1 0M19 12h1M19 12h1M12 18l-1 1M12 18l1 1" /></g>
  ),

  // ─── Land / Nature ─────────────────────────────────────────
  island: () => (
    <g {...c}><path d="M2 19c4-2 16-2 20 0" /><path d="M12 19V8" /><path d="M12 8c-3-2-6-1-7 2M12 8c3-2 6-1 7 2M12 8c-1-3 1-5 3-4M12 8c1-3-1-5-3-4" /></g>
  ),
  mountain: () => (
    <g {...c}><path d="M2 21l6-12 4 7 3-5 7 10z" /><path d="M5 16l3-6M8 9l4 7" stroke="currentColor" opacity="0.5" /></g>
  ),
  ice: () => (
    <g {...c}><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" /><circle cx="12" cy="12" r="1" fill="currentColor" /></g>
  ),
  desert: () => (
    <g {...c}><path d="M2 19c2-3 5-3 7 0c2-3 5-3 7 0c2-3 5-3 6 0" /><path d="M2 16c1-2 3-2 5 0c1-2 3-2 5 0c1-2 3-2 5 0" /><circle cx="18" cy="6" r="2" /></g>
  ),
  forest: () => (
    <g {...c}><path d="M6 21V14M6 14l-3 0l3-5l3 5z" /><path d="M14 21V12M14 12l-4 0l4-6l4 6z" /><path d="M20 21V16M20 16l-2 0l2-4l2 4z" /></g>
  ),
  volcano: () => (
    <g {...c}><path d="M3 21l5-9h2l2-4l2 4h2l5 9z" /><path d="M10 12l-1-4l1 1l1-2l1 3" stroke="currentColor" /></g>
  ),
  vineyard: () => (
    <g {...c}><path d="M2 21h20" /><path d="M4 21V8M9 21V8M14 21V8M19 21V8" /><circle cx="4" cy="6" r="1.5" /><circle cx="9" cy="6" r="1.5" /><circle cx="14" cy="6" r="1.5" /><circle cx="19" cy="6" r="1.5" /></g>
  ),
  horse: () => (
    <g {...c}><path d="M5 20v-6c0-3 2-5 5-5h4l3-4l1 3l2-1l-1 3v8" /><circle cx="14" cy="9" r="0.6" fill="currentColor" /><path d="M5 20h3M16 20h3" /></g>
  ),
  palm_tree: () => (
    <g {...c}><path d="M12 22V11" /><path d="M12 11c-3-2-7-1-8 3M12 11c3-2 7-1 8 3M12 11c-1-3 0-7 4-8M12 11c1-3 0-7-4-8" /></g>
  ),

  // ─── Transport ─────────────────────────────────────────────
  yacht: () => (
    <g {...c}><path d="M2 18c4 2 16 2 20 0l-2 3H4z" /><path d="M5 15l2-7 11 7" /><path d="M11 8V4" /></g>
  ),
  airplane: () => (
    <g {...c}><path d="M2 13l9-3l4-7l3 1l-4 7l8 2v3l-9-1l-3 5l-2 0l1-6z" /></g>
  ),
  rocket: () => (
    <g {...c}><path d="M12 2c4 3 6 8 6 12l-2 4h-8l-2-4c0-4 2-9 6-12z" /><circle cx="12" cy="10" r="2" /><path d="M8 18l-2 3M16 18l2 3M10 22l1 0M13 22l1 0" /></g>
  ),
  ship: () => (
    <g {...c}><path d="M2 17h20l-2 4H4z" /><rect x="6" y="11" width="12" height="6" /><path d="M6 11l2-3h8l2 3" /><path d="M9 14h6" /></g>
  ),
  satellite: () => (
    <g {...c}><rect x="9" y="9" width="6" height="6" /><path d="M9 12l-5-3v6zM15 12l5-3v6z" /><path d="M12 9V5M12 15v4" /><path d="M5 19c2-2 5-2 7 0" /></g>
  ),
  oil_rig: () => (
    <g {...c}><path d="M4 22l8-16l8 16" /><path d="M8 14h8" /><path d="M10 18h4" /><path d="M12 6V2" /><path d="M11 4l-2-2M13 4l2-2" /></g>
  ),
  pipeline: () => (
    <g {...c}><path d="M2 8h6v4h8v-4h6" /><path d="M2 16h6v-4h8v4h6" /><circle cx="11" cy="10" r="0.8" fill="currentColor" /><circle cx="13" cy="14" r="0.8" fill="currentColor" /></g>
  ),
  truck: () => (
    <g {...c}><rect x="2" y="9" width="11" height="8" /><path d="M13 12h5l3 3v2h-8z" /><circle cx="6" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" /></g>
  ),
  car: () => (
    <g {...c}><path d="M3 14l2-4c0-1 1-2 2-2h10c1 0 2 1 2 2l2 4v3h-2a2 2 0 11-4 0H9a2 2 0 11-4 0H3z" /><path d="M6 14h12" /></g>
  ),

  // ─── Off-world ─────────────────────────────────────────────
  mars: () => (
    <g {...c}><circle cx="12" cy="12" r="8" /><path d="M6 11c2 1 4 0 5-2c2 2 5 2 7 0M8 16c2-1 3 0 4 1c1-2 4-2 5 0" stroke="currentColor" opacity="0.6" /></g>
  ),
  moon: () => (
    <g {...c}><path d="M16 4a8 8 0 100 16A6 6 0 0116 4z" /><circle cx="11" cy="10" r="0.6" fill="currentColor" opacity="0.5" /><circle cx="9" cy="14" r="0.5" fill="currentColor" opacity="0.5" /><circle cx="13" cy="16" r="0.5" fill="currentColor" opacity="0.5" /></g>
  ),
  orbital: () => (
    <g {...c}><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="10" ry="3" /><ellipse cx="12" cy="12" rx="10" ry="3" transform="rotate(60 12 12)" /></g>
  ),
  globe: () => (
    <g {...c}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></g>
  ),

  // ─── Industry / Materials ──────────────────────────────────
  mine: () => (
    <g {...c}><path d="M5 6l4 3l5-3l3 5l-3 5l-5-3l-4 3" /><path d="M8 16l-4 5M16 16l4 5" /></g>
  ),
  gem: () => (
    <g {...c}><path d="M6 9l3-5h6l3 5l-6 11z" /><path d="M9 4l3 5l3-5M6 9h12" /></g>
  ),
  gold_bar: () => (
    <g {...c}><path d="M3 11l3-4h12l3 4v6l-3 4H6l-3-4z" /><path d="M3 11h18M6 7l-3 4M18 7l3 4M6 21l-3-4M18 21l3-4" /></g>
  ),
  pill: () => (
    <g {...c}><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-25 12 12)" /><path d="M9 7l5 10" /></g>
  ),
  dna: () => (
    <g {...c}><path d="M8 2c8 4 0 16 8 20M16 2c-8 4 0 16-8 20" /><path d="M9 6h6M9 12h6M9 18h6" stroke="currentColor" opacity="0.7" /></g>
  ),
  atom: () => (
    <g {...c}><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="4" /><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-60 12 12)" /></g>
  ),
  solar_panel: () => (
    <g {...c}><rect x="4" y="9" width="16" height="10" /><path d="M4 13h16M4 16h16M9 9v10M14 9v10" /><path d="M12 9V5M12 5l-3-3M12 5l3-3" /></g>
  ),
  cannabis_leaf: () => (
    <g {...c}><path d="M12 21V11" /><path d="M12 11l-6-7M12 11l6-7M12 11l-8-2M12 11l8-2M12 11l-7 4M12 11l7 4M12 21l-3-3M12 21l3-3" /></g>
  ),

  // ─── Consumer / Media ──────────────────────────────────────
  coffee: () => (
    <g {...c}><path d="M5 9h12v7a4 4 0 01-4 4H9a4 4 0 01-4-4z" /><path d="M17 11h2a2 2 0 010 4h-2" /><path d="M9 4l-1 2M12 4l-1 2M15 4l-1 2" /></g>
  ),
  burger: () => (
    <g {...c}><path d="M4 11c0-3 3-5 8-5s8 2 8 5" /><path d="M4 14h16" /><path d="M4 17c0 2 2 3 4 3h8c2 0 4-1 4-3z" /><path d="M8 14l1-1M12 14l1-1M16 14l1-1" /></g>
  ),
  retail: () => (
    <g {...c}><path d="M4 8l1-4h14l1 4" /><path d="M3 8h18v3a3 3 0 01-3 3a3 3 0 01-3-3a3 3 0 01-3 3a3 3 0 01-3-3a3 3 0 01-3 3a3 3 0 01-3-3z" /><path d="M5 14v7h14v-7" /></g>
  ),
  tv: () => (
    <g {...c}><rect x="3" y="5" width="18" height="12" rx="1" /><path d="M8 21h8M12 17v4" /></g>
  ),
  game_controller: () => (
    <g {...c}><path d="M5 8h14a3 3 0 013 3v4a3 3 0 01-6 0l-1-2H9l-1 2a3 3 0 01-6 0v-4a3 3 0 013-3z" /><path d="M8 11v3M6.5 12.5h3" /><circle cx="16" cy="12" r="0.8" fill="currentColor" /><circle cx="18" cy="14" r="0.8" fill="currentColor" /></g>
  ),
  bitcoin: () => (
    <g {...c}><circle cx="12" cy="12" r="9" /><path d="M9 7h5a2 2 0 010 4h-5M9 11h6a2 2 0 010 4h-6M9 7v8M11 5v2M13 5v2M11 15v2M13 15v2" /></g>
  ),

  // ─── Finance / Crime ───────────────────────────────────────
  dollar: () => (
    <g {...c}><path d="M16 7c-1-2-3-3-5-3c-3 0-5 2-5 4s2 3 5 4s5 2 5 4s-2 4-5 4c-3 0-5-1-6-3" /><path d="M11 2v4M11 18v4" /></g>
  ),
  briefcase: () => (
    <g {...c}><rect x="3" y="7" width="18" height="13" rx="1" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M3 13h18" /></g>
  ),
  money_bag: () => (
    <g {...c}><path d="M9 4l3-2l3 2" /><path d="M9 4h6l3 6c2 4-1 11-6 11s-8-7-6-11z" /><path d="M12 12v6M10 14h4M10 16h4" /></g>
  ),
  credit_card: () => (
    <g {...c}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M5 15h4M11 15h2" /></g>
  ),
  phone: () => (
    <g {...c}><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 18h4" /><path d="M9 5h6" stroke="currentColor" opacity="0.5" /></g>
  ),
  lock: () => (
    <g {...c}><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V7a4 4 0 018 0v4" /><circle cx="12" cy="16" r="1.5" /></g>
  ),
  mask: () => (
    <g {...c}><path d="M3 9c0-2 4-3 9-3s9 1 9 3v3c0 4-4 6-9 6s-9-2-9-6z" /><circle cx="9" cy="11" r="1.6" fill="currentColor" /><circle cx="15" cy="11" r="1.6" fill="currentColor" /></g>
  ),
  wallet: () => (
    <g {...c}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12h5" /><circle cx="17" cy="12.5" r="0.8" fill="currentColor" /><path d="M3 9h16" stroke="currentColor" opacity="0.5" /></g>
  ),
  chart_up: () => (
    <g {...c}><path d="M3 19h18" /><path d="M5 16l4-5l3 3l5-7" /><path d="M17 7h3v3" /></g>
  ),
  pyramid: () => (
    <g {...c}><path d="M12 3l9 18H3z" /><path d="M8 21l4-8l4 8M9 18h6" stroke="currentColor" opacity="0.6" /></g>
  ),
  key: () => (
    <g {...c}><circle cx="7" cy="12" r="4" /><path d="M11 12h10M17 12v3M20 12v2" /></g>
  ),
  crown: () => (
    <g {...c}><path d="M3 8l4 8h10l4-8l-5 4l-4-7l-4 7z" /><path d="M5 19h14" /><circle cx="3" cy="8" r="1" /><circle cx="21" cy="8" r="1" /><circle cx="12" cy="5" r="1" /></g>
  ),
  flag: () => (
    <g {...c}><path d="M5 22V3" /><path d="M5 4h12l-2 4l2 4H5" /></g>
  ),
  news: () => (
    <g {...c}><rect x="3" y="5" width="18" height="14" /><path d="M6 8h7M6 11h7M6 14h7M6 17h4" /><path d="M15 8h3v6h-3z" /></g>
  ),
  missile: () => (
    <g {...c}><path d="M21 3l-9 9l-2 1l1-2l9-9z" /><path d="M14 10l-3-3" /><path d="M4 15l3 3l-2 3l-3-3z" /><path d="M5 14l5 5" /></g>
  ),
  gun: () => (
    <g {...c}><path d="M3 11h13v3H8l-2 4H4l-1-4z" /><path d="M14 9v5M14 9h4l1 2h-2" /></g>
  ),
  test_tube: () => (
    <g {...c}><path d="M9 2v14a4 4 0 008 0V2" /><path d="M9 2h8" /><path d="M9 12h8" /><circle cx="13" cy="15" r="0.6" fill="currentColor" /><circle cx="11" cy="17" r="0.5" fill="currentColor" /></g>
  ),
  art_easel: () => (
    <g {...c}><rect x="6" y="3" width="12" height="12" /><path d="M9 7l2 3l3-4l3 5" /><circle cx="11" cy="7" r="0.8" fill="currentColor" /><path d="M12 15v7M8 22l4-7l4 7" /></g>
  ),
  ring_light: () => (
    <g {...c}><circle cx="12" cy="10" r="7" /><circle cx="12" cy="10" r="3" /><path d="M9 17v3h6v-3" /><path d="M12 20v2" /></g>
  ),
  syringe: () => (
    <g {...c}><path d="M14 2l8 8" /><path d="M16 4l4 4" /><path d="M14 6l-9 9v3h3l9-9z" /><path d="M3 21l3-3" /></g>
  ),
  cocktail: () => (
    <g {...c}><path d="M4 4h16l-7 9v6h-2v-6z" /><path d="M9 19h6" /><circle cx="17" cy="3" r="1" /><path d="M17 4v3" /></g>
  ),
  pole: () => (
    <g {...c}><path d="M12 2v20" /><ellipse cx="12" cy="20" rx="6" ry="2" /><circle cx="12" cy="6" r="1.5" /></g>
  ),
  zombie: () => (
    <g {...c}><circle cx="12" cy="9" r="6" /><circle cx="10" cy="9" r="1" fill="currentColor" /><path d="M14 9l1 1l-1 1l1 1l-1 1" /><path d="M9 13h6" /><path d="M8 15l-3 7M16 15l3 7" /></g>
  ),

  // ─── Catch-all ─────────────────────────────────────────────
  gear: () => (
    <g {...c}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></g>
  ),
}

// ───────────────── id → icon mapping ─────────────────
// First we check for explicit overrides (marquee items where the
// keyword-based mapping would pick a less-fitting archetype). Then
// we walk a keyword-rule list, matching against the lowercased id.
// Falls back to `gear` if nothing matches.

const EXPLICIT = {
  // Real estate
  trailer_park: 'trailer',
  single_rental: 'house',
  apt_building: 'apartment',
  auto_lot: 'car',
  storage_units: 'apartment',
  strip_mall: 'strip_mall',
  kentucky_horsefarm: 'horse',
  vineyard: 'vineyard',
  malibu_compound: 'mansion',
  aspen_chalet: 'chalet',
  hamptons_estate: 'mansion',
  beverly_mansion: 'mansion',
  trump_tower: 'tower',
  monaco_penthouse: 'tower',
  sf_loft: 'apartment',
  private_island: 'island',
  mar_a_lago: 'mansion',
  trump_chicago: 'tower',
  trump_doral: 'mansion',
  trump_vegas: 'tower',
  mago_island: 'island',
  skorpios: 'island',
  tagomago: 'island',
  isla_ferradura: 'island',
  bonds_cay: 'island',
  pumpkin_key: 'island',
  megayacht: 'yacht',
  gulfstream: 'airplane',
  champagne_house: 'vineyard',
  boutique_hotel: 'hotel',
  necker_island: 'island',
  mustique_villa: 'island',
  petit_st_vincent: 'island',
  tetiaroa: 'island',
  lanai: 'island',
  london_townhouse: 'mansion',
  dubai_skyscraper: 'skyscraper',
  burj_penthouse: 'tower',
  nba_franchise: 'stadium',
  f1_team: 'car',
  la_strip_casino: 'casino',
  premier_league: 'stadium',
  hollywood_studio: 'art_easel',
  nfl_franchise: 'stadium',
  cobalt_mine: 'mine',
  diamond_mine: 'gem',
  oil_platform: 'oil_rig',
  rocket_pad: 'rocket',
  crypto_exchange: 'bitcoin',
  streaming_platform: 'tv',
  maldives_atoll: 'island',
  med_archipelago: 'island',
  bahamian_chain: 'island',
  big_tech_hq: 'datacenter',
  national_airline: 'airplane',
  shipping_co: 'ship',
  oil_pipeline: 'pipeline',
  lithium_reserve: 'mine',
  mega_dataceter: 'datacenter',
  private_space: 'rocket',
  sovereign_slice: 'vault',
  telecom_monopoly: 'satellite',
  aircraft_carrier: 'ship',
  pacific_atoll: 'island',
  mega_bank: 'bank',
  global_ai_lab: 'datacenter',
  mars_deed: 'mars',
  lunar_helium: 'moon',

  // Stocks
  MEGA: 'gear', GAFA: 'datacenter', AAII: 'datacenter', NXAI: 'dna',
  BANK: 'bank', BNDS: 'briefcase',
  OIL: 'oil_rig', FUSE: 'atom', SOLR: 'solar_panel', NUKE: 'atom',
  PILL: 'pill', CRSP: 'dna', WGOV: 'syringe',
  BOOM: 'missile', JETS: 'airplane', ORBT: 'satellite',
  FAST: 'burger', COFF: 'coffee', MEGA_MART: 'retail', SHIP: 'truck',
  GOLD: 'gold_bar', LITH: 'mine', COBT: 'mine',
  EVCO: 'car', TRUC: 'truck',
  STRM: 'tv', GAME: 'game_controller',
  CRYP: 'bitcoin', WEED: 'cannabis_leaf', REIT: 'apartment',
  SCAM: 'bitcoin', ZMBE: 'zombie',

  // World territories
  arctic: 'ice', siberia: 'forest', mongolia: 'desert', sahara: 'desert',
  amazon: 'forest', oceania: 'island', andes: 'mountain', himalayas: 'mountain',
  patagonia: 'mountain', australia_outback: 'desert', greenland: 'ice', iceland: 'volcano',
  caribbean: 'palm_tree', iberia: 'mountain', mediterranean: 'palm_tree', scandinavia: 'ice',
  india_subcont: 'globe', south_africa: 'globe', persian_gulf: 'oil_rig',
  europe: 'globe', east_asia: 'skyscraper', north_america: 'skyscraper',
  middle_east: 'oil_rig', southeast_asia: 'palm_tree',
  russia: 'forest', china: 'skyscraper', silicon_valley: 'datacenter',
  antarctica: 'ice', low_earth_orbit: 'satellite', lunar_basin: 'moon',
  mars_north: 'mars', orbital_habitat: 'orbital',

  // Jobs — explicit picks so each shows up distinct
  pickpocket: 'wallet',
  shoplift: 'retail',
  mugging: 'mask',
  catalytic: 'car',
  fake_watches: 'gem',
  scam_grandma: 'phone',
  fake_id: 'credit_card',
  plasma: 'syringe',
  corner_sling: 'cannabis_leaf',
  onlyfans: 'ring_light',
  stripping: 'pole',
  camming: 'ring_light',
  car_boost: 'car',
  atm_skim: 'credit_card',
  charity_scam: 'money_bag',
  pawn_fence: 'briefcase',
  delivery_rob: 'truck',
  meth_batch: 'test_tube',
  timeshare: 'house',
  sugar_baby: 'cocktail',
  counterfeit: 'dollar',
  art_forge: 'art_easel',
  ransomware: 'lock',
  identity_ring: 'credit_card',
  jewel_heist: 'gem',
  bank_branch: 'bank',
  pig_butcher: 'phone',
  porn_studio: 'ring_light',
  ponzi: 'pyramid',
  embezzle: 'briefcase',
  insider: 'chart_up',
  pump_dump: 'chart_up',
  ceo_kickback: 'briefcase',
  shell_wash: 'money_bag',
  fda_bribe: 'pill',
  cayman_setup: 'briefcase',
  arms_broker: 'gun',
  dictator_pr: 'crown',
  swiss_heist: 'vault',
  crypto_mixer: 'bitcoin',
  pmc_contract: 'gun',
  coup: 'flag',
  nuke_smuggle: 'missile',
  war_contract: 'missile',
  false_flag: 'news',
  foreign_asset: 'key',
  megaheist: 'satellite',
}

// Per-id color hint so similar archetypes still have visual variety.
// Picked from Tailwind's palette to match each panel's overall theme.
function colorForId(id) {
  const lower = String(id).toLowerCase()
  // Real estate → emerald family
  if (/tower|mansion|trump|burj|chicago|doral|vegas|skyscraper|champagne|hotel|chalet|loft|vineyard|horsefarm/.test(lower)) return '#34d399'
  // Islands → cyan
  if (/island|atoll|ferradura|tagomago|skorpios|mago|necker|mustique|tetiaroa|lanai|pumpkin|bonds_cay|maldives|archipelago|bahamian|pacific|caribbean|oceania/.test(lower)) return '#67e8f9'
  // Mining / resources → amber
  if (/cobalt|diamond|gold|lithium|oil_platform|pipeline/.test(lower)) return '#fbbf24'
  // Aerospace / off-world → indigo
  if (/rocket|space|mars|lunar|orbital|satellite|atoll/.test(lower)) return '#a5b4fc'
  // Stocks → sky
  if (/^[A-Z_]+$/.test(id)) return '#7dd3fc'
  // Jobs → orange
  if (/pickpocket|shoplift|mug|catalytic|fake|scam|plasma|sling|onlyfans|strip|cam|boost|skim|charity|pawn|delivery|meth|timeshare|sugar|counterfeit|forge|ransom|identity|jewel|bank|pig|porn|ponzi|embezzle|insider|pump|kickback|shell|fda|cayman|arms|dictator|swiss|mixer|pmc|coup|nuke|war|flag|foreign|mega/.test(lower)) return '#fb923c'
  return '#a78bfa' // default purple
}

// Keyword fallback if no explicit mapping. Walks in order so more
// specific patterns can shadow more general ones.
const KEYWORD_RULES = [
  [/tower|skyscraper|burj|dubai|chicago|trump_/i,                  'tower'],
  [/mansion|estate|compound|villa|loft|townhouse|maralago|monaco/i,'mansion'],
  [/penthouse/i,                                                    'tower'],
  [/apartment|rental|reit|storage|sf_loft/i,                       'apartment'],
  [/island|atoll|cay|key|archipelago|chain/i,                      'island'],
  [/yacht|boat/i,                                                  'yacht'],
  [/jet|airplane|airline|gulfstream/i,                             'airplane'],
  [/rocket|space|spacex|launch/i,                                  'rocket'],
  [/satellite|orbit|telecom/i,                                     'satellite'],
  [/ship|carrier|shipping|freight/i,                               'ship'],
  [/oil|petro|pipeline/i,                                          'oil_rig'],
  [/datacenter|ai_lab|tech_hq|neural|nexus/i,                      'datacenter'],
  [/bank|finance/i,                                                'bank'],
  [/vault|sovereign|fund/i,                                        'vault'],
  [/mine|cobalt|lithium/i,                                         'mine'],
  [/gold|diamond|gem|jewel/i,                                      'gem'],
  [/pill|pharma|drug/i,                                            'pill'],
  [/dna|gene|crisp|biotech/i,                                      'dna'],
  [/atom|nuclear|fusion|nuke/i,                                    'atom'],
  [/solar/i,                                                       'solar_panel'],
  [/weed|cannabis|green/i,                                         'cannabis_leaf'],
  [/coffee/i,                                                      'coffee'],
  [/burger|fast/i,                                                 'burger'],
  [/retail|mart|store|shop/i,                                      'retail'],
  [/tv|stream/i,                                                   'tv'],
  [/game|controller/i,                                             'game_controller'],
  [/crypto|btc|coin/i,                                             'bitcoin'],
  [/casino|strip_casino|las_vegas/i,                               'casino'],
  [/nfl|nba|stadium|premier|f1/i,                                  'stadium'],
  [/champagne|vineyard|wine/i,                                     'vineyard'],
  [/horse/i,                                                       'horse'],
  [/chalet|ski/i,                                                  'chalet'],
  [/hotel/i,                                                       'hotel'],
  [/mountain|himalaya|ande|patagonia|iberi/i,                      'mountain'],
  [/ice|arctic|greenland|scandinavia|antarctic/i,                  'ice'],
  [/desert|sahara|mongolia|outback/i,                              'desert'],
  [/forest|amazon|siberia|russia/i,                                'forest'],
  [/volcano|iceland|geothermal/i,                                  'volcano'],
  [/mars|red_planet/i,                                             'mars'],
  [/moon|lunar/i,                                                  'moon'],
  [/orbital|habitat/i,                                             'orbital'],
  [/globe|world|europe|north_america|asia|china|india/i,           'globe'],
  [/palm|tropical|caribbean|oceania|mediterranean/i,               'palm_tree'],
  [/dollar|money|cash|embezzle|ponzi|wash/i,                       'dollar'],
  [/briefcase|consult|deal|kickback|shell|cayman/i,                'briefcase'],
  [/bag|charity|money_bag/i,                                       'money_bag'],
  [/card|identity|skim|atm/i,                                      'credit_card'],
  [/phone|scam_grandma|pig/i,                                      'phone'],
  [/lock|ransomware|hack/i,                                        'lock'],
  [/mask|mugging/i,                                                'mask'],
  [/wallet|pickpocket/i,                                           'wallet'],
  [/chart|trade|insider|pump|dump/i,                               'chart_up'],
  [/pyramid|scheme/i,                                              'pyramid'],
  [/key|asset|foreign/i,                                           'key'],
  [/crown|dictator|king|royal/i,                                   'crown'],
  [/flag|coup/i,                                                   'flag'],
  [/news|paper|media/i,                                            'news'],
  [/missile|weapon|war|arms|nuke_smuggle|defense/i,                'missile'],
  [/gun|pmc|firearm/i,                                             'gun'],
  [/lab|test|tube|fda|bribe|meth/i,                                'test_tube'],
  [/art|forge|easel|paint/i,                                       'art_easel'],
  [/ring|cam|onlyfans|porn/i,                                      'ring_light'],
  [/syringe|injection|plasma|inject/i,                             'syringe'],
  [/cocktail|drink|sugar|timeshare/i,                              'cocktail'],
  [/pole|strip|club/i,                                             'pole'],
  [/zombie|bankrupt|dead/i,                                        'zombie'],
  [/factory|hq|industrial/i,                                       'factory'],
  [/auto|car|boost|vehicle|ev/i,                                   'car'],
  [/truck|delivery|haul/i,                                         'truck'],
  [/trailer|mobile/i,                                              'trailer'],
  [/mall|store|strip_mall/i,                                       'strip_mall'],
  [/house|single|home/i,                                           'house'],
]

function kindFor(id, name) {
  if (EXPLICIT[id]) return EXPLICIT[id]
  const idLower = String(id || '').toLowerCase()
  const nameLower = String(name || '').toLowerCase()
  for (const [pat, kind] of KEYWORD_RULES) {
    if (pat.test(idLower) || pat.test(nameLower)) return kind
  }
  return 'gear'
}

export default function CatalogIcon({
  id,
  name,
  className = '',
  bg,         // background color override
  color,      // stroke color override
  rounded = 'rounded-md',
}) {
  const { kind, fill, stroke } = useMemo(() => {
    const kind = kindFor(id, name)
    // Default colors derived from id; explicit props override.
    const stroke = color || colorForId(id)
    // Bg is a darkened version of stroke. Quick mix: take the stroke
    // hex and apply a low alpha overlay via gradient.
    const fill = bg || `${stroke}22`   // 13% alpha hex appended
    return { kind, fill, stroke }
  }, [id, name, bg, color])

  const Icon = ICONS[kind] || ICONS.gear

  return (
    <div
      role="img"
      aria-label={name || id}
      className={`relative flex items-center justify-center overflow-hidden ${rounded} ${className}`}
      style={{ background: fill, color: stroke }}
    >
      <svg
        viewBox="0 0 24 24"
        width="60%"
        height="60%"
        aria-hidden="true"
        style={{ color: stroke }}
      >
        {Icon()}
      </svg>
    </div>
  )
}

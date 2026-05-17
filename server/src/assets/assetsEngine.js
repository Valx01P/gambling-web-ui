// Appreciating-assets market. Players buy fixed-catalog real-estate-
// style assets that quietly grow in value every hand — the "safe
// passive yield" complement to crypto's swing trading and rugs.
//
// The catalog spans 5 price tiers from $250K starter ("trailer park")
// up to $500B sovereign-level ("Pacific Atoll Nation"), so a broke
// spectator with a few job-grind chips can climb into the market
// while a late-game whale still has things to buy.
//
// 2026-05 economy rebalance:
//   • Yield is now a 3-9% slice of the basePrice each hand (instead
//     of the old flat per-asset rate which produced absurd cases like
//     $700 yield on a $450K rental). Each entry gets a per-instance
//     `yieldPct` in YIELD_PCT_RANGE applied to basePrice.
//   • Prices now wobble per hand: a small random fluctuation (usually
//     well under 1%, occasionally up to ±20%) layers on top of the
//     deterministic `appreciation` drift. Big crashes (-70% to -80%)
//     only fire from world events via applyMarketShock — not from
//     per-hand randomness.
//
// Each entry has an `imageUrl` for the panel preview. Most use the
// placehold.co service with tier-coded colors (always renders, never
// breaks); marquee items try a Wikipedia commons URL, and the React
// panel's <AssetImage> handles onError fallback to the placeholder.
//
// Server-authoritative: the catalog lives here, the engine mutates
// player.chips on buy/sell/yield, and broadcasts `assets:state` after
// every change. Bots can't trade assets.

// 3-9% of basePrice per hand. Each catalog entry rolls a value in
// this band once at engine construction; the value is stable for
// the life of the room (so a player who buys at 7% keeps reading
// "7% yield/hand" instead of seeing it jitter between hands).
const YIELD_PCT_MIN = 0.03
const YIELD_PCT_MAX = 0.09

// Per-hand random price fluctuation. Most of the time the wobble is
// small (well under 1%). About 1 in 8 hands rolls a "fat tail" event
// up to ±20%. World-event crashes go further (-70 to -80%) but go
// through applyMarketShock, not this path.
const NORMAL_WOBBLE_MAX_PCT = 0.008    // ±0.8% on a normal hand
const FAT_TAIL_PROBABILITY = 0.12      // 12% chance of a bigger move
const FAT_TAIL_MAX_PCT = 0.20          // ±20% on the rare hand

import { MESSAGE_TYPES } from '../config/constants.js'

// Quick placeholder URL helper. Used as the imageUrl when we don't
// have a verified real-image URL. The hex-coded color signals tier
// so the panel renders a visual hierarchy even before real photos
// are wired in.
function ph(text, tier) {
  const colors = {
    starter:  '10b981/d1fae5',  // emerald
    mid:      'f59e0b/fef3c7',  // amber
    high:     'dc2626/fee2e2',  // red
    absurd:   '7e22ce/ede9fe',  // purple
    sovereign:'1e293b/e0e7ff',  // slate (the trillion-tier)
  }
  const palette = colors[tier] || colors.mid
  const enc = encodeURIComponent(text).replace(/%20/g, '+')
  return `https://placehold.co/480x300/${palette}.png?text=${enc}&font=lato`
}

const BASE_CATALOG = [
  // ─── STARTER TIER ($250K – $5M) ──────────────────────────────────────
  // Affordable on a few job-grinds. Modest yield but a foothold in
  // the market and decent appreciation.
  { id: 'trailer_park',    name: 'Florida Trailer Park',          blurb: 'Hurricane discount, monthly cashflow.',                basePrice: 250_000,         floor: 100_000,        appreciation: 0.002,  yield: 350,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e2/FEMA_-_12268_-_Photograph_by_Andrea_Booher_taken_on_11-11-2004_in_Florida.jpg' },
  { id: 'single_rental',   name: 'Single-Family Rental (Phoenix)',blurb: 'Boring. Pays the rent.',                                basePrice: 450_000,         floor: 200_000,        appreciation: 0.0025, yield: 700,    imageUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750' },
  { id: 'auto_lot',        name: 'Used Car Lot',                  blurb: 'Volume play. Don\'t ask about the financing.',          basePrice: 800_000,         floor: 400_000,        appreciation: 0.002,  yield: 1100,   imageUrl: 'https://images.unsplash.com/photo-1567808291548-f4b4e2e2e2e2' },
  { id: 'storage_units',   name: 'Self-Storage Facility',         blurb: 'Recession-proof. People accumulate stuff.',             basePrice: 1_200_000,       floor: 600_000,        appreciation: 0.003,  yield: 1800,   imageUrl: 'https://images.unsplash.com/photo-1586528116314-0d8d0e4f5c3f' },
  { id: 'strip_mall',      name: 'Suburban Strip Mall',           blurb: 'Nail salon, vape shop, dialysis center.',               basePrice: 1_800_000,       floor: 900_000,        appreciation: 0.003,  yield: 2500,   imageUrl: 'https://images.unsplash.com/photo-1486299265341-5d2d5d4f5e5f' },
  { id: 'apt_building',    name: '20-Unit Apartment Building',    blurb: 'Section 8 vouchers clear every month.',                 basePrice: 2_500_000,       floor: 1_200_000,      appreciation: 0.0035, yield: 4000,   imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3f8e0d0f' },
  { id: 'kentucky_horsefarm',name: 'Kentucky Horse Farm',         blurb: 'Bourbon, brunch, and stud fees.',                       basePrice: 3_500_000,       floor: 1_500_000,      appreciation: 0.003,  yield: 5500,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Kentucky_horse_farm_bluegrass.jpg/800px-Kentucky_horse_farm_bluegrass.jpg' },
  { id: 'vineyard',        name: 'Napa Valley Vineyard',          blurb: 'Wine tastings on weekends. Tax write-offs daily.',      basePrice: 4_500_000,       floor: 2_000_000,      appreciation: 0.0035, yield: 7000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/57/Napa_Valley_Vineyard_Scene_With_Roses.jpg' },

  // ─── MID TIER ($5M – $100M) ──────────────────────────────────────────
  // The classic "real estate" you'd expect a successful poker player
  // to own. Trophy homes, branded condos, niche businesses.
  { id: 'malibu_compound', name: 'Malibu Coastal Compound',       blurb: 'Six guest houses and a private wave.',                  basePrice: 8_500_000,       floor: 4_000_000,      appreciation: 0.0035, yield: 12_000,    imageUrl: 'https://images.unsplash.com/photo-cr1izPlkSjQ' },
  { id: 'aspen_chalet',    name: 'Aspen Ski Chalet',              blurb: 'Open three months a year. Worth it.',                   basePrice: 12_000_000,      floor: 6_000_000,      appreciation: 0.004,  yield: 18_000,    imageUrl: 'https://images.unsplash.com/photo-PZUumD6n2rY' },
  { id: 'hamptons_estate', name: 'Hamptons Beachfront Estate',    blurb: 'Hedge-fund neighbours, helipad included.',              basePrice: 18_000_000,      floor: 9_000_000,      appreciation: 0.0045, yield: 26_000,    imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a9c' },
  { id: 'beverly_mansion', name: 'Beverly Hills Mansion',         blurb: 'Used in three reality TV shows.',                       basePrice: 25_000_000,      floor: 12_000_000,     appreciation: 0.005,  yield: 38_000,    imageUrl: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811' },
  { id: 'trump_tower',     name: 'Trump Tower Penthouse (NYC)',   blurb: 'Gilded everything. Bulletproof glass.',                 basePrice: 35_000_000,      floor: 18_000_000,     appreciation: 0.004,  yield: 50_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Trump_Tower_(7181836700).jpg' },
  { id: 'monaco_penthouse',name: 'Monaco Penthouse',              blurb: 'Zero income tax. Yacht parked downstairs.',             basePrice: 45_000_000,      floor: 22_000_000,     appreciation: 0.005,  yield: 65_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Monaco_harbour.jpg/800px-Monaco_harbour.jpg' },
  { id: 'sf_loft',         name: 'San Francisco Tech Loft',       blurb: 'Owned the founder. Now owns the founder\'s ex.',        basePrice: 8_000_000,       floor: 4_000_000,      appreciation: 0.0035, yield: 12_000,    imageUrl: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267' },
  { id: 'private_island',  name: 'Caribbean Private Island',      blurb: 'Sand, helipad, no extradition treaty.',                 basePrice: 60_000_000,      floor: 28_000_000,     appreciation: 0.005,  yield: 90_000,    imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  // ── More Trump-branded real estate ─────────────────────────────
  { id: 'mar_a_lago',      name: 'Mar-a-Lago',                    blurb: 'Palm Beach estate. Members-only. Lots of gold leaf.',   basePrice: 75_000_000,      floor: 35_000_000,     appreciation: 0.0045, yield: 105_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Mar-a-Lago_aerial.jpg/800px-Mar-a-Lago_aerial.jpg' },
  { id: 'trump_chicago',   name: 'Trump Intl Hotel & Tower Chicago',blurb: 'River-front, the sign visible from space.',           basePrice: 55_000_000,      floor: 28_000_000,     appreciation: 0.004,  yield: 78_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Trump_International_Hotel_and_Tower_Chicago.jpg/800px-Trump_International_Hotel_and_Tower_Chicago.jpg' },
  { id: 'trump_doral',     name: 'Trump National Doral (Miami)',  blurb: 'Four golf courses. The Blue Monster.',                   basePrice: 90_000_000,      floor: 45_000_000,     appreciation: 0.0045, yield: 130_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Trump_National_Doral.jpg/800px-Trump_National_Doral.jpg' },
  { id: 'trump_vegas',     name: 'Trump Intl Hotel Las Vegas',    blurb: '24-karat gold-leafed windows on the Strip.',             basePrice: 48_000_000,      floor: 24_000_000,     appreciation: 0.004,  yield: 68_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Trump_Hotel_Las_Vegas.jpg/800px-Trump_Hotel_Las_Vegas.jpg' },
  // ── More islands ───────────────────────────────────────────────
  { id: 'mago_island',     name: 'Mago Island (Fiji)',            blurb: '5,400 acres of jungle. A movie star bought it on a whim.', basePrice: 16_000_000,    floor: 8_000_000,      appreciation: 0.004,  yield: 24_000,    imageUrl: 'https://images.unsplash.com/photo-1501785889-0d8a2f9c7d3f' },
  { id: 'skorpios',        name: 'Skorpios (Ionian Sea)',         blurb: 'Onassis-era hideaway. Olive groves and chapels.',       basePrice: 150_000_000,     floor: 70_000_000,     appreciation: 0.005,  yield: 220_000,   imageUrl: 'https://images.unsplash.com/photo-1540979388789-2bf9c6a1b2f3' },
  { id: 'tagomago',        name: 'Tagomago (off Ibiza)',          blurb: '1.4 km² of Mediterranean rental income.',               basePrice: 110_000_000,     floor: 55_000_000,     appreciation: 0.005,  yield: 160_000,   imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd70cbf54a' },
  { id: 'isla_ferradura',  name: 'Isla de sa Ferradura (Ibiza)',  blurb: 'Boutique villa rental. Sunset facing.',                 basePrice: 95_000_000,      floor: 48_000_000,     appreciation: 0.0045, yield: 135_000,   imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd70cbf54a' },
  { id: 'bonds_cay',       name: 'Bonds Cay (Bahamas)',           blurb: '700 acres, white sand, no neighbours for miles.',       basePrice: 35_000_000,      floor: 18_000_000,     appreciation: 0.004,  yield: 50_000,    imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'pumpkin_key',     name: 'Pumpkin Key (Florida Keys)',    blurb: '26-acre island with airstrip and tennis courts.',       basePrice: 95_000_000,      floor: 48_000_000,     appreciation: 0.0045, yield: 140_000,   imageUrl: 'https://images.unsplash.com/photo-1501785889-0d8a2f9c7d3f' },
  { id: 'megayacht',       name: 'Megayacht (90m)',               blurb: 'Crew of 30. Repaints itself when you blink.',           basePrice: 80_000_000,      floor: 40_000_000,     appreciation: 0.003,  yield: 100_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Megayacht_aerial.jpg/800px-Megayacht_aerial.jpg' },
  { id: 'gulfstream',      name: 'Gulfstream G700',               blurb: 'Coast-to-coast in nap-time.',                           basePrice: 70_000_000,      floor: 35_000_000,     appreciation: 0.003,  yield: 95_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Gulfstream_G700_tarmac.jpg/800px-Gulfstream_G700_tarmac.jpg' },
  { id: 'champagne_house', name: 'Champagne Maison (Reims)',      blurb: 'Centuries-old cellar, 200-acre estate.',                basePrice: 55_000_000,      floor: 28_000_000,     appreciation: 0.004,  yield: 75_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Reims_champagne_house_vineyards.jpg/800px-Reims_champagne_house_vineyards.jpg' },
  { id: 'boutique_hotel',  name: 'Boutique Hotel (Mykonos)',      blurb: 'Influencer hotspot. Pays in optics + cash.',            basePrice: 22_000_000,      floor: 11_000_000,     appreciation: 0.0045, yield: 32_000,    imageUrl: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4' },

  // ─── HIGH TIER ($100M – $10B) ────────────────────────────────────────
  // Sports franchises, mega-casinos, full mining operations.
  // ── High-tier islands ──────────────────────────────────────────
  { id: 'necker_island',   name: 'Necker Island (BVI)',           blurb: '74 acres in the British Virgin Islands. Has a kitemark.', basePrice: 180_000_000,   floor: 90_000_000,     appreciation: 0.0055, yield: 260_000,   imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'mustique_villa',  name: 'Mustique Estate (Grenadines)',  blurb: 'Royals and rock stars vacation here. Discreet staff.',  basePrice: 220_000_000,     floor: 110_000_000,    appreciation: 0.005,  yield: 300_000,   imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba' },
  { id: 'petit_st_vincent',name: 'Petit Saint Vincent',           blurb: '115 acres, 22 cottages, the whole island is the resort.',basePrice: 145_000_000,    floor: 70_000_000,     appreciation: 0.0045, yield: 195_000,   imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'tetiaroa',        name: 'Tetiaroa Atoll (French Polynesia)',blurb: 'A movie legend\'s atoll. Twelve motus, eco-resort built.',basePrice: 420_000_000,floor: 200_000_000,   appreciation: 0.005,  yield: 580_000,   imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'lanai',           name: 'Lana\'i (Hawaii, 98% private)', blurb: 'Pineapple plantation turned billionaire\'s playground.', basePrice: 600_000_000,    floor: 300_000_000,    appreciation: 0.0055, yield: 820_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Lanai_Hawaii_coast.jpg/800px-Lanai_Hawaii_coast.jpg' },
  { id: 'london_townhouse',name: 'Belgravia Townhouse',           blurb: 'White stucco. Neighbours are oligarchs.',               basePrice: 120_000_000,     floor: 60_000_000,     appreciation: 0.0045, yield: 150_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Belgravia_townhouse.jpg/800px-Belgravia_townhouse.jpg' },
  { id: 'dubai_skyscraper',name: 'Dubai Skyscraper (top floor)',  blurb: 'Top floor of a tower that didn\'t exist last year.',    basePrice: 180_000_000,     floor: 90_000_000,     appreciation: 0.006,  yield: 240_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Dubai_Marina_Cayan_Tower.jpg/800px-Dubai_Marina_Cayan_Tower.jpg' },
  { id: 'burj_penthouse',  name: 'Burj Khalifa Penthouse',        blurb: 'Floor 154. Curvature of the earth from your bathtub.',  basePrice: 250_000_000,     floor: 120_000_000,    appreciation: 0.006,  yield: 320_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/Burj_Khalifa_(16260269606).jpg' },
  { id: 'nba_franchise',   name: 'NBA Franchise (mid-market)',    blurb: 'Sells out home games. Loses every playoff round.',      basePrice: 600_000_000,     floor: 350_000_000,    appreciation: 0.005,  yield: 700_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/NBA_arena_interior.jpg/800px-NBA_arena_interior.jpg' },
  { id: 'f1_team',         name: 'Formula 1 Team',                blurb: 'Burns 200 engines a year.',                             basePrice: 800_000_000,     floor: 450_000_000,    appreciation: 0.0055, yield: 950_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Formula_1_pit_lane.jpg/800px-Formula_1_pit_lane.jpg' },
  { id: 'la_strip_casino', name: 'Las Vegas Strip Casino',        blurb: 'House edge: yes.',                                      basePrice: 1_500_000_000,   floor: 800_000_000,    appreciation: 0.005,  yield: 2_500_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Las_Vegas_Strip_neon_night.jpg/800px-Las_Vegas_Strip_neon_night.jpg' },
  { id: 'premier_league',  name: 'Premier League Club',           blurb: 'Mid-table forever. Sponsorship deals huge.',            basePrice: 2_500_000_000,   floor: 1_200_000_000,  appreciation: 0.006,  yield: 4_500_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Premier_League_stadium_aerial.jpg/800px-Premier_League_stadium_aerial.jpg' },
  { id: 'hollywood_studio',name: 'Hollywood Studio Lot',          blurb: 'Three IPs that haven\'t been rebooted yet.',            basePrice: 4_000_000_000,   floor: 2_000_000_000,  appreciation: 0.005,  yield: 6_000_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Hollywood_studio_lot_aerial.jpg/800px-Hollywood_studio_lot_aerial.jpg' },
  { id: 'nfl_franchise',   name: 'NFL Franchise',                 blurb: 'Stadium subsidies, captive market.',                    basePrice: 6_000_000_000,   floor: 3_000_000_000,  appreciation: 0.0055, yield: 9_000_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/NFL_stadium_aerial.jpg/800px-NFL_stadium_aerial.jpg' },
  { id: 'cobalt_mine',     name: 'Cobalt Mine (DRC)',             blurb: 'Powers every EV battery on earth.',                     basePrice: 3_500_000_000,   floor: 1_800_000_000,  appreciation: 0.006,  yield: 5_500_000, imageUrl: 'https://images.unsplash.com/photo-1583248379190-3f5c3b8c8e8e' },
  { id: 'diamond_mine',    name: 'Diamond Mine (Botswana)',       blurb: 'De Beers wants in. Don\'t let them.',                   basePrice: 5_500_000_000,   floor: 2_800_000_000,  appreciation: 0.0055, yield: 8_000_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Jwaneng_diamond_mine_aerial.jpg/800px-Jwaneng_diamond_mine_aerial.jpg' },
  { id: 'oil_platform',    name: 'North Sea Oil Platform',        blurb: 'Decommissioning bill not your problem yet.',            basePrice: 4_500_000_000,   floor: 2_200_000_000,  appreciation: 0.005,  yield: 7_500_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/North_Sea_oil_platform.jpg/800px-North_Sea_oil_platform.jpg' },
  { id: 'rocket_pad',      name: 'Private Rocket Launchpad',      blurb: 'Quarterly satellite contracts, telegenic.',             basePrice: 2_000_000_000,   floor: 1_000_000_000,  appreciation: 0.007,  yield: 3_500_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/SpaceX_Falcon_launch_pad.jpg/800px-SpaceX_Falcon_launch_pad.jpg' },
  { id: 'crypto_exchange', name: 'Mid-Tier Crypto Exchange',      blurb: 'Custodial. Trust us.',                                  basePrice: 1_800_000_000,   floor: 900_000_000,    appreciation: 0.007,  yield: 4_000_000, imageUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0' },
  { id: 'streaming_platform',name: 'Niche Streaming Platform',    blurb: 'Cooking + sports + true crime. The trifecta.',          basePrice: 3_000_000_000,   floor: 1_500_000_000,  appreciation: 0.006,  yield: 5_000_000, imageUrl: 'https://images.unsplash.com/photo-1574375927797-0f2f8b3c8f4d' },

  // ─── ABSURD TIER ($10B – $500B) ──────────────────────────────────────
  // Sovereign-adjacent things you can own. National airlines, big-tech
  // HQs, private space programs.
  // ── Multi-island holdings (absurd tier) ────────────────────────
  { id: 'maldives_atoll',  name: 'Maldives Private Atoll',        blurb: 'Your own ring of motus. Resort, airstrip, dive shop.',  basePrice: 1_500_000_000,   floor: 800_000_000,    appreciation: 0.006,  yield: 2_200_000,    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Maldives_overwater_bungalows_aerial.jpg/800px-Maldives_overwater_bungalows_aerial.jpg' },
  { id: 'med_archipelago', name: 'Private Mediterranean Archipelago',blurb: 'Six islands, one passport, regulators look the other way.',basePrice: 8_000_000_000, floor: 4_000_000_000, appreciation: 0.0055, yield: 11_000_000,   imageUrl: 'https://images.unsplash.com/photo-1540979388789-2bf9c6a1b2f3' },
  { id: 'bahamian_chain',  name: 'Bahamian Out-Island Chain',     blurb: 'A 14-island chain. Bring lawyers. And boats. And lawyers.', basePrice: 15_000_000_000,floor: 7_500_000_000, appreciation: 0.006,  yield: 22_000_000,   imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'big_tech_hq',     name: 'Big Tech HQ (lease)',           blurb: 'Cul-de-sac campus. Free snacks for 80,000.',            basePrice: 25_000_000_000,  floor: 12_000_000_000, appreciation: 0.005,  yield: 35_000_000,   imageUrl: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29' },
  { id: 'national_airline',name: 'National Airline (small country)',blurb: 'Three planes. One terminal. Sovereign immunity.',     basePrice: 18_000_000_000,  floor: 9_000_000_000,  appreciation: 0.0045, yield: 24_000_000,   imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05' },
  { id: 'shipping_co',     name: 'Pacific Shipping Conglomerate', blurb: '6% of global freight. Pirate insurance discount.',      basePrice: 40_000_000_000,  floor: 20_000_000_000, appreciation: 0.005,  yield: 60_000_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Container_ship_port.jpg/800px-Container_ship_port.jpg' },
  { id: 'oil_pipeline',    name: 'Trans-Continental Oil Pipeline',blurb: 'Geopolitically inconvenient. Profitable.',              basePrice: 55_000_000_000,  floor: 28_000_000_000, appreciation: 0.005,  yield: 80_000_000,   imageUrl: 'https://images.unsplash.com/photo-1583248379190-3f5c3b8c8e8e' },
  { id: 'lithium_reserve', name: 'Bolivian Lithium Reserve',      blurb: 'Half the planet\'s known supply.',                      basePrice: 80_000_000_000,  floor: 40_000_000_000, appreciation: 0.0065, yield: 130_000_000,  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Salar_de_Uyuni_lithium_pools.jpg/800px-Salar_de_Uyuni_lithium_pools.jpg' },
  { id: 'mega_dataceter', name: 'Hyperscale Datacenter Complex',  blurb: 'Powers your model. Yes, that one.',                     basePrice: 100_000_000_000, floor: 50_000_000_000, appreciation: 0.007,  yield: 175_000_000,  imageUrl: 'https://images.unsplash.com/photo-1558494949-ef0d38d3f2d4' },
  { id: 'private_space',   name: 'Private Space Program',         blurb: 'Reusable boosters. Hostile reusable lawyers.',          basePrice: 150_000_000_000, floor: 75_000_000_000, appreciation: 0.0075, yield: 240_000_000,  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/SpaceX_Starbase.jpg/800px-SpaceX_Starbase.jpg' },
  { id: 'sovereign_slice', name: 'Sovereign Wealth Fund (slice)', blurb: '0.3% of a Gulf state\'s fund. Quarterly statement.',    basePrice: 220_000_000_000, floor: 110_000_000_000,appreciation: 0.0055, yield: 280_000_000,  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Abu_Dhabi_skyline.jpg/800px-Abu_Dhabi_skyline.jpg' },
  { id: 'telecom_monopoly',name: 'Continental Telecom Monopoly',  blurb: 'Owns the cables, the spectrum, the regulator.',         basePrice: 300_000_000_000, floor: 150_000_000_000,appreciation: 0.006,  yield: 420_000_000,  imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'aircraft_carrier',name: 'Aircraft Carrier (decommissioned, livable)',blurb: 'Floating fortress. International waters only.',basePrice: 12_000_000_000, floor: 6_000_000_000, appreciation: 0.0035, yield: 13_000_000,   imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nimitz_class_aircraft_carrier.jpg/800px-Nimitz_class_aircraft_carrier.jpg' },

  // ─── SOVEREIGN TIER ($500B+) ─────────────────────────────────────────
  // Things only billionaires (or several billionaires combined) can
  // afford. Buying one is a flex; selling one moves the market.
  { id: 'pacific_atoll',   name: 'Pacific Atoll Nation',          blurb: 'Recognized by 14 countries. Has a flag.',               basePrice: 500_000_000_000,   floor: 250_000_000_000,   appreciation: 0.006,  yield: 750_000_000,    imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'mega_bank',       name: 'Systemically-Important Bank',   blurb: 'Too big to fail. The bailout is the business model.',   basePrice: 800_000_000_000,   floor: 400_000_000_000,   appreciation: 0.0055, yield: 1_100_000_000,  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Wall_Street.jpg/800px-Wall_Street.jpg' },
  { id: 'global_ai_lab',   name: 'Frontier AI Lab',               blurb: 'Burns a power plant per training run.',                 basePrice: 1_200_000_000_000, floor: 600_000_000_000,   appreciation: 0.008,  yield: 2_000_000_000,  imageUrl: 'https://images.unsplash.com/photo-1558494949-ef0d38d3f2d4' },
  { id: 'mars_deed',       name: 'Mars Colony Land Deed',         blurb: '50 km² on Olympus Mons. Comes with a flag.',            basePrice: 2_000_000_000_000, floor: 1_000_000_000_000, appreciation: 0.009,  yield: 2_800_000_000,  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Olympus_Mons.jpg/800px-Olympus_Mons.jpg' },
  { id: 'lunar_helium',    name: 'Lunar Helium-3 Mining Rights',  blurb: 'Fusion fuel monopoly, when the reactors work.',         basePrice: 3_500_000_000_000, floor: 1_700_000_000_000, appreciation: 0.0085, yield: 4_500_000_000,  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Moon_south_pole_crater.jpg/800px-Moon_south_pole_crater.jpg' },
]

export class AssetEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast
    this.catalog = new Map()
    for (const entry of BASE_CATALOG) {
      // Roll the per-asset yield rate once at construction. Locked for
      // the life of this room so a buyer's "yield/hand" reading is
      // stable across hands. The legacy flat `yield` field is ignored
      // in favour of `yieldPct * basePrice`.
      const yieldPct = YIELD_PCT_MIN + Math.random() * (YIELD_PCT_MAX - YIELD_PCT_MIN)
      this.catalog.set(entry.id, {
        ...entry,
        price: entry.basePrice,
        yieldPct,
        yield: Math.max(1, Math.floor(entry.basePrice * yieldPct)),
      })
    }
    this.holdings = new Map()  // playerId → Map<assetId, units>
    this.marketMultiplier = 1.0
  }

  _bagFor(playerId) {
    let bag = this.holdings.get(playerId)
    if (!bag) { bag = new Map(); this.holdings.set(playerId, bag) }
    return bag
  }

  _findPlayer(playerId) {
    return this.room.players?.get?.(playerId) || this.room.spectators?.get?.(playerId) || null
  }

  onHandEnd() {
    const yields = []
    for (const [playerId, bag] of this.holdings) {
      const player = this._findPlayer(playerId)
      if (!player || player.isBot) continue
      let total = 0
      for (const [assetId, units] of bag) {
        const entry = this.catalog.get(assetId)
        if (!entry) continue
        total += Math.floor((entry.yield || 0) * units)
      }
      if (total > 0) {
        // Yields land in the bank — assets are a passive-income
        // money-maker, decoupled from the poker stack.
        player.bankBalance = (player.bankBalance || 0) + total
        yields.push({ playerId, amount: total })
      }
    }
    for (const entry of this.catalog.values()) {
      // Deterministic appreciation drift (per-asset, tiny — was already
      // here pre-rebalance) plus a per-hand random wobble. Most hands
      // see a tiny ±0.8% jitter; ~1 in 8 rolls a bigger ±20% move so
      // a long session has visible price action. Crashes >20% only
      // come from world events via applyMarketShock.
      const fatTail = Math.random() < FAT_TAIL_PROBABILITY
      const wobbleMax = fatTail ? FAT_TAIL_MAX_PCT : NORMAL_WOBBLE_MAX_PCT
      const wobble = (Math.random() * 2 - 1) * wobbleMax
      const next = entry.price * (1 + entry.appreciation + wobble)
      entry.price = Math.max(entry.floor, Math.floor(next))
    }
    if (this.marketMultiplier < 1) {
      this.marketMultiplier = Math.min(1, this.marketMultiplier + 0.04)
    }
    if (yields.length > 0) {
      for (const y of yields) {
        const p = this._findPlayer(y.playerId)
        p?.send?.({
          type: MESSAGE_TYPES.SYSTEM_MESSAGE,
          data: { message: `🏛 Asset yields: +$${y.amount.toLocaleString()}` }
        })
      }
    }
    this._broadcastState()
  }

  buy(playerId, { assetId, units = 1 } = {}) {
    const u = Math.max(1, Math.floor(Number(units) || 0))
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_trade' }
    const entry = this.catalog.get(assetId)
    if (!entry) return { success: false, error: 'unknown_asset' }
    const price = this._displayPrice(entry)
    const total = price * u
    // Asset purchases are funded from the bank. Player.chips at the
    // table is poker money only.
    if ((player.bankBalance || 0) < total) return { success: false, error: 'insufficient_chips' }
    player.bankBalance -= total
    const bag = this._bagFor(playerId)
    bag.set(assetId, (bag.get(assetId) || 0) + u)
    this._broadcastState()
    return { success: true, assetId, units: u, totalCost: total }
  }

  sell(playerId, { assetId, units = 1 } = {}) {
    const u = Math.max(1, Math.floor(Number(units) || 0))
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    const bag = this.holdings.get(playerId)
    const have = bag?.get(assetId) || 0
    if (have < u) return { success: false, error: 'insufficient_units' }
    const entry = this.catalog.get(assetId)
    if (!entry) return { success: false, error: 'unknown_asset' }
    const price = this._displayPrice(entry)
    const proceeds = price * u
    player.bankBalance = (player.bankBalance || 0) + proceeds
    const next = have - u
    if (next <= 0) bag.delete(assetId)
    else bag.set(assetId, next)
    this._broadcastState()
    return { success: true, assetId, units: u, proceeds }
  }

  applyMarketShock(magnitude) {
    const m = Math.max(0.25, Math.min(1.0, Number(magnitude) || 1.0))
    this.marketMultiplier = Math.min(this.marketMultiplier, m)
    this._broadcastState()
    return { newMultiplier: this.marketMultiplier }
  }

  _displayPrice(entry) {
    return Math.max(entry.floor, Math.floor(entry.price * this.marketMultiplier))
  }

  buildSnapshot(playerId) {
    const catalog = [...this.catalog.values()].map(e => ({
      id: e.id,
      name: e.name,
      blurb: e.blurb,
      price: this._displayPrice(e),
      yieldPerHand: e.yield,
      // 3-9% yield rate on basePrice — rolled once at construction
      // and stable for the room. The client reads this to render the
      // headline "X% per hand" alongside the dollar amount, since the
      // old `appreciation` (per-hand price drift) was a separate,
      // much smaller number and confused users into thinking the
      // asset paid 0.3%/hand when it actually pays 3-9%.
      yieldPct: e.yieldPct,
      appreciation: e.appreciation,
      imageUrl: e.imageUrl || null,
    }))
    const bag = this.holdings.get(playerId) || new Map()
    const positions = []
    for (const [assetId, units] of bag) {
      const entry = this.catalog.get(assetId)
      if (!entry) continue
      positions.push({
        assetId,
        units,
        currentPrice: this._displayPrice(entry),
        currentValue: this._displayPrice(entry) * units,
      })
    }
    return {
      catalog,
      myPositions: positions,
      marketMultiplier: this.marketMultiplier,
    }
  }

  _broadcastState() {
    const seats = this.room.players?.values?.() || []
    for (const p of seats) {
      if (p.isBot || !p.isConnected) continue
      p.send({ type: 'assets:state', data: this.buildSnapshot(p.id) })
    }
    const specs = this.room.spectators?.values?.() || []
    for (const s of specs) {
      if (!s.isConnected) continue
      s.send({ type: 'assets:state', data: this.buildSnapshot(s.id) })
    }
  }

  sendSnapshotTo(player) {
    if (!player || player.isBot) return
    player.send({ type: 'assets:state', data: this.buildSnapshot(player.id) })
  }

  handlePlayerLeave(playerId) {
    const player = this._findPlayer(playerId)
    const bag = this.holdings.get(playerId)
    if (!bag || bag.size === 0) {
      this.holdings.delete(playerId)
      return
    }
    if (player) {
      let proceeds = 0
      for (const [assetId, units] of bag) {
        const entry = this.catalog.get(assetId)
        if (!entry) continue
        proceeds += this._displayPrice(entry) * units
      }
      player.bankBalance = (player.bankBalance || 0) + proceeds
    }
    this.holdings.delete(playerId)
  }
}

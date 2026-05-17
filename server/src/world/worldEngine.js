// Satirical-tycoon world layer. Players claim fictional territories
// from a fixed catalog; each claimed territory pays passive income per
// hand. A second mechanic — release a fictional PANDEMIC — drops the
// passive income for ALL territories worldwide for several hands AND
// crashes the real-estate market multiplier as collateral damage.
//
// The game framing is deliberately Plague-Inc / Risk-style fictional:
// no real territory ownership, no real disease, just a stylized hex
// of regions and a chip-economy lever to mess with.
//
// Territories can be CONTESTED — a richer player can outbid the
// current owner. The price floor is the original claim price; each
// reclaim doubles it, so squatting is expensive and hostile takeovers
// are real.
//
// 2026-05 design note: regions intentionally have NO random per-hand
// price or yield fluctuation. The only things that move world prices
// or yields are (a) deliberate global events (pandemic today; future
// events like hacked nukes, extreme lobbying could land here) and
// (b) player actions (claim / reclaim cost-doubling). Per-asset
// randomness lives on the real-estate / stocks / crypto layers
// instead — keep this layer event-driven so geopolitics feels like
// an intentional act, not weather.

import { MESSAGE_TYPES } from '../config/constants.js'

// Stable id, display label, region color (for the map UI), per-hand
// yield, initial claim cost. Costs scale roughly with desirability.
// Compact placeholder builder for territories. Hex color of the
// region tints the chip so even on the world panel the regions are
// visually distinct.
function tph(text, hex) {
  const fg = 'ffffff'
  const bg = hex.replace('#', '')
  const enc = encodeURIComponent(text).replace(/%20/g, '+')
  return `https://placehold.co/320x200/${bg}/${fg}.png?text=${enc}&font=lato`
}

// 30+ fictional Risk-style regions covering the globe. Yields scale
// with desirability — Arctic pays peanuts, megacities and petro
// states pay millions. Top end (Solar Orbital Habitat, Mars Pole)
// reaches into the trillion-tier so the world layer stays competitive
// with the real-estate sovereign tier.
const TERRITORIES = [
  // Cheap entry tier — small, marginal regions
  { id: 'arctic',         name: 'Arctic Territories',          color: '#7dd3fc', yieldBase: 5_000,         costBase: 1_000_000        , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Arctic_ice.jpg/800px-Arctic_ice.jpg' },
  { id: 'siberia',        name: 'Siberian Tundra',             color: '#a5b4fc', yieldBase: 12_000,        costBase: 3_000_000        , imageUrl: 'https://images.unsplash.com/photo-1511497588682-9f9d9e5b5f5f' },
  { id: 'mongolia',       name: 'Central Asian Steppe',        color: '#fcd34d', yieldBase: 18_000,        costBase: 5_000_000        , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Mongolian_steppe.jpg/800px-Mongolian_steppe.jpg' },
  { id: 'sahara',         name: 'Saharan Belt',                color: '#fbbf24', yieldBase: 22_000,        costBase: 6_500_000        , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Sahara_desert_dunes.jpg/800px-Sahara_desert_dunes.jpg' },
  { id: 'amazon',         name: 'Amazon Basin',                color: '#86efac', yieldBase: 80_000,        costBase: 25_000_000       , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Amazon_rainforest_river_aerial.jpg/800px-Amazon_rainforest_river_aerial.jpg' },
  { id: 'oceania',        name: 'Oceanic Islands',             color: '#67e8f9', yieldBase: 100_000,       costBase: 35_000_000       , imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'andes',          name: 'Andean Highlands',            color: '#fda4af', yieldBase: 55_000,        costBase: 18_000_000       , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Andes_mountains_aerial.jpg/800px-Andes_mountains_aerial.jpg' },
  { id: 'himalayas',      name: 'Himalayan Range',             color: '#c4b5fd', yieldBase: 70_000,        costBase: 22_000_000       , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Mount_Everest_aerial.jpg/800px-Mount_Everest_aerial.jpg' },
  { id: 'patagonia',      name: 'Patagonian Pampas',           color: '#a7f3d0', yieldBase: 35_000,        costBase: 12_000_000       , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Patagonia_glacier.jpg/800px-Patagonia_glacier.jpg' },
  { id: 'australia_outback',name: 'Australian Outback',        color: '#fcd34d', yieldBase: 60_000,        costBase: 20_000_000       , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Uluru_red_desert.jpg/800px-Uluru_red_desert.jpg' },
  { id: 'greenland',      name: 'Greenland Ice Sheet',         color: '#cffafe', yieldBase: 25_000,        costBase: 8_000_000        , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Greenland_ice_sheet.jpg/800px-Greenland_ice_sheet.jpg' },
  { id: 'iceland',        name: 'Icelandic Geothermal Belt',   color: '#a5f3fc', yieldBase: 90_000,        costBase: 28_000_000       , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Iceland_geothermal.jpg/800px-Iceland_geothermal.jpg' },
  // Mid tier — productive regions
  { id: 'caribbean',      name: 'Caribbean Tax Havens',        color: '#5eead4', yieldBase: 250_000,       costBase: 80_000_000       , imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'iberia',         name: 'Iberian Peninsula',           color: '#fdba74', yieldBase: 600_000,       costBase: 200_000_000      , imageUrl: 'https://images.unsplash.com/photo-1501785889-0d8a2f9c7d3f' },
  { id: 'mediterranean',  name: 'Mediterranean Coast',         color: '#7dd3fc', yieldBase: 800_000,       costBase: 250_000_000      , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Mediterranean_coast.jpg/800px-Mediterranean_coast.jpg' },
  { id: 'scandinavia',    name: 'Scandinavian Fjords',         color: '#a5b4fc', yieldBase: 700_000,       costBase: 220_000_000      , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Norwegian_fjord_aerial.jpg/800px-Norwegian_fjord_aerial.jpg' },
  { id: 'india_subcont',  name: 'Indian Subcontinent',         color: '#fb923c', yieldBase: 2_500_000,     costBase: 800_000_000      , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Mumbai_skyline.jpg/800px-Mumbai_skyline.jpg' },
  { id: 'south_africa',   name: 'Southern African Belt',       color: '#bef264', yieldBase: 1_200_000,     costBase: 400_000_000      , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Table_Mountain.jpg/800px-Table_Mountain.jpg' },
  { id: 'persian_gulf',   name: 'Persian Gulf Coast',          color: '#fde047', yieldBase: 4_500_000,     costBase: 1_500_000_000    , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Dubai_persian_gulf.jpg/800px-Dubai_persian_gulf.jpg' },
  // High tier — economic powerhouses
  { id: 'europe',         name: 'Western European Plain',      color: '#f9a8d4', yieldBase: 8_000_000,     costBase: 2_500_000_000    , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Paris_Eiffel.jpg/800px-Paris_Eiffel.jpg' },
  { id: 'east_asia',      name: 'East Asian Megacities',       color: '#fca5a5', yieldBase: 12_000_000,    costBase: 4_000_000_000    , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Tokyo_shibuya.jpg/800px-Tokyo_shibuya.jpg' },
  { id: 'north_america',  name: 'North American Empire',       color: '#93c5fd', yieldBase: 18_000_000,    costBase: 6_000_000_000    , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Manhattan_aerial.jpg/800px-Manhattan_aerial.jpg' },
  { id: 'middle_east',    name: 'Gulf Petro-States',           color: '#fde047', yieldBase: 14_000_000,    costBase: 5_000_000_000    , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Riyadh_skyline.jpg/800px-Riyadh_skyline.jpg' },
  { id: 'southeast_asia', name: 'Southeast Asian Tigers',      color: '#fdba74', yieldBase: 9_000_000,     costBase: 3_000_000_000    , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Singapore_marina_bay.jpg/800px-Singapore_marina_bay.jpg' },
  // Sovereign tier — owning a whole bloc
  { id: 'russia',         name: 'Russian Federation Lite',     color: '#a5b4fc', yieldBase: 35_000_000,    costBase: 12_000_000_000   , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Moscow_red_square.jpg/800px-Moscow_red_square.jpg' },
  { id: 'china',          name: 'Greater China Sphere',        color: '#fca5a5', yieldBase: 70_000_000,    costBase: 25_000_000_000   , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Shanghai_pudong.jpg/800px-Shanghai_pudong.jpg' },
  { id: 'silicon_valley', name: 'Silicon Valley Megaplex',     color: '#a78bfa', yieldBase: 100_000_000,   costBase: 35_000_000_000   , imageUrl: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29' },
  // Off-world tier — Plague Inc / Civ endgame
  { id: 'antarctica',     name: 'Antarctic Resource Claim',    color: '#e0f2fe', yieldBase: 60_000_000,    costBase: 22_000_000_000   , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Antarctica_research_station.jpg/800px-Antarctica_research_station.jpg' },
  { id: 'low_earth_orbit',name: 'Low Earth Orbit (5km slot)',  color: '#1e293b', yieldBase: 500_000_000,   costBase: 180_000_000_000  , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/ISS_orbit_earth.jpg/800px-ISS_orbit_earth.jpg' },
  { id: 'lunar_basin',    name: 'Lunar South Pole Basin',      color: '#e2e8f0', yieldBase: 1_200_000_000, costBase: 450_000_000_000  , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Moon_south_pole_crater.jpg/800px-Moon_south_pole_crater.jpg' },
  { id: 'mars_north',     name: 'Mars North Pole',             color: '#fca5a5', yieldBase: 2_500_000_000, costBase: 1_000_000_000_000, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Mars_polar_ice_cap.jpg/800px-Mars_polar_ice_cap.jpg' },
  { id: 'orbital_habitat',name: 'Solar Orbital Habitat',       color: '#fde047', yieldBase: 5_000_000_000, costBase: 2_500_000_000_000, imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd70cbf54a' },
]
// Group territories by region — drives the flat-map view layout.
// Each row of the map shows one region. The off-world tier sits at
// the top (above earth), polar regions at the very bottom edge.
const REGION_FOR_ID = {
  arctic: 'polar', greenland: 'polar', iceland: 'polar',
  siberia: 'eurasia', europe: 'eurasia', scandinavia: 'eurasia', iberia: 'eurasia',
  russia: 'eurasia', mongolia: 'eurasia', himalayas: 'eurasia', india_subcont: 'eurasia',
  east_asia: 'eurasia', china: 'eurasia', southeast_asia: 'eurasia',
  middle_east: 'eurasia', persian_gulf: 'eurasia', mediterranean: 'eurasia',
  silicon_valley: 'americas', north_america: 'americas', amazon: 'americas',
  andes: 'americas', patagonia: 'americas', caribbean: 'americas',
  sahara: 'africa', south_africa: 'africa',
  australia_outback: 'oceania', oceania: 'oceania',
  antarctica: 'polar',
  low_earth_orbit: 'orbital', lunar_basin: 'orbital', mars_north: 'orbital',
  orbital_habitat: 'orbital',
}

// Map each territory to a list of real-world country names that the
// world-atlas TopoJSON recognizes. Used by the real SVG world map
// to color-fill the right countries based on territory ownership.
// Loose mapping — a player who claims "Saharan Belt" paints every
// Sahara country, etc. Country names match the TopoJSON `properties.name`
// field exactly (world-atlas 110m, which the client uses).
const COUNTRIES_FOR_ID = {
  arctic: ['Greenland'],
  greenland: ['Greenland'],
  iceland: ['Iceland'],
  siberia: ['Russia'],
  europe: ['France', 'Germany', 'Italy', 'Belgium', 'Netherlands', 'Austria', 'Switzerland', 'Czech Republic', 'Poland', 'Slovakia', 'Hungary'],
  scandinavia: ['Sweden', 'Norway', 'Finland', 'Denmark'],
  iberia: ['Spain', 'Portugal'],
  russia: ['Russia', 'Belarus', 'Ukraine'],
  mongolia: ['Mongolia', 'Kazakhstan', 'Kyrgyzstan'],
  himalayas: ['Nepal', 'Bhutan'],
  india_subcont: ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka'],
  east_asia: ['Japan', 'South Korea', 'North Korea', 'Taiwan'],
  china: ['China'],
  southeast_asia: ['Vietnam', 'Thailand', 'Indonesia', 'Malaysia', 'Philippines', 'Myanmar', 'Cambodia', 'Laos'],
  middle_east: ['Iran', 'Iraq', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Turkey'],
  persian_gulf: ['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Kuwait', 'Oman'],
  mediterranean: ['Greece', 'Cyprus', 'Albania', 'Croatia', 'Slovenia'],
  silicon_valley: ['United States of America'],
  north_america: ['United States of America', 'Canada', 'Mexico'],
  amazon: ['Brazil', 'Peru', 'Colombia', 'Bolivia', 'Ecuador', 'Venezuela'],
  andes: ['Chile', 'Bolivia', 'Peru'],
  patagonia: ['Argentina'],
  caribbean: ['Cuba', 'Haiti', 'Dominican Republic', 'Jamaica', 'Bahamas'],
  sahara: ['Egypt', 'Libya', 'Algeria', 'Morocco', 'Tunisia', 'Sudan', 'Mali', 'Niger', 'Chad', 'Mauritania'],
  south_africa: ['South Africa', 'Namibia', 'Botswana', 'Zimbabwe', 'Zambia', 'Mozambique'],
  australia_outback: ['Australia'],
  oceania: ['New Zealand', 'Papua New Guinea', 'Fiji', 'Solomon Islands'],
  antarctica: ['Antarctica'],
  // Off-world entries map to no Earth geography — they're rendered
  // only in the list / grid views.
  low_earth_orbit: [],
  lunar_basin: [],
  mars_north: [],
  orbital_habitat: [],
}

// Decorate with image URLs derived from the region's display color
// and stamp the region group so the client can lay out a flat map.
for (const t of TERRITORIES) {
  if (!t.imageUrl) t.imageUrl = tph(t.name, t.color)
  t.region = REGION_FOR_ID[t.id] || 'other'
  t.countries = COUNTRIES_FOR_ID[t.id] || []
}

// Pandemic event tuning.
const PANDEMIC_COOLDOWN_HANDS = 10
const PANDEMIC_DURATION_HANDS = 6
const PANDEMIC_YIELD_DROP = 0.4    // yields fall 60% during the event
const PANDEMIC_ASSET_SHOCK = 0.55  // applied to AssetEngine.marketMultiplier
const PANDEMIC_BASE_COST_PERCENT = 0.05  // 5% of total territory market cap

// Distinct hue palette for per-player territory colors. Assigned in
// claim order; the same player keeps the same color across the
// session so the flat map reads at a glance. 12 entries to handle a
// table + spectators without collisions; if more players show up we
// rotate (acceptable since 5-handed tables max out at 5 owners).
// Deterministic 5–10% per-hand yield rate keyed off a territory id.
// FNV-1a hash for a stable 32-bit value, then a uniform mapping into
// [0.05, 0.10]. Same id always yields the same rate so room state
// is reproducible across reloads.
function _yieldRateForId(id) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const u = (h % 10000) / 10000  // [0, 1)
  return 0.05 + u * 0.05         // [0.05, 0.10)
}

const PLAYER_COLOR_PALETTE = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#a855f7', // purple
  '#14b8a6', // teal
  '#fde047', // yellow
]

export class WorldEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast
    // Catalog state: a Map of stable territory entries, mutated as
    // owners + cost change. Cloned from TERRITORIES so each room has
    // its own world.
    this.catalog = new Map()
    for (const t of TERRITORIES) {
      // Per-territory yield rate. Drawn deterministically from the
      // region id so a fresh room always has the same yield-rate
      // profile, but each region varies within the 5%-10%/hand band
      // (decimal of currentCost) the user asked for. Squatting is
      // now genuinely worthwhile — a region paying 7%/hand of its
      // own cost pays back in ~14 hands.
      const yieldRate = _yieldRateForId(t.id)
      this.catalog.set(t.id, {
        ...t,
        ownerId: null,
        ownerName: null,
        currentCost: t.costBase,
        yieldRate,
        // Pending offer queue. Each entry:
        //   { id, buyerId, buyerName, price, createdAtHand }
        // The buyer's bank is debited at offer time (escrow). The
        // owner accept/decline drains or refunds the escrow.
        offers: [],
      })
    }
    this._offerSeq = 0
    // Pandemic state. activeUntil > handIndex means yields are
    // depressed and a release is in flight.
    this.pandemicActive = false
    this.pandemicActiveUntilHand = 0
    this.pandemicCooldowns = new Map()  // playerId → handIndex
    // playerId → hex color, stable across the session. Allocated
    // in-order from PLAYER_COLOR_PALETTE on the player's first
    // territory claim.
    this.playerColors = new Map()
    this._colorIndex = 0
  }

  _colorFor(playerId) {
    if (!this.playerColors.has(playerId)) {
      const color = PLAYER_COLOR_PALETTE[this._colorIndex % PLAYER_COLOR_PALETTE.length]
      this._colorIndex += 1
      this.playerColors.set(playerId, color)
    }
    return this.playerColors.get(playerId)
  }

  _findPlayer(playerId) {
    return this.room.players?.get?.(playerId) || this.room.spectators?.get?.(playerId) || null
  }

  // ─── Territory claim ───────────────────────────────────────────────────
  // 2026-05: hostile-takeover semantics are GONE. An owned territory
  // can only change hands through the offer/accept flow below. This
  // keeps regions a "real" investment — you hold yours and sell at
  // your own will, and a richer rival can't just outbid you out of
  // your bag. Empty territories still claim normally (no auction).
  claim(playerId, { territoryId } = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_claim' }
    const t = this.catalog.get(territoryId)
    if (!t) return { success: false, error: 'unknown_territory' }
    if (t.ownerId === playerId) return { success: false, error: 'already_owned' }
    if (t.ownerId) return { success: false, error: 'already_owned_by_other' }
    if ((player.bankBalance || 0) < t.currentCost) {
      return { success: false, error: 'insufficient_chips', cost: t.currentCost }
    }
    player.bankBalance -= t.currentCost
    t.ownerId = playerId
    t.ownerName = player.username
    t.ownerColor = this._colorFor(playerId)
    this._broadcastState()
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `🗺 ${player.username} claimed ${t.name}.` }
    })
    return { success: true, territoryId, cost: t.currentCost }
  }

  // ─── Offer / accept / decline for owned territories ───────────────────
  // A buyer escrows their offer from their bank. The owner reviews
  // the list and accepts (transfer + escrow → owner's bank) or
  // declines (refund escrow). Cancel from the buyer side also
  // refunds. Multiple offers from different buyers can sit on the
  // same territory at once.

  makeOffer(playerId, { territoryId, price } = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_claim' }
    const t = this.catalog.get(territoryId)
    if (!t) return { success: false, error: 'unknown_territory' }
    if (!t.ownerId) return { success: false, error: 'not_owned' }
    if (t.ownerId === playerId) return { success: false, error: 'already_owned' }
    const p = Math.floor(Number(price) || 0)
    if (!Number.isFinite(p) || p < 1) return { success: false, error: 'invalid_price' }
    if ((player.bankBalance || 0) < p) {
      return { success: false, error: 'insufficient_chips', cost: p }
    }
    // Escrow now so the buyer can't double-spend the same bank
    // money across multiple simultaneous offers. Refunded on
    // decline / cancel; transferred on accept.
    player.bankBalance -= p
    const offer = {
      id: `offer_${++this._offerSeq}`,
      buyerId: playerId,
      buyerName: player.username,
      price: p,
      createdAtHand: this.room.game?.handIndex || 0,
    }
    t.offers.push(offer)
    this._broadcastState()
    const owner = this._findPlayer(t.ownerId)
    if (owner) {
      owner.send?.({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `🗺 ${player.username} offered $${p.toLocaleString()} for ${t.name}.` }
      })
    }
    return { success: true, offerId: offer.id, territoryId, price: p }
  }

  acceptOffer(playerId, { territoryId, offerId } = {}) {
    const t = this.catalog.get(territoryId)
    if (!t) return { success: false, error: 'unknown_territory' }
    if (t.ownerId !== playerId) return { success: false, error: 'not_owner' }
    const idx = t.offers.findIndex(o => o.id === offerId)
    if (idx < 0) return { success: false, error: 'offer_not_found' }
    const offer = t.offers[idx]
    const buyer = this._findPlayer(offer.buyerId)
    const owner = this._findPlayer(playerId)
    if (!owner) return { success: false, error: 'owner_gone' }
    // Escrow → owner's bank. Transfer ownership.
    owner.bankBalance = (owner.bankBalance || 0) + offer.price
    t.ownerId = buyer ? offer.buyerId : null
    t.ownerName = buyer ? offer.buyerName : null
    t.ownerColor = buyer ? this._colorFor(offer.buyerId) : null
    t.currentCost = offer.price  // the new floor is what the new owner paid
    // Refund every OTHER pending offer (they didn't win the auction).
    const refunds = t.offers.filter(o => o.id !== offerId)
    for (const r of refunds) {
      const b = this._findPlayer(r.buyerId)
      if (b) b.bankBalance = (b.bankBalance || 0) + r.price
    }
    t.offers = []
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `🤝 ${owner.username} sold ${t.name} to ${offer.buyerName} for $${offer.price.toLocaleString()}.` }
    })
    this._broadcastState()
    return { success: true, territoryId, price: offer.price }
  }

  declineOffer(playerId, { territoryId, offerId } = {}) {
    const t = this.catalog.get(territoryId)
    if (!t) return { success: false, error: 'unknown_territory' }
    if (t.ownerId !== playerId) return { success: false, error: 'not_owner' }
    const idx = t.offers.findIndex(o => o.id === offerId)
    if (idx < 0) return { success: false, error: 'offer_not_found' }
    const offer = t.offers[idx]
    const buyer = this._findPlayer(offer.buyerId)
    if (buyer) buyer.bankBalance = (buyer.bankBalance || 0) + offer.price
    t.offers.splice(idx, 1)
    if (buyer) {
      buyer.send?.({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `🚫 ${t.ownerName} declined your $${offer.price.toLocaleString()} offer for ${t.name}.` }
      })
    }
    this._broadcastState()
    return { success: true }
  }

  cancelOffer(playerId, { territoryId, offerId } = {}) {
    const t = this.catalog.get(territoryId)
    if (!t) return { success: false, error: 'unknown_territory' }
    const idx = t.offers.findIndex(o => o.id === offerId)
    if (idx < 0) return { success: false, error: 'offer_not_found' }
    const offer = t.offers[idx]
    if (offer.buyerId !== playerId) return { success: false, error: 'not_your_offer' }
    const buyer = this._findPlayer(playerId)
    if (buyer) buyer.bankBalance = (buyer.bankBalance || 0) + offer.price
    t.offers.splice(idx, 1)
    this._broadcastState()
    return { success: true }
  }

  // ─── Pandemic release ──────────────────────────────────────────────────
  releasePandemic(playerId, { handIndex } = {}) {
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_release' }
    if (this.pandemicActive) return { success: false, error: 'already_active' }
    const lastUsed = this.pandemicCooldowns.get(playerId)
    if (typeof lastUsed === 'number' && (handIndex - lastUsed) < PANDEMIC_COOLDOWN_HANDS) {
      return { success: false, error: 'cooldown', cooldownRemaining: PANDEMIC_COOLDOWN_HANDS - (handIndex - lastUsed) }
    }
    // Cost scales with the total tracked-territory market value so
    // wealthy players can afford it but it's not a free button at
    // the start of a session.
    const total = [...this.catalog.values()].reduce((s, t) => s + (t.currentCost || 0), 0)
    const cost = Math.max(100_000, Math.floor(total * PANDEMIC_BASE_COST_PERCENT))
    if ((player.bankBalance || 0) < cost) return { success: false, error: 'insufficient_chips', cost }
    player.bankBalance -= cost
    this.pandemicActive = true
    this.pandemicActiveUntilHand = handIndex + PANDEMIC_DURATION_HANDS
    this.pandemicCooldowns.set(playerId, handIndex)
    // Knock-on effects: cascades into BOTH real-estate AND the stock
    // market. Real-estate gets a market-multiplier shock (recovers
    // gradually over ~17 hands); stocks take a direct ~22% drop with
    // a 30s sabotage-style hold so the chart shows the crash candle.
    // Crypto isn't touched by pandemic — the meme-coin market is
    // chaos in both directions anyway.
    try { this.room.assetEngine?.applyMarketShock(PANDEMIC_ASSET_SHOCK) } catch {}
    try { this.room.stockEngine?.applyMarketShock(0.22) } catch {}
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `☣️ ${player.username} released a global pandemic. World yields collapse for ${PANDEMIC_DURATION_HANDS} hands.` }
    })
    this._broadcastState()
    return { success: true, cost, durationHands: PANDEMIC_DURATION_HANDS }
  }

  // ─── Hand-end ──────────────────────────────────────────────────────────
  onHandEnd(handIndex) {
    if (this.pandemicActive && handIndex >= this.pandemicActiveUntilHand) {
      this.pandemicActive = false
      this.pandemicActiveUntilHand = 0
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: '🌍 Pandemic has subsided. World yields return to normal.' }
      })
    }
    // Pay yields to each territory owner. Per the 2026-05 retune,
    // the yield is a DECIMAL of the territory's currentCost (its
    // per-region yieldRate sits in [5%, 10%]), so a region pays back
    // on the order of 10-20 hands of squatting. Yields land in the
    // BANK wallet — world income is off-table money like every other
    // passive source.
    const yieldMul = this.pandemicActive ? PANDEMIC_YIELD_DROP : 1.0
    const payouts = new Map()
    for (const t of this.catalog.values()) {
      if (!t.ownerId) continue
      const owner = this._findPlayer(t.ownerId)
      if (!owner) continue
      const rate = typeof t.yieldRate === 'number' ? t.yieldRate : 0.07
      const paid = Math.floor((t.currentCost || 0) * rate * yieldMul)
      owner.bankBalance = (owner.bankBalance || 0) + paid
      payouts.set(t.ownerId, (payouts.get(t.ownerId) || 0) + paid)
    }
    for (const [pid, total] of payouts) {
      const p = this._findPlayer(pid)
      if (!p || total <= 0) continue
      p.send?.({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `🌍 Territory yields: +$${total.toLocaleString()}` }
      })
    }
    this._broadcastState()
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────
  buildSnapshot(playerId) {
    return {
      territories: [...this.catalog.values()].map(t => {
        const isMine = t.ownerId === playerId
        // Offers visible to:
        //   - the owner (so they can accept/decline)
        //   - the buyer who submitted each one (so they can cancel)
        // Other viewers see just the offer count (a hint that this
        // region is being courted) but not individual prices.
        const visibleOffers = (t.offers || []).filter(o =>
          isMine || o.buyerId === playerId
        )
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          // yieldRate is exposed so the client can render "+5.6%/hand"
          // labels alongside the dollar yield estimate.
          yieldRate: t.yieldRate || 0.07,
          // The dollar yield this region would pay THIS hand at the
          // current pandemic multiplier; kept on the wire to match
          // the old `yieldBase` field name the client UI reads.
          yieldBase: Math.floor((t.currentCost || 0) * (t.yieldRate || 0.07)),
          currentCost: t.currentCost,
          ownerId: t.ownerId,
          ownerName: t.ownerName,
          ownerColor: t.ownerColor || null,
          region: t.region || 'other',
          isMine,
          imageUrl: t.imageUrl || null,
          countries: Array.isArray(t.countries) ? t.countries : [],
          // Offer queue — only owner / buyer see the full row, but
          // every viewer sees the count so they know if a region is
          // already being negotiated.
          offers: visibleOffers,
          offerCount: (t.offers || []).length,
        }
      }),
      myColor: this.playerColors.get(playerId) || null,
      pandemicActive: this.pandemicActive,
      pandemicEndsInHands: this.pandemicActive
        ? Math.max(0, this.pandemicActiveUntilHand - (this.room.game?.handIndex || 0))
        : 0,
      yieldMultiplier: this.pandemicActive ? PANDEMIC_YIELD_DROP : 1.0,
    }
  }

  _broadcastState() {
    const seats = this.room.players?.values?.() || []
    for (const p of seats) {
      if (p.isBot || !p.isConnected) continue
      p.send({ type: 'world:state', data: this.buildSnapshot(p.id) })
    }
    const specs = this.room.spectators?.values?.() || []
    for (const s of specs) {
      if (!s.isConnected) continue
      s.send({ type: 'world:state', data: this.buildSnapshot(s.id) })
    }
  }

  sendSnapshotTo(player) {
    if (!player || player.isBot) return
    player.send({ type: 'world:state', data: this.buildSnapshot(player.id) })
  }

  handlePlayerLeave(playerId) {
    // Release any territories owned by the leaving player. Cost
    // resets to costBase so the slot is reasonably accessible to
    // whoever picks it up next. We DON'T release the color from the
    // palette — if the player rejoins (reconnect) they get the same
    // hue, which is the friendlier behavior.
    let released = false
    for (const t of this.catalog.values()) {
      if (t.ownerId === playerId) {
        t.ownerId = null
        t.ownerName = null
        t.ownerColor = null
        t.currentCost = t.costBase
        released = true
      }
    }
    this.pandemicCooldowns.delete(playerId)
    if (released) this._broadcastState()
  }
}

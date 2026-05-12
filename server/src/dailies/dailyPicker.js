// Deterministic daily picker. The same daily fires for everyone in the
// world on a given UTC date — and we don't need a cron job to "decide"
// it, because the date itself is the seed. Today's pick is a pure
// function of today's date, computable on demand by both the server (when
// scoring hands) and the client (when rendering the tool panel — though
// the client just reads what the server tells it via /api/dailies/today).
//
// `dateKey` is the canonical UTC YYYY-MM-DD string. Using UTC avoids a
// player in Tokyo "rolling over" their daily 17 hours before a player in
// LA — the rollover is at midnight UTC for everyone.

import { DAILY_CATALOG, DAILY_BY_ID } from './dailyCatalog.js'

export function todayDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

// FNV-1a 32-bit. Stable across Node versions, no deps. Just enough avalanche
// for picking one item out of ~100 without obvious patterns (Mondays don't
// always get the easy ones, etc.).
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function pickDailyForDate(dateKey) {
  if (!DAILY_CATALOG.length) return null
  const idx = fnv1a(dateKey) % DAILY_CATALOG.length
  return DAILY_CATALOG[idx]
}

export function getTodayDaily() {
  return pickDailyForDate(todayDateKey())
}

export function dailyById(id) {
  return DAILY_BY_ID[id] || null
}

import jwt from 'jsonwebtoken'
import { LRUCache } from 'lru-cache'

const ISSUER = 'gambling-web-ui'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short (need >= 32 chars). See server/.env.example.')
  }
  return secret
}

export function sign(payload) {
  const ttl = Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 24 * 30)
  return jwt.sign(payload, getSecret(), { expiresIn: ttl, issuer: ISSUER })
}

// Verification cache. Every authenticated HTTP request hits this; jsonwebtoken
// does ~0.1-0.5ms of HMAC work per call which adds up across hundreds of
// requests per minute. The lru-cache package handles eviction + TTL natively
// (replacing a hand-rolled Map) — same external behavior, less code, fewer
// edge cases (TTL-aware get, atomic size enforcement).
const _verifyCache = new LRUCache({
  max: 1024,
  ttl: 5 * 60 * 1000,            // 5-minute upper bound
  ttlAutopurge: false,           // we let lookups lazily evict; cheaper
  updateAgeOnGet: false,         // strict TTL — don't extend on read
})

export function verify(token) {
  const cached = _verifyCache.get(token)
  if (cached) return cached

  const payload = jwt.verify(token, getSecret(), { issuer: ISSUER })

  // Cache the verified payload until the earlier of (a) the cache TTL or
  // (b) the token's actual `exp` claim — never serve a payload past its
  // real expiration via cache.
  const cacheTtl = _verifyCache.ttl
  const tokenTtlMs = typeof payload.exp === 'number'
    ? Math.max(0, payload.exp * 1000 - Date.now())
    : cacheTtl
  _verifyCache.set(token, payload, { ttl: Math.min(cacheTtl, tokenTtlMs) })
  return payload
}

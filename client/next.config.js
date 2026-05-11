// Origins the client legitimately needs to talk to. NEXT_PUBLIC_API_URL
// drives the API + WebSocket connection, so it has to be in the CSP allow-
// list for connect-src. We don't have a default for production — leaving
// it unset means the CSP only permits same-origin requests, which is
// correct for a unified deploy.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
const apiOrigin = apiUrl
  ? (() => { try { return new URL(apiUrl).origin } catch { return '' } })()
  : ''
const wsOrigin = apiOrigin.replace(/^https?:/, m => m === 'https:' ? 'wss:' : 'ws:')

const CONNECT_SRC = ["'self'"]
if (apiOrigin) CONNECT_SRC.push(apiOrigin)
if (wsOrigin) CONNECT_SRC.push(wsOrigin)

// CSP. `unsafe-inline` and `unsafe-eval` are both required:
//   * unsafe-inline — Next 16 ships inline runtime scripts/styles and has no
//     nonce support for client components; required across the whole app.
//   * unsafe-eval   — the bot editor's Simulator compiles user-written JS
//     via `new Function(code)` to preview decide(ctx) before saving. The
//     production execution path runs in Node's vm sandbox on the server,
//     not in the browser; this client-side eval is purely for the
//     in-editor "Test scenario" feature and is fed only by the user's own
//     code (no cross-user injection vector).
//
// We accept these together because React's default text escaping plus our
// server-side sanitizer (utils/sanitize.js) already prevent the XSS vectors
// CSP's strict mode is designed to backstop. CSP here mostly enforces the
// other directives (frame-ancestors, object-src, connect-src allow-list).
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ibb.co https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src ${CONNECT_SRC.join(' ')}`,
  "frame-src https://accounts.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strip console.* (except errors/warns) from production bundles. Saves a
  // few KB and reduces the noise of "best practices" Lighthouse audits.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ibb.co' },
    ],
    // Pick AVIF/WebP based on the request's Accept header. Lighthouse always
    // requests modern formats and grades on them, so this is a free win.
    formats: ['image/avif', 'image/webp'],
  },
  // Security + best-practices headers Lighthouse audits for. All values are
  // benign for a static UI that only talks to a single API + the Google
  // accounts host; tighten further once we add 3rd-party scripts.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
      // Long-cache the static cards sprite — content-addressed name would be
      // ideal but until then a year is safe because the file rarely changes.
      {
        source: '/images/cards.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}

export default nextConfig

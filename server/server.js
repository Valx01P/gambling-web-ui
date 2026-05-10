import express from 'express'
import cookieParser from 'cookie-parser'
import { WebSocketServer } from './src/network/WebSocketServer.js'
import { apiRouter } from './src/api/index.js'
import { runMigrations } from './src/db/migrate.js'
import { closePool, query as dbQuery } from './src/db/pool.js'

const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '256kb' }))
app.use(cookieParser())

// Diagnostic-friendly /health. Always returns 200 (so Render's "service is
// alive" check passes) but the body reports whether the DB is reachable.
// Hit this from a browser to see what's misconfigured without digging
// through logs.
app.get('/health', async (_req, res) => {
  const db = { configured: Boolean(process.env.DATABASE_URL), reachable: null, error: null }
  if (db.configured) {
    try {
      await dbQuery('SELECT 1')
      db.reachable = true
    } catch (err) {
      db.reachable = false
      db.error = err.message || String(err)
    }
  }
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    db,
    corsOrigins: allowedOrigins,
    googleClientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    jwtSecretConfigured: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
  })
})

app.use('/api', apiRouter())

// 404 for unknown API routes — returns JSON so the client can read it,
// instead of falling through and getting an HTML response from somewhere.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }))

// Last-line error middleware. Reached when a route handler `next(err)`s or
// when express-async-errors (loaded by routers) catches an async rejection.
// Without this every async throw stalls the connection and Render's edge
// times out → 502 to the client.
app.use((err, _req, res, _next) => {
  console.error('[api] unhandled:', err)
  if (res.headersSent) return
  // Surface 503 for DB-shaped failures so the operator can tell at a glance.
  const isDb = /database_url|connect e\w+|pg|relation .* does not exist/i.test(err?.message || '')
  res.status(isDb ? 503 : 500).json({
    error: isDb ? 'database_unavailable' : 'internal_error',
    detail: process.env.NODE_ENV === 'production' ? undefined : (err?.message || String(err))
  })
})

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations()
    } catch (err) {
      console.error('[db] migrations failed at boot:', err.message)
      // Surface but don't crash — the WS poker game still works without DB.
      // Bot endpoints will 500 until migrations succeed.
    }
  } else {
    console.warn('[db] DATABASE_URL not set; bot endpoints will fail. See server/.env.example.')
  }

  const server = app.listen(PORT, () => {
    // Log everything an operator might want to see in the first scroll of
    // their Render dashboard. CORS_ORIGINS is the #1 thing people forget
    // when deploying — surfaced here so it's visible at boot.
    console.log(`[server] listening on port ${PORT}`)
    console.log(`[server] CORS_ORIGINS = ${allowedOrigins.join(', ') || '(none)'}`)
    console.log(`[server] DATABASE_URL ${process.env.DATABASE_URL ? 'set' : 'NOT SET — bot endpoints will 503'}`)
    console.log(`[server] JWT_SECRET ${(process.env.JWT_SECRET?.length || 0) >= 32 ? 'set' : 'NOT SET — auth will fail'}`)
    console.log(`[server] GOOGLE_CLIENT_ID ${process.env.GOOGLE_CLIENT_ID ? 'set' : 'NOT SET — sign-in will fail'}`)
  })

  const wss = new WebSocketServer(server)

  const shutdown = async () => {
    wss.close()
    server.close(async () => {
      await closePool().catch(() => {})
      process.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

start().catch(err => {
  console.error('[server] failed to start:', err)
  process.exit(1)
})

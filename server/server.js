import express from 'express'
import cookieParser from 'cookie-parser'
import { WebSocketServer } from './src/network/WebSocketServer.js'
import { apiRouter } from './src/api/index.js'
import { runMigrations } from './src/db/migrate.js'
import { closePool } from './src/db/pool.js'

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

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/api', apiRouter())

app.use((err, _req, res, _next) => {
  console.error('[api] unhandled:', err)
  res.status(500).json({ error: 'internal_error' })
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
    console.log(`Server running on port ${PORT}`)
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

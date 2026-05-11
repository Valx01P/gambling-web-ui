import pg from 'pg'

const { Pool } = pg

let pool = null

export function getPool() {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See server/.env.example.')
  }

  const sslEnabled = (process.env.DATABASE_SSL ?? 'true').toLowerCase() !== 'false'

  pool = new Pool({
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DATABASE_POOL_MAX) || 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Server-side guards. statement_timeout kills runaway queries before they
    // tie up a connection; idle_in_transaction_session_timeout reclaims pool
    // slots if app code forgets to COMMIT/ROLLBACK after an error.
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 5_000,
    idle_in_transaction_session_timeout: 10_000,
    keepAlive: true
  })

  pool.on('error', err => {
    console.error('[db] idle client error:', err.message)
  })

  return pool
}

export async function query(text, params) {
  return getPool().query(text, params)
}

export async function withTransaction(fn) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getPool } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function ensureMigrationsTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function appliedSet() {
  const { rows } = await getPool().query('SELECT filename FROM schema_migrations')
  return new Set(rows.map(r => r.filename))
}

// Postgres advisory-lock key — any constant works as long as every replica
// uses the same one. Random 64-bit number stamped here so two boot-time
// `runMigrations()` calls (e.g. blue/green deploy) serialize instead of
// racing each other on the same migration files.
const MIGRATION_LOCK_KEY = 8472619503271845n

export async function runMigrations() {
  await ensureMigrationsTable()

  // Grab a session-level advisory lock for the whole migration sweep. If
  // another instance is already migrating, this blocks until they're done —
  // we then re-check `applied` and skip everything they ran.
  const client = await getPool().connect()
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY.toString()])

    const { rows } = await client.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map(r => r.filename))

    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      }
      console.log(`[db] applied migration ${file}`)
      count++
    }

    if (count === 0) console.log('[db] schema up to date')
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY.toString()]).catch(() => {})
    client.release()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[db] migration failed:', err)
      process.exit(1)
    })
}

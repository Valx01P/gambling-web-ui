import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getPool, withTransaction } from './pool.js'

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

export async function runMigrations() {
  await ensureMigrationsTable()
  const applied = await appliedSet()

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  let count = 0
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    await withTransaction(async client => {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
    })
    console.log(`[db] applied migration ${file}`)
    count++
  }

  if (count === 0) console.log('[db] schema up to date')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[db] migration failed:', err)
      process.exit(1)
    })
}

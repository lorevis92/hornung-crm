// One-time copy of Hornung's data from the Supabase database into Neon
// (db/copyData.js does the work; test/copy-data.test.js shows what it does).
//
//   SUPABASE_DB_URL=postgresql://...supabase.com:5432/postgres \
//   DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require \
//     node scripts/copy-data-from-supabase.mjs --yes
//
// Order: `npm run db:migrate` on the empty Neon database first, then this.
// It EMPTIES the copied Neon tables before filling them, so it can be
// re-run (e.g. a rehearsal, then the real cut-over) — hence --yes.
// Reads the Supabase database only (selects). Both connection strings come
// from the environment and are never printed or written anywhere.
import { Client, neonConfig } from '@neondatabase/serverless'
import pg from 'pg'
import { copyData } from '../db/copyData.js'

const { SUPABASE_DB_URL, DATABASE_URL } = process.env
if (!SUPABASE_DB_URL || !DATABASE_URL) {
  console.error('Set SUPABASE_DB_URL (Supabase -> Project Settings -> Database -> connection string, session mode) and DATABASE_URL (Neon).')
  process.exit(1)
}
if (!process.argv.includes('--yes')) {
  console.error('This empties the Hornung tables in the Neon database (DATABASE_URL) and refills them from Supabase. Re-run with --yes.')
  process.exit(1)
}
if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket

const source = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
const target = new Client(DATABASE_URL)
await source.connect()
await target.connect()
try {
  // Read-only on the Supabase side, whatever happens.
  await source.query('set session characteristics as transaction read only')
  const result = await copyData({
    source: { query: (sql, params) => source.query(sql, params) },
    target: { query: (sql, params) => target.query(sql, params), exec: (sql) => target.query(sql) },
    log: (line) => console.log(line)
  })
  if (result.mismatches.length) {
    console.error('Row counts differ for:', result.mismatches)
    process.exitCode = 1
  } else {
    console.log(`Done: ${result.tables.length} tables, every row count matches.`)
  }
} finally {
  await source.end()
  await target.end()
}

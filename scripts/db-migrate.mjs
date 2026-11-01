// npm run db:migrate [-- <mode>] — migrates the Neon database (DATABASE_URL
// from the environment; never written to a file by this script).
//
//   (no mode)              applies every pending migration of db/migrations
//                          (the Supabase stand-ins first, when 01–52 are
//                          still pending) — a new, empty Neon database ends
//                          up exactly like the tests' Postgres
//   --status               lists applied / pending migrations, changes nothing
//
// Data from Supabase is copied with scripts/copy-data-from-supabase.mjs
// AFTER this has run on the empty Neon database (see
// docs/MIGRAZIONE-CLOUDFLARE.md).
//
// Uses the driver's WebSocket client (one session, multi-statement SQL);
// the Worker itself uses the HTTP one.
import { Client, neonConfig } from '@neondatabase/serverless'
import { migrate, migrationFiles } from '../db/migrate.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Neon console -> your project -> Connect -> connection string (owner role).')
  process.exit(1)
}
if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket

const client = new Client(url)
await client.connect()
try {
  const exec = (sql) => client.query(sql)
  const query = (sql, params) => client.query(sql, params)
  if (process.argv.includes('--status')) {
    await exec('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await query('select name from public.schema_migrations', [])).rows.map((r) => r.name))
    for (const name of migrationFiles()) console.log(`${done.has(name) ? 'applied' : 'PENDING'}  ${name}`)
  } else {
    const applied = await migrate({ exec, query, log: (name) => console.log(`applying ${name}`) })
    console.log(applied.length ? `${applied.length} migration(s) applied.` : 'Nothing to apply: the database is up to date.')
  }
} finally {
  await client.end()
}

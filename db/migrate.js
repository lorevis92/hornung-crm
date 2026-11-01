// Applies db/migrations/*.sql to a plain Postgres, in order, once each
// (table public.schema_migrations). Shared by scripts/db-migrate.mjs (Neon),
// scripts/local-neon.mjs (local development) and the tests (PGlite), so
// all three run exactly the same SQL.
//
// The migrations were written for Supabase. Two things make them apply
// unchanged on Neon:
//   * db/supabase-compat.sql, run first, creates the few Supabase objects
//     they reference (roles, auth.users, auth.uid(), storage.*, net.*) —
//     empty stand-ins that migration 53 removes again;
//   * the only statement Neon refuses outright, `create extension pg_net`
//     (the extension doesn't exist there), is skipped — see prepareMigration.
import { readdirSync, readFileSync } from 'node:fs'

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url)
const COMPAT_FILE = new URL('./supabase-compat.sql', import.meta.url)
// The migration that removes the stand-ins: once it is applied, the
// compatibility layer must never be re-created.
export const LEAVE_SUPABASE_MIGRATION = '20260101000053_leave_supabase.sql'

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
}

export function readMigration(name) {
  return prepareMigration(readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8'))
}

export function prepareMigration(sql) {
  return sql.replace(
    /^\s*create extension if not exists pg_net;\s*$/gim,
    '-- (skipped by db/migrate.js: no pg_net on Neon — see db/supabase-compat.sql)'
  )
}

/**
 * exec(sql): runs a multi-statement SQL text (simple query protocol).
 * query(sql, params): returns { rows }.
 * Returns the names of the migrations applied by this call.
 */
export async function migrate({ exec, query, log = () => {}, until = null }) {
  await exec(`create table if not exists public.schema_migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  )`)
  const { rows } = await query('select name from public.schema_migrations', [])
  const done = new Set(rows.map((r) => r.name))
  // until (tests only): stop after that migration, e.g. to build a
  // Supabase-like database at migration 52.
  const pending = migrationFiles().filter((name) => !done.has(name) && (!until || name <= until))
  if (!pending.length) return []

  if (!done.has(LEAVE_SUPABASE_MIGRATION) && pending.some((name) => name < LEAVE_SUPABASE_MIGRATION)) {
    log('supabase-compat.sql')
    await exec(readFileSync(COMPAT_FILE, 'utf8'))
  }

  const applied = []
  for (const name of pending) {
    log(name)
    const escaped = name.replace(/'/g, "''")
    await exec(`begin;\n${readMigration(name)}\n;insert into public.schema_migrations (name) values ('${escaped}');\ncommit;`)
    applied.push(name)
  }
  return applied
}

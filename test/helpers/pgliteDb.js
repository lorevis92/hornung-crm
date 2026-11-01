// A real Postgres for the tests: PGlite (Postgres 17 compiled to wasm, in
// process), with every migration of db/migrations applied through
// db/migrate.js — the same runner that migrates Neon. Queries go through
// the same api/_db.js builder the Worker uses with Neon; values are
// returned in the same text form Neon's HTTP endpoint sends and parsed by
// the same parsers, so a test here sees what the app sees in production.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { migrate } from '../../db/migrate.js'
import { createDb, parserFor, TYPE_PARSERS } from '../../api/_db.js'

// Postgres text form of a parameter, as the pg/neon drivers send it.
export function toPgText(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return `{${value
      .map((v) => (v === null || v === undefined ? 'NULL' : `"${String(toPgText(v)).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`))
      .join(',')}}`
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Every type the parsers know, returned as text and then parsed like Neon.
const RAW_OIDS = [...Object.keys(TYPE_PARSERS).map(Number), 1009, 1015, 2951, 1007, 1016, 1231, 1182, 1185]
const PARSERS = Object.fromEntries(RAW_OIDS.map((oid) => [oid, (text) => parserFor(oid)(text)]))

export async function createPgliteDb({ until = null } = {}) {
  const pg = await PGlite.create({ extensions: { pgcrypto } })
  await pg.exec("set timezone to 'UTC'")
  const query = async (text, params = []) => {
    const result = await pg.query(text, params.map(toPgText), { parsers: PARSERS })
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  }
  const applied = await migrate({ exec: (sql) => pg.exec(sql), query, until })
  const db = createDb({ query })
  return { pg, db, query, exec: (sql) => pg.exec(sql), applied }
}

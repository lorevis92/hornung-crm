// A local stand-in for Neon, for `npm run dev:worker` and the end-to-end
// check (scripts/e2e-worker.mjs): a real Postgres (PGlite, persisted in
// .local-db/) behind the same HTTP "SQL over fetch" protocol Neon's
// serverless driver speaks — so the Worker runs with the real driver, the
// real query builder and every migration, without a Neon account.
//
//   node scripts/local-neon.mjs [--port 4444] [--fresh]
//
// Point the driver at it with NEON_FETCH_ENDPOINT=http://127.0.0.1:4444/sql
// (scripts/dev-worker.mjs does). Local development only: no authentication.
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { migrate } from '../db/migrate.js'

export async function startLocalNeon({ port = 4444, dataDir = '.local-db', fresh = false, log = console.log } = {}) {
  if (fresh) rmSync(dataDir, { recursive: true, force: true })
  const pg = await PGlite.create({ dataDir, extensions: { pgcrypto } })
  await pg.exec("set timezone to 'UTC'")

  // Every value back as Postgres text, like Neon's endpoint sends it (the
  // driver parses it): an identity parser for every type there is.
  const { rows: types } = await pg.query('select oid::int as oid from pg_type')
  const raw = Object.fromEntries(types.map(({ oid }) => [oid, (text) => text]))

  const run = async (q, { query, params = [] }) => {
    const result = await q.query(query, params, { rowMode: 'array', parsers: raw })
    const command = (query.trim().match(/^\w+/)?.[0] || '').toUpperCase()
    return {
      command,
      rowCount: result.affectedRows ?? result.rows.length,
      fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rows: result.rows,
      rowAsArray: true
    }
  }

  const applied = await migrate({
    exec: (sql) => pg.exec(sql),
    query: async (text, params) => ({ rows: (await pg.query(text, params)).rows }),
    log: (name) => log(`[local-neon] migration ${name}`)
  })
  log(`[local-neon] ${applied.length} migration(s) applied`)

  // One request at a time, like a single connection.
  let chain = Promise.resolve()
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      chain = chain.then(async () => {
        let payload
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          const result = Array.isArray(payload.queries)
            ? { results: await pg.transaction(async (tx) => {
              const out = []
              for (const q of payload.queries) out.push(await run(tx, q))
              return out
            }) }
            : await run(pg, payload)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, hint: error.hint }))
        }
      })
    })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  log(`[local-neon] Postgres (PGlite) on http://127.0.0.1:${port}/sql`)
  return {
    pg,
    url: `http://127.0.0.1:${port}/sql`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
      await pg.close()
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('local-neon.mjs')) {
  const portArg = process.argv.indexOf('--port')
  await startLocalNeon({
    port: portArg > 0 ? Number(process.argv[portArg + 1]) : 4444,
    fresh: process.argv.includes('--fresh')
  })
}

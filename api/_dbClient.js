// The service client the server code works with: database (Neon, through
// api/_db.js) + file storage (R2, through api/_storage.js), in the shape
// the code was written against with supabase-js.
//
// Tests replace this module (vi.mock('../api/_dbClient.js')) with an
// in-memory database (test/helpers/fakeSupabase.js) or a real Postgres
// (test/helpers/pgliteDb.js).
import { neon, neonConfig } from '@neondatabase/serverless'
import { createDb, neonExecutor } from './_db.js'
import { storageClient } from './_storage.js'

// One per isolate (and connection string): the driver is stateless (one
// HTTPS request per statement), the db keeps its column-type cache.
let cached = null

export function createServiceClient(databaseUrl) {
  if (cached?.url === databaseUrl) return cached.client
  // Local development only: `npm run dev:worker` points the driver at the
  // Neon-compatible endpoint of scripts/local-neon.mjs instead of Neon.
  if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT
  const db = createDb(neonExecutor(neon(databaseUrl)))
  cached = { url: databaseUrl, client: { from: db.from, rpc: db.rpc, storage: storageClient() } }
  return cached.client
}

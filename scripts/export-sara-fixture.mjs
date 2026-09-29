// One-off (but re-runnable) export: pulls the Sara Bianchi client's real,
// specialist-reviewed data out of production and writes it to
// test/fixtures/sara-bianchi-2025.json — the second "golden case" fixture,
// alongside Weber, exercising the row-based extraction model (see
// src/lib/rowBasedFields.js) on its real multi-row documents (multiple bank
// accounts, multiple insurance premiums for different people, multiple
// securities positions). Shared implementation:
// scripts/export-client-fixture.mjs.
//
// Reads every credential from the environment — never hardcode a URL, key,
// email or password here, and never commit a version of this file that does.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SPECIALIST_EMAIL=... SPECIALIST_PASSWORD=... \
//     node scripts/export-sara-fixture.mjs
import { exportClientFixture } from './export-client-fixture.mjs'

exportClientFixture({
  clientEmail: 'sarabianchi@gmail.com',
  taxYear: 2025,
  outFile: new URL('../test/fixtures/sara-bianchi-2025.json', import.meta.url)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})

// One-off (but re-runnable) export: pulls the Weber client's real,
// specialist-reviewed data out of production and writes it to
// test/fixtures/weber-2025.json — the "golden case" fixture the regression
// suite (test/weber-calculation.test.js) runs computeTaxAggregate() against
// directly, with no live database or AI call involved in the tests
// themselves. Shared implementation: scripts/export-client-fixture.mjs.
//
// Reads every credential from the environment — never hardcode a URL, key,
// email or password here, and never commit a version of this file that does.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SPECIALIST_EMAIL=... SPECIALIST_PASSWORD=... \
//     node scripts/export-weber-fixture.mjs
import { exportClientFixture } from './export-client-fixture.mjs'

exportClientFixture({
  clientEmail: 'giuliaweber@gmail.com',
  taxYear: 2025,
  outFile: new URL('../test/fixtures/weber-2025.json', import.meta.url)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})

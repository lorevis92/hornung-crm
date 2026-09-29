// Client-side mirror of the "cases: client insert own" RLS policy
// (supabase/migrations/20260101000041_client_created_tax_year.sql) — a pure
// function with no I/O, so the exact same rule can be asserted in tests
// without a live database, and demo mode (which has no RLS at all) still
// enforces the identical rule instead of silently allowing more than the
// real backend would. The database is still the real gate (see the
// migration) — this exists so a bug shows up here first, and so demo mode
// isn't more permissive than production.
import { currentTaxYear } from './config'

// requestedClientId/sessionClientId: the client_id the caller is trying to
//   create a case for, and the client_id of the currently signed-in client
//   — mirrors `client_id = my_client_id()` in the RLS policy. Always equal
//   when the call comes from the client's own UI; only a defensive check.
// taxYear: the year being requested.
// existingYears: tax_year values of this client's current cases.
export function validateClientCaseCreation({ requestedClientId, sessionClientId, taxYear, existingYears }) {
  if (requestedClientId !== sessionClientId) return { ok: false, reason: 'FORBIDDEN_CLIENT' }
  const year = Number(taxYear)
  if (!Number.isInteger(year)) return { ok: false, reason: 'INVALID_YEAR' }
  // Same bound as the RLS policy (calendar year, not the app's own
  // currentTaxYear() — which is usually one year earlier, "the year being
  // filed for" — so this is a generous ceiling, never stricter than what
  // the picker below actually offers).
  if (year > new Date().getFullYear()) return { ok: false, reason: 'FUTURE_YEAR' }
  if ((existingYears || []).map(Number).includes(year)) return { ok: false, reason: 'YEAR_EXISTS' }
  return { ok: true }
}

// The years a client is offered to pick from when adding their own tax
// year — up to (and including) the current filing year, the same "sensible"
// range the consultant's own picker uses, just never a future one.
export function selectableClientTaxYears(count = 6) {
  const max = currentTaxYear()
  return Array.from({ length: count }, (_, i) => max - i)
}

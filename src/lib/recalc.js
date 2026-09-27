import { api } from './data'

// The tax calculation is pure arithmetic over data already in the database
// (no AI/external call) — cheap enough that it never needs to be a manual
// step. Called silently after anything that could change its result: a
// field confirmed/edited, included/excluded from the calculation, or a
// document deleted — from wherever that mutation happens (TaxSummary,
// DocumentVerificationPanel, CasePage's document list). Errors are logged,
// not surfaced — a background refresh shouldn't interrupt whatever the
// user was actually doing; the manual "Recalculate" button on the tax
// summary still works as a fallback.
export async function recalculateInBackground(clientId, taxYear, lang) {
  if (!clientId || !taxYear) return null
  try {
    return await api.calculateAggregates(clientId, taxYear, lang)
  } catch (error) {
    console.error('[recalculateInBackground]', error)
    return null
  }
}

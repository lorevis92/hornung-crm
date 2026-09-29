// Regression tests for the client-side mirror of the "cases: client insert
// own" RLS policy (supabase/migrations/20260101000041_client_created_tax_year.sql)
// — src/lib/caseCreation.js's validateClientCaseCreation enforces the exact
// same rule, so demo mode (no real RLS) can't silently allow more than the
// real backend would, and so the rule is testable without a live database.
// The DB itself remains the real gate for the "another client" case — this
// test documents the same check this app performs before ever reaching it.
import { describe, expect, it } from 'vitest'
import { validateClientCaseCreation } from '../src/lib/caseCreation.js'

const THIS_YEAR = new Date().getFullYear()

describe('validateClientCaseCreation', () => {
  it('succeeds for a valid, non-duplicate, non-future year on the caller\'s own client', () => {
    const result = validateClientCaseCreation({
      requestedClientId: 'client-1',
      sessionClientId: 'client-1',
      taxYear: THIS_YEAR - 1,
      existingYears: [THIS_YEAR - 2]
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a duplicate year', () => {
    const result = validateClientCaseCreation({
      requestedClientId: 'client-1',
      sessionClientId: 'client-1',
      taxYear: THIS_YEAR - 1,
      existingYears: [THIS_YEAR - 1, THIS_YEAR - 2]
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('YEAR_EXISTS')
  })

  it('rejects a future year', () => {
    const result = validateClientCaseCreation({
      requestedClientId: 'client-1',
      sessionClientId: 'client-1',
      taxYear: THIS_YEAR + 1,
      existingYears: []
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('FUTURE_YEAR')
  })

  it('rejects an attempt to create a case for a different client', () => {
    const result = validateClientCaseCreation({
      requestedClientId: 'client-1',
      sessionClientId: 'client-2',
      taxYear: THIS_YEAR - 1,
      existingYears: []
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('FORBIDDEN_CLIENT')
  })
})

// resolveAggregateStatus is the single shared rule for whether an aggregate
// can honestly be called "ready_for_simulation" (see src/lib/taxCalculation.js,
// used by both api/_recalc.js and src/lib/data/demo.js). Covered directly
// here with synthetic inputs so the rule can't silently drift out of sync
// with either call site again.
import { describe, expect, it } from 'vitest'
import { resolveAggregateStatus } from '../src/lib/taxCalculation.js'

describe('resolveAggregateStatus', () => {
  it('is draft while a document is still uploaded/extracting, even with no components at all', () => {
    expect(resolveAggregateStatus({ documentsStillProcessing: true, components: [] })).toBe('draft')
  })

  it('is ready_for_simulation once extraction is done and nothing needs verification', () => {
    const components = [
      { needsVerification: false, amount: 1000 },
      { needsVerification: false, amount: 0 }
    ]
    expect(resolveAggregateStatus({ documentsStillProcessing: false, components })).toBe('ready_for_simulation')
  })

  it('is draft while a component needing verification carries a real, nonzero amount', () => {
    const components = [{ needsVerification: true, amount: 1240 }]
    expect(resolveAggregateStatus({ documentsStillProcessing: false, components })).toBe('draft')
  })

  it('a needs-verification component with amount 0 does not block readiness on its own', () => {
    const components = [{ needsVerification: true, amount: 0 }]
    expect(resolveAggregateStatus({ documentsStillProcessing: false, components })).toBe('ready_for_simulation')
  })

  it('reads snake_case DB row shape (needs_verification) just as well as the camelCase pure-function shape', () => {
    const components = [{ needs_verification: true, amount: 500 }]
    expect(resolveAggregateStatus({ documentsStillProcessing: false, components })).toBe('draft')
  })

  it('documentsStillProcessing overrides an otherwise-clean set of components', () => {
    const components = [{ needsVerification: false, amount: 1000 }]
    expect(resolveAggregateStatus({ documentsStillProcessing: true, components })).toBe('draft')
  })
})

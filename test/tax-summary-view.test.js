// Regression test for Tax Summary's source-document "back" navigation —
// see src/lib/taxSummaryView.js and src/pages/TaxSummary.jsx's
// viewSource/backToList. Driving the source view from a URL query param
// (?view=source) rather than bare component state is what lets the
// browser's own back button return to the Tax Summary list instead of
// skipping past it to whatever page was open before Tax Summary — this
// test covers the pure decision function that makes that safe.
import { describe, expect, it } from 'vitest'
import { resolveTaxSummaryView } from '../src/lib/taxSummaryView.js'

describe('resolveTaxSummaryView', () => {
  it('shows the source view when the URL asks for it and a field is loaded', () => {
    expect(resolveTaxSummaryView('source', true)).toBe('source')
  })

  it('shows the list when the URL has no view param at all', () => {
    expect(resolveTaxSummaryView(null, true)).toBe('list')
    expect(resolveTaxSummaryView(undefined, true)).toBe('list')
  })

  it('shows the list for any other/unrecognized view param', () => {
    expect(resolveTaxSummaryView('something-else', true)).toBe('list')
  })

  it('falls back to the list even with ?view=source if no source field is actually loaded — a stale link or hard refresh must never render a broken viewer', () => {
    expect(resolveTaxSummaryView('source', false)).toBe('list')
  })
})

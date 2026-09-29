// Regression tests for the fee estimator and the price-list display helpers
// (src/lib/pricing.js) — pricing_items became staff-editable this round
// (see supabase/migrations/20260101000040_pricing_items_editable.sql), but
// estimateFee still matches specific, fixed codes (base_single, property,
// ...), and "further services" (kind: 'service') never feed into the total
// at all — a specialist adding/editing/removing one must never change a
// client's fee estimate.
import { describe, expect, it } from 'vitest'
import { estimateFee, pricingDescription, pricingLabel } from '../src/lib/pricing.js'

const PRICING_ITEMS = [
  { code: 'base_single', kind: 'base', price: 240, label_en: 'Single' },
  { code: 'base_married', kind: 'base', price: 320, label_en: 'Married' },
  { code: 'property', kind: 'per_unit', price: 80, label_en: 'Per property' },
  { code: 'svc_retirement', kind: 'service', price: 0, on_request: true, label_en: 'Retirement planning', description_en: 'Long-term retirement planning.' }
]

describe('estimateFee', () => {
  it('picks the married base fee when a spouse is present', () => {
    const result = estimateFee(PRICING_ITEMS, { persons: [{ person_type: 'primary' }, { person_type: 'spouse', first_name: 'Marc' }] })
    expect(result.isMarried).toBe(true)
    expect(result.lines.find((l) => l.code === 'base_married')?.amount).toBe(320)
  })

  it('never includes a "service" (further services) row in the total, however it is edited', () => {
    const result = estimateFee(PRICING_ITEMS, { persons: [{ person_type: 'primary' }], properties: [{ address: 'Rue X 1' }] })
    expect(result.lines.some((l) => l.code === 'svc_retirement')).toBe(false)
    // Single (240) + one property (80).
    expect(result.total).toBe(320)
  })

  it('adding a brand-new pricing_items row never breaks the estimate — unmatched codes are simply ignored', () => {
    const withExtra = [...PRICING_ITEMS, { code: 'svc_new_thing', kind: 'service', price: 0, on_request: true, label_en: 'Something new' }]
    const result = estimateFee(withExtra, { persons: [{ person_type: 'primary' }] })
    expect(result.total).toBe(240)
  })
})

describe('pricingLabel / pricingDescription', () => {
  it('falls back to English when the requested language has no translation', () => {
    const item = { label_en: 'Trading', description_en: 'Active trading review.' }
    expect(pricingLabel(item, 'fr')).toBe('Trading')
    expect(pricingDescription(item, 'fr')).toBe('Active trading review.')
  })

  it('uses the requested language when present', () => {
    const item = { label_en: 'Trading', label_it: 'Trading (IT)', description_it: 'Descrizione IT' }
    expect(pricingLabel(item, 'it')).toBe('Trading (IT)')
    expect(pricingDescription(item, 'it')).toBe('Descrizione IT')
  })

  it('returns an empty description rather than a placeholder when none was ever set', () => {
    const item = { label_en: 'Trading' }
    expect(pricingDescription(item, 'en')).toBe('')
  })
})

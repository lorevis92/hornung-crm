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

// The consultant's own edits to a case's estimate (migration 47). The
// automatic calculation underneath never stops running — these are stored
// as the difference from it, so a case whose Questionnaire changes still
// tracks it — and all three inputs are optional, so a case nobody has
// touched behaves exactly as it did before they existed.
describe("estimateFee — the consultant's edits", () => {
  const MARRIED_WITH_PROPERTY = {
    persons: [{ person_type: 'primary', marital_status: 'married' }],
    properties: [{ address: 'Rue X 1' }, { address: 'Via Y 2' }]
  }

  it('leaves the estimate exactly as it was when nothing has been edited', () => {
    const result = estimateFee(PRICING_ITEMS, MARRIED_WITH_PROPERTY)
    // Married (320) + two properties (160).
    expect(result.total).toBe(480)
    expect(result.computedTotal).toBe(480)
    expect(result.isOverridden).toBe(false)
    expect(result.lines.every((l) => l.excluded === false && l.source === 'auto')).toBe(true)
  })

  it('recalculates from the selected items when a derived line is switched off', () => {
    const result = estimateFee(PRICING_ITEMS, {
      ...MARRIED_WITH_PROPERTY,
      excludedCodes: ['property']
    })
    expect(result.total).toBe(320)
    // Still listed, so the consultant can see what was waived rather than
    // wondering why the total dropped.
    const property = result.lines.find((l) => l.code === 'property')
    expect(property).toBeTruthy()
    expect(property.excluded).toBe(true)
    expect(property.amount).toBe(160)
  })

  it('counts an item the consultant added although nothing in the Questionnaire implies it', () => {
    const withPaidService = [
      ...PRICING_ITEMS,
      { code: 'svc_paid', kind: 'service', price: 150, label_en: 'Paid service' }
    ]
    const result = estimateFee(withPaidService, {
      persons: [{ person_type: 'primary' }],
      extraCodes: ['svc_paid']
    })
    expect(result.total).toBe(390)
    const added = result.lines.find((l) => l.code === 'svc_paid')
    expect(added.source).toBe('extra')
    expect(added.qty).toBe(1)
  })

  it('shows a price-on-request service that was added, without pretending it is worth nothing', () => {
    const result = estimateFee(PRICING_ITEMS, {
      persons: [{ person_type: 'primary' }],
      extraCodes: ['svc_retirement']
    })
    const added = result.lines.find((l) => l.code === 'svc_retirement')
    expect(added.onRequest).toBe(true)
    // It is on the estimate, and it adds nothing to the total.
    expect(result.total).toBe(240)
  })

  it('ignores an added code that no longer exists in the price list', () => {
    const result = estimateFee(PRICING_ITEMS, {
      persons: [{ person_type: 'primary' }],
      extraCodes: ['svc_deleted_last_year']
    })
    expect(result.lines.some((l) => l.code === 'svc_deleted_last_year')).toBe(false)
    expect(result.total).toBe(240)
  })

  it('never double-counts an item that the Questionnaire already produced', () => {
    const result = estimateFee(PRICING_ITEMS, {
      ...MARRIED_WITH_PROPERTY,
      extraCodes: ['property']
    })
    expect(result.lines.filter((l) => l.code === 'property')).toHaveLength(1)
    expect(result.total).toBe(480)
  })

  it('accepts a manual total that wins over the calculated one, and keeps the calculated one visible', () => {
    const result = estimateFee(PRICING_ITEMS, {
      ...MARRIED_WITH_PROPERTY,
      totalOverride: 600
    })
    expect(result.isOverridden).toBe(true)
    expect(result.total).toBe(600)
    // The number it replaced is still reported — an override that hid it
    // would be worse than no override at all.
    expect(result.computedTotal).toBe(480)
  })

  it('treats a cleared override as "use the calculated total" again', () => {
    for (const cleared of [null, undefined, '']) {
      const result = estimateFee(PRICING_ITEMS, { ...MARRIED_WITH_PROPERTY, totalOverride: cleared })
      expect(result.isOverridden).toBe(false)
      expect(result.total).toBe(480)
    }
  })

  it('accepts an override of zero — a case being done for free is a real decision, not a cleared field', () => {
    const result = estimateFee(PRICING_ITEMS, { ...MARRIED_WITH_PROPERTY, totalOverride: 0 })
    expect(result.isOverridden).toBe(true)
    expect(result.total).toBe(0)
    expect(result.computedTotal).toBe(480)
  })

  it('keeps the override when the selected items change — it is a decision, not a snapshot', () => {
    const before = estimateFee(PRICING_ITEMS, { ...MARRIED_WITH_PROPERTY, totalOverride: 600 })
    const after = estimateFee(PRICING_ITEMS, {
      ...MARRIED_WITH_PROPERTY,
      excludedCodes: ['property'],
      totalOverride: 600
    })
    expect(after.total).toBe(before.total)
    // Only the number underneath moved.
    expect(after.computedTotal).toBe(320)
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

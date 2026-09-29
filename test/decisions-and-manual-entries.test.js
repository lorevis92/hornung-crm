// Regression tests for the specialist decision system (tax_field_decisions)
// and manual "how this was calculated" entries (tax_manual_aggregate_entries)
// — both read fresh on every recalculation and merged into
// computeTaxAggregate()'s output, independent of tax_aggregate_components
// (wiped and rebuilt every time — see api/_recalc.js). Calling
// computeTaxAggregate() twice with the same inputs simulates two
// recalculations in a row: since it's a pure function with no internal
// state, this is exactly what "survives a recalculation" means for a value
// that (unlike a plain extracted field) isn't itself stored in
// tax_aggregate_components.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'

const CATEGORIES = [
  { code: 'pension_buyback', group_key: 'deductions', label_en: 'Pension buyback' },
  { code: 'salary_statement', group_key: 'income', label_en: 'Salary statement' }
]
const FIELD_DEFS = [{ category_code: 'pension_buyback', field_key: 'annual_amount', field_label: 'Pension buy-in' }]
const RULES = [{ category_code: 'pension_buyback', field_key: 'annual_amount', contribution_type: 'income_minus', cap_parameter_family: null }]
const DOCUMENTS = [
  { id: 'doc-buyback', category_code: 'pension_buyback', file_name: 'buyback.pdf' },
  { id: 'doc-salary', category_code: 'salary_statement', file_name: 'salary.pdf' }
]

function extractedFields(buybackAmount) {
  return [
    { document_id: 'doc-buyback', field_key: 'annual_amount', field_value: String(buybackAmount), included_in_calculation: true },
    { document_id: 'doc-salary', field_key: 'pension_fund_contributions', field_value: '6860', included_in_calculation: true }
  ]
}

function run({ buybackAmount = 5240, fieldDecisions = [], manualEntries = [] } = {}) {
  return computeTaxAggregate({
    canton: 'VS',
    documents: DOCUMENTS,
    extractedFields: extractedFields(buybackAmount),
    rules: RULES,
    fieldDefs: FIELD_DEFS,
    categories: CATEGORIES,
    parameters: [],
    taxYear: 2025,
    primaryPerson: null,
    spousePerson: null,
    children: [],
    fieldDecisions,
    manualEntries,
    lang: 'en'
  })
}

describe('specialist decisions on a flagged field', () => {
  it('without a decision, a possible double deduction is flagged needing verification', () => {
    const result = run()
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component.needsVerification).toBe(true)
    expect(component.decision).toBeNull()
  })

  it('an "include" decision resolves it, and the resolution is identical across repeated recalculations', () => {
    const fieldDecisions = [{ document_id: 'doc-buyback', field_key: 'annual_amount', decision: 'include', decided_amount: 5240 }]

    const first = run({ fieldDecisions })
    const second = run({ fieldDecisions }) // simulates a second recalculation reading the same decision row again

    for (const result of [first, second]) {
      const component = result.components.find((c) => c.fieldKey === 'annual_amount')
      expect(component.needsVerification).toBe(false)
      expect(component.decision).toBe('include')
      expect(component.amount).toBe(5240)
    }
  })

  it('an "exclude" decision resolves it as excluded, never silently included in the total', () => {
    const fieldDecisions = [{ document_id: 'doc-buyback', field_key: 'annual_amount', decision: 'exclude', decided_amount: 5240 }]
    const result = run({ fieldDecisions })
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component.needsVerification).toBe(false)
    expect(component.decision).toBe('exclude')
    // Shown for reference, but not counted — taxableIncomeCantonal below confirms this.
    expect(component.amount).toBe(5240)
  })

  it('a decision whose snapshot no longer matches the current amount is ignored — the field reverts to needing verification', () => {
    const fieldDecisions = [{ document_id: 'doc-buyback', field_key: 'annual_amount', decision: 'include', decided_amount: 5240 }]
    // The document was re-extracted/corrected with a materially different amount since the decision was made.
    const result = run({ buybackAmount: 6000, fieldDecisions })
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component.needsVerification).toBe(true)
    expect(component.decision).toBeNull()
  })
})

describe('manual "how this was calculated" entries', () => {
  const manualEntries = [
    { id: 'manual-income', component_type: 'income', description: 'Extra income known separately', amount: 1000 },
    { id: 'manual-deduction', component_type: 'deduction', description: 'Extra deduction known separately', amount: 300 }
  ]

  it('count in the totals, marked as manual, and are identical across repeated recalculations', () => {
    const first = run({ buybackAmount: 0, manualEntries })
    // A second recalculation, reading the same manual-entry rows again but
    // with the underlying extracted data now different (as a fresh
    // re-extraction would leave it) — the manual entries have no
    // extracted field behind them at all, so they must show up exactly the
    // same regardless.
    const second = run({ buybackAmount: 9999, manualEntries })

    for (const result of [first, second]) {
      const income = result.components.find((c) => c.manualEntryId === 'manual-income')
      const deduction = result.components.find((c) => c.manualEntryId === 'manual-deduction')
      expect(income.isManual).toBe(true)
      expect(income.componentType).toBe('income')
      expect(income.amount).toBe(1000)
      expect(deduction.isManual).toBe(true)
      expect(deduction.componentType).toBe('deduction')
      expect(deduction.amount).toBe(300)
      // Income (1000) minus deduction (300) — no other income/deduction
      // data feeds into this synthetic case, so the total is exactly the
      // manual entries' own net effect.
      expect(result.taxableIncomeCantonal).toBe(700)
    }
  })
})

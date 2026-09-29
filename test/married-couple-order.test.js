// Proves the two independent halves of "married couple" handling never leak
// into each other:
//  - src/lib/personOrder.js decides which of the two appears FIRST
//    (husband-first) — a pure presentation concern.
//  - src/lib/taxCalculation.js decides the TOTALS (income/wealth summed
//    across both spouses, married brackets/exemptions, the two-income
//    deduction) — gender and display order never feed into it at all.
// Built on the Weber golden fixture (test/fixtures/weber-2025.json): Giulia
// is `primary`, Marc is `spouse` in the database, but Marc is the husband —
// this is exactly the case the husband-first rule exists for.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'
import { resolvePersonDisplayOrder } from '../src/lib/personOrder.js'
import fixture from './fixtures/weber-2025.json' with { type: 'json' }

function runWeber(overrides = {}) {
  return computeTaxAggregate({
    canton: fixture.client.canton,
    documents: fixture.documents,
    extractedFields: fixture.extractedFields,
    rules: fixture.rules,
    fieldDefs: fixture.fieldDefs,
    categories: fixture.categories,
    parameters: fixture.parameters,
    taxYear: fixture.taxYear,
    primaryPerson: fixture.primaryPerson,
    spousePerson: fixture.spousePerson,
    children: fixture.children,
    lang: 'en',
    ...overrides
  })
}

describe('Weber 2025 — Marc (husband) shown before Giulia (wife), same totals as always', () => {
  it('resolves the display order to Marc first once gender is known', () => {
    const primaryWithGender = { ...fixture.primaryPerson, gender: 'female' } // Giulia
    const spouseWithGender = { ...fixture.spousePerson, gender: 'male' } // Marc
    const order = resolvePersonDisplayOrder({
      primaryPerson: primaryWithGender,
      spousePerson: spouseWithGender,
      overrideOrder: null
    })
    expect(order.needsVerification).toBe(false)
    expect(order.ordered.map((o) => o.kind)).toEqual(['spouse', 'primary'])
    expect(order.ordered[0].person.first_name).toBe('Marc')
    expect(order.ordered[1].person.first_name).toBe('Giulia')
  })

  it('the calculation totals are byte-for-byte identical whether or not gender/display order is known', () => {
    const withoutGender = runWeber()
    const withGender = runWeber({
      primaryPerson: { ...fixture.primaryPerson, gender: 'female' },
      spousePerson: { ...fixture.spousePerson, gender: 'male' }
    })
    expect(withGender.taxableIncomeCantonal).toBe(withoutGender.taxableIncomeCantonal)
    expect(withGender.taxableWealthCantonal).toBe(withoutGender.taxableWealthCantonal)
    expect(withGender.taxableIncomeFederal).toBe(withoutGender.taxableIncomeFederal)
    expect(withGender.components).toEqual(withoutGender.components)
  })
})

describe('the federal two-income deduction is never silently zero when both spouses appear employed', () => {
  const categories = [{ code: 'salary_statement', group_key: 'income', label_en: 'Salary statement' }]
  const rules = [{ category_code: 'salary_statement', field_key: 'net_salary', contribution_type: 'income_plus', cap_parameter_family: null }]
  const documents = [
    { id: 'doc-salary-1', category_code: 'salary_statement', file_name: 'salary-1.pdf' },
    { id: 'doc-salary-2', category_code: 'salary_statement', file_name: 'salary-2.pdf' }
  ]
  const extractedFields = [
    { document_id: 'doc-salary-1', field_key: 'net_salary', field_value: '80000', included_in_calculation: true },
    { document_id: 'doc-salary-2', field_key: 'net_salary', field_value: '60000', included_in_calculation: true }
  ]
  const primaryPerson = { marital_status: 'married', work_percentage: 100 }
  const spousePerson = { work_percentage: 80 }

  function runCouple(parameters) {
    return computeTaxAggregate({
      canton: 'VS',
      documents,
      extractedFields,
      rules,
      fieldDefs: [],
      categories,
      parameters,
      taxYear: 2025,
      primaryPerson,
      spousePerson,
      children: [],
      lang: 'en'
    })
  }

  it('is flagged "needs verification" with a real, visible amount when the parameter IS configured — never silently absent', () => {
    const parameters = [
      { id: 'p1', scope: 'federal', canton_code: null, parameter_family: 'two_income_deduction_min', value_numeric: 8600, value_type: 'fixed_amount', notes: null }
    ]
    const result = runCouple(parameters)
    const entry = result.components.find((c) => c.fieldLabel?.includes('two-income'))
    expect(entry).toBeTruthy()
    expect(entry.needsVerification).toBe(true)
    expect(entry.amount).toBe(8600)
  })

  it('is STILL flagged (not silently zero) when the parameter is missing entirely', () => {
    const result = runCouple([])
    const entry = result.components.find((c) => c.fieldLabel?.includes('two-income'))
    expect(entry).toBeTruthy()
    expect(entry.needsVerification).toBe(true)
    expect(entry.amount).toBe(0)
  })

  it('is never raised at all when only one spouse appears employed', () => {
    const result = computeTaxAggregate({
      canton: 'VS',
      documents,
      extractedFields,
      rules,
      fieldDefs: [],
      categories,
      parameters: [],
      taxYear: 2025,
      primaryPerson,
      spousePerson: { work_percentage: 0 },
      children: [],
      lang: 'en'
    })
    expect(result.components.some((c) => c.fieldLabel?.includes('two-income'))).toBe(false)
  })
})

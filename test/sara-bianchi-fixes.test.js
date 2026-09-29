// Regression tests for real bugs found while live-testing the Sara Bianchi
// case (divorced, one child, a rented chalet) on the deployed app:
//  - an amount extracted with the currency written into the same string
//    ("CHF 15'000.00") was silently dropped instead of parsed;
//  - alimony received from an ex-spouse never appeared anywhere (in the
//    totals or as "needs verification") once the amount actually parsed;
//  - alimony received for a still-unconfirmed-minor child beneficiary
//    needs a specialist's confirmation, not a silent default;
//  - an imputed rental value and an actual rental income both present
//    across a client's property documents are mutually exclusive ways of
//    taxing the same real estate and must never both be silently counted;
//  - pillar 3a contributions had no cap at all wired up, despite the
//    federal "with LPP" / "without LPP" parameters already existing.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'

const CATEGORIES = [
  { code: 'alimony_received', group_key: 'income', label_en: 'Alimony received' },
  { code: 'property_tax_value', group_key: 'property', label_en: 'Property tax value statement' },
  { code: 'pillar_3a_certificate', group_key: 'deductions', label_en: 'Pillar 3a certificate' },
  { code: 'salary_statement', group_key: 'income', label_en: 'Salary statement' },
  { code: 'self_employed_income_statement', group_key: 'income', label_en: 'Self-employment income statement' }
]
const FIELD_DEFS = [
  { category_code: 'alimony_received', field_key: 'annual_amount', field_label: 'Annual amount' },
  { category_code: 'property_tax_value', field_key: 'imputed_rental_value', field_label: 'Imputed rental value' },
  { category_code: 'property_tax_value', field_key: 'annual_rental_income', field_label: 'Annual rental income received' },
  { category_code: 'pillar_3a_certificate', field_key: 'annual_contribution', field_label: 'Annual contribution' }
]
const RULES = [
  { category_code: 'alimony_received', field_key: 'annual_amount', contribution_type: 'income_plus', cap_parameter_family: null },
  { category_code: 'property_tax_value', field_key: 'imputed_rental_value', contribution_type: 'income_plus', cap_parameter_family: null },
  { category_code: 'property_tax_value', field_key: 'annual_rental_income', contribution_type: 'income_plus', cap_parameter_family: null },
  { category_code: 'pillar_3a_certificate', field_key: 'annual_contribution', contribution_type: 'income_minus', cap_parameter_family: 'pillar_3a_dynamic' }
]
const PARAMETERS = [
  { id: 'p1', scope: 'federal', canton_code: null, parameter_family: 'pillar_3a_with_lpp', value_numeric: 7258, value_type: 'fixed_amount', notes: null },
  { id: 'p2', scope: 'federal', canton_code: null, parameter_family: 'pillar_3a_without_lpp', value_numeric: 36288, value_type: 'formula', notes: null }
]

function run(overrides = {}) {
  return computeTaxAggregate({
    canton: 'VS',
    documents: [],
    extractedFields: [],
    rules: RULES,
    fieldDefs: FIELD_DEFS,
    categories: CATEGORIES,
    parameters: PARAMETERS,
    taxYear: 2025,
    primaryPerson: { marital_status: 'divorced' },
    spousePerson: null,
    children: [],
    lang: 'en',
    ...overrides
  })
}

describe('parseAmount handles a currency code inlined in the value', () => {
  it('an alimony amount extracted as "CHF 15 000.00" is parsed and counted, not silently dropped', () => {
    const documents = [{ id: 'doc-alimony', category_code: 'alimony_received', file_name: 'alimony.pdf' }]
    const extractedFields = [
      { document_id: 'doc-alimony', field_key: 'annual_amount', field_value: 'CHF 15 000.00', included_in_calculation: true },
      { document_id: 'doc-alimony', field_key: 'beneficiary_type', field_value: 'ex-spouse', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields })
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component).toBeTruthy()
    expect(component.needsVerification).toBe(false)
    expect(component.amount).toBe(15000)
  })
})

describe('alimony received', () => {
  const baseDocs = [{ id: 'doc-alimony', category_code: 'alimony_received', file_name: 'alimony.pdf' }]

  it('to an ex-spouse counts as ordinary taxable income, no verification needed', () => {
    const extractedFields = [
      { document_id: 'doc-alimony', field_key: 'annual_amount', field_value: '15000', included_in_calculation: true },
      { document_id: 'doc-alimony', field_key: 'beneficiary_type', field_value: 'ex-spouse', included_in_calculation: true }
    ]
    const result = run({ documents: baseDocs, extractedFields })
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component.needsVerification).toBe(false)
    expect(component.amount).toBe(15000)
  })

  it('for a child beneficiary with no stated minor status is flagged for verification, never assumed either way', () => {
    const extractedFields = [
      { document_id: 'doc-alimony', field_key: 'annual_amount', field_value: '9000', included_in_calculation: true },
      { document_id: 'doc-alimony', field_key: 'beneficiary_type', field_value: 'figli', included_in_calculation: true }
    ]
    const result = run({ documents: baseDocs, extractedFields })
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component.needsVerification).toBe(true)
  })

  it('for a child beneficiary confirmed no longer a minor is excluded (not taxable)', () => {
    const extractedFields = [
      { document_id: 'doc-alimony', field_key: 'annual_amount', field_value: '9000', included_in_calculation: true },
      { document_id: 'doc-alimony', field_key: 'beneficiary_type', field_value: 'figli', included_in_calculation: true },
      { document_id: 'doc-alimony', field_key: 'beneficiary_is_minor', field_value: 'no', included_in_calculation: true }
    ]
    const result = run({ documents: baseDocs, extractedFields })
    const component = result.components.find((c) => c.fieldKey === 'annual_amount')
    expect(component.needsVerification).toBe(true)
  })
})

describe('imputed rental value vs. actual rental income', () => {
  it('both present across a client\'s property documents are both flagged, never both silently counted', () => {
    const documents = [
      { id: 'doc-tax-value', category_code: 'property_tax_value', file_name: 'tax-value.pdf' },
      { id: 'doc-rental', category_code: 'property_tax_value', file_name: 'rental-statement.pdf' }
    ]
    const extractedFields = [
      { document_id: 'doc-tax-value', field_key: 'imputed_rental_value', field_value: '9600', included_in_calculation: true },
      { document_id: 'doc-rental', field_key: 'annual_rental_income', field_value: '11400', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields })
    const imputed = result.components.find((c) => c.fieldKey === 'imputed_rental_value')
    const actual = result.components.find((c) => c.fieldKey === 'annual_rental_income')
    expect(imputed.needsVerification).toBe(true)
    expect(actual.needsVerification).toBe(true)
  })

  it('an imputed rental value alone (no rental income anywhere) is not flagged by this check', () => {
    const documents = [{ id: 'doc-tax-value', category_code: 'property_tax_value', file_name: 'tax-value.pdf' }]
    const extractedFields = [
      { document_id: 'doc-tax-value', field_key: 'imputed_rental_value', field_value: '9600', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields })
    const imputed = result.components.find((c) => c.fieldKey === 'imputed_rental_value')
    expect(imputed.needsVerification).toBe(false)
    expect(imputed.amount).toBe(9600)
  })
})

describe('pillar 3a dynamic cap (with/without occupational pension fund)', () => {
  it('is capped at the "with LPP" federal limit when a salary statement shows pension fund contributions', () => {
    const documents = [
      { id: 'doc-3a', category_code: 'pillar_3a_certificate', file_name: '3a.pdf' },
      { id: 'doc-salary', category_code: 'salary_statement', file_name: 'salary.pdf' }
    ]
    const extractedFields = [
      { document_id: 'doc-3a', field_key: 'annual_contribution', field_value: '8000', included_in_calculation: true },
      { document_id: 'doc-salary', field_key: 'pension_fund_contributions', field_value: '5900', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields })
    const component = result.components.find((c) => c.fieldKey === 'annual_contribution')
    expect(component.needsVerification).toBe(false)
    expect(component.amount).toBe(7258) // capped, 8000 > 7258
  })

  it('uncapped when the contribution is already under the "with LPP" limit', () => {
    const documents = [
      { id: 'doc-3a', category_code: 'pillar_3a_certificate', file_name: '3a.pdf' },
      { id: 'doc-salary', category_code: 'salary_statement', file_name: 'salary.pdf' }
    ]
    const extractedFields = [
      { document_id: 'doc-3a', field_key: 'annual_contribution', field_value: '7000', included_in_calculation: true },
      { document_id: 'doc-salary', field_key: 'pension_fund_contributions', field_value: '5900', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields })
    const component = result.components.find((c) => c.fieldKey === 'annual_contribution')
    expect(component.amount).toBe(7000)
  })

  it('is capped at 20% of self-employment net profit (never just the flat federal ceiling) with no occupational pension fund', () => {
    const documents = [
      { id: 'doc-3a', category_code: 'pillar_3a_certificate', file_name: '3a.pdf' },
      { id: 'doc-self', category_code: 'self_employed_income_statement', file_name: 'self-employed.pdf' }
    ]
    const extractedFields = [
      { document_id: 'doc-3a', field_key: 'annual_contribution', field_value: '10000', included_in_calculation: true },
      { document_id: 'doc-self', field_key: 'net_profit', field_value: '13590', included_in_calculation: true }
    ]
    const ruleWithNetProfit = [...RULES, { category_code: 'self_employed_income_statement', field_key: 'net_profit', contribution_type: 'income_plus', cap_parameter_family: null }]
    const result = run({ documents, extractedFields, rules: ruleWithNetProfit })
    const component = result.components.find((c) => c.fieldKey === 'annual_contribution')
    expect(component.amount).toBe(2718) // min(36288, 13590 * 0.2) = 2718
  })
})

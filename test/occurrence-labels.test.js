// Regression tests for replacing bare "#N" occurrence markers with a
// meaningful, row-derived label (account holder/IBAN, insured person +
// basic/supplementary cover, whose medical expense, whose 3a policy) — and
// for the per-person insurance-premium cap split this enables. See
// src/lib/rowBasedFields.js (ROW_IDENTITY_FIELDS) and
// src/lib/taxCalculation.js's buildOccurrenceIdentifier/identifierByDocId
// and the insurance-pooling rewrite.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'

const PRIMARY_PERSON = { first_name: 'Sara', last_name: 'Bianchi', marital_status: 'divorced' }
const CHILD = { id: 'child-1', full_name: 'Matteo Bianchi', date_of_birth: '2015-05-23' }

const CATEGORIES = [
  { code: 'bank_securities_crypto_statement', group_key: 'assets', label_en: 'Bank statement' },
  { code: 'health_insurance_policy', group_key: 'deductions', label_en: 'Health insurance' },
  { code: 'medical_costs', group_key: 'deductions', label_en: 'Medical costs' },
  { code: 'pillar_3a_certificate', group_key: 'deductions', label_en: 'Pillar 3a' }
]
const FIELD_DEFS = []
const PARAMETERS = [
  { id: 'p1', scope: 'cantonal', canton_code: 'VS', parameter_family: 'insurance_premium_cap_single', value_numeric: 3620, value_type: 'fixed_amount', notes: null },
  { id: 'p2', scope: 'cantonal', canton_code: 'VS', parameter_family: 'insurance_premium_child_increment', value_numeric: 1130, value_type: 'fixed_amount', notes: null },
  { id: 'p3', scope: 'cantonal', canton_code: 'VS', parameter_family: 'medical_costs_threshold_pct', value_numeric: 5, value_type: 'percentage', notes: null }
]

function run({ documents, extractedFields, rules, parameters = PARAMETERS, children = [CHILD] }) {
  return computeTaxAggregate({
    canton: 'VS',
    documents,
    extractedFields,
    rules,
    fieldDefs: FIELD_DEFS,
    categories: CATEGORIES,
    parameters,
    taxYear: 2025,
    primaryPerson: PRIMARY_PERSON,
    spousePerson: null,
    children,
    lang: 'en'
  })
}

// Finds a component by field_key AND row_key — field_key alone is no longer
// unique once a category can have more than one row (see rowBasedFields.js).
function find(components, fieldKey, rowKey) {
  return components.find((c) => c.fieldKey === fieldKey && c.rowKey === rowKey)
}

describe('bank account labels replace "#N"', () => {
  const documents = [{ id: 'doc-bank', category_code: 'bank_securities_crypto_statement', file_name: 'bank.pdf' }]
  const rules = [
    { category_code: 'bank_securities_crypto_statement', field_key: 'account_balance_31_12', contribution_type: 'wealth_plus', cap_parameter_family: null }
  ]

  it('uses the account holder name and masked IBAN when both are extracted', () => {
    const extractedFields = [
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000', included_in_calculation: true },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_balance_31_12', field_value: '5000', included_in_calculation: true },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_holder_name', field_value: 'Matteo Bianchi', included_in_calculation: true },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_iban', field_value: 'CH1234567890123456789', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const first = find(result.components, 'account_balance_31_12', 'row-1')
    const second = find(result.components, 'account_balance_31_12', 'row-2')
    expect(first.needsVerification).toBe(false)
    expect(first.fieldLabel).toContain('Sara Bianchi')
    expect(first.fieldLabel).not.toMatch(/#\d/)
    expect(second.needsVerification).toBe(false)
    // Canonicalized against the registry (child), plus the masked IBAN.
    expect(second.fieldLabel).toContain('Matteo Bianchi')
    expect(second.fieldLabel).toContain('CH12…6789')
    expect(second.fieldLabel).not.toMatch(/#\d/)
  })

  it('never falls back to a bare "#2" — an unidentified repeated account is flagged instead', () => {
    const extractedFields = [
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000', included_in_calculation: true },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_balance_31_12', field_value: '5000', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const second = find(result.components, 'account_balance_31_12', 'row-2')
    expect(second.needsVerification).toBe(true)
    expect(second.fieldLabel).not.toMatch(/#\d/)
    expect(second.fieldLabel.toLowerCase()).toContain('unidentified')
  })

  it('a single, non-repeated account is unaffected (no identifier needed, never flagged)', () => {
    const extractedFields = [
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const only = find(result.components, 'account_balance_31_12', 'row-1')
    expect(only.needsVerification).toBe(false)
  })
})

describe('health insurance premiums — per-person label, basic vs. supplementary, and per-person cap', () => {
  const documents = [{ id: 'doc-ins', category_code: 'health_insurance_policy', file_name: 'insurance.pdf' }]
  const rules = [
    { category_code: 'health_insurance_policy', field_key: 'annual_premium', contribution_type: 'income_minus', cap_parameter_family: 'insurance_premium_pool' }
  ]

  it('labels each premium with the insured person and basic/supplementary cover instead of "#N"', () => {
    const extractedFields = [
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'annual_premium', field_value: '2000', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'insured_person_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'policy_type', field_value: 'LAMal', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-2', field_key: 'annual_premium', field_value: '500', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-2', field_key: 'insured_person_name', field_value: 'Matteo Bianchi', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-2', field_key: 'policy_type', field_value: 'LCA', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const adult = find(result.components, 'annual_premium', 'row-1')
    const child = find(result.components, 'annual_premium', 'row-2')
    expect(adult.fieldLabel).toContain('Sara Bianchi')
    expect(adult.fieldLabel).toContain('LAMal/KVG')
    expect(adult.fieldLabel).not.toMatch(/#\d/)
    expect(child.fieldLabel).toContain('Matteo Bianchi')
    expect(child.fieldLabel).toContain('LCA/VVG')
    expect(child.fieldLabel).not.toMatch(/#\d/)
  })

  it('applies the cap per person (adult vs. child) instead of one generic pooled cap', () => {
    // Adult premium (2000) alone is under the single cap (3620) -> uncapped.
    // Child premium (2000) alone is over the child increment (1130) -> capped at 1130.
    // A single combined pool (3620 + 1130 = 4750) would NOT have capped
    // either individually (2000+2000=4000 < 4750) — this proves the split
    // is real, not just a relabeling.
    const extractedFields = [
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'annual_premium', field_value: '2000', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'insured_person_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-2', field_key: 'annual_premium', field_value: '2000', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-2', field_key: 'insured_person_name', field_value: 'Matteo Bianchi', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const adult = find(result.components, 'annual_premium', 'row-1')
    const child = find(result.components, 'annual_premium', 'row-2')
    expect(adult.amount).toBe(2000)
    expect(adult.needsVerification).toBe(false)
    expect(child.amount).toBe(1130)
    expect(child.needsVerification).toBe(false)
  })

  it('falls back to the original combined household pool when no premium states an insured person at all', () => {
    const extractedFields = [
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'annual_premium', field_value: '2000', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-2', field_key: 'annual_premium', field_value: '2000', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const first = find(result.components, 'annual_premium', 'row-1')
    const second = find(result.components, 'annual_premium', 'row-2')
    // Combined pool: single (3620) + 1 child (1130) = 4750 cap over 4000 raw -> uncapped.
    expect(first.amount).toBe(2000)
    expect(second.amount).toBe(2000)
  })

  it('a premium for a person not found in the registry is held for verification, never pooled blindly', () => {
    const extractedFields = [
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'annual_premium', field_value: '2000', included_in_calculation: true },
      { document_id: 'doc-ins', row_key: 'row-1', field_key: 'insured_person_name', field_value: 'Someone Else', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const entry = find(result.components, 'annual_premium', 'row-1')
    expect(entry.needsVerification).toBe(true)
  })
})

describe('medical costs — per-person label, and the threshold pooled once (not per person)', () => {
  const documents = [{ id: 'doc-med', category_code: 'medical_costs', file_name: 'medical.pdf' }]
  const rules = [
    { category_code: 'medical_costs', field_key: 'total_amount', contribution_type: 'income_minus', cap_parameter_family: 'medical_costs_threshold_pct' }
  ]

  it('labels each expense with whose it is instead of "#N"', () => {
    const extractedFields = [
      { document_id: 'doc-med', row_key: 'row-1', field_key: 'total_amount', field_value: '1000', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-1', field_key: 'person_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-2', field_key: 'total_amount', field_value: '500', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-2', field_key: 'person_name', field_value: 'Matteo Bianchi', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const first = find(result.components, 'total_amount', 'row-1')
    const second = find(result.components, 'total_amount', 'row-2')
    expect(first.fieldLabel).toContain('Sara Bianchi')
    expect(second.fieldLabel).toContain('Matteo Bianchi')
    expect(first.fieldLabel).not.toMatch(/#\d/)
    expect(second.fieldLabel).not.toMatch(/#\d/)
  })

  it('applies the deduction threshold once to the combined total, not separately to each person', () => {
    // Two entries of 1000 each = 2000 combined. incomeAfterGeneralDeductions
    // ends up being just this deduction category itself (no other income
    // fed in), so provisionalIncome is 0 and the threshold is 0 too —
    // instead, prove the pooling with a threshold-driving income source.
    const documents2 = [
      ...documents,
      { id: 'doc-salary', category_code: 'salary_statement', file_name: 'salary.pdf' }
    ]
    const rules2 = [
      ...rules,
      { category_code: 'salary_statement', field_key: 'net_salary', contribution_type: 'income_plus', cap_parameter_family: null }
    ]
    const extractedFields = [
      { document_id: 'doc-salary', field_key: 'net_salary', field_value: '20000', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-1', field_key: 'total_amount', field_value: '1000', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-1', field_key: 'person_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-2', field_key: 'total_amount', field_value: '1000', included_in_calculation: true },
      { document_id: 'doc-med', row_key: 'row-2', field_key: 'person_name', field_value: 'Matteo Bianchi', included_in_calculation: true }
    ]
    // threshold = 5% of 20000 = 1000. Combined raw = 2000. Pooled once:
    // deductible = max(0, 2000 - 1000) = 1000, split proportionally
    // (500 each) — NOT 1000 each (which double-applying the threshold to
    // every entry independently would give: min(1000, 1000-1000)=0 each,
    // or worse if the entries differed).
    const result = run({ documents: documents2, extractedFields, rules: rules2 })
    const first = find(result.components, 'total_amount', 'row-1')
    const second = find(result.components, 'total_amount', 'row-2')
    expect(first.amount).toBe(500)
    expect(second.amount).toBe(500)
  })
})

describe('pillar 3a — policyholder label replaces "#N"', () => {
  it('labels two contributions by their own policyholder instead of a bare number', () => {
    const documents = [{ id: 'doc-3a', category_code: 'pillar_3a_certificate', file_name: '3a.pdf' }]
    const rules = [
      { category_code: 'pillar_3a_certificate', field_key: 'annual_contribution', contribution_type: 'income_minus', cap_parameter_family: null }
    ]
    const extractedFields = [
      { document_id: 'doc-3a', row_key: 'row-1', field_key: 'annual_contribution', field_value: '3000', included_in_calculation: true },
      { document_id: 'doc-3a', row_key: 'row-1', field_key: 'policyholder_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-3a', row_key: 'row-2', field_key: 'annual_contribution', field_value: '2000', included_in_calculation: true },
      { document_id: 'doc-3a', row_key: 'row-2', field_key: 'policyholder_name', field_value: 'Unmatched Person', included_in_calculation: true }
    ]
    const result = run({ documents, extractedFields, rules })
    const first = find(result.components, 'annual_contribution', 'row-1')
    const second = find(result.components, 'annual_contribution', 'row-2')
    expect(first.fieldLabel).toContain('Sara Bianchi')
    expect(first.fieldLabel).not.toMatch(/#\d/)
    // Not matched to the registry — still shown as extracted, never a bare
    // number, and not silently treated as confirmed either.
    expect(second.fieldLabel).toContain('Unmatched Person')
    expect(second.fieldLabel).not.toMatch(/#\d/)
  })
})

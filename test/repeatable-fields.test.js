// A document with exactly one occurrence of a field that's REGISTERED as
// repeatable (see src/lib/repeatableFields.js) must still produce exactly
// one row/component — the repeatable mechanism must never manufacture a
// second, duplicate entry out of a single real extraction.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'

describe('a single occurrence of a repeatable field produces exactly one row', () => {
  it('debt_certificate:debt_balance — one mortgage, one row, no "#2" marker', () => {
    const documents = [{ id: 'd1', category_code: 'debt_certificate', file_name: 'mortgage.pdf' }]
    const extractedFields = [
      { document_id: 'd1', field_key: 'debt_balance', field_value: '100000', included_in_calculation: true },
      { document_id: 'd1', field_key: 'creditor_name', field_value: 'Test Bank', included_in_calculation: true }
    ]
    const rules = [
      { category_code: 'debt_certificate', field_key: 'debt_balance', contribution_type: 'wealth_minus', cap_parameter_family: null },
      { category_code: 'debt_certificate', field_key: 'creditor_name', contribution_type: 'none', cap_parameter_family: null }
    ]
    const fieldDefs = [{ category_code: 'debt_certificate', field_key: 'debt_balance', field_label: 'Debt balance' }]
    const categories = [{ code: 'debt_certificate', group_key: 'deductions', label_en: 'Debt certificate' }]

    const result = computeTaxAggregate({
      canton: 'VS',
      documents,
      extractedFields,
      rules,
      fieldDefs,
      categories,
      parameters: [],
      taxYear: 2025,
      primaryPerson: null,
      spousePerson: null,
      children: [],
      lang: 'en'
    })

    const debtBalanceRows = result.components.filter((c) => c.fieldKey === 'debt_balance')
    expect(debtBalanceRows).toHaveLength(1)
    expect(debtBalanceRows[0].amount).toBe(100000)
    expect(debtBalanceRows[0].fieldLabel).not.toMatch(/#\d/)
  })
})

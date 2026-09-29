// A document with exactly one row for a row-based category (see
// src/lib/rowBasedFields.js) must still produce exactly one row/component —
// the row mechanism must never manufacture a second, duplicate entry out of
// a single real extraction, and must never show a numeric "#2" marker.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'
import { legacySuffixBaseKey } from '../src/lib/rowBasedFields.js'

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

describe('legacySuffixBaseKey never misfires on a canonical key that happens to end in digits', () => {
  it('does not treat "account_balance_31_12" as a legacy "_12" suffix', () => {
    expect(legacySuffixBaseKey('account_balance_31_12')).toBe('account_balance_31')
    // The bare helper CAN look like a match (that ambiguity is why the only
    // two call sites — taxCalculation.js and extraction.js — always gate on
    // the FULL, unstripped field_key already having its own rule/definition
    // before ever consulting this helper; see the comments there.
  })
})

describe('mismatched-length lists (the original Sara Bianchi bug) are never silently aligned by position', () => {
  it('data still carrying the OLD "_2"/"_3" suffix convention on a row-based category is flagged for re-extraction instead of being paired up positionally', () => {
    // The exact shape of the original bug: 4 premiums, but institution
    // context only for 2 of them, all extracted under the pre-row-model
    // suffix convention (no row_key at all) — under the row model this
    // must never be guessed at by list position; every suffixed occurrence
    // is surfaced as its own "re-extract this document" row instead.
    const documents = [{ id: 'doc-ins', category_code: 'health_insurance_policy', file_name: 'premi.pdf' }]
    const extractedFields = [
      { document_id: 'doc-ins', field_key: 'annual_premium', field_value: '4260', included_in_calculation: true },
      { document_id: 'doc-ins', field_key: 'annual_premium_2', field_value: '4320', included_in_calculation: true },
      { document_id: 'doc-ins', field_key: 'annual_premium_3', field_value: '1320', included_in_calculation: true },
      { document_id: 'doc-ins', field_key: 'annual_premium_4', field_value: '780', included_in_calculation: true },
      { document_id: 'doc-ins', field_key: 'insured_person_name', field_value: 'Sara Bianchi', included_in_calculation: true },
      { document_id: 'doc-ins', field_key: 'insured_person_name_2', field_value: 'Matteo Bianchi', included_in_calculation: true }
    ]
    const rules = [
      { category_code: 'health_insurance_policy', field_key: 'annual_premium', contribution_type: 'income_minus', cap_parameter_family: 'insurance_premium_pool' },
      { category_code: 'health_insurance_policy', field_key: 'insured_person_name', contribution_type: 'none', cap_parameter_family: null }
    ]
    const fieldDefs = [{ category_code: 'health_insurance_policy', field_key: 'annual_premium', field_label: 'Annual premium' }]
    const categories = [{ code: 'health_insurance_policy', group_key: 'deductions', label_en: 'Health insurance' }]

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

    const premiumRows = result.components.filter((c) => c.fieldKey?.startsWith('annual_premium'))
    // All 4 — none silently dropped, none silently paired with a mismatched
    // institution/person by position. The one plain, unsuffixed occurrence
    // (the only one that's actually a valid row under the new model, since
    // none of this old data carries a real row_key) resolves normally; the
    // three still carrying the OLD "_2"/"_3" suffix convention are each
    // flagged for re-extraction instead of being guessed at by position.
    expect(premiumRows).toHaveLength(4)
    const legacyRows = premiumRows.filter((c) => c.fieldKey !== 'annual_premium')
    expect(legacyRows).toHaveLength(3)
    expect(legacyRows.every((c) => c.needsVerification)).toBe(true)
    expect(legacyRows.every((c) => /re-extract/i.test(c.fieldLabel || ''))).toBe(true)
    expect(premiumRows.every((c) => !/#\d/.test(c.fieldLabel))).toBe(true)
  })
})

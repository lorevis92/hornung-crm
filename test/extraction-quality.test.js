// Regression tests for src/lib/extractionQuality.js — the open questions
// this app still tracks after the tax calculation engine was removed.
//
// The distinction these tests lock in: a finding is raised only about the
// extracted DATA (whose row is this, was a line read twice, is a row
// missing, can the rows be grouped at all). Nothing here judges how a
// figure should be taxed — those checks went away with the engine.
import { describe, expect, it } from 'vitest'
import { buildQualityFindings } from '../src/lib/extractionQuality.js'

const BANK = 'bank_securities_crypto_statement'

const FIELD_DEFS = [
  { category_code: BANK, field_key: 'institution_name' },
  { category_code: BANK, field_key: 'account_holder_name' },
  { category_code: BANK, field_key: 'account_type' },
  { category_code: BANK, field_key: 'account_iban' },
  { category_code: BANK, field_key: 'account_balance_31_12' },
  { category_code: BANK, field_key: 'reported_total_balance' },
  { category_code: 'health_insurance_policy', field_key: 'insured_person_name' },
  { category_code: 'health_insurance_policy', field_key: 'annual_premium' },
  { category_code: 'salary_statement', field_key: 'gross_salary' }
]

const bankDoc = { id: 'doc-bank', category_code: BANK, file_name: '07_conti_bancari.pdf' }

function run(extractedFields, documents = [bankDoc]) {
  return buildQualityFindings({ documents, extractedFields, fieldDefs: FIELD_DEFS })
}

describe('unidentified rows', () => {
  it('flags a row that says nothing about whose it is, when the document has more than one row', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara Bianchi' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_balance_31_12', field_value: '8200' }
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'unidentifiedRow', documentId: 'doc-bank', rowKey: 'row-2' })
  })

  it('does not flag a row identified by any of its category\'s identity fields, not just a person', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_type', field_value: 'CONTO COINTESTATO' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_iban', field_value: 'CH1234567890123456789' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_balance_31_12', field_value: '8200' }
    ])
    expect(findings.filter((f) => f.kind === 'unidentifiedRow')).toHaveLength(0)
  })

  it('never flags a single-row document — there is nothing to tell it apart from', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' }
    ])
    expect(findings).toHaveLength(0)
  })

  it('ignores a value the specialist already marked as not relevant', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara Bianchi' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' },
      {
        document_id: 'doc-bank',
        row_key: 'row-2',
        field_key: 'account_balance_31_12',
        field_value: '8200',
        included_in_calculation: false
      }
    ])
    expect(findings).toHaveLength(0)
  })
})

describe('the same line read twice', () => {
  it('flags both rows that quote the exact same source text for the same field', () => {
    const findings = run([
      {
        document_id: 'doc-bank',
        row_key: 'row-1',
        field_key: 'account_balance_31_12',
        field_value: '1240',
        source_quote: 'Cash USD at 31 Dec USD 1 240.00'
      },
      {
        document_id: 'doc-bank',
        row_key: 'row-3',
        field_key: 'account_balance_31_12',
        field_value: '1240',
        source_quote: 'Cash USD at 31 Dec USD 1 240.00'
      },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_type', field_value: 'Cash' },
      { document_id: 'doc-bank', row_key: 'row-3', field_key: 'account_type', field_value: 'Cash USD' }
    ])
    const duplicates = findings.filter((f) => f.kind === 'duplicateSource')
    expect(duplicates).toHaveLength(2)
    expect(duplicates.map((f) => f.rowKey).sort()).toEqual(['row-1', 'row-3'])
    expect(duplicates[0].detail.count).toBe(2)
  })

  it('does not flag an identity value the document states once for several rows (one bank, two mortgages)', () => {
    const mortgageDoc = { id: 'doc-debt', category_code: 'debt_certificate', file_name: '09_ipoteche.pdf' }
    const findings = buildQualityFindings({
      documents: [mortgageDoc],
      extractedFields: [
        { document_id: 'doc-debt', row_key: 'row-1', field_key: 'creditor_name', field_value: 'BANQUE MONT ROUX', source_quote: 'BANQUE MONT ROUX' },
        { document_id: 'doc-debt', row_key: 'row-1', field_key: 'debt_type', field_value: 'IPOTECA SION', source_quote: 'IPOTECA SION' },
        { document_id: 'doc-debt', row_key: 'row-1', field_key: 'debt_balance', field_value: '435000', source_quote: 'CHF 435 000.00' },
        { document_id: 'doc-debt', row_key: 'row-2', field_key: 'creditor_name', field_value: 'BANQUE MONT ROUX', source_quote: 'BANQUE MONT ROUX' },
        { document_id: 'doc-debt', row_key: 'row-2', field_key: 'debt_type', field_value: 'IPOTECA MARTIGNY', source_quote: 'IPOTECA MARTIGNY' },
        { document_id: 'doc-debt', row_key: 'row-2', field_key: 'debt_balance', field_value: '265000', source_quote: 'CHF 265 000.00' }
      ],
      fieldDefs: [
        { category_code: 'debt_certificate', field_key: 'creditor_name' },
        { category_code: 'debt_certificate', field_key: 'debt_type' },
        { category_code: 'debt_certificate', field_key: 'debt_balance' }
      ]
    })
    expect(findings).toEqual([])
  })

  it('does not flag two rows that quote different lines', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_type', field_value: 'A', source_quote: 'line one' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_type', field_value: 'B', source_quote: 'line two' }
    ])
    expect(findings.filter((f) => f.kind === 'duplicateSource')).toHaveLength(0)
  })
})

describe('the document\'s own stated total vs. its rows', () => {
  it('flags a stated total that does not match the sum of the extracted rows', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: '', field_key: 'reported_total_balance', field_value: "CHF 20'000" },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_holder_name', field_value: 'Marco' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_balance_31_12', field_value: '8200' }
    ])
    const mismatch = findings.find((f) => f.kind === 'reportedTotalMismatch')
    expect(mismatch).toBeTruthy()
    expect(mismatch.detail).toEqual({ reportedTotal: 20000, rowsSum: 18200 })
  })

  it('accepts a rounding-level difference without flagging it', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: '', field_key: 'reported_total_balance', field_value: '18200.40' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_holder_name', field_value: 'Marco' },
      { document_id: 'doc-bank', row_key: 'row-2', field_key: 'account_balance_31_12', field_value: '8200' }
    ])
    expect(findings.filter((f) => f.kind === 'reportedTotalMismatch')).toHaveLength(0)
  })
})

describe('data extracted before the row model existed', () => {
  it('flags the document for re-extraction and says nothing else about it', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: '', field_key: 'account_balance_31_12', field_value: '10000' },
      { document_id: 'doc-bank', row_key: '', field_key: 'account_balance_31_12_2', field_value: '8200' },
      { document_id: 'doc-bank', row_key: '', field_key: 'account_balance_31_12_3', field_value: '1240' }
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('legacyFormat')
    expect(findings[0].detail.fieldKeys.sort()).toEqual(['account_balance_31_12_2', 'account_balance_31_12_3'])
  })

  it('never mistakes a canonical key that happens to end in digits for an old suffix', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' }
    ])
    expect(findings.filter((f) => f.kind === 'legacyFormat')).toHaveLength(0)
  })
})

describe('what is deliberately NOT flagged any more', () => {
  it('says nothing about a foreign currency, a missing tax parameter or how a value is taxed', () => {
    const findings = run([
      { document_id: 'doc-bank', row_key: '', field_key: 'currency', field_value: 'USD' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_holder_name', field_value: 'Sara' },
      { document_id: 'doc-bank', row_key: 'row-1', field_key: 'account_balance_31_12', field_value: '10000' }
    ])
    expect(findings).toEqual([])
  })

  it('says nothing about a category that has no row concept at all', () => {
    const salaryDoc = { id: 'doc-salary', category_code: 'salary_statement', file_name: '02_salario.pdf' }
    const findings = run(
      [{ document_id: 'doc-salary', row_key: '', field_key: 'gross_salary', field_value: '95000' }],
      [salaryDoc]
    )
    expect(findings).toEqual([])
  })
})

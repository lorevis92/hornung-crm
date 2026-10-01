// The safety net under the per-category whitelist, and the clean-up that
// came with it (src/lib/otherFindings.js, src/lib/extraction.js,
// src/lib/extractionQuality.js).
//
// The three rules this pins down, in the order they were asked for:
//   1. A whitelist field the document never mentions produces NO row in the
//      interface — no "Not found", no empty line.
//   2. A value no whitelist field covers, found by the coverage pass, shows
//      up in "other information found" WITH its source quote.
//   3. A row whose value is there but whose owner is not stays flagged.
// The third is the deliberate exception to the first, and the reason they
// are tested together: the line is not "is it in the schema" but "does a
// value exist" — no value, nothing to say; a value nobody can attribute, a
// question that must not be hidden.
import { describe, expect, it } from 'vitest'
import { mergeFieldsWithDefinitions } from '../src/lib/extraction.js'
import { buildQualityFindings } from '../src/lib/extractionQuality.js'
import {
  MAX_OTHER_FINDINGS_PER_DOCUMENT,
  buildOtherFindingRows,
  capturedValuesOf,
  describeExtractionForCoverage,
  normalizeOtherFinding
} from '../src/lib/otherFindings.js'

const BANK_DEFS = [
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_holder_name', field_label: 'Account holder', sort_order: 10 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'iban', field_label: 'IBAN', sort_order: 20 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'institution_name', field_label: 'Institution', sort_order: 30 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_balance_31_12', field_label: 'Balance 31.12', sort_order: 40 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'interest_income', field_label: 'Interest', sort_order: 50 }
]
const bankDoc = { id: 'doc-1', category_code: 'bank_securities_crypto_statement', file_name: 'estratto.pdf', mime_type: 'application/pdf' }

function field(overrides) {
  return {
    document_id: 'doc-1',
    row_key: '',
    field_value: '',
    confidence: 0.9,
    source_quote: null,
    source_page: 1,
    included_in_calculation: true,
    verified_by_specialist: false,
    ...overrides
  }
}

describe('a whitelist field the document does not mention', () => {
  it('produces no row at all — not an empty one', () => {
    const extracted = [
      field({ field_key: 'account_holder_name', row_key: 'row-1', field_value: 'Giulia Weber' }),
      field({ field_key: 'account_balance_31_12', row_key: 'row-1', field_value: "12'400.00" })
    ]
    const rows = mergeFieldsWithDefinitions(BANK_DEFS, extracted, bankDoc)

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.field_key)).toEqual(['account_holder_name', 'account_balance_31_12'])
    // The three definitions the document says nothing about are simply gone.
    expect(rows.some((r) => r.field_key === 'iban')).toBe(false)
    expect(rows.some((r) => r.field_key === 'institution_name')).toBe(false)
    expect(rows.some((r) => r.field_key === 'interest_income')).toBe(false)
    // And nothing empty survives anywhere in the output.
    expect(rows.every((r) => r.field_value.trim())).toBe(true)
  })

  it('treats a whitespace-only extracted value the same as no value', () => {
    const rows = mergeFieldsWithDefinitions(
      BANK_DEFS,
      [
        field({ field_key: 'account_holder_name', field_value: '   ' }),
        field({ field_key: 'account_balance_31_12', field_value: '900.00' })
      ],
      bankDoc
    )
    expect(rows.map((r) => r.field_key)).toEqual(['account_balance_31_12'])
  })

  it('keeps the field definition ORDER for the fields that are present', () => {
    const rows = mergeFieldsWithDefinitions(
      BANK_DEFS,
      [
        field({ field_key: 'interest_income', field_value: '12.40' }),
        field({ field_key: 'account_holder_name', field_value: 'Giulia Weber' })
      ],
      bankDoc
    )
    // Extraction order is irrelevant; sort_order still decides.
    expect(rows.map((r) => r.field_key)).toEqual(['account_holder_name', 'interest_income'])
  })

  it('raises no quality question about it either — a document not stating something is not a problem', () => {
    const findings = buildQualityFindings({
      documents: [bankDoc],
      extractedFields: [field({ field_key: 'account_balance_31_12', field_value: '900.00' })],
      fieldDefs: BANK_DEFS
    })
    expect(findings).toEqual([])
  })
})

describe('a value outside the whitelist, found by the coverage check', () => {
  const coverageItems = [
    {
      label: 'Commissione di tenuta conto',
      value: "180.00",
      source_quote: "Commissione di tenuta conto 2025: CHF 180.00",
      source_page: 2,
      ambiguous: false
    }
  ]

  it('is kept, with its label, its value and its exact source', () => {
    const rows = buildOtherFindingRows({
      items: coverageItems,
      documentId: 'doc-1',
      origin: 'coverage_check',
      isPdf: true,
      alreadyCaptured: capturedValuesOf([field({ field_key: 'account_balance_31_12', field_value: "12'400.00" })])
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      document_id: 'doc-1',
      label: 'Commissione di tenuta conto',
      finding_value: '180.00',
      source_quote: 'Commissione di tenuta conto 2025: CHF 180.00',
      source_page: 2,
      origin: 'coverage_check',
      needs_review: false
    })
  })

  it('is dropped when the whitelist already holds that value, however it is written', () => {
    const captured = capturedValuesOf([
      field({ field_key: 'account_balance_31_12', field_value: "12'400.00" })
    ])
    const rows = buildOtherFindingRows({
      // The coverage pass re-reporting a value it can see in the output it
      // was given is the common case, not an error — but it is not news.
      items: [{ label: 'Saldo al 31.12', value: 'CHF 12 400.00', source_quote: "Saldo: CHF 12'400.00" }],
      documentId: 'doc-1',
      origin: 'coverage_check',
      isPdf: true,
      alreadyCaptured: captured
    })
    expect(rows).toEqual([])
  })

  it('treats 15000 and 15000.00 as the same value, but 15000 and 15001 as different', () => {
    const captured = capturedValuesOf([field({ field_key: 'account_balance_31_12', field_value: '15000.00' })])
    const same = buildOtherFindingRows({
      items: [{ label: 'Totale', value: '15000' }],
      documentId: 'doc-1',
      origin: 'coverage_check',
      alreadyCaptured: captured
    })
    const different = buildOtherFindingRows({
      items: [{ label: 'Totale', value: '15001' }],
      documentId: 'doc-1',
      origin: 'coverage_check',
      alreadyCaptured: captured
    })
    expect(same).toEqual([])
    expect(different).toHaveLength(1)
  })

  it('never invents a row out of an item with only a label or only a value', () => {
    expect(normalizeOtherFinding({ label: 'Qualcosa' }, { documentId: 'd', origin: 'extraction' })).toBeNull()
    expect(normalizeOtherFinding({ value: '42' }, { documentId: 'd', origin: 'extraction' })).toBeNull()
    expect(normalizeOtherFinding('not an object', { documentId: 'd', origin: 'extraction' })).toBeNull()
    expect(normalizeOtherFinding(null, { documentId: 'd', origin: 'extraction' })).toBeNull()
  })

  it('drops a page number for a document that has no pages, and keeps it for a PDF', () => {
    const base = { label: 'X', value: '1', source_page: 3 }
    expect(normalizeOtherFinding(base, { documentId: 'd', origin: 'extraction', isPdf: false }).source_page).toBeNull()
    expect(normalizeOtherFinding(base, { documentId: 'd', origin: 'extraction', isPdf: true }).source_page).toBe(3)
  })

  it('stops at a sane number of findings rather than letting one run transcribe a document', () => {
    const items = Array.from({ length: MAX_OTHER_FINDINGS_PER_DOCUMENT + 25 }, (_, i) => ({
      label: `Voce ${i}`,
      value: String(1000 + i)
    }))
    const rows = buildOtherFindingRows({ items, documentId: 'doc-1', origin: 'coverage_check' })
    expect(rows).toHaveLength(MAX_OTHER_FINDINGS_PER_DOCUMENT)
  })

  it('reports the same label+value only once, however often the model repeats it', () => {
    const rows = buildOtherFindingRows({
      items: [
        { label: 'Bollo', value: '25.00' },
        { label: 'bollo', value: '25.00' },
        { label: 'Bollo', value: '25.00' }
      ],
      documentId: 'doc-1',
      origin: 'coverage_check'
    })
    expect(rows).toHaveLength(1)
  })

  it('hands the coverage pass a compact summary of what is already known', () => {
    const summary = describeExtractionForCoverage({
      fieldRows: [
        { field_key: 'account_holder_name', row_key: 'row-1', field_value: 'Giulia Weber' },
        { field_key: 'unknown_key', row_key: '', field_value: '900.00' }
      ],
      findingRows: [{ label: 'Bollo', finding_value: '25.00' }],
      fieldLabelByKey: { account_holder_name: 'Account holder' }
    })
    expect(summary).toContain('Account holder [row-1]: Giulia Weber')
    // No label defined for it — the key itself is still better than nothing.
    expect(summary).toContain('unknown_key: 900.00')
    expect(summary).toContain('Bollo: 25.00')
  })
})

describe('an uncertain coverage finding', () => {
  const uncertain = {
    label: 'Importo non identificato',
    value: '3 200.00',
    source_quote: 'Rif. 44-A 3 200.00',
    ambiguous: true,
    note: 'Non è chiaro se sia un addebito o un accredito'
  }

  it('is still kept — nothing found is ever discarded — but marked for review', () => {
    const [row] = buildOtherFindingRows({
      items: [uncertain],
      documentId: 'doc-1',
      origin: 'coverage_check'
    })
    expect(row.needs_review).toBe(true)
    expect(row.review_note).toBe('Non è chiaro se sia un addebito o un accredito')
  })

  it('becomes an explicit open question instead of sitting quietly in the list', () => {
    const [row] = buildOtherFindingRows({ items: [uncertain], documentId: 'doc-1', origin: 'coverage_check' })
    const findings = buildQualityFindings({
      documents: [bankDoc],
      extractedFields: [field({ field_key: 'account_balance_31_12', field_value: '900.00' })],
      fieldDefs: BANK_DEFS,
      otherFindings: [{ ...row, id: 'f-1' }]
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'otherFindingNeedsReview',
      documentId: 'doc-1',
      detail: { label: 'Importo non identificato', value: '3 200.00' }
    })
  })

  it('raises no question at all when the coverage pass was confident', () => {
    const [row] = buildOtherFindingRows({
      items: [{ ...uncertain, ambiguous: false, note: null }],
      documentId: 'doc-1',
      origin: 'coverage_check'
    })
    const findings = buildQualityFindings({
      documents: [bankDoc],
      extractedFields: [field({ field_key: 'account_balance_31_12', field_value: '900.00' })],
      fieldDefs: BANK_DEFS,
      otherFindings: [{ ...row, id: 'f-1' }]
    })
    expect(findings).toEqual([])
  })
})

describe('a row whose value is there but whose owner is not', () => {
  // The exception to "absent means invisible": the value EXISTS, it just
  // cannot be attributed, and hiding that would lose real information.
  const twoAccounts = [
    field({ field_key: 'account_holder_name', row_key: 'row-1', field_value: 'Giulia Weber' }),
    field({ field_key: 'iban', row_key: 'row-1', field_value: 'CH93 0076 2011 6238 5295 7' }),
    field({ field_key: 'account_balance_31_12', row_key: 'row-1', field_value: "12'400.00" }),
    // Second account: a balance, and nothing at all saying whose it is.
    field({ field_key: 'account_balance_31_12', row_key: 'row-2', field_value: "48'920.00" })
  ]

  it('is still flagged, exactly as before this change', () => {
    const findings = buildQualityFindings({
      documents: [bankDoc],
      extractedFields: twoAccounts,
      fieldDefs: BANK_DEFS
    })
    const unidentified = findings.filter((f) => f.kind === 'unidentifiedRow')
    expect(unidentified).toHaveLength(1)
    expect(unidentified[0].rowKey).toBe('row-2')
    // The identified row is not flagged.
    expect(unidentified.some((f) => f.rowKey === 'row-1')).toBe(false)
  })

  it('still shows the value it could not attribute — the row is not dropped with its missing identity fields', () => {
    const rows = mergeFieldsWithDefinitions(BANK_DEFS, twoAccounts, bankDoc)
    const rowTwo = rows.filter((r) => r.row_key === 'row-2')
    expect(rowTwo).toHaveLength(1)
    expect(rowTwo[0].field_value).toBe("48'920.00")
    // No identity to label it with, which is precisely what the finding says.
    expect(rowTwo[0].row_label).toBeNull()
  })
})

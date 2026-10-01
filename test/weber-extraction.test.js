// The Weber golden case, on real specialist-reviewed data
// (test/fixtures/weber-2025.json, exported by scripts/export-weber-fixture.mjs).
//
// This suite used to assert the tax calculation this app no longer does.
// The fixture itself is still the most valuable test data in the repo — a
// whole real client/year of documents, extracted into the row model and
// reviewed by a professional — so it was kept and re-pointed at what the
// app actually does now: grouping an extraction into rows, labelling those
// rows, and raising the right questions about the ones it cannot attribute.
// Every expectation below is a fact about the real documents, not a
// snapshot of code output: a failure here means the row model or the
// quality checks changed behaviour on real data.
import { describe, expect, it } from 'vitest'
import { mergeFieldsWithDefinitions } from '../src/lib/extraction.js'
import { buildQualityFindings } from '../src/lib/extractionQuality.js'
import { buildCategoryEntities, sortedPair } from '../src/lib/categoryEntities.js'
import fixture from './fixtures/weber-2025.json' with { type: 'json' }

function docByFilePart(part) {
  return fixture.documents.find((d) => d.file_name.toLowerCase().includes(part.toLowerCase()))
}

function rowsOf(doc) {
  const defs = fixture.fieldDefs.filter((d) => d.category_code === doc.category_code)
  const extracted = fixture.extractedFields.filter((f) => f.document_id === doc.id)
  const merged = mergeFieldsWithDefinitions(defs, extracted, doc)
  const byRow = new Map()
  for (const field of merged) {
    const key = field.row_key || ''
    if (!byRow.has(key)) byRow.set(key, { rowKey: key, rowLabel: field.row_label, values: {} })
    if (field.field_value) byRow.get(key).values[field.field_key] = field.field_value
  }
  return [...byRow.values()]
}

const findings = buildQualityFindings({
  documents: fixture.documents,
  extractedFields: fixture.extractedFields,
  fieldDefs: fixture.fieldDefs
})

function findingsFor(doc, kind) {
  return findings.filter((f) => f.documentId === doc.id && f.kind === kind)
}

describe('Weber 2025 — the row model on real documents', () => {
  it('keeps the two mortgages as two separate, individually labelled rows', () => {
    const doc = docByFilePart('09_attestazione_ipoteca')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    expect(rows).toHaveLength(2)
    const sion = rows.find((r) => r.values.debt_balance === '435000.00')
    const martigny = rows.find((r) => r.values.debt_balance === '265000.00')
    expect(sion.values.annual_interest_paid).toBe('7490.00')
    expect(martigny.values.annual_interest_paid).toBe('4590.00')
    // Each row is named by its own creditor + debt type, never by position.
    expect(sion.rowLabel).toContain('BANQUE MONT ROUX')
    expect(sion.rowLabel).toContain('SION')
    expect(martigny.rowLabel).toContain('MARTIGNY')
    expect(sion.rowLabel).not.toMatch(/#\d/)
  })

  it('keeps the joint account and Lina\'s own account apart, each with its own label and balance', () => {
    const doc = docByFilePart('10_attestazione_banca_conti')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    expect(rows).toHaveLength(2)
    const joint = rows.find((r) => r.values.account_balance_31_12 === '36420.5')
    const lina = rows.find((r) => r.values.account_balance_31_12 === '5980.2')
    expect(joint.values.interest_income).toBe('64.5')
    expect(lina.values.interest_income).toBe('18.2')
    expect(joint.rowLabel).toContain('COINTESTATO')
    expect(lina.rowLabel).toContain('LINA')
    // The bank name is stated once for the whole statement, so it stays a
    // document-level value rather than being copied onto either row.
    const documentLevel = rowsOf(doc).find((r) => !r.rowKey)
    expect(documentLevel.values.institution_name).toBe('BANQUE MONT ROUX')
    expect(documentLevel.values.currency).toBe('CHF')
  })

  it('keeps all three USD broker balances and both dividends as separate rows', () => {
    const doc = docByFilePart('11_report_broker_estero')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.values.account_balance_31_12).sort()).toEqual(['1240', '1240', '8350'])
    expect(rows.map((r) => r.values.dividend_income).filter(Boolean).sort()).toEqual(['185', '480'])
  })

  it('keeps the two donations apart, each labelled by its own recipient', () => {
    const doc = docByFilePart('15_ricevute_donazioni')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    expect(rows).toHaveLength(2)
    const pure = rows.find((r) => r.values.annual_amount === '420.00')
    const withConsideration = rows.find((r) => r.values.annual_amount === '150.00')
    expect(pure.rowLabel).toContain('Fondazione Aiuto Alpino')
    expect(withConsideration.rowLabel).toContain('Associazione culturale Art et Valais')
    // The "was something received in exchange" answer stays on its own row,
    // as extracted — this app records it, it no longer rules on it.
    expect(pure.values.has_consideration).toBe('no')
    expect(withConsideration.values.has_consideration).toBe('yes')
  })

  it('keeps both pillar 3a contributions as separate rows', () => {
    const doc = docByFilePart('05_attestazioni_3a')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.values.annual_contribution).sort()).toEqual(['6000.00', '7258.00'])
  })
})

describe('Weber 2025 — what the quality checks say about the same data', () => {
  it('flags the USD cash balance that was read twice from one line, and nothing else on that document', () => {
    const doc = docByFilePart('11_report_broker_estero')
    const duplicates = findingsFor(doc, 'duplicateSource')
    expect(duplicates).toHaveLength(2)
    expect(duplicates.every((f) => f.fieldKey === 'account_balance_31_12')).toBe(true)
    expect(duplicates[0].detail.quote).toContain('Cash USD at 31 Dec')
  })

  it('flags every premium on the health-insurance statement — it names four amounts but nobody they belong to', () => {
    const doc = docByFilePart('13_premi_cassa_malati')
    const unidentified = findingsFor(doc, 'unidentifiedRow')
    expect(unidentified.length).toBe(rowsOf(doc).filter((r) => r.rowKey).length)
    expect(unidentified.length).toBeGreaterThan(1)
  })

  it('does NOT flag the two mortgages: one bank named once for both rows is correct, not a double read', () => {
    const doc = docByFilePart('09_attestazione_ipoteca')
    expect(findingsFor(doc, 'duplicateSource')).toHaveLength(0)
    expect(findingsFor(doc, 'unidentifiedRow')).toHaveLength(0)
  })

  it('does NOT flag the donations or the CHF bank statement — every row there says whose it is', () => {
    expect(findingsFor(docByFilePart('15_ricevute_donazioni'), 'unidentifiedRow')).toHaveLength(0)
    expect(findingsFor(docByFilePart('10_attestazione_banca_conti'), 'unidentifiedRow')).toHaveLength(0)
  })

  it('raises nothing about how anything is taxed — only the four data-quality kinds exist', () => {
    const kinds = [...new Set(findings.map((f) => f.kind))].sort()
    expect(kinds.every((k) =>
      ['unidentifiedRow', 'duplicateSource', 'reportedTotalMismatch', 'legacyFormat'].includes(k)
    )).toBe(true)
  })

  it('no document in this real case is still on the pre-row-model format', () => {
    expect(findings.filter((f) => f.kind === 'legacyFormat')).toHaveLength(0)
  })
})

// The round that added the "other information found" safety net also stopped
// emitting a row for every whitelist field the document never mentioned.
// That is a change to what is DISPLAYED, and it must not be a change to what
// is KNOWN — these assertions exist to prove, on real reviewed data, that
// the same values are still there and still attributed to the same rows.
describe('Weber 2025 — dropping the empty rows changed nothing that was extracted', () => {
  it('shows exactly the extracted values, no more and no fewer', () => {
    for (const doc of fixture.documents) {
      const defs = fixture.fieldDefs.filter((d) => d.category_code === doc.category_code)
      const extracted = fixture.extractedFields.filter((f) => f.document_id === doc.id)
      const merged = mergeFieldsWithDefinitions(defs, extracted, doc)

      const definedKeys = new Set(defs.map((d) => d.field_key))
      const realValues = extracted.filter(
        (f) => definedKeys.has(f.field_key) && String(f.field_value ?? '').trim()
      )
      // One displayed row per extracted value: nothing invented, nothing
      // lost, and no empty row left over.
      expect(merged, doc.file_name).toHaveLength(realValues.length)
      expect(merged.every((r) => String(r.field_value).trim()), doc.file_name).toBe(true)
    }
  })

  it('keeps every bank account attached to the thing that identifies it', () => {
    const doc = docByFilePart('10_attestazione_banca_conti')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      // This statement names no holder and no IBAN — what tells the two
      // accounts apart is the account type ("CONTO COINTESTATO" vs "CONTO
      // RISPARMIO LINA"), and that is exactly what the row label is built
      // from. Dropping empty fields must never drop an identity field that
      // HAS a value.
      expect(row.values.account_type).toBeTruthy()
      expect(row.values.account_balance_31_12).toBeTruthy()
      expect(row.values.interest_income).toBeTruthy()
      expect(row.rowLabel).toContain(row.values.account_type)
    }
    expect(rows.map((r) => r.values.account_balance_31_12).sort()).toEqual(['36420.5', '5980.2'])
    // dividend_income and capital_gain_loss ARE defined for this category
    // and this statement says nothing about either. They used to appear as
    // an empty "Not found" line on every one of its three row groups; now
    // they appear nowhere.
    const defs = fixture.fieldDefs.filter((d) => d.category_code === doc.category_code)
    expect(defs.map((d) => d.field_key)).toEqual(
      expect.arrayContaining(['dividend_income', 'capital_gain_loss'])
    )
    const merged = mergeFieldsWithDefinitions(
      defs,
      fixture.extractedFields.filter((f) => f.document_id === doc.id),
      doc
    )
    expect(merged.some((r) => r.field_key === 'dividend_income')).toBe(false)
    expect(merged.some((r) => r.field_key === 'capital_gain_loss')).toBe(false)
  })

  it('keeps both mortgages with their creditor, their balance and their interest', () => {
    const rows = rowsOf(docByFilePart('09_attestazione_ipoteca')).filter((r) => r.rowKey)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.values.creditor_name).toBeTruthy()
      expect(row.values.debt_balance).toBeTruthy()
      expect(row.values.annual_interest_paid).toBeTruthy()
    }
  })

  it('keeps every insurance premium amount, including the rows nobody could attribute', () => {
    const doc = docByFilePart('13_premi_cassa_malati')
    const rows = rowsOf(doc).filter((r) => r.rowKey)
    const premiums = rows.map((r) => r.values.annual_premium).filter(Boolean)
    // Exactly as many premium amounts as the document's own extraction
    // holds — an unattributed row is still a row with a real value in it.
    const extractedPremiums = fixture.extractedFields.filter(
      (f) => f.document_id === doc.id && f.field_key === 'annual_premium' && String(f.field_value ?? '').trim()
    )
    expect(premiums).toHaveLength(extractedPremiums.length)
    expect(premiums.length).toBeGreaterThan(1)
  })

  it('still asks the same questions — the quality findings are untouched by the display change', () => {
    const withFindingsArgument = buildQualityFindings({
      documents: fixture.documents,
      extractedFields: fixture.extractedFields,
      fieldDefs: fixture.fieldDefs,
      otherFindings: []
    })
    expect(withFindingsArgument).toEqual(findings)
    // And no document in this case has an uncertain "other information"
    // item, because the fixture predates the coverage check entirely.
    expect(findings.filter((f) => f.kind === 'otherFindingNeedsReview')).toHaveLength(0)
  })
})

// The by-category reading of the same real data (src/lib/categoryEntities.js).
// The document view answers "what does this file say"; this one answers "how
// many properties does this client have". Weber is the case that proves both
// halves of the merge rule on real documents: one property genuinely written
// two ways across two files, and two mortgages from the SAME bank that must
// never be collapsed into one.
function entitiesOf(categoryCode, mergeDecisions = []) {
  const { groups, suggestions } = buildCategoryEntities({
    documents: fixture.documents,
    extractedFields: fixture.extractedFields,
    fieldDefs: fixture.fieldDefs,
    categories: fixture.categories,
    mergeDecisions
  })
  const group = groups.find((g) => g.categoryCode === categoryCode)
  return {
    entities: group?.entities || [],
    suggestions: suggestions.filter((s) => s.categoryCode === categoryCode)
  }
}

describe('Weber 2025 — the by-category view on real documents', () => {
  it('keeps the two mortgages distinct: same bank, two different debts', () => {
    const { entities, suggestions } = entitiesOf('debt_certificate')
    expect(entities).toHaveLength(2)

    const sion = entities.find((e) => e.label?.includes('SION'))
    const martigny = entities.find((e) => e.label?.includes('MARTIGNY'))
    expect(sion).toBeTruthy()
    expect(martigny).toBeTruthy()

    const amountOf = (entity, fieldKey) =>
      entity.values.find((v) => v.fieldKey === fieldKey)?.entries[0]?.value
    expect(amountOf(sion, 'debt_balance')).toBe('435000.00')
    expect(amountOf(sion, 'annual_interest_paid')).toBe('7490.00')
    expect(amountOf(martigny, 'debt_balance')).toBe('265000.00')
    expect(amountOf(martigny, 'annual_interest_paid')).toBe('4590.00')

    // Both name "BANQUE MONT ROUX" — sharing a creditor is not sharing a
    // debt, and nothing may suggest otherwise.
    expect(sion.label).toContain('BANQUE MONT ROUX')
    expect(martigny.label).toContain('BANQUE MONT ROUX')
    expect(suggestions).toEqual([])
    expect(entities.every((e) => e.mergedBy === null)).toBe(true)
  })

  it('asks about the one property this case really does write two ways', () => {
    const { entities, suggestions } = entitiesOf('property_tax_value')
    // Sion, Martigny, and the maintenance invoices that say only "RUE DES
    // FINETTES 6" — three entities until someone decides.
    expect(entities).toHaveLength(3)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].reason).toBe('similarIdentifier')
    const labels = suggestions[0].labels.join(' | ').toLowerCase()
    expect(labels).toContain('finettes')
    // The Sion property is nowhere near it and is never dragged in.
    expect(labels).not.toContain('dixence')
  })

  it('merges that property into one once confirmed, keeping both documents visible', () => {
    const { suggestions } = entitiesOf('property_tax_value')
    const [a, b] = sortedPair(...suggestions[0].keys)
    const { entities, suggestions: after } = entitiesOf('property_tax_value', [
      { category_code: 'property_tax_value', entity_key_a: a, entity_key_b: b, decision: 'merged' }
    ])
    expect(entities).toHaveLength(2)
    const merged = entities.find((e) => e.documentIds.length > 1)
    expect(merged.mergedBy).toBe('decision')
    // The rental statement's income and the invoices' maintenance cost now
    // sit on one property, each still pointing at the file it came from.
    const rentalIncome = merged.values.find((v) => v.fieldKey === 'annual_rental_income')
    const maintenance = merged.values.find((v) => v.fieldKey === 'maintenance_costs')
    expect(rentalIncome.entries[0].fileName).toContain('07_rendiconto')
    expect(maintenance.entries.some((e) => e.fileName.includes('08_fatture'))).toBe(true)
    expect(after).toEqual([])
  })

  it('never merges the six health-insurance premiums, which say only an amount each', () => {
    const { entities, suggestions } = entitiesOf('health_insurance_policy')
    expect(entities).toHaveLength(6)
    expect(suggestions).toEqual([])
    // And the document view still raises each one as unidentified, so the
    // two views say the same thing about them.
    expect(findingsFor(docByFilePart('13_premi_cassa_malati'), 'unidentifiedRow')).toHaveLength(6)
  })

  it("keeps the joint account and Lina's account apart in this view too", () => {
    const { entities } = entitiesOf('bank_securities_crypto_statement')
    const labels = entities.map((e) => e.label || '')
    expect(labels.some((l) => l.includes('COINTESTATO'))).toBe(true)
    expect(labels.some((l) => l.includes('LINA'))).toBe(true)
    expect(entities.filter((e) => e.mergedBy !== null)).toHaveLength(0)
  })
})

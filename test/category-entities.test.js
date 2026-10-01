// The by-category reading of an extraction, and the question it raises
// that reading one document never did: are these two rows the same
// real-world thing? (src/lib/categoryEntities.js, migration 48.)
//
// The rule under test is deliberately asymmetric, because the two mistakes
// are not equally bad: merging two different properties silently loses
// one, while leaving one property as two rows is merely untidy and
// visible. So an identical strong identifier merges automatically, a
// similar one only ever asks, and no identifier never merges at all.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildCategoryEntities,
  entityKeyOf,
  looksLikeSameIdentifier,
  normalizeIdentifier,
  sortedPair,
  suggestionsAsQualityFindings
} from '../src/lib/categoryEntities.js'

const PROPERTY_DEFS = [
  { category_code: 'property_tax_value', field_key: 'property_address', field_label: 'Address', sort_order: 10 },
  { category_code: 'property_tax_value', field_key: 'tax_value', field_label: 'Tax value', sort_order: 20 },
  { category_code: 'property_tax_value', field_key: 'maintenance_costs', field_label: 'Maintenance', sort_order: 30 },
  { category_code: 'property_tax_value', field_key: 'annual_rental_income', field_label: 'Rental income', sort_order: 40 }
]
const CATEGORIES = [{ code: 'property_tax_value', label_en: 'Property', sort_order: 10 }]

function doc(id, fileName, categoryCode = 'property_tax_value') {
  return { id, file_name: fileName, category_code: categoryCode }
}
function field(documentId, fieldKey, value, extra = {}) {
  return {
    document_id: documentId,
    field_key: fieldKey,
    row_key: '',
    field_value: value,
    source_quote: `«${value}»`,
    source_page: 1,
    included_in_calculation: true,
    ...extra
  }
}

function build(documents, extractedFields, mergeDecisions = [], fieldDefs = PROPERTY_DEFS) {
  return buildCategoryEntities({
    documents,
    extractedFields,
    fieldDefs,
    categories: CATEGORIES,
    mergeDecisions
  })
}

describe('grouping rows from different documents by category', () => {
  const documents = [doc('d1', 'valutazione.pdf'), doc('d2', 'affitto.pdf'), doc('d3', 'spese.pdf')]
  const fields = [
    field('d1', 'property_address', 'Rue de la Dixence 24, 1950 Sion'),
    field('d1', 'tax_value', '625000'),
    field('d2', 'property_address', 'Rue des Finettes 6, 1920 Martigny'),
    field('d2', 'annual_rental_income', '16800'),
    field('d3', 'property_address', 'Rue de la Dixence 24, 1950 Sion'),
    field('d3', 'maintenance_costs', '4550')
  ]

  it('puts everything of one category in a single group, across documents', () => {
    const { groups } = build(documents, fields)
    expect(groups).toHaveLength(1)
    expect(groups[0].categoryCode).toBe('property_tax_value')
    // Two real properties out of three documents.
    expect(groups[0].entities).toHaveLength(2)
  })

  it('keeps a document that mentions no other property as its own entity', () => {
    const { groups } = build(documents, fields)
    const martigny = groups[0].entities.find((e) => e.label?.includes('Martigny'))
    expect(martigny.members).toHaveLength(1)
    expect(martigny.documentIds).toEqual(['d2'])
  })
})

describe('an identical strong identifier merges automatically', () => {
  const documents = [doc('d1', 'valutazione.pdf'), doc('d3', 'spese.pdf')]
  const fields = [
    field('d1', 'property_address', 'Rue de la Dixence 24, 1950 Sion'),
    field('d1', 'tax_value', '625000'),
    // Same address, written with different case and spacing — normalizing
    // is not guessing, it is reading the same string.
    field('d3', 'property_address', 'RUE DE LA DIXENCE  24, 1950 SION'),
    field('d3', 'maintenance_costs', '4550')
  ]

  it('shows one entity carrying the data of both documents', () => {
    const { groups, suggestions } = build(documents, fields)
    expect(groups[0].entities).toHaveLength(1)
    const [entity] = groups[0].entities
    expect(entity.documentIds.sort()).toEqual(['d1', 'd3'])
    expect(entity.mergedBy).toBe('identifier')
    // It is settled, so nothing is asked about it.
    expect(suggestions).toEqual([])
  })

  it('still says which document each value came from', () => {
    const { groups } = build(documents, fields)
    const [entity] = groups[0].entities
    const taxValue = entity.values.find((v) => v.fieldKey === 'tax_value')
    const maintenance = entity.values.find((v) => v.fieldKey === 'maintenance_costs')
    expect(taxValue.entries).toHaveLength(1)
    expect(taxValue.entries[0].documentId).toBe('d1')
    expect(taxValue.entries[0].fileName).toBe('valutazione.pdf')
    expect(maintenance.entries[0].documentId).toBe('d3')
    // And the source quote survives, so "where does this come from" is
    // still answerable after a merge.
    expect(taxValue.entries[0].sourceQuote).toContain('625000')
  })

  it('lists both documents when both state the same field', () => {
    const { groups } = build(documents, [
      ...fields,
      field('d3', 'tax_value', '625000')
    ])
    const [entity] = groups[0].entities
    const taxValue = entity.values.find((v) => v.fieldKey === 'tax_value')
    expect(taxValue.entries.map((e) => e.documentId).sort()).toEqual(['d1', 'd3'])
  })
})

describe('a merely similar identifier is never merged on its own', () => {
  const documents = [doc('d2', 'affitto.pdf'), doc('d3', 'spese.pdf')]
  const fields = [
    field('d2', 'property_address', 'Rue des Finettes 6, 1920 Martigny'),
    field('d2', 'annual_rental_income', '16800'),
    // The same street without the town — probably the same property, and
    // "probably" is not good enough to merge behind the specialist's back.
    field('d3', 'property_address', 'RUE DES FINETTES 6'),
    field('d3', 'maintenance_costs', '4550')
  ]

  it('leaves the two separate and raises one question about them', () => {
    const { groups, suggestions } = build(documents, fields)
    expect(groups[0].entities).toHaveLength(2)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].reason).toBe('similarIdentifier')
    expect(suggestions[0].categoryCode).toBe('property_tax_value')
    expect(suggestions[0].labels.join(' / ')).toContain('Finettes')
  })

  it('merges them once the specialist confirms, and says who merged them', () => {
    const { suggestions } = build(documents, fields)
    const [a, b] = sortedPair(...suggestions[0].keys)
    const { groups, suggestions: after } = build(documents, fields, [
      { category_code: 'property_tax_value', entity_key_a: a, entity_key_b: b, decision: 'merged' }
    ])
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('decision')
    expect(groups[0].entities[0].documentIds.sort()).toEqual(['d2', 'd3'])
    // Answered, so it stops being asked.
    expect(after).toEqual([])
  })

  it('stops asking when the specialist says they are different, without merging them', () => {
    const { suggestions } = build(documents, fields)
    const [a, b] = sortedPair(...suggestions[0].keys)
    const { groups, suggestions: after } = build(documents, fields, [
      { category_code: 'property_tax_value', entity_key_a: a, entity_key_b: b, decision: 'separate' }
    ])
    expect(groups[0].entities).toHaveLength(2)
    expect(after).toEqual([])
  })

  it('keeps the confirmation after a re-extraction, because the key is derived from the address and not from a row id', () => {
    const { suggestions } = build(documents, fields)
    const [a, b] = sortedPair(...suggestions[0].keys)
    const decisions = [
      { category_code: 'property_tax_value', entity_key_a: a, entity_key_b: b, decision: 'merged' }
    ]

    // What re-extraction actually changes: new field rows, new ids, new
    // row_keys, possibly a different order — the same text in the
    // documents. Nothing here reuses an identifier from the first pass.
    const reExtracted = [
      field('d3', 'maintenance_costs', '4550', { row_key: 'row-7' }),
      field('d3', 'property_address', 'Rue des Finettes 6', { row_key: 'row-7' }),
      field('d2', 'annual_rental_income', '16800', { row_key: 'row-4' }),
      field('d2', 'property_address', 'Rue des Finettes 6, 1920 Martigny', { row_key: 'row-4' })
    ]
    const { groups, suggestions: after } = build(documents, reExtracted, decisions)
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('decision')
    expect(after).toEqual([])
  })
})

describe('a row with nothing to identify it', () => {
  it('is suggested against the only candidate there is', () => {
    const documents = [doc('d1', 'valutazione.pdf'), doc('d4', 'fattura.pdf')]
    const fields = [
      field('d1', 'property_address', 'Rue de la Dixence 24, 1950 Sion'),
      field('d1', 'tax_value', '625000'),
      field('d4', 'maintenance_costs', '900')
    ]
    const { suggestions } = build(documents, fields)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].reason).toBe('missingIdentifier')
  })

  it('is left alone when there are two candidates — a guess between them would be noise', () => {
    const documents = [doc('d1', 'sion.pdf'), doc('d2', 'martigny.pdf'), doc('d4', 'fattura.pdf')]
    const fields = [
      field('d1', 'property_address', 'Rue de la Dixence 24, 1950 Sion'),
      field('d2', 'property_address', 'Rue des Finettes 6, 1920 Martigny'),
      field('d4', 'maintenance_costs', '900')
    ]
    const { suggestions } = build(documents, fields)
    expect(suggestions).toEqual([])
  })

  it('never merges with another unidentified row just because both say nothing', () => {
    const documents = [doc('d4', 'fattura-a.pdf'), doc('d5', 'fattura-b.pdf')]
    const fields = [field('d4', 'maintenance_costs', '900'), field('d5', 'maintenance_costs', '750')]
    const { groups, suggestions } = build(documents, fields)
    expect(groups[0].entities).toHaveLength(2)
    expect(suggestions).toEqual([])
  })
})

describe('the open questions reach both views', () => {
  it('turns a still-unanswered suggestion into the same shape the quality findings use', () => {
    const documents = [doc('d2', 'affitto.pdf'), doc('d3', 'spese.pdf')]
    const { suggestions } = build(documents, [
      field('d2', 'property_address', 'Rue des Finettes 6, 1920 Martigny'),
      field('d3', 'property_address', 'RUE DES FINETTES 6')
    ])
    const [finding] = suggestionsAsQualityFindings(suggestions, documents)
    expect(finding.kind).toBe('possibleSameEntity')
    expect(finding.fileName).toBeTruthy()
    expect(finding.detail.keys).toHaveLength(2)
  })
})

describe('the identifier helpers', () => {
  it('reads the same address written differently as the same string', () => {
    expect(normalizeIdentifier("Rue de l'Église 4, 1950 SION")).toBe('rue de l eglise 4 1950 sion')
  })

  it('calls a strict token subset similar, and anything else not', () => {
    expect(looksLikeSameIdentifier('rue des finettes 6', 'Rue des Finettes 6, 1920 Martigny')).toBe(true)
    expect(looksLikeSameIdentifier('Rue de la Dixence 24', 'Rue des Finettes 6')).toBe(false)
    // Identical is not "similar" — that case is a merge, not a question.
    expect(looksLikeSameIdentifier('Rue des Finettes 6', 'rue des finettes 6')).toBe(false)
    // One token is too little to claim anything.
    expect(looksLikeSameIdentifier('Sion', 'Sion 24 1950')).toBe(false)
  })

  it('derives a key from the identifier when there is one, and from the document when there is not', () => {
    expect(entityKeyOf({ categoryCode: 'property_tax_value', identifier: 'Rue X 1' })).toBe(
      'property_tax_value|id|rue x 1'
    )
    expect(
      entityKeyOf({ categoryCode: 'property_tax_value', identifier: null, documentId: 'd4', rowKey: '' })
    ).toBe('property_tax_value|doc|d4|row|')
  })
})

// The by-category view is an ADDITION, not a replacement — the brief was
// explicit about that, and it is the kind of thing a later refactor
// quietly gets wrong. Asserted against the source because this repo's
// suite has no DOM; see test/case-page-sections.test.js for the same
// reasoning.
describe('both readings stay available', () => {
  const taxSummary = readFileSync(new URL('../src/pages/TaxSummary.jsx', import.meta.url), 'utf8')

  it('keeps the by-document view alongside the new by-category one', () => {
    expect(taxSummary).toMatch(/dataView === 'document' \? sections\.map/)
    expect(taxSummary).toMatch(/<CategoryEntityView/)
    expect(taxSummary).toMatch(/summary\.dataViewByDocument/)
    expect(taxSummary).toMatch(/summary\.dataViewByCategory/)
  })

  it('remembers which one was last used', () => {
    expect(taxSummary).toMatch(/hornung\.dataView/)
    expect(taxSummary).toMatch(/readStoredDataView/)
  })

  it('feeds one list of open questions to both, the quality findings included', () => {
    // The merge suggestions join the quality findings rather than living
    // in a list of their own, so neither view can show a question the
    // other hides.
    expect(taxSummary).toMatch(/suggestionsAsQualityFindings/)
    expect(taxSummary).toMatch(/findingsByMember/)
  })
})

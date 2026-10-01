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
  ENTITY_IDENTIFIERS,
  buildCategoryEntities,
  entityKeyOf,
  looksLikeSameIdentifier,
  normalizeIdentifier,
  sortedPair,
  suggestionsAsQualityFindings
} from '../src/lib/categoryEntities.js'
import { ROW_IDENTITY_FIELDS } from '../src/lib/rowBasedFields.js'
import { CATEGORY_FIELD_DEFINITIONS } from '../src/lib/demoSeed.js'

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

// ---------------------------------------------------------------------------
// Identity strength: what merges on its own, and what only ever asks.
// ---------------------------------------------------------------------------
const BANK_DEFS = [
  { category_code: 'bank_securities_crypto_statement', field_key: 'institution_name', field_label: 'Institution', sort_order: 10 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_type', field_label: 'Account type', sort_order: 20 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_balance_31_12', field_label: 'Balance', sort_order: 30 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'interest_income', field_label: 'Interest', sort_order: 40 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_holder_name', field_label: 'Holder', sort_order: 45 },
  { category_code: 'bank_securities_crypto_statement', field_key: 'account_iban', field_label: 'IBAN', sort_order: 46 }
]
const HEALTH_DEFS = [
  { category_code: 'health_insurance_policy', field_key: 'insurer_name', field_label: 'Insurer', sort_order: 10 },
  { category_code: 'health_insurance_policy', field_key: 'annual_premium', field_label: 'Premium', sort_order: 30 },
  { category_code: 'health_insurance_policy', field_key: 'insured_person_name', field_label: 'Insured person', sort_order: 45 },
  { category_code: 'health_insurance_policy', field_key: 'policy_type', field_label: 'Policy type', sort_order: 46 }
]
const DEBT_DEFS = [
  { category_code: 'debt_certificate', field_key: 'contract_number', field_label: 'Contract number', sort_order: 5 },
  { category_code: 'debt_certificate', field_key: 'creditor_name', field_label: 'Creditor', sort_order: 10 },
  { category_code: 'debt_certificate', field_key: 'debt_type', field_label: 'Debt type', sort_order: 20 },
  { category_code: 'debt_certificate', field_key: 'debt_balance', field_label: 'Balance', sort_order: 30 }
]

function buildFor(categoryCode, defs, documents, extractedFields, mergeDecisions = []) {
  return buildCategoryEntities({
    documents,
    extractedFields,
    fieldDefs: defs,
    categories: [{ code: categoryCode, label_en: categoryCode, sort_order: 10 }],
    mergeDecisions
  })
}

describe('the identity fields the dictionary now provides are the ones the merge logic uses', () => {
  it('treats an IBAN, an account number or institution+holder as certain for a bank account', () => {
    const { certain, probable } = ENTITY_IDENTIFIERS.bank_securities_crypto_statement
    expect(certain).toContainEqual(['account_iban'])
    expect(certain).toContainEqual(['account_number'])
    expect(certain).toContainEqual(['institution_name', 'account_holder_name'])
    // Institution + account type is a hint, not a proof.
    expect(probable).toContainEqual(['institution_name', 'account_type'])
    expect(certain).not.toContainEqual(['institution_name', 'account_type'])
  })

  it('treats insurer + insured person + policy type as certain for a premium', () => {
    const { certain } = ENTITY_IDENTIFIERS.health_insurance_policy
    expect(certain).toContainEqual(['insurer_name', 'insured_person_name', 'policy_type'])
  })

  it('no longer treats creditor + debt type as certain for a debt', () => {
    const { certain, probable } = ENTITY_IDENTIFIERS.debt_certificate
    expect(certain).not.toContainEqual(['creditor_name', 'debt_type'])
    expect(probable).toContainEqual(['creditor_name', 'debt_type'])
    // What identifies a specific debt instead.
    expect(certain).toContainEqual(['contract_number'])
  })

  it('names those same fields to the extraction, so documents can be read into them at all', () => {
    // The prompt lists the field dictionary dynamically, but WHICH fields
    // are a row's identity is a separate statement it has to make —
    // api/extract-document.js builds that from this map.
    const bank = ROW_IDENTITY_FIELDS.bank_securities_crypto_statement
    expect(bank).toContain('account_iban')
    expect(bank).toContain('account_holder_name')
    expect(bank).toContain('account_number')
    expect(ROW_IDENTITY_FIELDS.health_insurance_policy).toContain('insured_person_name')
    expect(ROW_IDENTITY_FIELDS.health_insurance_policy).toContain('policy_type')
    expect(ROW_IDENTITY_FIELDS.debt_certificate).toContain('contract_number')
    expect(ROW_IDENTITY_FIELDS.pension_fund_statement).toContain('insured_person_name')
    expect(ROW_IDENTITY_FIELDS.life_insurance_policy).toContain('policyholder_name')

    const extractionSource = readFileSync(new URL('../api/extract-document.js', import.meta.url), 'utf8')
    expect(extractionSource).toMatch(/identityFields\.join/)
    expect(extractionSource).toMatch(/most important fields to get right/)
  })

  it('has every identity field it relies on in the shipped dictionary, not just in the merge map', () => {
    // The gap this round closed: the merge logic named fields that
    // category_field_definitions did not have, so they were never
    // extracted and never merged anything. Checked against the demo seed,
    // which mirrors the migrations.
    const seeded = new Set(CATEGORY_FIELD_DEFINITIONS.map((d) => `${d.category_code}:${d.field_key}`))
    const missing = []
    for (const [categoryCode, specs] of Object.entries(ENTITY_IDENTIFIERS)) {
      for (const spec of [...(specs.certain || []), ...(specs.probable || [])]) {
        for (const fieldKey of spec) {
          if (!seeded.has(`${categoryCode}:${fieldKey}`)) missing.push(`${categoryCode}.${fieldKey}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('a bank account across two statements', () => {
  const documents = [
    doc('b1', 'estratto-2025.pdf', 'bank_securities_crypto_statement'),
    doc('b2', 'titoli-2025.pdf', 'bank_securities_crypto_statement')
  ]

  it('merges as a certain identity when both statements give the same IBAN', () => {
    const fields = [
      field('b1', 'institution_name', 'Banque du Leman'),
      field('b1', 'account_iban', 'CH93 0076 2011 6238 5295 7'),
      field('b1', 'account_balance_31_12', '12400.00'),
      field('b2', 'institution_name', 'BANQUE DU LEMAN'),
      // The same IBAN, spaced differently — one account.
      field('b2', 'account_iban', 'CH9300762011623852957'),
      field('b2', 'interest_income', '64.50')
    ]
    const { groups, suggestions } = buildFor('bank_securities_crypto_statement', BANK_DEFS, documents, fields)
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('identifier')
    expect(suggestions).toEqual([])
  })

  it('only asks when there is no IBAN and no holder, just the same institution and account type', () => {
    const fields = [
      field('b1', 'institution_name', 'Banque du Leman'),
      field('b1', 'account_type', 'Conto risparmio'),
      field('b1', 'account_balance_31_12', '12400.00'),
      field('b2', 'institution_name', 'Banque du Leman'),
      field('b2', 'account_type', 'Conto risparmio'),
      field('b2', 'account_balance_31_12', '5980.20')
    ]
    const { groups, suggestions } = buildFor('bank_securities_crypto_statement', BANK_DEFS, documents, fields)
    // Either one account read from two statements, or two accounts of the
    // same kind. Not something to settle automatically.
    expect(groups[0].entities).toHaveLength(2)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].reason).toBe('probableIdentifier')
  })

  it('merges on institution + holder, which does name one account', () => {
    const fields = [
      field('b1', 'institution_name', 'Banque du Leman'),
      field('b1', 'account_holder_name', 'Giulia Weber'),
      field('b1', 'account_balance_31_12', '12400.00'),
      field('b2', 'institution_name', 'Banque du Leman'),
      field('b2', 'account_holder_name', 'GIULIA WEBER'),
      field('b2', 'interest_income', '64.50')
    ]
    const { groups } = buildFor('bank_securities_crypto_statement', BANK_DEFS, documents, fields)
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('identifier')
  })
})

describe('an insurance premium', () => {
  it('merges as a certain identity on insurer + insured person + policy type', () => {
    const documents = [
      doc('h1', 'premi-2025.pdf', 'health_insurance_policy'),
      doc('h2', 'attestato-premi.pdf', 'health_insurance_policy')
    ]
    const fields = [
      field('h1', 'insurer_name', 'Sante Valais'),
      field('h1', 'insured_person_name', 'Lina Weber', { row_key: 'row-1' }),
      field('h1', 'policy_type', 'LAMal', { row_key: 'row-1' }),
      field('h1', 'annual_premium', '1320', { row_key: 'row-1' }),
      field('h2', 'insurer_name', 'SANTE VALAIS'),
      field('h2', 'insured_person_name', 'LINA WEBER', { row_key: 'row-1' }),
      field('h2', 'policy_type', 'lamal', { row_key: 'row-1' }),
      field('h2', 'annual_premium', '1320', { row_key: 'row-1' })
    ]
    const { groups, suggestions } = buildFor('health_insurance_policy', HEALTH_DEFS, documents, fields)
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('identifier')
    expect(suggestions).toEqual([])
  })

  it('keeps the basic and the supplementary cover of one person apart', () => {
    const documents = [doc('h1', 'premi-2025.pdf', 'health_insurance_policy')]
    const fields = [
      field('h1', 'insurer_name', 'Sante Valais'),
      field('h1', 'insured_person_name', 'Lina Weber', { row_key: 'row-1' }),
      field('h1', 'policy_type', 'LAMal', { row_key: 'row-1' }),
      field('h1', 'annual_premium', '1320', { row_key: 'row-1' }),
      field('h1', 'insured_person_name', 'Lina Weber', { row_key: 'row-2' }),
      field('h1', 'policy_type', 'LCA', { row_key: 'row-2' }),
      field('h1', 'annual_premium', '540', { row_key: 'row-2' })
    ]
    const { groups } = buildFor('health_insurance_policy', HEALTH_DEFS, documents, fields)
    expect(groups[0].entities).toHaveLength(2)
  })
})

describe('two debts from the same bank with the same generic type', () => {
  const documents = [
    doc('m1', 'ipoteca-a.pdf', 'debt_certificate'),
    doc('m2', 'ipoteca-b.pdf', 'debt_certificate')
  ]
  const fields = [
    field('m1', 'creditor_name', 'Banque Cantonale'),
    field('m1', 'debt_type', 'Ipoteca'),
    field('m1', 'debt_balance', '435000.00'),
    // A different mortgage, described in exactly the same words.
    field('m2', 'creditor_name', 'Banque Cantonale'),
    field('m2', 'debt_type', 'Ipoteca'),
    field('m2', 'debt_balance', '265000.00')
  ]

  it('is NOT merged automatically — this is the case the demotion exists for', () => {
    const { groups } = buildFor('debt_certificate', DEBT_DEFS, documents, fields)
    expect(groups[0].entities).toHaveLength(2)
    expect(groups[0].entities.every((e) => e.mergedBy === null)).toBe(true)
    // Both balances survive, which is the whole point: an automatic merge
    // here would have silently destroyed one of two real debts.
    const balances = groups[0].entities
      .map((e) => e.values.find((v) => v.fieldKey === 'debt_balance')?.entries[0]?.value)
      .sort()
    expect(balances).toEqual(['265000.00', '435000.00'])
  })

  it('is raised as a question instead', () => {
    const { suggestions } = buildFor('debt_certificate', DEBT_DEFS, documents, fields)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].reason).toBe('probableIdentifier')
  })

  it('merges only after the specialist says so, and then stays merged', () => {
    const { suggestions } = buildFor('debt_certificate', DEBT_DEFS, documents, fields)
    const [a, b] = sortedPair(...suggestions[0].keys)
    const decisions = [{ category_code: 'debt_certificate', entity_key_a: a, entity_key_b: b, decision: 'merged' }]
    const { groups, suggestions: after } = buildFor('debt_certificate', DEBT_DEFS, documents, fields, decisions)
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('decision')
    expect(after).toEqual([])
  })

  it('still merges on its own when the documents give the same contract number', () => {
    const withContract = [
      ...fields,
      field('m1', 'contract_number', 'HYP-7781'),
      field('m2', 'contract_number', 'HYP-7781')
    ]
    const { groups, suggestions } = buildFor('debt_certificate', DEBT_DEFS, documents, withContract)
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].mergedBy).toBe('identifier')
    expect(suggestions).toEqual([])
  })
})

describe('two rows of the SAME document are never merged', () => {
  it('keeps them apart even when one identifier covers both', () => {
    // A 3a certificate states one policy number above two separate
    // contributions. The extraction gave them distinct row_keys because
    // the document describes two things, and an identifier that cannot
    // tell them apart inside one file cannot be trusted across files.
    const defs = [
      { category_code: 'pillar_3a_certificate', field_key: 'institution_name', field_label: 'Institution', sort_order: 10 },
      { category_code: 'pillar_3a_certificate', field_key: 'policy_number', field_label: 'Policy number', sort_order: 20 },
      { category_code: 'pillar_3a_certificate', field_key: 'annual_contribution', field_label: 'Contribution', sort_order: 30 }
    ]
    const documents = [doc('p1', 'attestazioni-3a.pdf', 'pillar_3a_certificate')]
    const fields = [
      field('p1', 'institution_name', 'Fondazione Previdenza'),
      field('p1', 'policy_number', 'PV-3141'),
      field('p1', 'annual_contribution', '7258.00', { row_key: 'row-1' }),
      field('p1', 'annual_contribution', '6000.00', { row_key: 'row-2' })
    ]
    const { groups, suggestions } = buildFor('pillar_3a_certificate', defs, documents, fields)
    expect(groups[0].entities).toHaveLength(2)
    expect(groups[0].entities.every((e) => e.mergedBy === null)).toBe(true)
    expect(suggestions).toEqual([])
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

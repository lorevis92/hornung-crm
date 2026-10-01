// The by-category reading of an extraction: every bank account of the
// client in one place, every property in one place, every mortgage in one
// place — regardless of which document each row came from.
//
// The by-document view (src/lib/extraction.js) answers "what does this file
// say". This answers the other question a consultant actually has: "how
// many properties does this client have, and what do we know about each".
// Both are views of the same extracted_document_fields rows; neither
// replaces the other.
//
// Reading across documents raises a question reading one never did: two
// rows in the same category can describe the SAME real-world thing. The
// rule here is deliberately asymmetric, because the two mistakes are not
// equally bad — merging two different properties silently loses one, while
// leaving one property as two rows is merely untidy and visible:
//
//   strong identifier, identical  -> merged automatically, no question
//   strong identifier, similar    -> NOT merged; raised as a question
//   no identifier at all          -> never merged with anything
//
// A specialist's answer to one of those questions is stored against the
// derived entity key, not the row id (see migration 48 and entityKeyOf
// below), so it survives re-extraction.
//
// Pure, no I/O — same convention as extraction.js / extractionQuality.js.
import { ROW_IDENTITY_FIELDS, ROW_KEY_DOCUMENT_LEVEL, isRowBasedCategory } from './rowBasedFields.js'
import { buildRowIdentityLabel } from './rowIdentity.js'

// What makes two rows of a category CERTAINLY the same thing. Each entry is
// a list of candidate field-key tuples, tried in order: the first tuple
// whose every field has a value on the row becomes that row's identity.
//
// These are the identifiers the field dictionary actually provides today.
// Several categories have none — a health-insurance premium row carries
// only its amount, with the insurer stated once for the document — and
// those simply never merge, which is the correct outcome rather than a
// limitation to work around.
export const ENTITY_IDENTIFIERS = {
  // An IBAN or account number settles it outright; failing that, the
  // institution plus the account type is what a statement actually prints.
  bank_securities_crypto_statement: [['account_iban'], ['account_number'], ['institution_name', 'account_type']],
  debt_certificate: [['creditor_name', 'debt_type']],
  pillar_3a_certificate: [['policy_number'], ['institution_name', 'policyholder_name']],
  property_tax_value: [['property_address']],
  property_sale: [['property_address']],
  rental_contract_zug: [['property_address']],
  life_insurance_policy: [['policy_number'], ['insurer_name']],
  health_insurance_policy: [['insured_person_name', 'policy_type']],
  medical_costs: [['person_name']],
  donation_certificate: [['recipient_organization']],
  childcare_costs: [['child_name', 'provider_name']],
  private_vehicle: [['description', 'purchase_year']],
  self_employed_income_statement: [['business_name']],
  pension_fund_statement: [['institution_name']]
}

// Comparison form for an identifier: case, accents, punctuation and runs of
// whitespace all differ between two documents naming the same street, and
// none of those differences mean a different street.
export function normalizeIdentifier(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokensOf(value) {
  const normalized = normalizeIdentifier(value)
  return normalized ? normalized.split(' ') : []
}

// "Could be the same, could not." One identifier's tokens being a strict
// subset of the other's: "rue des finettes 6" inside "rue des finettes 6
// 1920 martigny" — the same street written with and without the town. Not
// edit distance: a token subset is a thing a human can check at a glance
// and explain, which matters more here than catching every typo.
export function looksLikeSameIdentifier(a, b) {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  if (ta.length < 2 || tb.length < 2) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (shorter.length === longer.length) return false
  const longerSet = new Set(longer)
  return shorter.every((token) => longerSet.has(token))
}

// The stable name of one real-world thing. Derived from WHAT IDENTIFIES IT,
// so the next extraction of the same document produces the same key and any
// decision recorded against it still applies. A row with no identifier
// falls back to its own document (and row), which is stable for a
// document-level row and as stable as row_key for a repeated one — such a
// row never merges automatically anyway.
export function entityKeyOf({ categoryCode, identifier, documentId, rowKey }) {
  if (identifier) return `${categoryCode}|id|${normalizeIdentifier(identifier)}`
  return `${categoryCode}|doc|${documentId}|row|${rowKey || ROW_KEY_DOCUMENT_LEVEL}`
}

function pairKey(a, b) {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

// Union-find over entity keys, for the specialist's confirmed merges:
// confirming A=B and B=C has to produce one entity, not two overlapping
// pairs.
function makeUnionFind() {
  const parent = new Map()
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key)
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)
    let cursor = key
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor)
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }
  return {
    find,
    union: (a, b) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(rb, ra)
    }
  }
}

// One extracted row — a (document, row_key) pair — reduced to what this
// module needs. Identity fields are read from the row itself FIRST and from
// the document-level row second: a bank statement prints its institution
// once for every account on it, and that institution belongs to each of
// those accounts just as much as if it had been repeated.
function buildRows({ documents, extractedFields, fieldDefs }) {
  const defsByCategory = {}
  for (const def of fieldDefs || []) {
    ;(defsByCategory[def.category_code] ||= []).push(def)
  }
  for (const defs of Object.values(defsByCategory)) {
    defs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }

  const fieldsByDoc = {}
  for (const field of extractedFields || []) {
    if (!String(field.field_value ?? '').trim()) continue
    ;(fieldsByDoc[field.document_id] ||= []).push(field)
  }

  const rows = []
  for (const doc of documents || []) {
    const categoryCode = doc.category_code
    if (!categoryCode) continue
    const docFields = fieldsByDoc[doc.id] || []
    if (!docFields.length) continue

    const definedKeys = new Set((defsByCategory[categoryCode] || []).map((d) => d.field_key))
    const byRow = new Map()
    for (const field of docFields) {
      if (!definedKeys.has(field.field_key)) continue
      const rowKey = field.row_key || ROW_KEY_DOCUMENT_LEVEL
      if (!byRow.has(rowKey)) byRow.set(rowKey, [])
      byRow.get(rowKey).push(field)
    }
    if (!byRow.size) continue

    const documentLevel = byRow.get(ROW_KEY_DOCUMENT_LEVEL) || []
    const valueAt = (fields, key) => fields.find((f) => f.field_key === key)?.field_value

    // A row-based category's document-level fields describe the document,
    // not a row of their own — unless they are all it has.
    const realRowKeys = [...byRow.keys()].filter((k) => k !== ROW_KEY_DOCUMENT_LEVEL)
    const rowKeys =
      isRowBasedCategory(categoryCode) && realRowKeys.length ? realRowKeys : [...byRow.keys()]

    for (const rowKey of rowKeys) {
      const own = byRow.get(rowKey) || []
      // Shared document-level values are part of this row's data when the
      // row is a real row; for the document-level row itself they ARE its
      // data and are already in `own`.
      const inherited = rowKey === ROW_KEY_DOCUMENT_LEVEL ? [] : documentLevel
      const fieldAt = (key) => valueAt(own, key) ?? valueAt(inherited, key)

      const identifierSpecs = ENTITY_IDENTIFIERS[categoryCode] || []
      let identifier = null
      let identifierFields = null
      for (const spec of identifierSpecs) {
        const values = spec.map((key) => fieldAt(key))
        if (values.every((v) => v != null && String(v).trim())) {
          identifier = values.map((v) => String(v).trim()).join(' / ')
          identifierFields = spec
          break
        }
      }

      const label =
        buildRowIdentityLabel({ categoryCode, fieldAt }) ||
        identifier ||
        null

      rows.push({
        categoryCode,
        documentId: doc.id,
        fileName: doc.file_name,
        rowKey,
        identifier,
        identifierFields,
        label,
        key: entityKeyOf({ categoryCode, identifier, documentId: doc.id, rowKey }),
        fields: own,
        inheritedFields: inherited,
        defs: defsByCategory[categoryCode] || []
      })
    }
  }
  return rows
}

function collectValues(members) {
  // One block per defined field, in dictionary order, each listing every
  // document that stated it — "where does this figure come from" has to
  // stay answerable after a merge, otherwise merging loses the one thing
  // this app exists to preserve.
  const defs = members[0]?.defs || []
  const blocks = []
  for (const def of defs) {
    const entries = []
    for (const member of members) {
      const own = member.fields.filter((f) => f.field_key === def.field_key)
      const inherited = own.length
        ? []
        : member.inheritedFields.filter((f) => f.field_key === def.field_key)
      for (const field of [...own, ...inherited]) {
        entries.push({
          value: field.field_value,
          documentId: member.documentId,
          fileName: member.fileName,
          rowKey: member.rowKey,
          fieldKey: field.field_key,
          sourceQuote: field.source_quote || null,
          sourcePage: field.source_page || null,
          confidence: field.confidence ?? null,
          verifiedBySpecialist: Boolean(field.verified_by_specialist),
          includedInCalculation: field.included_in_calculation !== false,
          inherited: !own.length
        })
      }
    }
    if (entries.length) {
      blocks.push({ fieldKey: def.field_key, fieldLabel: def.field_label || def.field_key, entries })
    }
  }
  return blocks
}

// documents / extractedFields / fieldDefs: as everywhere else in this app.
// categories: document_categories rows, for ordering the groups.
// mergeDecisions: entity_merge_decisions rows (migration 48) —
//   { category_code, entity_key_a, entity_key_b, decision }.
//
// Returns { groups, suggestions }:
//   groups      — [{ categoryCode, category, entities }], entities carrying
//                 their members, their per-field values with provenance,
//                 and how they came to be one entity.
//   suggestions — the "possibly the same thing" questions still open, each
//                 naming the two entity keys so the answer can be stored.
export function buildCategoryEntities({
  documents,
  extractedFields,
  fieldDefs,
  categories,
  mergeDecisions
}) {
  const rows = buildRows({ documents, extractedFields, fieldDefs })

  const decisionByPair = new Map()
  for (const decision of mergeDecisions || []) {
    decisionByPair.set(pairKey(decision.entity_key_a, decision.entity_key_b), decision.decision)
  }

  // 1. Rows sharing a key are the same thing by their own identifier.
  const uf = makeUnionFind()
  for (const row of rows) uf.find(row.key)

  // 2. Then whatever the specialist confirmed.
  const confirmedPairs = new Set()
  for (const decision of mergeDecisions || []) {
    if (decision.decision !== 'merged') continue
    confirmedPairs.add(pairKey(decision.entity_key_a, decision.entity_key_b))
    uf.union(decision.entity_key_a, decision.entity_key_b)
  }

  const byRoot = new Map()
  for (const row of rows) {
    const root = uf.find(row.key)
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(row)
  }

  const categoryByCode = Object.fromEntries((categories || []).map((c) => [c.code, c]))
  const entitiesByCategory = {}
  const entityByKey = new Map()

  for (const [root, members] of byRoot.entries()) {
    const categoryCode = members[0].categoryCode
    const identified = members.some((m) => m.identifier)
    const documentIds = [...new Set(members.map((m) => m.documentId))]
    const memberKeys = [...new Set(members.map((m) => m.key))]
    const entity = {
      key: root,
      categoryCode,
      label: members.find((m) => m.label)?.label || null,
      identified,
      identifier: members.find((m) => m.identifier)?.identifier || null,
      memberKeys,
      members: members.map((m) => ({ documentId: m.documentId, fileName: m.fileName, rowKey: m.rowKey })),
      documentIds,
      // Why this is one entity rather than several: its own identifier said
      // so, a specialist said so, or there was only ever one row.
      mergedBy: memberKeys.length > 1 ? 'decision' : documentIds.length > 1 ? 'identifier' : null,
      values: collectValues(members)
    }
    ;(entitiesByCategory[categoryCode] ||= []).push(entity)
    for (const key of memberKeys) entityByKey.set(key, entity)
  }

  // 3. What is only probably the same thing. Compared between ENTITIES, not
  //    rows, so a pair already merged (by identifier or by decision) is
  //    never raised again.
  const suggestions = []
  for (const [categoryCode, entities] of Object.entries(entitiesByCategory)) {
    const identifiedEntities = entities.filter((e) => e.identified)
    for (let i = 0; i < entities.length; i += 1) {
      for (let j = i + 1; j < entities.length; j += 1) {
        const a = entities[i]
        const b = entities[j]
        const pair = pairKey(a.key, b.key)
        if (decisionByPair.get(pair) === 'separate') continue
        if (confirmedPairs.has(pair)) continue

        let reason = null
        if (a.identifier && b.identifier) {
          if (looksLikeSameIdentifier(a.identifier, b.identifier)) reason = 'similarIdentifier'
        } else if (identifiedEntities.length === 1) {
          // One side says nothing about what it is, and there is exactly
          // one candidate it could belong to. With two or more candidates
          // there is nothing to suggest — guessing between them would be
          // noise, and "this row has no identity" is already raised on its
          // own by src/lib/extractionQuality.js.
          const unidentified = a.identified ? b : a
          const candidate = a.identified ? a : b
          if (!unidentified.identified && candidate.identified) reason = 'missingIdentifier'
        }
        if (!reason) continue

        suggestions.push({
          categoryCode,
          reason,
          keys: a.key < b.key ? [a.key, b.key] : [b.key, a.key],
          labels: a.key < b.key ? [a.label, b.label] : [b.label, a.label],
          documentIds: [...new Set([...a.documentIds, ...b.documentIds])]
        })
      }
    }
  }

  const groups = Object.entries(entitiesByCategory)
    .map(([categoryCode, entities]) => ({
      categoryCode,
      category: categoryByCode[categoryCode] || null,
      entities: entities.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
    }))
    .sort((a, b) => (a.category?.sort_order || 0) - (b.category?.sort_order || 0))

  return { groups, suggestions, entityByKey }
}

// Turns the open "possibly the same thing" questions into the same shape
// src/lib/extractionQuality.js produces, so one list of open questions
// covers both views instead of each view having its own.
export function suggestionsAsQualityFindings(suggestions, documents) {
  const fileNameById = Object.fromEntries((documents || []).map((d) => [d.id, d.file_name]))
  return (suggestions || []).map((suggestion) => ({
    kind: 'possibleSameEntity',
    documentId: suggestion.documentIds[0],
    fileName: fileNameById[suggestion.documentIds[0]] || null,
    categoryCode: suggestion.categoryCode,
    rowKey: ROW_KEY_DOCUMENT_LEVEL,
    fieldKey: null,
    detail: {
      reason: suggestion.reason,
      keys: suggestion.keys,
      labels: suggestion.labels,
      documentIds: suggestion.documentIds
    }
  }))
}

// Exported for the UI's "confirm" / "keep separate" actions: the pair is
// always stored in one order so it can never be recorded twice.
export function sortedPair(keyA, keyB) {
  return keyA < keyB ? [keyA, keyB] : [keyB, keyA]
}

export { ROW_IDENTITY_FIELDS }

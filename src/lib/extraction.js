import { ROW_KEY_DOCUMENT_LEVEL, isRowBasedCategory, legacySuffixBaseKey } from './rowBasedFields.js'
import { buildRowIdentityLabel } from './rowIdentity.js'

// Shared between DocumentVerificationPanel (single document) and TaxSummary
// (every document of a client/tax year): merges the field dictionary for a
// category with whatever was actually extracted for one document.
//
// ONLY fields that actually have a value come back. A defined field the
// document says nothing about used to be emitted as an empty row reading
// "Not found — enter it manually if you have it", which meant a bank
// statement carrying three real values was displayed as fifteen rows,
// twelve of them saying nothing. What the document does not contain is now
// simply absent. Note the deliberate asymmetry with
// src/lib/extractionQuality.js: a field missing from the document is not a
// problem and is not shown, whereas a value that IS there but cannot be
// attributed to anyone (an account with no holder and no IBAN) stays
// flagged — the value exists, so hiding the question would lose it.
//
// A row-based
// category (see rowBasedFields.js — bank accounts, insurance premiums,
// pillar 3a certificates, ...) can have more than one ROW for the same
// field definition, each sharing a `row_key` assigned by the extraction
// itself; every row gets its own editable copy of every field definition,
// labelled with that row's own identity (e.g. "Sara Bianchi — Cassa
// Helvetica — base (LAMal)") instead of a bare "#2".
export function mergeFieldsWithDefinitions(fieldDefs, extractedFields, doc) {
  const categoryCode = doc?.category_code
  const byKeyAndRow = new Map()
  for (const e of extractedFields || []) {
    byKeyAndRow.set(`${e.field_key}:${e.row_key || ROW_KEY_DOCUMENT_LEVEL}`, e)
  }

  // Every distinct row_key actually present on this document, document-level
  // first (a category has no row concept if it isn't in ROW_IDENTITY_FIELDS
  // at all, so everything for it stays under the single document-level row).
  const rowKeysPresent = Array.from(
    new Set((extractedFields || []).map((e) => e.row_key || ROW_KEY_DOCUMENT_LEVEL))
  ).sort((a, b) => (a === ROW_KEY_DOCUMENT_LEVEL ? -1 : b === ROW_KEY_DOCUMENT_LEVEL ? 1 : 0))
  const rows_ = rowKeysPresent.length ? rowKeysPresent : [ROW_KEY_DOCUMENT_LEVEL]

  // One shared implementation with src/lib/extractionQuality.js (see
  // rowIdentity.js): a row labelled here and a row judged "unidentified"
  // there must always be answering the same question the same way.
  const rowLabelFor = (rowKey) => {
    if (rowKey === ROW_KEY_DOCUMENT_LEVEL) return null
    return buildRowIdentityLabel({
      categoryCode,
      fieldAt: (key) => byKeyAndRow.get(`${key}:${rowKey}`)?.field_value
    })
  }

  const makeRow = (def, e, rowKey) => ({
    field_key: def.field_key,
    row_key: rowKey,
    row_label: rowLabelFor(rowKey),
    field_label: def.field_label || def.field_key,
    field_value: e?.field_value || '',
    confidence: e?.confidence ?? null,
    source_quote: e?.source_quote || null,
    source_page: e?.source_page || null,
    verified_by_specialist: e?.verified_by_specialist || false,
    verified_at: e?.verified_at || null,
    verified_by: e?.verified_by || null,
    included_in_calculation: e?.included_in_calculation !== false,
    document_id: doc?.id ?? null,
    file_name: doc?.file_name ?? null,
    isPdf: doc?.mime_type === 'application/pdf',
    isText: doc?.mime_type === 'text/plain'
  })

  const sortedDefs = [...(fieldDefs || [])].sort((a, b) => a.sort_order - b.sort_order)
  const rows = []
  for (const rowKey of rows_) {
    for (const def of sortedDefs) {
      const extracted = byKeyAndRow.get(`${def.field_key}:${rowKey}`)
      // Nothing was found for this field on this row — the definition
      // exists, the value does not, so there is nothing to show.
      if (!extracted || !String(extracted.field_value ?? '').trim()) continue
      rows.push(makeRow(def, extracted, rowKey))
    }
  }

  // Fields extracted before the row model existed still carry the OLD
  // "_2"/"_3" suffix convention — they match no definition above at all
  // (field_key no longer aligns with any category_field_definitions row),
  // so without this they'd silently vanish from the review panel. Surfaced
  // as their own flagged rows instead, pointing at "re-extract this
  // document" rather than disappearing. Guarded on the full field_key
  // matching no definition first: legacySuffixBaseKey is a bare "_N" suffix
  // match, which would also match a perfectly canonical key that just
  // happens to end in digits (e.g. "account_balance_31_12") — a canonical
  // key always has its own definition, so this only ever fires for a
  // genuinely stale suffixed key.
  const definedKeys = new Set(sortedDefs.map((d) => d.field_key))
  if (isRowBasedCategory(categoryCode)) {
    for (const e of extractedFields || []) {
      if (definedKeys.has(e.field_key)) continue
      const legacyBase = legacySuffixBaseKey(e.field_key)
      if (!legacyBase) continue
      const def = sortedDefs.find((d) => d.field_key === legacyBase) || { field_key: e.field_key, field_label: e.field_key }
      rows.push({ ...makeRow(def, e, e.row_key || ROW_KEY_DOCUMENT_LEVEL), legacyFormat: true, row_label: null })
    }
  }

  return rows
}

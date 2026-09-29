import { docTypeLabel } from './labels'
import { ROW_IDENTITY_FIELDS, ROW_KEY_DOCUMENT_LEVEL, isRowBasedCategory, legacySuffixBaseKey } from './rowBasedFields.js'

// Shared between DocumentVerificationPanel (single document) and TaxSummary
// (every document of a client/tax year): merges the field dictionary for a
// category with whatever was actually extracted for one document, so every
// defined field shows up even when nothing was found for it. A row-based
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

  const rowLabelFor = (rowKey) => {
    if (rowKey === ROW_KEY_DOCUMENT_LEVEL) return null
    const identityFields = ROW_IDENTITY_FIELDS[categoryCode]
    if (!identityFields) return null
    const parts = identityFields
      .map((key) => byKeyAndRow.get(`${key}:${rowKey}`)?.field_value)
      .filter(Boolean)
    return parts.length ? parts.join(' — ') : null
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
      rows.push(makeRow(def, byKeyAndRow.get(`${def.field_key}:${rowKey}`), rowKey))
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

// Every field of a tax-summary section that has a value, grouped by
// document (one heading per document instead of repeating it on every row)
// — the "raw reference" reading used by the results card and the exported
// PDF's "Document data" section, as opposed to the "how this was
// calculated" breakdown which only lists fields that actually feed the
// total. Not gated on verified_by_specialist — extracted values are
// reference data as soon as they exist, whether or not a specialist has
// touched them.
export function verifiedFieldsByDocument(section, lang) {
  const groups = []
  section.categories.forEach(({ category, documents }) => {
    documents.forEach((docGroup) => {
      const withValue = docGroup.fields.filter((f) => f.field_value)
      if (!withValue.length) return
      const categoryLabel = docTypeLabel(category, lang) || ''
      const baseHeading = `${categoryLabel} — ${docGroup.fileName}`
      // One row (an account, an insurance premium, a mortgage) becomes its
      // own group, headed by that row's own identifier, instead of every
      // row's fields interleaved into one flat list under the document.
      // withValue is already in row order (see mergeFieldsWithDefinitions),
      // so this only needs to chunk on row_key changing.
      const rowGroups = []
      for (const field of withValue) {
        const rowKey = field.row_key || ''
        const last = rowGroups[rowGroups.length - 1]
        if (last && last.rowKey === rowKey) last.fields.push(field)
        else rowGroups.push({ rowKey, rowLabel: field.row_label || null, fields: [field] })
      }
      for (const rowGroup of rowGroups) {
        groups.push({
          documentId: docGroup.documentId,
          // `heading` is the plain-text, non-interactive version (used by
          // the PDF export, which has no concept of a clickable source
          // link) — categoryLabel/fileName/rowLabel are the same three
          // parts, kept separate so the on-screen Tax Summary can render
          // just the file name as a link back to the source document
          // without also making the category label or row identifier
          // clickable.
          heading: rowGroup.rowLabel ? `${baseHeading} — ${rowGroup.rowLabel}` : baseHeading,
          categoryLabel,
          fileName: docGroup.fileName,
          rowLabel: rowGroup.rowLabel || null,
          fields: rowGroup.fields.map((f) => ({ label: f.field_label, value: f.field_value || '—' }))
        })
      }
    })
  })
  return groups
}

import { docTypeLabel } from './labels'
import { baseFieldKey, occurrenceIndex } from './repeatableFields'

// Shared between DocumentVerificationPanel (single document) and TaxSummary
// (every document of a client/tax year): merges the field dictionary for a
// category with whatever was actually extracted for one document, so every
// defined field shows up even when nothing was found for it. A repeatable
// field (see repeatableFields.js — several donations, dividend
// distributions, pillar 3a payments, ...) can have more than one extracted
// occurrence for the SAME field definition; each becomes its own editable
// row (labelled "#2", "#3", ...) instead of only the first ever being
// visible to review.
export function mergeFieldsWithDefinitions(fieldDefs, extractedFields, doc) {
  const occurrencesByBaseKey = {}
  for (const e of extractedFields || []) {
    const base = baseFieldKey(e.field_key)
    ;(occurrencesByBaseKey[base] ||= []).push(e)
  }

  const makeRow = (def, e, label) => ({
    field_key: e?.field_key || def.field_key,
    field_label: label,
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
    isPdf: doc?.mime_type === 'application/pdf'
  })

  const rows = []
  for (const def of [...(fieldDefs || [])].sort((a, b) => a.sort_order - b.sort_order)) {
    const label = def.field_label || def.field_key
    const matches = (occurrencesByBaseKey[def.field_key] || []).sort(
      (a, b) => occurrenceIndex(a.field_key) - occurrenceIndex(b.field_key)
    )
    if (!matches.length) {
      rows.push(makeRow(def, null, label))
    } else {
      matches.forEach((e, i) => rows.push(makeRow(def, e, matches.length > 1 ? `${label} #${i + 1}` : label)))
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
      groups.push({
        documentId: docGroup.documentId,
        heading: `${docTypeLabel(category, lang) || ''} — ${docGroup.fileName}`,
        fields: withValue.map((f) => ({ label: f.field_label, value: f.field_value || '—' }))
      })
    })
  })
  return groups
}

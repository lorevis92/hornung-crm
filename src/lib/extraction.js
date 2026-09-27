import { docTypeLabel } from './labels'

// Shared between DocumentVerificationPanel (single document) and TaxSummary
// (every document of a client/tax year): merges the field dictionary for a
// category with whatever was actually extracted for one document, so every
// defined field shows up even when nothing was found for it.
export function mergeFieldsWithDefinitions(fieldDefs, extractedFields, doc) {
  const byKey = Object.fromEntries((extractedFields || []).map((e) => [e.field_key, e]))
  return [...(fieldDefs || [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((def) => {
      const e = byKey[def.field_key]
      return {
        field_key: def.field_key,
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
        isPdf: doc?.mime_type === 'application/pdf'
      }
    })
}

// Every verified field of a tax-summary section, grouped by document (one
// heading per document instead of repeating it on every row) — the "raw
// reference" reading used by the results card and the exported PDF's
// "Document data" section, as opposed to the "how this was calculated"
// breakdown which only lists fields that actually feed the total.
export function verifiedFieldsByDocument(section, lang) {
  const groups = []
  section.categories.forEach(({ category, documents }) => {
    documents.forEach((docGroup) => {
      const verified = docGroup.fields.filter((f) => f.verified_by_specialist)
      if (!verified.length) return
      groups.push({
        documentId: docGroup.documentId,
        heading: `${docTypeLabel(category, lang) || ''} — ${docGroup.fileName}`,
        fields: verified.map((f) => ({ label: f.field_label, value: f.field_value || '—' }))
      })
    })
  })
  return groups
}

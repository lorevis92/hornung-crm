// Open questions about the QUALITY of what was extracted from a client's
// documents — not about tax treatment. A pure function with no I/O, shared
// by Tax Summary (which shows them with the action that resolves each one)
// and api/case-assistant.js (which tells the assistant what is still
// unresolved), same convention as personalDetails.js / rowIdentity.js.
//
// This is deliberately ALL that survives of the old "needs verification"
// system: the checks that decided how a value should be taxed (include or
// exclude it from a total, is it a double deduction, was a donation really
// a donation) went away with the calculation engine. What remains is only
// what a specialist still has to answer for the data itself to be usable
// and traceable:
//   - unidentifiedRow — a document has several rows of the same kind (three
//     accounts, four premiums) and this one says nothing about WHOSE it is;
//     without that the row can't be attributed or asked about.
//   - duplicateSource — two rows take the same VALUE from the exact same
//     line of the document, which is the AI reading one line twice rather
//     than two real rows. (Identity fields are exempt: one bank named once
//     for two mortgages legitimately belongs to both rows.)
//   - reportedTotalMismatch — the document states its own total and it
//     doesn't match the sum of the rows extracted from it: a row is
//     probably missing.
//   - legacyFormat — extracted before the row model existed, so its values
//     can't be grouped into rows at all; the document needs re-extracting.
import { ROW_IDENTITY_FIELDS, ROW_KEY_DOCUMENT_LEVEL, isRowBasedCategory, legacySuffixBaseKey } from './rowBasedFields.js'
import { buildRowIdentityLabel } from './rowIdentity.js'

// Documents that state their own combined total, and which per-row field
// that total should agree with. Most documents state no total at all, which
// is fine — there is simply nothing to cross-check.
const REPORTED_TOTAL_FIELDS = {
  health_insurance_policy: { totalKey: 'reported_total_premiums', rowValueKey: 'annual_premium' },
  bank_securities_crypto_statement: { totalKey: 'reported_total_balance', rowValueKey: 'account_balance_31_12' }
}
// Whole francs: a stated total and the sum of the rows disagreeing by less
// than this is rounding, not a missing row.
const REPORTED_TOTAL_TOLERANCE = 1

// Same tolerant parser the extraction itself needs: an amount can come back
// as a bare number or with the currency written into the same string
// ("CHF 15 000.00", "1'240.00 USD").
function parseAmount(value) {
  if (value == null) return null
  const cleaned = String(value)
    .trim()
    .replace(/[a-zA-Z]+/g, '')
    .replace(/['’\s]/g, '')
    .replace(/,/g, '')
    .trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

// documents: client_documents rows (id, category_code, file_name), already
//   scoped to one client/tax year.
// extractedFields: extracted_document_fields rows for those documents
//   (field_key, row_key, field_value, source_quote, included_in_calculation).
// fieldDefs: category_field_definitions rows — only used to tell a real
//   canonical field_key apart from one still carrying the old "_2" suffix.
//
// Returns a flat list of findings, each already carrying everything the UI
// needs to point at the problem: { kind, documentId, fileName, categoryCode,
// rowKey, fieldKey, detail }.
export function buildQualityFindings({ documents, extractedFields, fieldDefs }) {
  const findings = []
  const definedKeys = new Set((fieldDefs || []).map((f) => `${f.category_code}:${f.field_key}`))
  const fieldsByDoc = {}
  for (const field of extractedFields || []) {
    if (field.included_in_calculation === false) continue
    if (!field.field_value || !String(field.field_value).trim()) continue
    ;(fieldsByDoc[field.document_id] ||= []).push(field)
  }

  for (const doc of documents || []) {
    const categoryCode = doc.category_code
    if (!categoryCode) continue
    const docFields = fieldsByDoc[doc.id] || []
    if (!docFields.length) continue
    const base = { documentId: doc.id, fileName: doc.file_name, categoryCode }

    // --- legacy "_2"/"_3" suffix, from before the row model existed -------
    // Gated on the full key matching no definition: a perfectly canonical
    // key can also end in digits (account_balance_31_12), and stripping
    // that would flag every bank statement forever.
    if (isRowBasedCategory(categoryCode)) {
      const legacyKeys = new Set()
      for (const field of docFields) {
        if (definedKeys.has(`${categoryCode}:${field.field_key}`)) continue
        const legacyBase = legacySuffixBaseKey(field.field_key)
        if (legacyBase && definedKeys.has(`${categoryCode}:${legacyBase}`)) legacyKeys.add(field.field_key)
      }
      if (legacyKeys.size) {
        findings.push({
          ...base,
          kind: 'legacyFormat',
          rowKey: ROW_KEY_DOCUMENT_LEVEL,
          fieldKey: null,
          detail: { fieldKeys: [...legacyKeys] }
        })
        // Nothing else can be judged about a document whose values can't be
        // grouped into rows in the first place — re-extracting it is the
        // only next step, so don't pile unrelated findings on top.
        continue
      }
    }

    // --- rows with no identity at all ------------------------------------
    const rowKeysPresent = new Set(docFields.map((f) => f.row_key || ROW_KEY_DOCUMENT_LEVEL))
    const realRowKeys = [...rowKeysPresent].filter((k) => k !== ROW_KEY_DOCUMENT_LEVEL)
    // One row needs no name to tell it apart from anything else — only a
    // document that genuinely repeats does.
    if (isRowBasedCategory(categoryCode) && realRowKeys.length > 1) {
      const genericNameFields = docFields.filter((f) => /_(name|organization)$/.test(f.field_key))
      for (const rowKey of realRowKeys) {
        const fieldAt = (key) =>
          docFields.find((f) => f.field_key === key && (f.row_key || ROW_KEY_DOCUMENT_LEVEL) === rowKey)?.field_value
        const identity = buildRowIdentityLabel({ categoryCode, fieldAt })
        if (identity) continue
        const generic = genericNameFields.find((f) => (f.row_key || ROW_KEY_DOCUMENT_LEVEL) === rowKey)
        if (generic) continue
        findings.push({ ...base, kind: 'unidentifiedRow', rowKey, fieldKey: null, detail: {} })
      }
    }

    // --- the same line of the document read twice ------------------------
    // Only VALUE fields: an identity field is legitimately the same on
    // several rows and usually written once in the document (one bank
    // named once for two mortgages, one insurer for four premiums), so
    // every row quoting that single line is correct, not a double read.
    const identityFields = new Set(ROW_IDENTITY_FIELDS[categoryCode] || [])
    const bySignature = new Map()
    for (const field of docFields) {
      if (identityFields.has(field.field_key)) continue
      const quote = (field.source_quote || '').trim().toLowerCase()
      if (!quote) continue
      const key = `${field.field_key}:${quote}`
      if (!bySignature.has(key)) bySignature.set(key, [])
      bySignature.get(key).push(field)
    }
    for (const group of bySignature.values()) {
      if (group.length < 2) continue
      for (const field of group) {
        findings.push({
          ...base,
          kind: 'duplicateSource',
          rowKey: field.row_key || ROW_KEY_DOCUMENT_LEVEL,
          fieldKey: field.field_key,
          detail: { quote: group[0].source_quote, count: group.length }
        })
      }
    }

    // --- the document's own stated total vs. the rows extracted from it --
    const totalSpec = REPORTED_TOTAL_FIELDS[categoryCode]
    if (totalSpec) {
      const totalField = docFields.find(
        (f) => f.field_key === totalSpec.totalKey && (f.row_key || ROW_KEY_DOCUMENT_LEVEL) === ROW_KEY_DOCUMENT_LEVEL
      )
      const reportedTotal = totalField ? parseAmount(totalField.field_value) : null
      if (reportedTotal != null) {
        const rowsSum = docFields
          .filter((f) => f.field_key === totalSpec.rowValueKey)
          .reduce((sum, f) => sum + (parseAmount(f.field_value) || 0), 0)
        if (Math.abs(rowsSum - reportedTotal) > REPORTED_TOTAL_TOLERANCE) {
          findings.push({
            ...base,
            kind: 'reportedTotalMismatch',
            rowKey: ROW_KEY_DOCUMENT_LEVEL,
            fieldKey: totalSpec.totalKey,
            detail: { reportedTotal, rowsSum }
          })
        }
      }
    }
  }

  return findings
}

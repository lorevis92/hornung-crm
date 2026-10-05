// What may need a second look in the data extracted from a client's
// documents — never about tax treatment. A pure function with no I/O,
// shared by Tax Summary (which marks the document "da verificare" and shows
// each note discreetly next to the row it concerns) and api/case-assistant.js
// (which tells the assistant the same things). Nothing here asks the
// specialist to approve anything; it only says where to look:
//   - unidentifiedRow — a document has several rows of the same kind (three
//     accounts, four premiums) and this one says nothing about WHOSE it is.
//   - duplicateSource — two rows take the same VALUE from the exact same
//     line of the document: probably one line read twice. (Identity fields
//     are exempt: one bank named once for two mortgages belongs to both.)
//   - reportedTotalMismatch — the document states its own total and it
//     doesn't match the sum of the rows extracted from it: a row is
//     probably missing.
//   - otherFindingNeedsReview — the coverage pass (src/lib/otherFindings.js)
//     found something no field covers but could not say confidently what.
//
// A field the document simply doesn't mention is NOT a note: no value, no
// question.
import { ROW_IDENTITY_FIELDS, ROW_KEY_DOCUMENT_LEVEL, isRowBasedCategory } from './rowBasedFields.js'
import { buildRowIdentityLabel } from './rowIdentity.js'
import { parseAmount } from './fieldFormat.js'

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

// documents: client_documents rows (id, category_code, file_name), already
//   scoped to one client/tax year.
// extractedFields: extracted_document_fields rows for those documents
//   (field_key, row_key, field_value, source_quote).
// otherFindings: document_other_findings rows (optional) — only the ones
//   flagged needs_review produce a question here; the rest are simply
//   shown as "other information found".
//
// Returns a flat list of findings, each already carrying everything the UI
// needs to point at the problem: { kind, documentId, fileName, categoryCode,
// rowKey, fieldKey, detail }.
export function buildQualityFindings({ documents, extractedFields, otherFindings }) {
  const findings = []
  const uncertainByDoc = {}
  for (const finding of otherFindings || []) {
    if (!finding?.needs_review) continue
    ;(uncertainByDoc[finding.document_id] ||= []).push(finding)
  }
  const fieldsByDoc = {}
  for (const field of extractedFields || []) {
    if (!field.field_value || !String(field.field_value).trim()) continue
    ;(fieldsByDoc[field.document_id] ||= []).push(field)
  }

  for (const doc of documents || []) {
    const categoryCode = doc.category_code
    if (!categoryCode) continue
    const docFields = fieldsByDoc[doc.id] || []
    if (!docFields.length) continue
    const base = { documentId: doc.id, fileName: doc.file_name, categoryCode }

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

  // --- the coverage pass found something it couldn't place ---------------
  // Its own pass, deliberately outside the loop above: this note stands on
  // its own even for a document whose field extraction found nothing at all.
  for (const doc of documents || []) {
    for (const finding of uncertainByDoc[doc.id] || []) {
      findings.push({
        documentId: doc.id,
        fileName: doc.file_name,
        categoryCode: doc.category_code,
        kind: 'otherFindingNeedsReview',
        rowKey: ROW_KEY_DOCUMENT_LEVEL,
        fieldKey: null,
        detail: {
          label: finding.label,
          value: finding.finding_value,
          note: finding.review_note || null
        }
      })
    }
  }

  return findings
}

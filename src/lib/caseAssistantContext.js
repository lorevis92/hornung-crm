// Builds the plain-text context fed to the case assistant (api/case-assistant.js)
// — a pure function with no I/O, same reasoning as personalDetails.js: the
// endpoint does every DB read, this only turns already-fetched rows into
// text, so it's testable without a live database and can never accidentally
// reach past what it was explicitly given. The caller is responsible for
// scoping every query to exactly this case's client_id/tax_year — this
// function has no way to fetch more even if it wanted to.
//
// The app no longer computes a tax declaration, so this context is strictly
// "what the documents say and where each value came from": documents, their
// extracted rows, and the open data-quality questions. It deliberately
// contains no taxable totals, deductions or fiscal treatment of any kind —
// there are none to report, and the assistant must not imply otherwise.
import { ROW_KEY_DOCUMENT_LEVEL } from './rowBasedFields.js'

function fullName(person) {
  if (!person) return null
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || null
}

function formatAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '—')
  return n.toLocaleString('de-CH', { maximumFractionDigits: 0 })
}

// Groups a document's extracted fields by row_key (see rowBasedFields.js) —
// same grouping the UI itself uses, so the assistant describes the data the
// same way the specialist sees it on screen.
function groupFieldsByRow(fields, fieldLabelByKey, categoryCode) {
  const byRow = new Map()
  for (const field of fields) {
    if (!field.field_value) continue
    const rowKey = field.row_key || ROW_KEY_DOCUMENT_LEVEL
    if (!byRow.has(rowKey)) byRow.set(rowKey, [])
    const label = fieldLabelByKey[`${categoryCode}:${field.field_key}`] || field.field_key
    byRow.get(rowKey).push(`${label}: ${field.field_value}`)
  }
  return byRow
}

// documents: client_documents rows for this case's client/tax_year.
// extractedFields: extracted_document_fields rows for those documents.
// categories/fieldDefs: the full document_categories / category_field_definitions
//   tables (for human-readable labels).
// otherFindings: document_other_findings rows — values a document holds
//   that no whitelist field covers (src/lib/otherFindings.js). Included so
//   the assistant can answer from what a document ACTUALLY says, not only
//   from what the schema anticipated.
// qualityFindings: buildQualityFindings(...) output (src/lib/extractionQuality.js)
//   — the open questions about the extracted data, the same ones Tax
//   Summary shows the specialist.
// primaryPerson/spousePerson/children: client_persons/client_children rows.
export function buildCaseAssistantContext({
  client,
  caseRow,
  primaryPerson,
  spousePerson,
  children,
  documents,
  extractedFields,
  categories,
  fieldDefs,
  otherFindings,
  qualityFindings
}) {
  const categoryByCode = Object.fromEntries((categories || []).map((c) => [c.code, c]))
  const fieldLabelByKey = Object.fromEntries(
    (fieldDefs || []).map((f) => [`${f.category_code}:${f.field_key}`, f.field_label])
  )
  const fieldsByDoc = {}
  for (const field of extractedFields || []) {
    ;(fieldsByDoc[field.document_id] ||= []).push(field)
  }
  const otherByDoc = {}
  for (const finding of otherFindings || []) {
    ;(otherByDoc[finding.document_id] ||= []).push(finding)
  }

  const lines = []

  lines.push('=== CASE ===')
  lines.push(`Client: ${fullName(client) || client?.email || 'unknown'} (client_id: ${client?.id})`)
  lines.push(`Tax year: ${caseRow?.tax_year}, case status: ${caseRow?.status}`)
  if (caseRow?.client_message) lines.push(`Message shown to the client: "${caseRow.client_message}"`)
  lines.push('')

  lines.push('=== HOUSEHOLD (from the Questionnaire) ===')
  if (primaryPerson) {
    lines.push(
      `Primary person: ${fullName(primaryPerson) || 'unnamed'}` +
        (primaryPerson.marital_status ? `, marital status: ${primaryPerson.marital_status}` : '') +
        (primaryPerson.date_of_birth ? `, born ${primaryPerson.date_of_birth}` : '')
    )
  } else {
    lines.push('Primary person: not yet in the registry.')
  }
  if (spousePerson && (spousePerson.first_name || spousePerson.last_name)) {
    lines.push(`Spouse: ${fullName(spousePerson) || 'unnamed'}`)
  }
  if (children?.length) {
    lines.push(`Children: ${children.map((c) => c.full_name || 'unnamed').join(', ')}`)
  }
  lines.push('')

  lines.push('=== DOCUMENTS AND THEIR EXTRACTED DATA ===')
  if (!documents?.length) {
    lines.push('No documents uploaded yet for this case.')
  }
  for (const doc of documents || []) {
    const category = categoryByCode[doc.category_code]
    lines.push(
      `[[doc:${doc.id}|${doc.file_name}]] — category: ${category?.label_en || doc.category_code || 'uncategorized'}, status: ${doc.status}`
    )
    const fields = fieldsByDoc[doc.id] || []
    const others = otherByDoc[doc.id] || []
    if (!fields.length && !others.length) {
      lines.push('  (nothing extracted yet, or extraction failed)')
      continue
    }
    const byRow = groupFieldsByRow(fields, fieldLabelByKey, doc.category_code)
    for (const [rowKey, entries] of byRow.entries()) {
      lines.push(rowKey ? `  Row (${rowKey}): ${entries.join('; ')}` : `  ${entries.join('; ')}`)
    }
    // Free-form values the category's field list does not cover — as real
    // as the fields above, just not anticipated by the schema.
    for (const finding of others) {
      lines.push(
        `  Other information found: ${finding.label}: ${finding.finding_value}` +
          (finding.source_quote ? ` (document says: "${finding.source_quote}")` : '') +
          (finding.needs_review ? ' — UNCERTAIN, flagged for a specialist to confirm' : '')
      )
    }
  }
  lines.push('')

  lines.push('=== OPEN DATA-QUALITY QUESTIONS (see src/lib/extractionQuality.js) ===')
  lines.push(
    'These are the only open questions this app tracks. They are about the extracted data itself ' +
      '(whose row is this, was a line read twice, is a row missing), never about how a figure should be taxed.'
  )
  if (!qualityFindings?.length) {
    lines.push('None — nothing is currently flagged on this case.')
  }
  for (const finding of qualityFindings || []) {
    const docRef = `[[doc:${finding.documentId}|${finding.fileName}]]`
    if (finding.kind === 'unidentifiedRow') {
      lines.push(
        `  ${docRef}: one of its rows (internal row key "${finding.rowKey}") states nothing about whose it is ` +
          '— no account holder, insured person, creditor or similar. A specialist still has to say who it belongs to.'
      )
    } else if (finding.kind === 'duplicateSource') {
      lines.push(
        `  ${docRef}: "${finding.fieldKey}" was extracted ${finding.detail?.count ?? 2} times from the exact same ` +
          `line of the document ("${finding.detail?.quote ?? ''}") — probably one line read twice, not several real rows.`
      )
    } else if (finding.kind === 'reportedTotalMismatch') {
      lines.push(
        `  ${docRef}: the document states a total of ${formatAmount(finding.detail?.reportedTotal)} but the rows ` +
          `extracted from it add up to ${formatAmount(finding.detail?.rowsSum)} — a row may be missing.`
      )
    } else if (finding.kind === 'otherFindingNeedsReview') {
      lines.push(
        `  ${docRef}: something was found in this document that no defined field covers — ` +
          `"${finding.detail?.label ?? ''}": ${finding.detail?.value ?? ''} — but it could not be read ` +
          `with confidence${finding.detail?.note ? ` (${finding.detail.note})` : ''}. Report it as what the ` +
          'document appears to say, never as established fact.'
      )
    } else if (finding.kind === 'legacyFormat') {
      lines.push(
        `  ${docRef}: extracted before the row model existed, so its values cannot be grouped into rows at all. ` +
          'It needs re-extracting before anything can be said about its rows.'
      )
    }
  }

  return lines.join('\n')
}

// Splits an assistant reply into plain-text and document-reference parts —
// the model is instructed (see api/case-assistant.js's system prompt) to
// mark a source-document reference as "[[doc:<id>|<file name>]]", copied
// verbatim from the context above, so the UI can render just that part as
// a click-through to the source document (the same viewer Tax Summary
// already uses for a single field's own "view source" action) instead of
// dead text repeating a file name. A malformed or missing marker simply
// falls through as plain text — never a rendering error.
const DOC_REFERENCE_PATTERN = /\[\[doc:([^|\]]+)\|([^\]]+)\]\]/g

export function parseAssistantMessage(content) {
  const parts = []
  let lastIndex = 0
  let match
  DOC_REFERENCE_PATTERN.lastIndex = 0
  while ((match = DOC_REFERENCE_PATTERN.exec(content || '')) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    parts.push({ type: 'doc', documentId: match[1], fileName: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < (content || '').length) parts.push({ type: 'text', text: content.slice(lastIndex) })
  return parts
}

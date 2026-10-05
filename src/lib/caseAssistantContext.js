// Builds the plain-text context fed to the case assistant (api/case-assistant.js)
// — a pure function with no I/O: the endpoint does every DB read, scoped to
// exactly this case's client_id/tax_year, and this only turns those rows into
// text. It can never reach past what it was given.
//
// The app does not compute a tax declaration, so this context is strictly
// "what the documents say, about whom, and where each value came from". Every
// extracted value carries its own reference marker with page and sentence
// (src/lib/citations.js), so an answer built on it opens the document at the
// right point.
import { documentMarker, sourceMarker } from './citations.js'
import { describeDocumentPerson } from './documentPerson.js'
import { groupDocumentRows } from './extraction.js'

const PERSON_KIND_TEXT = {
  taxpayer: 'the taxpayer',
  spouse: 'the spouse',
  both_spouses: 'both spouses',
  child: 'a child',
  household: 'the household (rows may belong to different persons)',
  unknown: 'cannot be determined from the document',
  pending: 'not determined yet (document not extracted with the current version)'
}

function fullName(person) {
  if (!person) return null
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || null
}

function formatAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '—')
  return n.toLocaleString('de-CH', { maximumFractionDigits: 0 })
}

function describeNote(note) {
  if (note.kind === 'unidentifiedRow') {
    return 'one of its rows states nothing about whose it is (no account holder, insured person or similar).'
  }
  if (note.kind === 'duplicateSource') {
    return `"${note.fieldKey}" was read ${note.detail?.count ?? 2} times from the same line ("${note.detail?.quote ?? ''}") — probably one line read twice.`
  }
  if (note.kind === 'reportedTotalMismatch') {
    return `the document states a total of ${formatAmount(note.detail?.reportedTotal)} but its rows add up to ${formatAmount(note.detail?.rowsSum)} — a row may be missing.`
  }
  if (note.kind === 'otherFindingNeedsReview') {
    return `"${note.detail?.label ?? ''}": ${note.detail?.value ?? ''} was found but could not be read with confidence${note.detail?.note ? ` (${note.detail.note})` : ''}.`
  }
  return null
}

// documents: client_documents rows for this case's client/tax_year.
// extractedFields / otherFindings: their extracted_document_fields /
//   document_other_findings rows.
// categories / fieldDefs: document_categories / category_field_definitions
//   (labels, field order, value types).
// qualityFindings: buildQualityFindings(...) — the same notes Tax Summary
//   shows next to each document.
// primaryPerson / spousePerson / children: client_persons / client_children.
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
  const household = { primary: primaryPerson, spouse: spousePerson, children: children || [] }
  const lines = []

  lines.push('=== CASE ===')
  lines.push(`Client: ${fullName(client) || client?.email || 'unknown'} (client_id: ${client?.id})`)
  lines.push(`Tax year: ${caseRow?.tax_year}, case status: ${caseRow?.status}`)
  if (caseRow?.client_message) lines.push(`Message shown to the client: "${caseRow.client_message}"`)
  lines.push('')

  lines.push('=== HOUSEHOLD (from the Questionnaire) ===')
  if (primaryPerson) {
    lines.push(
      `Taxpayer: ${fullName(primaryPerson) || 'unnamed'}` +
        (primaryPerson.marital_status ? `, marital status: ${primaryPerson.marital_status}` : '') +
        (primaryPerson.date_of_birth ? `, born ${primaryPerson.date_of_birth}` : '')
    )
  } else {
    lines.push('Taxpayer: not yet in the registry.')
  }
  if (spousePerson && (spousePerson.first_name || spousePerson.last_name)) {
    lines.push(`Spouse: ${fullName(spousePerson) || 'unnamed'}`)
  }
  if (children?.length) {
    lines.push(`Children: ${children.map((c) => c.full_name || 'unnamed').join(', ')}`)
  }
  lines.push('')

  lines.push('=== DOCUMENTS AND THEIR EXTRACTED DATA ===')
  if (!documents?.length) lines.push('No documents uploaded yet for this case.')
  for (const doc of documents || []) {
    const category = categoryByCode[doc.category_code]
    const person = describeDocumentPerson(doc, household)
    lines.push(
      `${documentMarker(doc)} — type: ${category?.label_en || doc.category_code || 'uncategorized'}, status: ${doc.status}`
    )
    lines.push(
      `  Refers to: ${person.name ? `${person.name} — ` : ''}${PERSON_KIND_TEXT[person.kind]}` +
        (doc.person_quote ? ` (document says: "${doc.person_quote}")` : '')
    )
    const rows = groupDocumentRows(
      (fieldDefs || []).filter((d) => d.category_code === doc.category_code),
      (extractedFields || []).filter((f) => f.document_id === doc.id),
      doc.category_code
    )
    const findings = (otherFindings || []).filter((f) => f.document_id === doc.id)
    if (!rows.length && !findings.length) {
      lines.push('  (nothing extracted yet, or extraction failed)')
    }
    for (const row of rows) {
      const values = row.fields
        .map((f) => `${f.label}: ${f.value} ${sourceMarker(doc, { page: f.source_page, quote: f.source_quote })}`)
        .join('; ')
      if (row.rowKey) {
        lines.push(`  Row "${row.label || 'not identified'}"${row.person ? ` (person: ${row.person})` : ''}: ${values}`)
      } else {
        lines.push(`  ${values}`)
      }
    }
    for (const finding of findings) {
      lines.push(
        `  Other information found: ${finding.label}: ${finding.finding_value} ` +
          sourceMarker(doc, { page: finding.source_page, quote: finding.source_quote }) +
          (finding.needs_review ? ' — UNCERTAIN, still to be confirmed' : '')
      )
    }
    for (const note of (qualityFindings || []).filter((n) => n.documentId === doc.id)) {
      const text = describeNote(note)
      if (text) lines.push(`  To double-check: ${text}`)
    }
  }

  return lines.join('\n')
}

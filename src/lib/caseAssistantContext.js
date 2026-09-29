// Builds the plain-text context fed to the case assistant (api/case-assistant.js)
// — a pure function with no I/O, same reasoning as taxCalculation.js/
// personalDetails.js: the endpoint does every DB read, this only turns
// already-fetched rows into text, so it's testable without a live database
// and can never accidentally reach past what it was explicitly given. The
// caller is responsible for scoping every query to exactly this case's
// client_id/tax_year — this function has no way to fetch more even if it
// wanted to.
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
// aggregate/components: this client/year's tax_aggregates row and its
//   tax_aggregate_components rows (the persisted "how this was calculated"
//   breakdown — exactly what Tax Summary itself shows).
// fieldDecisions/manualEntries: tax_field_decisions / tax_manual_aggregate_entries
//   rows for this client/tax_year.
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
  aggregate,
  components,
  fieldDecisions,
  manualEntries
}) {
  const categoryByCode = Object.fromEntries((categories || []).map((c) => [c.code, c]))
  const fieldLabelByKey = Object.fromEntries(
    (fieldDefs || []).map((f) => [`${f.category_code}:${f.field_key}`, f.field_label])
  )
  const fieldsByDoc = {}
  for (const field of extractedFields || []) {
    ;(fieldsByDoc[field.document_id] ||= []).push(field)
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
    if (!fields.length) {
      lines.push('  (nothing extracted yet, or extraction failed)')
      continue
    }
    const byRow = groupFieldsByRow(fields, fieldLabelByKey, doc.category_code)
    for (const [rowKey, entries] of byRow.entries()) {
      lines.push(rowKey ? `  Row (${rowKey}): ${entries.join('; ')}` : `  ${entries.join('; ')}`)
    }
  }
  lines.push('')

  lines.push('=== CALCULATION BREAKDOWN (income, deductions, wealth, debts) ===')
  if (aggregate) {
    lines.push(
      `Taxable income (cantonal): ${formatAmount(aggregate.taxable_income_cantonal)}, ` +
        `taxable wealth (cantonal): ${formatAmount(aggregate.taxable_wealth_cantonal)}, ` +
        `taxable income (federal): ${formatAmount(aggregate.taxable_income_federal)}. ` +
        `Status: ${aggregate.status}.`
    )
  } else {
    lines.push('No calculation has been run yet for this case.')
  }
  const bySection = {}
  for (const c of components || []) {
    ;(bySection[c.section_key || 'other'] ||= []).push(c)
  }
  for (const [section, rows] of Object.entries(bySection)) {
    lines.push(`-- ${section} --`)
    for (const c of rows) {
      const docRef = c.document_id
        ? (() => {
            const doc = (documents || []).find((d) => d.id === c.document_id)
            return doc ? ` (source: [[doc:${doc.id}|${doc.file_name}]])` : ''
          })()
        : c.is_manual
          ? ' (manual entry, no source document)'
          : ''
      const flag = c.needs_verification
        ? ' — NEEDS VERIFICATION, not counted in the total yet'
        : c.decision === 'exclude'
          ? ' — resolved by the specialist as EXCLUDED'
          : c.decision === 'include'
            ? ' — resolved by the specialist as INCLUDED'
            : ''
      lines.push(`  ${c.label || c.field_label}: ${formatAmount(c.amount)}${docRef}${flag}`)
    }
  }
  lines.push('')

  lines.push('=== SPECIALIST DECISIONS (include/exclude on flagged fields) ===')
  if (fieldDecisions?.length) {
    for (const d of fieldDecisions) {
      lines.push(`  field ${d.field_key} on document ${d.document_id}: ${d.decision}${d.note ? ` (${d.note})` : ''}`)
    }
  } else {
    lines.push('No explicit decisions recorded.')
  }
  lines.push('')

  lines.push('=== MANUAL "HOW THIS WAS CALCULATED" ENTRIES (no source document) ===')
  if (manualEntries?.length) {
    for (const m of manualEntries) {
      lines.push(`  ${m.description}: ${formatAmount(m.amount)} (${m.component_type})${m.note ? ` — ${m.note}` : ''}`)
    }
  } else {
    lines.push('None.')
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

// The safety net under the per-category whitelist: what to do with a value
// a document contains, a tax consultant would care about, and no
// category_field_definitions field covers.
//
// The whitelist itself is unchanged and stays authoritative — for a bank
// statement the holder, the IBAN, the institution and the balance still
// come back as proper extracted_document_fields rows, with their row_key,
// their identity label and their quality checks. Everything else lands in
// document_other_findings (migration 46) through these two paths:
//
//   1. The extraction call itself is asked, in the same request, to list
//      anything relevant it saw that no listed field covers.
//   2. A single coverage pass afterwards gets the document AND that whole
//      output back, and is asked which amounts, names and dates in the
//      text are still not represented anywhere in it.
//
// Pure functions, no I/O — api/extract-document.js does the calls and the
// writes, this module decides what is worth keeping. That split is what
// makes "a value the coverage pass found appears with its source" testable
// without an API key (see test/other-findings.test.js).
import { ROW_KEY_DOCUMENT_LEVEL } from './rowBasedFields.js'

// A document with more genuinely-unanticipated values than this is not a
// document with a rich long tail, it is a model that started transcribing.
// Cutting off protects the UI (and the assistant's context window) from a
// single pathological extraction; the whitelist fields are never affected.
export const MAX_OTHER_FINDINGS_PER_DOCUMENT = 40

// Comparison form for "is this value already represented?": case, spacing,
// thousands separators and currency words all differ between how a
// whitelist field stored a value ("15000.00") and how the coverage pass
// quotes the same thing ("CHF 15'000.00"), and none of those differences
// mean it is a new piece of information.
function comparable(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// Amounts need their own comparison: "CHF 12'400.00", "12 400.00" and
// "12400" are one value written three ways, and stripping the punctuation
// alone would turn 12400.00 into the integer 1240000. Same tolerant parse
// as extractionQuality.js's parseAmount, deliberately — the two modules
// must agree on when two amounts are the same amount.
function comparableAmount(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[a-zA-Z]+/g, '')
    .replace(/['’\s]/g, '')
    .replace(/,/g, '')
    .trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? String(num) : null
}

function bothForms(value) {
  return [comparable(value), comparableAmount(value)].filter(Boolean)
}

// One raw item as the model returned it -> a document_other_findings row,
// or null when there is nothing usable in it. Deliberately strict about
// label AND value: an item with only a label says nothing, and an item
// with only a value cannot be presented to anyone.
export function normalizeOtherFinding(raw, { documentId, origin, isPdf }) {
  if (!raw || typeof raw !== 'object') return null
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const value = raw.value == null ? '' : String(raw.value).trim()
  if (!label || !value) return null

  const page = Number(raw.source_page)
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : null
  return {
    document_id: documentId,
    label: label.slice(0, 200),
    finding_value: value.slice(0, 2000),
    source_quote:
      typeof raw.source_quote === 'string' && raw.source_quote.trim() ? raw.source_quote.trim() : null,
    source_page: isPdf && Number.isInteger(page) && page > 0 ? page : null,
    origin,
    confidence: confidence != null && confidence >= 0 && confidence <= 1 ? confidence : null,
    // The coverage pass can say "I found something here but I am not sure
    // what it is" — that is still worth keeping, just never worth
    // presenting as established fact (see extractionQuality.js).
    needs_review: raw.ambiguous === true || raw.needs_review === true,
    review_note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 500) : null
  }
}

// items: whatever the model returned (any shape — anything unusable is
//   dropped rather than trusted).
// alreadyCaptured: values already represented elsewhere for this document,
//   as plain strings — the whitelist field values, plus the findings kept
//   so far. An item whose value is one of those is not new information.
//
// Returns rows ready for insert, deduped against alreadyCaptured, deduped
// against each other, and capped.
export function buildOtherFindingRows({
  items,
  documentId,
  origin,
  isPdf = false,
  alreadyCaptured = [],
  limit = MAX_OTHER_FINDINGS_PER_DOCUMENT
}) {
  const seenValues = new Set()
  for (const value of alreadyCaptured) {
    for (const form of bothForms(value)) seenValues.add(form)
  }
  const seenRows = new Set()

  const rows = []
  for (const raw of Array.isArray(items) ? items : []) {
    if (rows.length >= limit) break
    const row = normalizeOtherFinding(raw, { documentId, origin, isPdf })
    if (!row) continue

    // Same label AND same value twice in one response is the model
    // repeating itself, never two findings.
    const rowSignature = `${comparable(row.label)}|${comparable(row.finding_value)}`
    if (seenRows.has(rowSignature)) continue

    // The value is already somewhere in this document's extracted data —
    // a whitelist field holds it, or an earlier finding already does. The
    // coverage pass re-reporting a value it can see in the output it was
    // given is the common case, and the whole point of giving it that
    // output.
    const forms = bothForms(row.finding_value)
    if (forms.some((form) => seenValues.has(form))) continue

    seenRows.add(rowSignature)
    for (const form of forms) seenValues.add(form)
    rows.push(row)
  }
  return rows
}

// Every value this document already has on record, in the shape
// buildOtherFindingRows wants: the whitelist rows about to be written plus
// any findings already kept. Used both to dedupe the coverage pass and to
// tell the model what it does NOT need to report again.
export function capturedValuesOf(fieldRows = [], findingRows = []) {
  return [
    ...fieldRows.map((f) => f.field_value),
    ...findingRows.map((f) => f.finding_value)
  ].filter((v) => v != null && String(v).trim())
}

// The compact "here is what I already have" summary handed to the coverage
// pass. Kept small on purpose — it is sent alongside the document itself on
// every extraction, so it pays for itself only if it stays short.
export function describeExtractionForCoverage({ fieldRows = [], findingRows = [], fieldLabelByKey = {} }) {
  const lines = []
  for (const row of fieldRows) {
    const label = fieldLabelByKey[row.field_key] || row.field_key
    const rowKey = row.row_key && row.row_key !== ROW_KEY_DOCUMENT_LEVEL ? ` [${row.row_key}]` : ''
    lines.push(`- ${label}${rowKey}: ${row.field_value}`)
  }
  for (const row of findingRows) {
    lines.push(`- ${row.label}: ${row.finding_value}`)
  }
  return lines.length ? lines.join('\n') : '(nothing was extracted from this document)'
}

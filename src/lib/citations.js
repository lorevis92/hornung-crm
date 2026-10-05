// The clickable references in the case assistant's answers.
//
// The assistant copies them verbatim from its context (see
// caseAssistantContext.js), in two forms:
//   [[doc:<id>|<file name>]]                     — a document in general:
//                                                  opens it from the start;
//   [[doc:<id>|<file name>|p<page>|<sentence>]]  — one extracted value:
//                                                  opens it at that page with
//                                                  that sentence highlighted.
// The page may be empty ("p|...") for a document without pages. A malformed
// marker simply stays plain text — never a rendering error.

const QUOTE_MAX = 120

// The sentence as it can travel inside a marker: no brackets, no pipes, no
// line breaks, and short — the viewer's highlight already falls back to a
// prefix of the quote (src/lib/pdfHighlight.js), so a cut sentence still
// finds its place on the page.
function markerSafe(text) {
  return String(text || '')
    .replace(/[[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUOTE_MAX)
    .trim()
}

export function documentMarker(doc) {
  return `[[doc:${doc.id}|${markerSafe(doc.file_name) || 'documento'}]]`
}

// A marker for one value with its source; falls back to the plain document
// marker when the value has neither a page nor a sentence.
export function sourceMarker(doc, { page = null, quote = null } = {}) {
  const sentence = markerSafe(quote)
  if (!page && !sentence) return documentMarker(doc)
  return `[[doc:${doc.id}|${markerSafe(doc.file_name) || 'documento'}|p${page || ''}|${sentence}]]`
}

const MARKER_PATTERN = /\[\[doc:([^|\]]+)\|([^|\]]+)(?:\|p(\d*)\|([^\]]*))?\]\]/g

// -> [{ type: 'text', text } | { type: 'doc', documentId, fileName, page, quote }]
export function parseAssistantMessage(content) {
  const text = content || ''
  const parts = []
  let lastIndex = 0
  let match
  MARKER_PATTERN.lastIndex = 0
  while ((match = MARKER_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    parts.push({
      type: 'doc',
      documentId: match[1],
      fileName: match[2],
      page: match[3] ? Number(match[3]) : null,
      quote: match[4] ? match[4].trim() || null : null
    })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', text: text.slice(lastIndex) })
  return parts
}

// Where a click on a reference leads from a page without its own viewer
// (the case page): Tax Summary, opened directly on that point.
export function summaryLinkFor(caseId, { documentId, page = null, quote = null }) {
  const params = new URLSearchParams({ doc: documentId })
  if (page) params.set('page', String(page))
  if (quote) params.set('quote', quote)
  return `/year/${caseId}/summary?${params.toString()}`
}

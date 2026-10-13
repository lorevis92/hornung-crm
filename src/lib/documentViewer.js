// Opening the document an extracted value came from: always in a NEW browser
// tab, on the app's own full-page viewer route (src/pages/DocumentViewer.jsx)
// — same login, same permissions, never a raw link to the file. The page to
// show and the sentence to highlight travel in the URL:
//   /documents/<client_documents.id>/view?page=3&quote=<sentence>
// Without page and sentence the document opens from the start.

export function documentViewerLink(documentId, { page = null, quote = null } = {}) {
  const params = new URLSearchParams()
  if (page) params.set('page', String(page))
  if (quote) params.set('quote', quote)
  const query = params.toString()
  return `/documents/${encodeURIComponent(documentId)}/view${query ? `?${query}` : ''}`
}

// The viewer's side: URLSearchParams -> { page, quote }.
export function readViewerParams(searchParams) {
  const page = Number(searchParams.get('page'))
  return {
    page: Number.isInteger(page) && page > 0 ? page : null,
    quote: searchParams.get('quote') || null
  }
}

export function openDocumentViewer(documentId, source = {}) {
  window.open(documentViewerLink(documentId, source), '_blank', 'noopener')
}

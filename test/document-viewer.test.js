// "View in document" opens a new browser tab on the app's own full-page
// viewer route, /documents/<id>/view?page=&quote= (src/pages/DocumentViewer.jsx,
// src/lib/documentViewer.js) — same login and permissions as the rest of the
// app, never a raw link to the file — and shows the right page with the
// right sentence highlighted, exactly as the inline viewer did.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { documentViewerLink, readViewerParams } from '../src/lib/documentViewer.js'

vi.mock('../src/components/PdfSourceViewer.jsx', () => ({ default: function PdfSourceViewer() { return null } }))

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const QUOTE = 'Premio annuo assicurazione di base | Sara Bianchi & figli: CHF 4’812.00 (LAMal)'

describe('the viewer link', () => {
  it('carries document, page and sentence, and reads them back exactly', () => {
    const link = documentViewerLink('doc-7', { page: 3, quote: QUOTE })
    const url = new URL(link, 'https://example.test')
    expect(url.pathname).toBe('/documents/doc-7/view')
    expect(readViewerParams(url.searchParams)).toEqual({ page: 3, quote: QUOTE })
  })

  it('without page and sentence opens the document from the start', () => {
    expect(documentViewerLink('doc-7')).toBe('/documents/doc-7/view')
    expect(readViewerParams(new URLSearchParams(''))).toEqual({ page: null, quote: null })
  })

  it('ignores a page that is not a page number', () => {
    expect(readViewerParams(new URLSearchParams('page=abc&quote=x')).page).toBeNull()
    expect(readViewerParams(new URLSearchParams('page=0')).page).toBeNull()
  })

  it('always opens in a new tab', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    return import('../src/lib/documentViewer.js').then(({ openDocumentViewer }) => {
      openDocumentViewer('doc-7', { page: 2, quote: 'abc' })
      expect(open).toHaveBeenCalledWith('/documents/doc-7/view?page=2&quote=abc', '_blank', 'noopener')
      vi.unstubAllGlobals()
    })
  })
})

describe('the viewer page', () => {
  it('loads the document and a signed URL through the app (same login, same permissions)', async () => {
    const { loadViewerDocument } = await import('../src/pages/DocumentViewer.jsx')
    const doc = { id: 'doc-7', file_name: '07_premi.pdf', mime_type: 'application/pdf', storage_path: 'x/07.pdf' }
    const api = {
      getClientDocument: vi.fn(async (id) => (id === 'doc-7' ? doc : null)),
      getDownloadUrl: vi.fn(async () => 'https://signed.example/07.pdf?token=1')
    }
    expect(await loadViewerDocument(api, 'doc-7')).toEqual({ doc, fileUrl: 'https://signed.example/07.pdf?token=1' })
    expect(api.getDownloadUrl).toHaveBeenCalledWith(doc, { download: false })
    // Not found, or not allowed by RLS: nothing to show, no URL asked for.
    expect(await loadViewerDocument(api, 'other')).toBeNull()
    expect(api.getDownloadUrl).toHaveBeenCalledTimes(1)
  })

  it('shows the page and highlights the sentence given in the URL', async () => {
    const { DocumentViewerView } = await import('../src/pages/DocumentViewer.jsx')
    const { page, quote } = readViewerParams(new URL(documentViewerLink('doc-7', { page: 3, quote: QUOTE }), 'https://x.test').searchParams)
    const doc = { id: 'doc-7', file_name: '07_premi.pdf', mime_type: 'application/pdf' }
    const onBack = () => {}

    const tree = DocumentViewerView({ doc, fileUrl: 'https://signed.example/07.pdf', page, quote, onBack })
    const [title, suspense] = tree.props.children
    expect(title.props.children).toBe('07_premi.pdf')
    const viewer = suspense.props.children
    expect(viewer.props).toEqual({
      fileUrl: 'https://signed.example/07.pdf',
      isPdf: true,
      isText: false,
      fileName: '07_premi.pdf',
      page: 3,
      quote: QUOTE,
      onBack
    })
  })

  it('the viewer opens on that page and highlights the sentence only there', () => {
    const viewer = read('src/components/PdfSourceViewer.jsx')
    expect(viewer).toMatch(/useState\(page \|\| 1\)/)
    expect(viewer).toMatch(/renderPage\(pdf, Math\.min\(Math\.max\(1, page \|\| 1\), pdf\.numPages\)\)/)
    expect(viewer).toMatch(/if \(quote && clamped === \(page \|\| 1\)\)/)
  })
})

describe('the route', () => {
  const app = read('src/App.jsx')

  it('is part of the app, behind the staff login', () => {
    expect(app).toMatch(/path="\/documents\/:documentId\/view"\s+element=\{\s+<Protected staffOnly bare>\s+<DocumentViewer \/>/)
  })

  it('replaces the inline viewer: Tax Summary no longer switches to a viewer inside the page', () => {
    const taxSummary = read('src/pages/TaxSummary.jsx')
    expect(taxSummary).not.toMatch(/PdfSourceViewer|view=source|'view'/)
  })
})

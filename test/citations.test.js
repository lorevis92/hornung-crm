// An assistant answer built on an extracted value must open the document
// where that value came from: the context gives every value its own marker
// carrying page and sentence (src/lib/citations.js), the chat turns it into a
// click with that page and sentence, Tax Summary hands both to the same
// viewer the fields use, in a new tab, from whichever page the chat is open
// on. A reference to a document in general still opens it from the start.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildCaseAssistantContext } from '../src/lib/caseAssistantContext.js'
import { documentMarker, parseAssistantMessage, sourceMarker } from '../src/lib/citations.js'
import { documentViewerLink, readViewerParams } from '../src/lib/documentViewer.js'
import { findQuoteItemIndexes } from '../src/lib/pdfHighlight.js'

const doc = { id: 'doc-7', file_name: '07_premi_cassa_malati.pdf', category_code: 'health_insurance_policy', status: 'extracted' }
const QUOTE = 'Premio annuo assicurazione di base | Sara Bianchi [LAMal] CHF 4’812.00 dovuto entro il 31.01.2025, pagabile in dodici rate mensili tramite ordine permanente'

const context = buildCaseAssistantContext({
  client: { id: 'client-1', first_name: 'Sara', last_name: 'Bianchi' },
  caseRow: { tax_year: 2025, status: 'in_process' },
  primaryPerson: { first_name: 'Sara', last_name: 'Bianchi' },
  children: [],
  documents: [doc],
  extractedFields: [
    { document_id: 'doc-7', row_key: 'row-1', field_key: 'annual_premium', field_value: '4812.00', source_quote: QUOTE, source_page: 3 },
    { document_id: 'doc-7', row_key: 'row-1', field_key: 'insured_person_name', field_value: 'Sara Bianchi', source_quote: null, source_page: null }
  ],
  categories: [{ code: 'health_insurance_policy', label_en: 'Health insurance' }],
  fieldDefs: [
    { category_code: 'health_insurance_policy', field_key: 'insured_person_name', field_label: 'Insured person', sort_order: 10 },
    { category_code: 'health_insurance_policy', field_key: 'annual_premium', field_label: 'Annual premium', sort_order: 20 }
  ],
  otherFindings: [],
  qualityFindings: []
})

// The marker the model would copy, exactly as the context prints it.
const valueMarker = context.match(/Annual premium: 4812\.00 (\[\[doc:[^\]]+\]\])/)[1]

describe('the context', () => {
  it('prints, next to each extracted value, a marker with its page and its sentence', () => {
    expect(valueMarker).toMatch(/^\[\[doc:doc-7\|07_premi_cassa_malati\.pdf\|p3\|Premio annuo/)
  })

  it('keeps the plain document marker for the document in general and for a value without a source', () => {
    expect(context).toContain(`${documentMarker(doc)} — type: Health insurance`)
    expect(context).toContain(`Insured person: Sara Bianchi ${documentMarker(doc)}`)
  })

  it('never lets the sentence break the marker (brackets, pipes and length are taken care of)', () => {
    const marker = sourceMarker(doc, { page: 3, quote: QUOTE })
    expect(marker.match(/\|/g)).toHaveLength(3)
    expect(marker.slice(2, -2)).not.toMatch(/[[\]]/)
    expect(marker.length).toBeLessThan(200)
  })
})

describe('a reply that cites the value', () => {
  const reply = `Il premio annuo di Sara è di CHF 4'812 ${valueMarker}. Vedi anche ${documentMarker(doc)}.`
  const parts = parseAssistantMessage(reply).filter((p) => p.type === 'doc')

  it('becomes a click carrying the page and the sentence', () => {
    expect(parts[0]).toMatchObject({ documentId: 'doc-7', fileName: '07_premi_cassa_malati.pdf', page: 3 })
    expect(parts[0].quote).toMatch(/^Premio annuo assicurazione di base/)
  })

  it('and a reference to the document in general opens it from the start', () => {
    expect(parts[1]).toEqual({ type: 'doc', documentId: 'doc-7', fileName: '07_premi_cassa_malati.pdf', page: null, quote: null })
  })

  it('highlights the right text on that page, even though the sentence was shortened', () => {
    const pageItems = ['Riepilogo premi 2025', 'Premio annuo assicurazione di base', 'Sara Bianchi', 'LAMal', 'CHF 4’812.00']
    expect(findQuoteItemIndexes(pageItems, parts[0].quote)).toEqual(expect.arrayContaining([1, 2]))
  })

  it('leads to the viewer opened on that page and sentence', () => {
    const url = new URL(documentViewerLink(parts[0].documentId, parts[0]), 'https://example.test')
    expect(url.pathname).toBe('/documents/doc-7/view')
    expect(readViewerParams(url.searchParams)).toEqual({ page: 3, quote: parts[0].quote })
    // A general reference carries no page or sentence.
    expect(documentViewerLink(parts[1].documentId, parts[1])).toBe('/documents/doc-7/view')
  })
})

describe('the wiring between chat, pages and viewer', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

  it('the chat opens the viewer with page and sentence on every click', () => {
    expect(read('src/components/CaseAssistant.jsx')).toMatch(
      /openDocumentViewer\(part\.documentId, \{ page: part\.page, quote: part\.quote \}\)/
    )
  })

  it('Tax Summary\'s source links open the same viewer, at the value\'s page and sentence', () => {
    expect(read('src/components/summary/SummaryDocument.jsx')).toMatch(
      /openDocumentViewer\(doc\.id, \{ page: source_page, quote: source_quote \}\)/
    )
  })
})

// Opening a case used to send one database request per document for its
// extracted fields (Promise.all over the documents) — the main reason a case
// with many documents was slow. Now Tax Summary asks for all of them in ONE
// request (and the server in ONE .in('document_id', ...) query — see
// test/data-authz.test.js), the same way the "other information found"
// already were. These tests run the real loader against the real browser
// data layer, with only fetch() replaced by a recorder: the browser no
// longer queries the database itself, it calls POST /api/data/<op>.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const requests = []

// What each server op answers, whatever the arguments.
const OP_DATA = {
  getCase: { id: 'case-1', client_id: 'client-1', tax_year: 2025, client: {} },
  listClientDocuments: Array.from({ length: 12 }, (_, i) => ({ id: `doc-${i}`, file_name: `doc-${i}.pdf`, category_code: 'salary_statement' })),
  listDocumentCategories: [],
  listFieldDefinitions: [],
  getQuestionnaire: { details: {}, persons: [], children: [], vehicles: [], properties: [] },
  listExtractedFieldsForDocuments: [
    { document_id: 'doc-0', field_key: 'gross_salary', field_value: '95000', row_key: '' },
    { document_id: 'doc-7', field_key: 'gross_salary', field_value: '61000', row_key: '' }
  ],
  listOtherFindingsForDocuments: []
}

let supabaseApi
let loadTaxSummary

beforeEach(async () => {
  requests.length = 0
  vi.stubGlobal('fetch', async (url, init) => {
    const op = String(url).replace('/api/data/', '')
    requests.push({ op, body: JSON.parse(init.body), credentials: init.credentials })
    return { ok: true, status: 200, json: async () => ({ data: OP_DATA[op] ?? null }) }
  })
  ;({ supabaseApi } = await import('../src/lib/data/supabaseData.js'))
  ;({ loadTaxSummary } = await import('../src/lib/taxSummaryData.js'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loading Tax Summary for a case with 12 documents', () => {
  it('asks for the extracted fields of all documents in ONE request', async () => {
    const data = await loadTaxSummary(supabaseApi, 'case-1')

    const fieldRequests = requests.filter((r) => r.op === 'listExtractedFieldsForDocuments')
    expect(fieldRequests).toHaveLength(1)
    expect(fieldRequests[0].body).toEqual({ documentIds: OP_DATA.listClientDocuments.map((d) => d.id) })
    // ... and the same for the other information found.
    expect(requests.filter((r) => r.op === 'listOtherFindingsForDocuments')).toHaveLength(1)

    // Nothing else changed: the same data comes back, attached to its document.
    expect(data.documents).toHaveLength(12)
    expect(data.extractedFields.map((f) => f.document_id)).toEqual(['doc-0', 'doc-7'])
  })

  it('the number of requests no longer grows with the number of documents', async () => {
    await loadTaxSummary(supabaseApi, 'case-1')
    // case, documents, categories, field dictionary, questionnaire, fields,
    // findings — whatever the number of documents.
    expect(requests.map((r) => r.op)).toHaveLength(7)
  })

  it('every request carries the session cookie (same-origin) and goes to our own API', async () => {
    await loadTaxSummary(supabaseApi, 'case-1')
    expect(requests.every((r) => r.credentials === 'same-origin')).toBe(true)
  })

  it('sends no request at all for the fields of a case without documents', async () => {
    expect(await supabaseApi.listExtractedFieldsForDocuments([])).toEqual([])
    expect(requests).toHaveLength(0)
  })
})

describe('the loader itself', () => {
  it('never falls back to one request per document', async () => {
    const perDocument = vi.fn(async () => [])
    const allAtOnce = vi.fn(async () => [])
    const api = {
      getCase: async () => ({ id: 'case-1', client_id: 'client-1', tax_year: 2025, client: {} }),
      listClientDocuments: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      listDocumentCategories: async () => [],
      listFieldDefinitions: async () => [],
      getQuestionnaire: async () => ({ persons: [], children: [] }),
      listExtractedFieldsForDocument: perDocument,
      listExtractedFieldsForDocuments: allAtOnce,
      listOtherFindingsForDocuments: async () => []
    }
    await loadTaxSummary(api, 'case-1')
    expect(perDocument).not.toHaveBeenCalled()
    expect(allAtOnce).toHaveBeenCalledTimes(1)
    expect(allAtOnce).toHaveBeenCalledWith(['a', 'b', 'c'])
  })
})

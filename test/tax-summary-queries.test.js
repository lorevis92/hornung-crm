// Opening a case used to send one database request per document for its
// extracted fields (Promise.all over the documents) — the main reason a case
// with many documents was slow. Now Tax Summary asks for all of them in ONE
// query (.in('document_id', ...)), the same way the "other information
// found" already were. These tests run the real loader against the real
// Supabase data layer, with only the Supabase client replaced by a recorder.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const queries = []

// A recording stand-in for supabase-js: every from(table) is one request;
// filters are noted, and the data returned depends only on the table.
const TABLE_DATA = {
  tax_cases: { id: 'case-1', client_id: 'client-1', tax_year: 2025, client: {} },
  client_documents: Array.from({ length: 12 }, (_, i) => ({ id: `doc-${i}`, file_name: `doc-${i}.pdf`, category_code: 'salary_statement' })),
  document_categories: [],
  category_field_definitions: [],
  client_details: null,
  client_persons: [],
  client_children: [],
  client_vehicles: [],
  client_properties: [],
  extracted_document_fields: [
    { document_id: 'doc-0', field_key: 'gross_salary', field_value: '95000', row_key: '' },
    { document_id: 'doc-7', field_key: 'gross_salary', field_value: '61000', row_key: '' }
  ],
  document_other_findings: []
}

vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: {
    from(table) {
      const query = { table, filters: [] }
      queries.push(query)
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: (column, value) => {
          query.filters.push(['eq', column, value])
          return builder
        },
        in: (column, values) => {
          query.filters.push(['in', column, values])
          return builder
        },
        maybeSingle: () => Promise.resolve({ data: TABLE_DATA[table], error: null }),
        then: (resolve, reject) => Promise.resolve({ data: TABLE_DATA[table], error: null }).then(resolve, reject)
      }
      return builder
    }
  }
}))

let supabaseApi
let loadTaxSummary

beforeEach(async () => {
  queries.length = 0
  ;({ supabaseApi } = await import('../src/lib/data/supabaseData.js'))
  ;({ loadTaxSummary } = await import('../src/lib/taxSummaryData.js'))
})

describe('loading Tax Summary for a case with 12 documents', () => {
  it('asks for the extracted fields of all documents in ONE query', async () => {
    const data = await loadTaxSummary(supabaseApi, 'case-1')

    const fieldQueries = queries.filter((q) => q.table === 'extracted_document_fields')
    expect(fieldQueries).toHaveLength(1)
    expect(fieldQueries[0].filters).toEqual([['in', 'document_id', TABLE_DATA.client_documents.map((d) => d.id)]])
    // ... and the same for the other information found.
    expect(queries.filter((q) => q.table === 'document_other_findings')).toHaveLength(1)

    // Nothing else changed: the same data comes back, attached to its document.
    expect(data.documents).toHaveLength(12)
    expect(data.extractedFields.map((f) => f.document_id)).toEqual(['doc-0', 'doc-7'])
  })

  it('the number of requests no longer grows with the number of documents', async () => {
    await loadTaxSummary(supabaseApi, 'case-1')
    // case, documents, categories, field dictionary, the 5 questionnaire
    // tables, fields, findings — whatever the number of documents.
    expect(queries).toHaveLength(11)
  })

  it('sends no query at all for the fields of a case without documents', async () => {
    expect(await supabaseApi.listExtractedFieldsForDocuments([])).toEqual([])
    expect(queries).toHaveLength(0)
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

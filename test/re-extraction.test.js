// What happens the SECOND time a document is extracted.
//
// Everything about extraction was tested on a first run against a fixture,
// which is why these two bugs survived 158 green tests: both only appear on
// a re-extraction of a document that already has rows, which no fixture
// test ever performed.
//
//  1. The rows a previous extraction wrote were never removed. The upsert
//     keys on (document_id, field_key, row_key), and row_key is chosen
//     afresh by the model on every run — so re-extracting a document that
//     had produced "row-1"/"row-2" and now produces "row-a"/"row-b" kept
//     BOTH sets. On screen that reads as "the re-extraction did nothing",
//     because the old values are still sitting there.
//
//  2. A run that threw left the document claimed as 'extracting' forever.
//     runExtraction sets that status before doing any work, and only
//     api/extract-document.js's own HTTP handler undid it on failure —
//     api/retry-extraction.js and api/reprocess-client-year.js call
//     runExtraction directly, so their failures were invisible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Supabase that records what was asked of it. Only the handful of
// calls runExtraction makes are modelled; anything else throws loudly
// rather than silently returning undefined.
function makeAdmin({ documentRow, existingFields = [] }) {
  const state = {
    documentRow: { ...documentRow },
    fields: existingFields.map((f) => ({ ...f })),
    deletedIds: [],
    upserted: [],
    statusUpdates: []
  }

  const documentsTable = () => ({
    update(patch) {
      const chain = {
        _eq: {},
        eq(column, value) {
          this._eq[column] = value
          return this
        },
        select() {
          return this
        },
        async maybeSingle() {
          // The atomic claim: only succeeds while the row still has the
          // status the caller expected.
          if (chain._eq.status && state.documentRow.status !== chain._eq.status) return { data: null, error: null }
          Object.assign(state.documentRow, patch)
          state.statusUpdates.push(patch.status)
          return { data: { ...state.documentRow }, error: null }
        },
        then(resolve) {
          if (chain._eq.status && state.documentRow.status !== chain._eq.status) {
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          Object.assign(state.documentRow, patch)
          state.statusUpdates.push(patch.status)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        }
      }
      return chain
    },
    select() {
      return {
        eq: () => ({ maybeSingle: async () => ({ data: { ...state.documentRow }, error: null }) })
      }
    }
  })

  const fieldsTable = () => ({
    async upsert(rows) {
      state.upserted.push(...rows)
      for (const row of rows) {
        const existing = state.fields.find(
          (f) => f.field_key === row.field_key && (f.row_key || '') === (row.row_key || '')
        )
        if (existing) Object.assign(existing, row)
        else state.fields.push({ id: `new-${state.fields.length}`, ...row })
      }
      return { error: null }
    },
    select() {
      return {
        async eq() {
          return { data: state.fields.map((f) => ({ ...f })), error: null }
        }
      }
    },
    delete() {
      return {
        async in(_column, ids) {
          state.deletedIds.push(...ids)
          state.fields = state.fields.filter((f) => !ids.includes(f.id))
          return { error: null }
        }
      }
    }
  })

  const admin = {
    state,
    from(table) {
      if (table === 'client_documents') return documentsTable()
      if (table === 'extracted_document_fields') return fieldsTable()
      if (table === 'ai_model_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      }
      if (table === 'category_field_definitions') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  { field_key: 'institution_name', field_label: 'Institution', value_type: 'text' },
                  { field_key: 'account_balance_31_12', field_label: 'Balance', value_type: 'numeric' }
                ],
                error: null
              })
            })
          })
        }
      }
      if (table === 'document_categories') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [{ code: 'bank_securities_crypto_statement', label_en: 'Bank statement' }],
                error: null
              })
            })
          })
        }
      }
      // The persons of the case, offered to the model as the only possible
      // answers to "whom is this document about".
      if (table === 'client_persons') {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                { person_type: 'primary', first_name: 'Giulia', last_name: 'Weber' },
                { person_type: 'spouse', first_name: 'Lina', last_name: 'Weber' }
              ],
              error: null
            })
          })
        }
      }
      if (table === 'client_children') {
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: [{ id: 'child-1', full_name: 'Noah Weber' }], error: null }) })
          })
        }
      }
      if (table === 'document_other_findings') {
        return {
          delete: () => ({ async eq() { return { error: null } } }),
          async insert() { return { error: null } }
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
    storage: {
      from: () => ({
        async download() {
          return { data: { async text() { return 'statement text' } }, error: null }
        }
      })
    }
  }
  return admin
}

function makeAnthropic(fieldsPayload, { failExtraction = false, documentPerson = null } = {}) {
  return {
    messages: {
      create: vi.fn(async ({ max_tokens: maxTokens }) => {
        // The three phases are told apart by their token budget:
        // classify (200), extract (4000), coverage check (2000).
        if (maxTokens === 200) {
          return {
            content: [{ type: 'text', text: '{"category_code": "bank_securities_crypto_statement"}' }]
          }
        }
        if (maxTokens === 2000) return { content: [{ type: 'text', text: '[]' }] }
        if (failExtraction) throw new Error('rate limited')
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ document_person: documentPerson, fields: fieldsPayload, other_findings: [] })
            }
          ]
        }
      })
    }
  }
}

const DOCUMENT = {
  id: 'doc-1',
  client_id: 'client-1',
  tax_year: 2025,
  status: 'extracted',
  mime_type: 'text/plain',
  storage_path: 'x/y.txt',
  category_code: 'bank_securities_crypto_statement'
}

let runExtraction

beforeEach(async () => {
  vi.resetModules()
  // The registry catch-up is a separate concern with its own tests, and it
  // would otherwise need half the schema modelled here.
  vi.doMock('../api/_registrySync.js', () => ({ syncRegistryForClientYear: async () => {} }))
  ;({ runExtraction } = await import('../api/extract-document.js'))
})

afterEach(() => {
  vi.doUnmock('../api/_registrySync.js')
})

describe('re-extracting a document that already has rows', () => {
  it('removes the rows the new run no longer produces', async () => {
    const admin = makeAdmin({
      documentRow: DOCUMENT,
      existingFields: [
        // What a previous run wrote, under its own row keys.
        { id: 'old-1', field_key: 'institution_name', row_key: 'row-1', field_value: 'Banque A' },
        { id: 'old-2', field_key: 'account_balance_31_12', row_key: 'row-1', field_value: '100.00' },
        { id: 'old-3', field_key: 'account_balance_31_12', row_key: 'row-2', field_value: '200.00' }
      ]
    })
    const anthropic = makeAnthropic([
      // The new run calls the same account something else.
      { field_key: 'institution_name', row_key: 'row-a', field_value: 'Banque A', confidence: 0.9 },
      { field_key: 'account_balance_31_12', row_key: 'row-a', field_value: '150.00', confidence: 0.9 }
    ])

    await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })

    expect(admin.state.deletedIds.sort()).toEqual(['old-1', 'old-2', 'old-3'])
    const remaining = admin.state.fields.map((f) => `${f.field_key}:${f.row_key}`).sort()
    expect(remaining).toEqual(['account_balance_31_12:row-a', 'institution_name:row-a'])
    // The stale 100.00 and 200.00 are gone; only what the document says now
    // is on record.
    expect(admin.state.fields.map((f) => f.field_value)).toContain('150.00')
    expect(admin.state.fields.map((f) => f.field_value)).not.toContain('200.00')
  })

  it('keeps exactly what the new run read — there is no hand-edited exception any more', async () => {
    const admin = makeAdmin({
      documentRow: DOCUMENT,
      existingFields: [
        { id: 'old-1', field_key: 'account_balance_31_12', row_key: 'row-1', field_value: '100.00' },
        // Corrected by hand under the old review flow: Tax Summary is now
        // read-only, so the document itself is the only source of truth.
        { id: 'old-edited', field_key: 'institution_name', row_key: 'row-9', field_value: 'Banque', verified_by_specialist: true }
      ]
    })
    const anthropic = makeAnthropic([
      { field_key: 'account_balance_31_12', row_key: 'row-a', field_value: '150.00', confidence: 0.9 }
    ])

    await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })

    expect(admin.state.deletedIds.sort()).toEqual(['old-1', 'old-edited'])
    expect(admin.state.fields.map((f) => f.field_value)).toEqual(['150.00'])
  })

  it('leaves nothing behind when the document now yields exactly the same rows', async () => {
    const admin = makeAdmin({
      documentRow: DOCUMENT,
      existingFields: [
        { id: 'old-1', field_key: 'institution_name', row_key: 'row-1', field_value: 'Banque A' }
      ]
    })
    const anthropic = makeAnthropic([
      { field_key: 'institution_name', row_key: 'row-1', field_value: 'Banque A', confidence: 0.9 }
    ])

    await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })
    expect(admin.state.deletedIds).toEqual([])
    expect(admin.state.fields).toHaveLength(1)
  })
})

describe('a run that fails', () => {
  it('does not leave the document stuck at "extracting"', async () => {
    const admin = makeAdmin({ documentRow: DOCUMENT })
    const anthropic = makeAnthropic([], { failExtraction: true })

    await expect(
      runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })
    ).rejects.toThrow('rate limited')

    // Claimed, then released as failed — not abandoned mid-pipeline with
    // Tax Summary reporting it as still processing forever.
    expect(admin.state.statusUpdates).toContain('extracting')
    expect(admin.state.documentRow.status).toBe('extraction_failed')
    expect(admin.state.documentRow.extraction_error).toContain('rate limited')
  })
})

describe('a run whose document was claimed by someone else', () => {
  it('reports that it did nothing instead of looking like a success', async () => {
    const admin = makeAdmin({ documentRow: { ...DOCUMENT, status: 'extracting' } })
    const anthropic = makeAnthropic([])

    // The caller believed the document was 'extracted'; by now it is not.
    const result = await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })

    expect(result).toEqual({ claimed: false, documentId: 'doc-1' })
    expect(anthropic.messages.create).not.toHaveBeenCalled()
  })

  it('reports a real run as a real run', async () => {
    const admin = makeAdmin({ documentRow: DOCUMENT })
    const anthropic = makeAnthropic([
      { field_key: 'institution_name', row_key: '', field_value: 'Banque A', confidence: 0.9 }
    ])
    const result = await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })
    expect(result).toEqual({ claimed: true, documentId: 'doc-1' })
  })
})

describe('whom the document refers to, and what each row is called', () => {
  it('saves the person the model chose among the persons of the case, with the sentence that shows it', async () => {
    const admin = makeAdmin({ documentRow: DOCUMENT })
    const anthropic = makeAnthropic(
      [{ field_key: 'institution_name', row_key: '', field_value: 'Banque A', confidence: 0.9 }],
      { documentPerson: { ref: 'spouse', quote: 'Titolare: Lina Weber', page: null } }
    )

    await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })

    expect(admin.state.documentRow).toMatchObject({
      status: 'extracted',
      person_ref: 'spouse',
      person_name: 'Lina Weber',
      person_quote: 'Titolare: Lina Weber'
    })
    // The prompt offered exactly the persons of this case, by code.
    const prompt = anthropic.messages.create.mock.calls
      .map(([call]) => call.messages[0].content.find((b) => b.type === 'text' && b.text.includes('WHOM'))?.text)
      .find(Boolean)
    expect(prompt).toContain('"taxpayer"')
    expect(prompt).toContain('Giulia Weber')
    expect(prompt).toContain('"child:child-1"')
    expect(prompt).toContain('Noah Weber')
    expect(prompt).toContain('"unknown"')
  })

  it('never saves a person that is not one of the case — it becomes "cannot be determined"', async () => {
    const admin = makeAdmin({ documentRow: DOCUMENT })
    const anthropic = makeAnthropic(
      [{ field_key: 'institution_name', row_key: '', field_value: 'Banque A', confidence: 0.9 }],
      { documentPerson: { ref: 'Mario Rossi', quote: 'Mario Rossi' } }
    )

    await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })

    expect(admin.state.documentRow.person_ref).toBe('unknown')
    expect(admin.state.documentRow.person_quote).toBeNull()
  })

  it('gives every field of a row the same readable label', async () => {
    const admin = makeAdmin({ documentRow: DOCUMENT })
    const anthropic = makeAnthropic([
      { field_key: 'institution_name', row_key: 'row-1', row_label: 'Conto risparmio UBS – Giulia Weber', field_value: 'UBS' },
      { field_key: 'account_balance_31_12', row_key: 'row-1', row_label: 'Conto UBS', field_value: '150.00' }
    ])

    await runExtraction(admin, anthropic, 'doc-1', { fromStatuses: ['extracted'] })

    expect(admin.state.upserted.map((r) => r.row_label)).toEqual([
      'Conto risparmio UBS – Giulia Weber',
      'Conto risparmio UBS – Giulia Weber'
    ])
  })
})

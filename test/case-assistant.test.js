// Regression tests for the case assistant endpoint (api/case-assistant.js)
// and its pure context builder (src/lib/caseAssistantContext.js):
//  - a non-staff caller (e.g. a client) is rejected before any case data is
//    ever touched;
//  - a caseId that doesn't resolve to a real case is rejected;
//  - the context built for one client's case never contains another
//    client's data, checked both at the pure-builder level and at the
//    handler level (by asserting on the exact system prompt sent to the
//    model);
//  - the context describes documents, whom they refer to, their extracted
//    rows and the notes Tax Summary shows — never a taxable total or any
//    other computed tax figure, which this app does not produce.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { buildCaseAssistantContext } from '../src/lib/caseAssistantContext.js'
import { parseAssistantMessage } from '../src/lib/citations.js'

// ---------------------------------------------------------------------------
// buildCaseAssistantContext — pure logic
// ---------------------------------------------------------------------------
describe('buildCaseAssistantContext', () => {
  const baseArgs = {
    client: { id: 'client-1', first_name: 'Sara', last_name: 'Bianchi', email: 'sara@example.com' },
    caseRow: { tax_year: 2025, status: 'in_process', client_message: null },
    primaryPerson: { first_name: 'Sara', last_name: 'Bianchi', marital_status: 'divorced' },
    spousePerson: null,
    children: [{ full_name: 'Matteo Bianchi' }],
    documents: [
      { id: 'doc-1', file_name: '02_certificato_salario.pdf', category_code: 'salary_statement', status: 'extracted' }
    ],
    extractedFields: [
      { document_id: 'doc-1', field_key: 'gross_salary', field_value: '95000', row_key: '' }
    ],
    categories: [{ code: 'salary_statement', label_en: 'Salary statement' }],
    fieldDefs: [{ category_code: 'salary_statement', field_key: 'gross_salary', field_label: 'Gross salary', sort_order: 10 }],
    qualityFindings: []
  }

  it('includes the client, the documents (with a clickable-marker reference) and their extracted values', () => {
    const context = buildCaseAssistantContext(baseArgs)
    expect(context).toContain('Sara Bianchi')
    expect(context).toContain('[[doc:doc-1|02_certificato_salario.pdf]]')
    expect(context).toContain('Gross salary: 95000')
  })

  it('tells the assistant about what a document says beyond the defined fields', () => {
    const context = buildCaseAssistantContext({
      ...baseArgs,
      otherFindings: [
        {
          id: 'f-1',
          document_id: 'doc-1',
          label: 'Indennità di trasloco',
          finding_value: '3200.00',
          source_quote: 'Umzugsentschädigung CHF 3’200.00',
          needs_review: false
        },
        {
          id: 'f-2',
          document_id: 'doc-1',
          label: 'Importo non identificato',
          finding_value: '450.00',
          source_quote: 'Rif. 44-A 450.00',
          needs_review: true
        }
      ]
    })
    expect(context).toContain('Other information found: Indennità di trasloco: 3200.00')
    expect(context).toContain('Umzugsentschädigung CHF 3’200.00')
    // An uncertain one is included too — nothing found is dropped — but it
    // is never handed over as established fact.
    expect(context).toContain('Importo non identificato: 450.00')
    expect(context).toMatch(/UNCERTAIN/)
  })

  it('never describes a taxable total or any other computed tax figure — this app computes none', () => {
    const context = buildCaseAssistantContext(baseArgs)
    expect(context).not.toMatch(/taxable income/i)
    expect(context).not.toMatch(/taxable wealth/i)
    expect(context).not.toMatch(/deduction/i)
    expect(context).not.toMatch(/calculation breakdown/i)
  })

  it('lists the notes worth a second look, under the document they belong to', () => {
    const context = buildCaseAssistantContext({
      ...baseArgs,
      qualityFindings: [
        { kind: 'unidentifiedRow', documentId: 'doc-1', fileName: '02_certificato_salario.pdf', rowKey: 'row-2', detail: {} },
        {
          kind: 'reportedTotalMismatch',
          documentId: 'doc-1',
          fileName: '02_certificato_salario.pdf',
          rowKey: '',
          detail: { reportedTotal: 1000, rowsSum: 800 }
        }
      ]
    })
    expect(context).toMatch(/states nothing about whose it is/)
    expect(context).toContain('[[doc:doc-1|02_certificato_salario.pdf]]')
    expect(context).toMatch(/a row may be missing/i)
  })

  it('never contains another client\'s data — only what was explicitly passed in', () => {
    const context = buildCaseAssistantContext(baseArgs)
    expect(context).not.toContain('Weber')
    expect(context).not.toContain('giuliaweber@gmail.com')
  })
})

describe('parseAssistantMessage', () => {
  it('splits text and a document-reference marker into separate parts', () => {
    const parts = parseAssistantMessage('See [[doc:doc-1|02_certificato_salario.pdf]] for the source.')
    expect(parts).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'doc', documentId: 'doc-1', fileName: '02_certificato_salario.pdf', page: null, quote: null },
      { type: 'text', text: ' for the source.' }
    ])
  })

  it('falls through as plain text when there is no marker at all', () => {
    expect(parseAssistantMessage('Nothing to link here.')).toEqual([{ type: 'text', text: 'Nothing to link here.' }])
  })
})

// ---------------------------------------------------------------------------
// api/case-assistant.js — the handler itself
// ---------------------------------------------------------------------------
const requireStaffMock = vi.fn()
const readBodyMock = vi.fn()
const anthropicCreateMock = vi.fn()

vi.mock('../api/_lib.js', () => ({
  httpError: (status, code, message) => {
    const error = new Error(message || code)
    error.status = status
    error.code = code
    return error
  },
  readBody: (...args) => readBodyMock(...args),
  requireStaff: (...args) => requireStaffMock(...args)
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    constructor() {
      this.messages = { create: anthropicCreateMock }
    }
  }
}))

function fakeQuery(result) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    not: () => query,
    order: () => query,
    insert: () => query,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  }
  return query
}

// A table backed by real rows, real .eq()/.in() filtering and .insert()
// mutating the same in-memory array — used for the tables these tests need
// to actually filter (case_assistant_messages, ai_model_settings) instead
// of a single canned response. `insertHook`, if given, runs on every insert
// (used to auto-generate created_at ordering).
function makeFilterableTable(initialRows, { insertHook } = {}) {
  const rows = [...initialRows]
  return {
    from() {
      const filters = []
      let order = null
      const query = {
        select: () => query,
        eq: (col, val) => {
          filters.push((row) => row[col] === val)
          return query
        },
        in: (col, vals) => {
          filters.push((row) => vals.includes(row[col]))
          return query
        },
        not: () => query,
        order: (col, opts) => {
          order = { col, ascending: opts?.ascending !== false }
          return query
        },
        insert: (row) => {
          const inserted = insertHook ? insertHook(row) : row
          rows.push(inserted)
          return query
        },
        maybeSingle: () => Promise.resolve({ data: apply()[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: apply(), error: null }).then(resolve, reject)
      }
      function apply() {
        let result = rows.filter((row) => filters.every((f) => f(row)))
        if (order) {
          result = [...result].sort((a, b) => {
            const cmp = a[order.col] > b[order.col] ? 1 : a[order.col] < b[order.col] ? -1 : 0
            return order.ascending ? cmp : -cmp
          })
        }
        return result
      }
      return query
    }
  }
}

function makeAdmin(tables) {
  return {
    from(table) {
      const entry = tables[table]
      if (entry && entry.__filterable) return entry.table.from(table)
      return fakeQuery(entry ?? { data: null, error: null })
    }
  }
}

function makeRes() {
  const res = {}
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

let handler

beforeEach(async () => {
  requireStaffMock.mockReset()
  readBodyMock.mockReset()
  anthropicCreateMock.mockReset()
  anthropicCreateMock.mockResolvedValue({ content: [{ type: 'text', text: 'risposta di prova' }] })
  vi.resetModules()
  ;({ default: handler } = await import('../api/case-assistant.js'))
})

describe('api/case-assistant handler', () => {
  it('rejects a non-staff caller (e.g. the client themselves) before touching any case data', async () => {
    requireStaffMock.mockRejectedValue(
      Object.assign(new Error('Only Hornung Consulting staff may perform this action.'), { status: 403, code: 'NOT_STAFF' })
    )
    readBodyMock.mockReturnValue({ caseId: 'case-1', message: 'Da dove viene questo valore?' })

    const res = makeRes()
    await handler({ method: 'POST', headers: {} }, res)

    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('NOT_STAFF')
    expect(anthropicCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a caseId that does not resolve to a real case', async () => {
    requireStaffMock.mockResolvedValue({
      profile: { id: 'staff-1' },
      admin: makeAdmin({ tax_cases: { data: null, error: null } })
    })
    readBodyMock.mockReturnValue({ caseId: 'does-not-exist', message: 'Da dove viene questo valore?' })

    const res = makeRes()
    await handler({ method: 'POST', headers: {} }, res)

    expect(res.statusCode).toBe(404)
    expect(res.body.code).toBe('CASE_NOT_FOUND')
    expect(anthropicCreateMock).not.toHaveBeenCalled()
  })

  // Shared, minimal set of canned tables every handler call needs regardless
  // of what a specific test is checking — case_assistant_messages and
  // ai_model_settings are overridden per test with a real filterable table.
  function baseTables(overrides = {}) {
    return {
      tax_cases: { data: { id: 'case-1', client_id: 'client-1', tax_year: 2025, status: 'in_process' }, error: null },
      clients: { data: { id: 'client-1', first_name: 'Sara', last_name: 'Bianchi', email: 'sara@example.com' }, error: null },
      client_persons: { data: [{ person_type: 'primary', first_name: 'Sara', last_name: 'Bianchi' }], error: null },
      client_children: { data: [], error: null },
      client_documents: { data: [{ id: 'doc-1', file_name: '02_certificato_salario.pdf', category_code: 'salary_statement', status: 'extracted' }], error: null },
      extracted_document_fields: { data: [{ document_id: 'doc-1', field_key: 'gross_salary', field_value: '95000', row_key: '' }], error: null },
      document_categories: { data: [{ code: 'salary_statement', label_en: 'Salary statement' }], error: null },
      category_field_definitions: { data: [{ category_code: 'salary_statement', field_key: 'gross_salary', field_label: 'Gross salary' }], error: null },
      ai_model_settings: { data: null, error: null },
      ...overrides
    }
  }

  it('sends the model a system prompt containing only THIS case\'s data, never another client\'s', async () => {
    requireStaffMock.mockResolvedValue({
      profile: { id: 'staff-1' },
      admin: makeAdmin(baseTables({ case_assistant_messages: { data: [{ role: 'user', content: 'Da dove viene questo valore?' }], error: null } }))
    })
    readBodyMock.mockReturnValue({ caseId: 'case-1', message: 'Da dove viene questo valore?' })

    const res = makeRes()
    await handler({ method: 'POST', headers: {} }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.reply).toBe('risposta di prova')
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1)
    const call = anthropicCreateMock.mock.calls[0][0]
    expect(call.system).toContain('Sara Bianchi')
    expect(call.system).toContain('02_certificato_salario.pdf')
    expect(call.system).not.toContain('Weber')
    expect(call.system).not.toContain('giuliaweber@gmail.com')
  })

  it('a specialist only ever sees and continues their OWN conversation on a case, never a colleague\'s', async () => {
    // Two specialists have both talked to the assistant about the SAME
    // case — staff-2's own question/answer must never leak into staff-1's
    // history, in either direction.
    const messagesTable = makeFilterableTable(
      [
        { id: 'm1', case_id: 'case-1', role: 'user', content: 'Domanda di staff-1', created_by: 'staff-1', created_at: '2026-01-01T10:00:00Z' },
        { id: 'm2', case_id: 'case-1', role: 'assistant', content: 'Risposta per staff-1', created_by: 'staff-1', created_at: '2026-01-01T10:00:01Z' },
        { id: 'm3', case_id: 'case-1', role: 'user', content: 'Domanda RISERVATA di staff-2', created_by: 'staff-2', created_at: '2026-01-01T11:00:00Z' },
        { id: 'm4', case_id: 'case-1', role: 'assistant', content: 'Risposta RISERVATA per staff-2', created_by: 'staff-2', created_at: '2026-01-01T11:00:01Z' }
      ],
      { insertHook: (row) => ({ id: `m${Math.random()}`, created_at: new Date().toISOString(), ...row }) }
    )
    requireStaffMock.mockResolvedValue({
      profile: { id: 'staff-1' },
      admin: makeAdmin(baseTables({ case_assistant_messages: { __filterable: true, table: messagesTable } }))
    })
    readBodyMock.mockReturnValue({ caseId: 'case-1', message: 'Un\'altra domanda di staff-1' })

    const res = makeRes()
    await handler({ method: 'POST', headers: {} }, res)

    expect(res.statusCode).toBe(200)
    const call = anthropicCreateMock.mock.calls[0][0]
    const sentContents = call.messages.map((m) => m.content)
    expect(sentContents).toContain('Domanda di staff-1')
    expect(sentContents).toContain('Risposta per staff-1')
    expect(sentContents).not.toContain('Domanda RISERVATA di staff-2')
    expect(sentContents).not.toContain('Risposta RISERVATA per staff-2')

    // Both messages this call itself persists (the new question and the
    // reply) are tagged to staff-1, never left unattributed or to staff-2.
    const { data: allRows } = await messagesTable.from('case_assistant_messages').select('*')
    const newRows = allRows.filter((r) => !['m1', 'm2', 'm3', 'm4'].includes(r.id))
    expect(newRows).toHaveLength(2)
    expect(newRows.every((r) => r.created_by === 'staff-1')).toBe(true)
  })

  describe('AI model resolution (Tax settings "AI" tab)', () => {
    const originalEnv = process.env.ANTHROPIC_ASSISTANT_MODEL

    afterEach(() => {
      if (originalEnv === undefined) delete process.env.ANTHROPIC_ASSISTANT_MODEL
      else process.env.ANTHROPIC_ASSISTANT_MODEL = originalEnv
    })

    it('uses the model saved in ai_model_settings when present, ignoring the env var', async () => {
      process.env.ANTHROPIC_ASSISTANT_MODEL = 'claude-haiku-4-5-20251001'
      requireStaffMock.mockResolvedValue({
        profile: { id: 'staff-1' },
        admin: makeAdmin(
          baseTables({
            case_assistant_messages: { data: [{ role: 'user', content: 'ciao' }], error: null },
            ai_model_settings: { data: { model: 'claude-opus-5' }, error: null }
          })
        )
      })
      readBodyMock.mockReturnValue({ caseId: 'case-1', message: 'ciao' })

      const res = makeRes()
      await handler({ method: 'POST', headers: {} }, res)

      expect(res.statusCode).toBe(200)
      expect(anthropicCreateMock.mock.calls[0][0].model).toBe('claude-opus-5')
    })

    it('falls back to the ANTHROPIC_ASSISTANT_MODEL env var when no row is set', async () => {
      // ENV_MODEL is read once at module load (intentional — see
      // api/case-assistant.js's comment: an env var only ever changes via a
      // redeploy in production, unlike the database value), so the env var
      // must be set BEFORE this test's own fresh import, not just before
      // calling the handler.
      process.env.ANTHROPIC_ASSISTANT_MODEL = 'claude-haiku-4-5-20251001'
      vi.resetModules()
      ;({ default: handler } = await import('../api/case-assistant.js'))
      requireStaffMock.mockResolvedValue({
        profile: { id: 'staff-1' },
        admin: makeAdmin(
          baseTables({
            case_assistant_messages: { data: [{ role: 'user', content: 'ciao' }], error: null },
            ai_model_settings: { data: null, error: null }
          })
        )
      })
      readBodyMock.mockReturnValue({ caseId: 'case-1', message: 'ciao' })

      const res = makeRes()
      await handler({ method: 'POST', headers: {} }, res)

      expect(res.statusCode).toBe(200)
      expect(anthropicCreateMock.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001')
    })
  })
})

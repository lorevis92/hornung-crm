// POST /api/data/<op> replaces every query the browser used to send straight
// to Postgres, where RLS was the only thing keeping one client out of
// another's tax data. These tests call the real endpoint handler the way an
// attacker would — a valid session of their own, someone else's ids in the
// body — and check that the server, not the page, says no, and that nothing
// of the other client changed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-key'
  return { db: null }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => state.db }))

const { default: handler } = await import('../api/data/[op].js')
const { ops } = await import('../api/_dataOps.js')
const { buildWorld, IDS, PATHS, sessionCookie } = await import('./helpers/world.js')
const { makeReq, makeRes } = await import('./helpers/fakeSupabase.js')

async function call(op, body, cookie, headers = {}) {
  const res = makeRes()
  await handler(makeReq({ body, cookie, query: { op }, headers }), res)
  return res
}

let db
let asA
let asStaff
beforeEach(() => {
  db = buildWorld()
  state.db = db
  asA = sessionCookie(db, IDS.accA)
  asStaff = sessionCookie(db, IDS.accStaff)
})

// Every op, aimed at client B's records (or, for staff-only ops, at anything).
const CROSS_CLIENT = {
  listPricingItemsForStaff: {},
  createPricingItem: { payload: { code: 'x', price: 1 } },
  updatePricingItem: { id: 'price-1', patch: { price: 0 } },
  deletePricingItem: { id: 'price-1' },
  listClients: {},
  getClient: { id: IDS.cB },
  updateClient: { id: IDS.cB, patch: { email: 'attacker@evil.test' } },
  swapPrimaryAndSpouse: { clientId: IDS.cB },
  getQuestionnaire: { clientId: IDS.cB },
  saveQuestionnaire: { clientId: IDS.cB, payload: { details: {}, persons: [], children: [], vehicles: [], properties: [] } },
  listCases: { clientId: IDS.cB },
  getCase: { caseId: IDS.caseB },
  createCase: { clientId: IDS.cB, taxYear: 2023 },
  createOwnCase: { clientId: IDS.cB, taxYear: 2023 },
  updateCase: { caseId: IDS.caseB, patch: { status: 'finished' } },
  setCaseStatus: { caseId: IDS.caseB, status: 'finished' },
  getStats: { year: 2025 },
  listDocuments: { caseId: IDS.caseB },
  setDocumentCategory: { caseDocumentId: IDS.docB1, categoryCode: 'other' },
  listClientDocuments: { clientId: IDS.cB, taxYear: 2025 },
  getClientDocument: { documentId: IDS.cdB },
  getMirroredClientDocumentId: { caseDocumentId: IDS.docB1 },
  createUploadUrl: { caseId: IDS.caseB, fileName: 'x.pdf', direction: 'client_upload' },
  registerUploadedDocument: { caseId: IDS.caseB, path: PATHS.docB1, fileName: 'x.pdf', direction: 'client_upload' },
  deleteDocument: { id: IDS.docB1 },
  getDownloadUrl: { id: IDS.docB2 },
  listRequested: { caseId: IDS.caseB },
  setRequested: { caseId: IDS.caseB, typeIds: [] },
  createFieldDefinition: { payload: { category_code: 'salary_statement', field_key: 'x' } },
  updateFieldDefinition: { id: 'fd-1', patch: { field_key: 'y' } },
  deleteFieldDefinition: { id: 'fd-1' },
  listExtractedFieldsForDocument: { documentId: IDS.cdB },
  listExtractedFieldsForDocuments: { documentIds: [IDS.cdB] },
  listOtherFindingsForDocuments: { documentIds: [IDS.cdB] },
  listExtractedFields: { caseDocumentId: IDS.docB1 },
  listCaseAssistantMessages: { caseId: IDS.caseB },
  listAiModelSettings: {},
  saveAiModelSetting: { key: 'extraction', model: 'evil' },
  listFieldSuggestions: { clientId: IDS.cB },
  resolveFieldSuggestion: { suggestionId: IDS.sB, accept: true, suggestedValue: 'XX' }
}
// Readable by anyone with a profile (RLS: "read ... using (true)" / active prices).
const CATALOGUE = ['listDocumentTypes', 'listPricing', 'listDocumentCategories', 'listFieldDefinitions']
// Always about the caller themselves — no id in the request can redirect them.
const SELF = ['getMyClient', 'updateMyContact']

describe('every data operation is covered by an authorization test', () => {
  it('no op is left out of the lists above', () => {
    const covered = new Set([...Object.keys(CROSS_CLIENT), ...CATALOGUE, ...SELF])
    expect(Object.keys(ops).filter((op) => !covered.has(op))).toEqual([])
  })
})

describe('client A reaching for client B (or for staff-only data)', () => {
  for (const [op, body] of Object.entries(CROSS_CLIENT)) {
    it(`${op}: refused with 403, nothing of B changed or leaked`, async () => {
      const before = db.snapshot()
      const res = await call(op, body, asA)
      expect(res.statusCode).toBe(403)
      expect(res.body.data).toBeUndefined()
      expect(JSON.stringify(res.body)).not.toMatch(/secret|123456|9999|Bruno|b@client|private question/)
      expect(db.snapshot()).toBe(before)
      expect(db.signedUploads).toEqual([])
      expect(db.removed).toEqual([])
    })
  }
})

describe('without a valid session', () => {
  for (const op of Object.keys(ops)) {
    it(`${op}: 401 with no cookie`, async () => {
      const res = await call(op, CROSS_CLIENT[op] || {}, null)
      expect(res.statusCode).toBe(401)
    })
  }

  it('an unknown / forged session token is the same as none', async () => {
    const res = await call('getCase', { caseId: IDS.caseB }, 'hc_session=forged-token')
    expect(res.statusCode).toBe(401)
  })

  it('an expired session is refused and removed', async () => {
    const cookie = sessionCookie(db, IDS.accB)
    db.tables.auth_sessions.at(-1).expires_at = new Date(Date.now() - 1000).toISOString()
    const res = await call('getCase', { caseId: IDS.caseB }, cookie)
    expect(res.statusCode).toBe(401)
    expect(db.tables.auth_sessions.some((s) => s.account_id === IDS.accB)).toBe(false)
  })

  it('a login with no Hornung profile gets nothing, not even catalogues', async () => {
    const cookie = sessionCookie(db, IDS.accNoProfile)
    for (const op of ['listDocumentTypes', 'getMyClient', 'getCase']) {
      const res = await call(op, { caseId: IDS.caseB }, cookie)
      expect(res.statusCode).toBe(403)
      expect(res.body.code).toBe('NO_PROFILE')
    }
  })
})

describe('request hygiene', () => {
  it('refuses a cross-site request even with a valid session cookie (CSRF)', async () => {
    const res = await call('getCase', { caseId: IDS.caseA }, asA, { origin: 'https://evil.test' })
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('CROSS_SITE_REQUEST')
    const res2 = await call('getCase', { caseId: IDS.caseA }, asA, { 'sec-fetch-site': 'cross-site' })
    expect(res2.statusCode).toBe(403)
  })

  it('accepts the same request from this site', async () => {
    const res = await call('getCase', { caseId: IDS.caseA }, asA, { origin: 'https://app.test' })
    expect(res.statusCode).toBe(200)
  })

  it('only whitelisted ops exist (no generic table access)', async () => {
    for (const op of ['from', 'constructor', '__proto__', 'toString', 'auth_accounts']) {
      const res = await call(op, {}, asStaff)
      expect(res.statusCode).toBe(404)
    }
  })

  it('only POST', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'GET', cookie: asA, query: { op: 'getMyClient' } }), res)
    expect(res.statusCode).toBe(405)
  })
})

describe('client A on their own records', () => {
  it('reads their own client, cases, documents and questionnaire', async () => {
    expect((await call('getClient', { id: IDS.cA }, asA)).body.data.id).toBe(IDS.cA)
    expect((await call('getCase', { caseId: IDS.caseA }, asA)).body.data.client.id).toBe(IDS.cA)
    expect((await call('listCases', { clientId: IDS.cA }, asA)).body.data.map((c) => c.id).sort()).toEqual(
      [IDS.caseA, IDS.caseAClosed].sort()
    )
    const docs = (await call('listDocuments', { caseId: IDS.caseA }, asA)).body.data
    expect(docs.map((d) => d.id).sort()).toEqual([IDS.docA1, IDS.docA2].sort())
    expect(docs.find((d) => d.id === IDS.docA1).category_code).toBe('salary_statement')
    expect((await call('getQuestionnaire', { clientId: IDS.cA }, asA)).statusCode).toBe(200)
    // Both directions are downloadable, as in the storage policy.
    expect((await call('getDownloadUrl', { id: IDS.docA2 }, asA)).body.data).toContain(PATHS.docA2)
    expect((await call('getDownloadUrl', { id: IDS.cdA }, asA)).body.data).toContain(PATHS.docA1)
  })

  it('getMyClient always answers for the session, whatever the page sends', async () => {
    const res = await call('getMyClient', { profileId: IDS.pB }, asA)
    expect(res.body.data.id).toBe(IDS.cA)
  })

  it('updateMyContact only touches their own client row and profile', async () => {
    const bBefore = JSON.stringify(db.tables.clients.find((c) => c.id === IDS.cB))
    await call('updateMyContact', { first_name: 'Anne', canton: 'GE', id: IDS.cB, clientId: IDS.cB }, asA)
    expect(db.tables.clients.find((c) => c.id === IDS.cA)).toMatchObject({ first_name: 'Anne', canton: 'GE' })
    expect(JSON.stringify(db.tables.clients.find((c) => c.id === IDS.cB))).toBe(bBefore)
  })

  it('saving their questionnaire cannot re-point a row at another client', async () => {
    const res = await call(
      'saveQuestionnaire',
      {
        clientId: IDS.cA,
        payload: {
          details: { id: 'det-b', client_id: IDS.cB, marital_status: 'single' },
          persons: [{ id: 'per-b1', client_id: IDS.cB, person_type: 'primary', first_name: 'Anne' }],
          children: [{ id: 'kid-b', client_id: IDS.cB, full_name: 'Kid A' }],
          vehicles: [],
          properties: []
        }
      },
      asA
    )
    expect(res.statusCode).toBe(200)
    expect(db.tables.client_details.find((d) => d.id === 'det-b')).toMatchObject({ client_id: IDS.cB, marital_status: 'married' })
    expect(db.tables.client_persons.find((p) => p.id === 'per-b1')).toMatchObject({ client_id: IDS.cB, first_name: 'Bruno' })
    expect(db.tables.client_children.filter((c) => c.client_id === IDS.cB)).toHaveLength(1)
    expect(db.tables.client_children.find((c) => c.client_id === IDS.cA).full_name).toBe('Kid A')
  })

  it('uploads into their own case: server-chosen path, then recorded', async () => {
    const ticket = (await call('createUploadUrl', { caseId: IDS.caseA, fileName: '../../b/évil name.pdf' }, asA)).body.data
    expect(ticket.path.startsWith(`hornung/${IDS.cA}/2025/client_upload/`)).toBe(true)
    expect(ticket.path.slice(`hornung/${IDS.cA}/2025/client_upload/`.length)).not.toContain('/')
    db.objects.add(ticket.path) // the browser's PUT to the signed URL
    const res = await call('registerUploadedDocument', { caseId: IDS.caseA, path: ticket.path, fileName: 'x.pdf', direction: 'client_upload' }, asA)
    expect(res.statusCode).toBe(200)
    expect(res.body.data).toMatchObject({ case_id: IDS.caseA, direction: 'client_upload', uploaded_by: IDS.pA })
  })

  it('cannot upload as the specialist, nor register a path outside their own folder', async () => {
    expect((await call('createUploadUrl', { caseId: IDS.caseA, fileName: 'x.pdf', direction: 'specialist_upload' }, asA)).statusCode).toBe(403)
    expect(
      (await call('registerUploadedDocument', { caseId: IDS.caseA, path: PATHS.docA2, fileName: 'x.pdf', direction: 'specialist_upload' }, asA)).statusCode
    ).toBe(403)
    // Own case id, but somebody else's file: the path must sit in this case's folder.
    expect(
      (await call('registerUploadedDocument', { caseId: IDS.caseA, path: PATHS.docB1, fileName: 'x.pdf', direction: 'client_upload' }, asA)).statusCode
    ).toBe(403)
    expect(
      (await call('registerUploadedDocument', { caseId: IDS.caseA, path: `hornung/${IDS.cA}/2025/client_upload/../../../${IDS.cB}/2025/client_upload/b1.pdf`, fileName: 'x', direction: 'client_upload' }, asA)).statusCode
    ).toBe(403)
    // Right folder, but nothing was uploaded there.
    expect(
      (await call('registerUploadedDocument', { caseId: IDS.caseA, path: `hornung/${IDS.cA}/2025/client_upload/never.pdf`, fileName: 'x', direction: 'client_upload' }, asA)).statusCode
    ).toBe(400)
    expect(db.tables.case_documents).toHaveLength(5)
  })

  it('deletes their own upload while the case is open — not a specialist upload, not on a closed case', async () => {
    expect((await call('deleteDocument', { id: IDS.docA2 }, asA)).statusCode).toBe(403)
    expect((await call('deleteDocument', { id: IDS.docAClosed }, asA)).statusCode).toBe(403)
    expect(db.objects.has(PATHS.docA2) && db.objects.has(PATHS.docAClosed)).toBe(true)
    expect((await call('deleteDocument', { id: IDS.docA1 }, asA)).statusCode).toBe(200)
    expect(db.objects.has(PATHS.docA1)).toBe(false)
  })

  it('adds a past tax year for themselves, never a future one', async () => {
    const future = new Date().getFullYear() + 1
    expect((await call('createOwnCase', { clientId: IDS.cA, taxYear: future }, asA)).statusCode).toBe(403)
    const res = await call('createOwnCase', { clientId: IDS.cA, taxYear: 2023 }, asA)
    expect(res.statusCode).toBe(200)
    expect(res.body.data).toMatchObject({ client_id: IDS.cA, created_by_client: true })
    expect((await call('createOwnCase', { clientId: IDS.cA, taxYear: 2023 }, asA)).body.error).toBe('YEAR_EXISTS')
  })

  it('cannot see extraction results even for their own documents (staff only)', async () => {
    expect((await call('listExtractedFieldsForDocuments', { documentIds: [IDS.cdA] }, asA)).statusCode).toBe(403)
    expect((await call('listFieldSuggestions', { clientId: IDS.cA }, asA)).statusCode).toBe(403)
  })
})

describe('staff', () => {
  it('sees every client and case of the studio', async () => {
    const clients = (await call('listClients', {}, asStaff)).body.data
    expect(clients.map((c) => c.id).sort()).toEqual([IDS.cA, IDS.cB])
    expect(clients.find((c) => c.id === IDS.cA).cases_count).toBe(2)
    expect((await call('getCase', { caseId: IDS.caseB }, asStaff)).body.data.client.id).toBe(IDS.cB)
    expect((await call('listExtractedFieldsForDocuments', { documentIds: [IDS.cdB] }, asStaff)).body.data).toHaveLength(1)
  })

  it('reads only their own assistant conversation', async () => {
    const res = await call('listCaseAssistantMessages', { caseId: IDS.caseB }, asStaff)
    expect(res.body.data.map((m) => m.id)).toEqual(['m-1'])
  })

  it('a suggestion is written where the database says, not where the request says', async () => {
    const res = await call(
      'resolveFieldSuggestion',
      { suggestionId: IDS.sB, accept: true, suggestedValue: 'LU', target_table: 'app_profiles', target_field: 'role', client_id: IDS.cA },
      asStaff
    )
    expect(res.statusCode).toBe(200)
    expect(db.tables.clients.find((c) => c.id === IDS.cB).canton).toBe('LU')
    expect(db.tables.clients.find((c) => c.id === IDS.cA).canton).toBe('TI')
    expect(db.tables.app_profiles.every((p) => p.role !== 'LU')).toBe(true)
  })

  it('records who changed a case status (the DB trigger only sees the service role)', async () => {
    db.tables.case_events.push({ id: 'ev', case_id: IDS.caseB, event_type: 'status_change', actor_id: null, created_at: new Date().toISOString() })
    await call('setCaseStatus', { caseId: IDS.caseB, status: 'review' }, asStaff)
    expect(db.tables.case_events.find((e) => e.id === 'ev').actor_id).toBe(IDS.pStaff)
  })

  it('cannot move a client or pricing row to another app', async () => {
    await call('updateClient', { id: IDS.cB, patch: { app_id: 'wisihealth', canton: 'BS' } }, asStaff)
    expect(db.tables.clients.find((c) => c.id === IDS.cB)).toMatchObject({ app_id: 'hornung_crm', canton: 'BS' })
  })
})

describe('Tax Summary still asks for all extracted fields at once', () => {
  it('one query with .in() over every document', async () => {
    db.log.length = 0
    await call('listExtractedFieldsForDocuments', { documentIds: [IDS.cdA, IDS.cdB] }, asStaff)
    expect(db.log.filter((q) => q.table === 'extracted_document_fields')).toHaveLength(1)
  })
})

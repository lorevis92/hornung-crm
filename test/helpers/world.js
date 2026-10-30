// A small Hornung world for the authorization tests: two specialists, two
// clients (A and B) with their own cases, documents, questionnaire and
// extraction data, plus a login without any profile. Client A is always the
// "attacker" reaching for client B's records.
import bcrypt from 'bcryptjs'
import { hashToken } from '../../api/_auth.js'
import { createFakeDb } from './fakeSupabase.js'

export const PASSWORD = 'correct horse battery'
// Cost 4 keeps the suite fast; bcrypt reads the cost from the hash itself.
const HASH = bcrypt.hashSync(PASSWORD, 4)
// What Supabase Auth stored ("$2a$" prefix) — must keep working after migration 52.
const LEGACY_HASH = bcrypt.hashSync(PASSWORD, 4).replace(/^\$2b\$/, '$2a$')

export const IDS = {
  accStaff: 'acc-staff',
  accStaff2: 'acc-staff-2',
  accA: 'acc-a',
  accB: 'acc-b',
  accNoProfile: 'acc-none',
  accUnconfirmed: 'acc-unconfirmed',
  pStaff: 'p-staff',
  pStaff2: 'p-staff-2',
  pA: 'p-a',
  pB: 'p-b',
  cA: 'client-a',
  cB: 'client-b',
  caseA: 'case-a-2025',
  caseAClosed: 'case-a-2024',
  caseB: 'case-b-2025',
  docA1: 'doc-a-client-upload',
  docA2: 'doc-a-specialist-upload',
  docAClosed: 'doc-a-closed-case',
  docB1: 'doc-b-client-upload',
  docB2: 'doc-b-specialist-upload',
  cdA: 'cd-a',
  cdB: 'cd-b',
  sB: 'suggestion-b'
}

const T0 = '2026-01-01T00:00:00.000Z'
const path = (client, year, dir, name) => `hornung/${client}/${year}/${dir}/${name}`

export const PATHS = {
  docA1: path(IDS.cA, 2025, 'client_upload', 'a1.pdf'),
  docA2: path(IDS.cA, 2025, 'specialist_upload', 'a2.pdf'),
  docAClosed: path(IDS.cA, 2024, 'client_upload', 'a-closed.pdf'),
  docB1: path(IDS.cB, 2025, 'client_upload', 'b1.pdf'),
  docB2: path(IDS.cB, 2025, 'specialist_upload', 'b2-declaration.pdf')
}

function account(id, email, extra = {}) {
  return {
    id,
    email,
    password_hash: HASH,
    email_confirmed_at: T0,
    failed_login_count: 0,
    locked_until: null,
    created_at: T0,
    ...extra
  }
}

export function buildWorld() {
  const tables = {
    auth_accounts: [
      account(IDS.accStaff, 'staff@hornung.test'),
      account(IDS.accStaff2, 'staff2@hornung.test'),
      account(IDS.accA, 'a@client.test', { password_hash: LEGACY_HASH }),
      account(IDS.accB, 'b@client.test'),
      account(IDS.accNoProfile, 'nobody@elsewhere.test'),
      account(IDS.accUnconfirmed, 'new@client.test', { email_confirmed_at: null })
    ],
    auth_sessions: [],
    auth_tokens: [],
    app_profiles: [
      { id: IDS.pStaff, user_id: IDS.accStaff, app_id: 'hornung_crm', role: 'specialist', email: 'staff@hornung.test' },
      { id: IDS.pStaff2, user_id: IDS.accStaff2, app_id: 'hornung_crm', role: 'specialist', email: 'staff2@hornung.test' },
      { id: IDS.pA, user_id: IDS.accA, app_id: 'hornung_crm', role: 'client', email: 'a@client.test' },
      { id: IDS.pB, user_id: IDS.accB, app_id: 'hornung_crm', role: 'client', email: 'b@client.test' }
    ],
    clients: [
      { id: IDS.cA, app_id: 'hornung_crm', profile_id: IDS.pA, email: 'a@client.test', first_name: 'Anna', last_name: 'A', status: 'invited', canton: 'TI' },
      { id: IDS.cB, app_id: 'hornung_crm', profile_id: IDS.pB, email: 'b@client.test', first_name: 'Bruno', last_name: 'B', status: 'active', canton: 'ZH', internal_notes: 'secret' }
    ],
    tax_cases: [
      { id: IDS.caseA, client_id: IDS.cA, tax_year: 2025, status: 'opened' },
      { id: IDS.caseAClosed, client_id: IDS.cA, tax_year: 2024, status: 'finished' },
      { id: IDS.caseB, client_id: IDS.cB, tax_year: 2025, status: 'in_process' }
    ],
    case_events: [],
    case_documents: [
      { id: IDS.docA1, case_id: IDS.caseA, direction: 'client_upload', storage_path: PATHS.docA1, file_name: 'a1.pdf', created_at: T0 },
      { id: IDS.docA2, case_id: IDS.caseA, direction: 'specialist_upload', storage_path: PATHS.docA2, file_name: 'a2.pdf', created_at: T0 },
      { id: IDS.docAClosed, case_id: IDS.caseAClosed, direction: 'client_upload', storage_path: PATHS.docAClosed, file_name: 'a-closed.pdf', created_at: T0 },
      { id: IDS.docB1, case_id: IDS.caseB, direction: 'client_upload', storage_path: PATHS.docB1, file_name: 'b1.pdf', created_at: T0 },
      { id: IDS.docB2, case_id: IDS.caseB, direction: 'specialist_upload', storage_path: PATHS.docB2, file_name: 'b2-declaration.pdf', created_at: T0 }
    ],
    client_documents: [
      { id: IDS.cdA, client_id: IDS.cA, tax_year: 2025, source_case_document_id: IDS.docA1, storage_path: PATHS.docA1, file_name: 'a1.pdf', category_code: 'salary_statement' },
      { id: IDS.cdB, client_id: IDS.cB, tax_year: 2025, source_case_document_id: IDS.docB1, storage_path: PATHS.docB1, file_name: 'b1.pdf', category_code: 'salary_statement' }
    ],
    client_details: [{ id: 'det-b', client_id: IDS.cB, marital_status: 'married' }],
    client_persons: [
      { id: 'per-b1', client_id: IDS.cB, person_type: 'primary', first_name: 'Bruno', last_name: 'B' },
      { id: 'per-b2', client_id: IDS.cB, person_type: 'spouse', first_name: 'Berta', last_name: 'B' }
    ],
    client_children: [{ id: 'kid-b', client_id: IDS.cB, full_name: 'Baby B', sort_order: 0 }],
    client_vehicles: [],
    client_properties: [{ id: 'prop-b', client_id: IDS.cB, address: 'Bahnhofstrasse 1, Zürich', sort_order: 0 }],
    client_field_suggestions: [
      { id: IDS.sB, client_id: IDS.cB, document_id: IDS.cdB, target_table: 'clients', target_field: 'canton', target_person: 'none', suggested_value: 'BE', created_at: T0 }
    ],
    case_requested_documents: [{ id: 'req-b', case_id: IDS.caseB, document_type_id: 'salary', required: true }],
    extracted_document_fields: [{ id: 'f-b', document_id: IDS.cdB, field_key: 'gross_salary', field_value: '123456' }],
    document_other_findings: [{ id: 'o-b', document_id: IDS.cdB, label: 'Bonus', value: '9999', created_at: T0 }],
    case_assistant_messages: [
      { id: 'm-1', case_id: IDS.caseB, role: 'user', content: 'staff 1 question', created_by: IDS.pStaff, created_at: T0 },
      { id: 'm-2', case_id: IDS.caseB, role: 'user', content: 'staff 2 private question', created_by: IDS.pStaff2, created_at: T0 }
    ],
    pricing_items: [
      { id: 'price-1', app_id: 'hornung_crm', code: 'base', active: true, sort_order: 1 },
      { id: 'price-old', app_id: 'hornung_crm', code: 'old', active: false, sort_order: 2 }
    ],
    document_types: [{ id: 'salary', active: true, sort_order: 1 }],
    document_categories: [{ code: 'salary_statement', active: true, sort_order: 1 }],
    category_field_definitions: [{ id: 'fd-1', category_code: 'salary_statement', field_key: 'gross_salary', sort_order: 1 }],
    ai_model_settings: [{ id: 'ai-1', key: 'extraction', model: 'claude-x', updated_by: IDS.pStaff }]
  }
  return createFakeDb({
    tables,
    objects: Object.values(PATHS),
    rpcs: {
      swap_primary_and_spouse_server: () => null
    }
  })
}

let counter = 0
/** A live session for this account, as the browser would hold it. */
export function sessionCookie(db, accountId) {
  const token = `test-session-${accountId}-${++counter}`
  const now = Date.now()
  db.tables.auth_sessions.push({
    id: `sess-${counter}`,
    account_id: accountId,
    token_hash: hashToken(token),
    created_at: new Date(now).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    expires_at: new Date(now + 3600_000).toISOString()
  })
  return `hc_session=${token}`
}

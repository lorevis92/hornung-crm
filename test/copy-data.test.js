// db/copyData.js — the one-time copy of the data from Supabase into Neon —
// between two real Postgres databases (PGlite): a "Supabase" one at
// migration 52 (shared with WisiHealth, Supabase stand-ins in place) and a
// fully migrated "Neon" one.
import { beforeAll, describe, expect, it } from 'vitest'
import { createPgliteDb } from './helpers/pgliteDb.js'
import { copyData } from '../db/copyData.js'

let source
let target
let report
const ids = {}

beforeAll(async () => {
  source = await createPgliteDb({ until: '20260101000052_own_auth.sql' })
  target = await createPgliteDb()
  const s = source.db

  // WisiHealth shares the Supabase database: its app, profile and login
  // must never reach Hornung's Neon.
  await source.query("insert into apps (id, name) values ('wisihealth', 'WisiHealth')")
  const { data: wisiAccount } = await s.from('auth_accounts').insert({ email: 'patient@wisi.test', password_hash: '$2a$12$wisi' }).select().single()
  await s.from('app_profiles').insert({ user_id: wisiAccount.id, app_id: 'wisihealth', role: 'client', email: 'patient@wisi.test' })

  const { data: staff } = await s.from('auth_accounts').insert({ email: 'staff@h.test', password_hash: '$2a$12$staff', email_confirmed_at: '2026-01-02T03:04:05.123456+00:00' }).select().single()
  const { data: staffProfile } = await s.from('app_profiles').insert({ user_id: staff.id, app_id: 'hornung_crm', role: 'specialist', email: 'staff@h.test' }).select().single()
  await source.query("insert into auth_tokens (account_id, purpose, token_hash, expires_at) values ($1, 'invite', 'h1', now() + interval '1 day')", [staff.id])
  await source.query("insert into auth_sessions (account_id, token_hash, expires_at) values ($1, 's1', now() + interval '1 day')", [staff.id])

  const { data: client } = await s.from('clients').insert({ app_id: 'hornung_crm', first_name: 'Giulia', last_name: 'Weber', email: 'giulia@h.test', status: 'active' }).select().single()
  const { data: taxCase } = await s
    .from('tax_cases')
    .insert({ client_id: client.id, tax_year: 2025, status: 'in_process', due_date: '2026-03-31', fee_breakdown: [{ code: 'base', amount: 450.5 }], fee_excluded_codes: ['x', 'y z'] })
    .select()
    .single()
  const { data: caseDoc } = await s
    .from('case_documents')
    .insert({ case_id: taxCase.id, direction: 'client_upload', storage_path: 'hornung/c/2025/client_upload/a.pdf', file_name: 'a.pdf', uploaded_by: staffProfile.id })
    .select()
    .single()
  // The mirror trigger created the client_documents row on "Supabase"; it
  // gets extracted there.
  await s.from('client_documents').update({ status: 'extracted', category_code: 'salary_statement' }).eq('source_case_document_id', caseDoc.id)
  // A catalogue row the migrations seeded, edited on Supabase since.
  const { data: category } = await s.from('document_categories').select('code, label_en').limit(1).single()
  await s.from('document_categories').update({ label_en: 'Edited on Supabase' }).eq('code', category.code)
  Object.assign(ids, { staff: staff.id, client: client.id, taxCase: taxCase.id, caseDoc: caseDoc.id, category: category.code })

  report = await copyData({ source, target })
}, 240000)

describe('copying Supabase -> Neon', () => {
  it('every copied table has exactly the source rows', () => {
    expect(report.mismatches).toEqual([])
    expect(report.tables.length).toBeGreaterThan(20)
  })

  it('only Hornung from the shared tables — nothing of WisiHealth', async () => {
    expect((await target.query('select id from apps order by id')).rows).toEqual([{ id: 'hornung_crm' }])
    expect((await target.query("select count(*)::int as n from app_profiles where app_id <> 'hornung_crm'")).rows[0].n).toBe(0)
    expect((await target.query("select count(*)::int as n from auth_accounts where email = 'patient@wisi.test'")).rows[0].n).toBe(0)
    expect((await target.query('select email from auth_accounts')).rows).toEqual([{ email: 'staff@h.test' }])
  })

  it('logins keep id, password hash and confirmation; pending links come along; sessions do not', async () => {
    const { data } = await target.db.from('auth_accounts').select('id, password_hash, email_confirmed_at').single()
    expect(data).toEqual({ id: ids.staff, password_hash: '$2a$12$staff', email_confirmed_at: '2026-01-02T03:04:05.123456+00:00' })
    expect((await target.query('select count(*)::int as n from auth_tokens')).rows[0].n).toBe(1)
    expect((await target.query('select count(*)::int as n from auth_sessions')).rows[0].n).toBe(0)
  })

  it('values are exact: date, jsonb, text[], ids', async () => {
    const { data } = await target.db.from('tax_cases').select('id, due_date, fee_breakdown, fee_excluded_codes, status').eq('id', ids.taxCase).single()
    expect(data).toEqual({ id: ids.taxCase, due_date: '2026-03-31', fee_breakdown: [{ code: 'base', amount: 450.5 }], fee_excluded_codes: ['x', 'y z'], status: 'in_process' })
  })

  it('the document mirror is copied as it was, not fired again', async () => {
    const { data } = await target.db.from('client_documents').select('status, category_code').eq('source_case_document_id', ids.caseDoc)
    expect(data).toEqual([{ status: 'extracted', category_code: 'salary_statement' }])
  })

  it('a catalogue the migrations seeded takes the (edited) Supabase version', async () => {
    const { data } = await target.db.from('document_categories').select('label_en').eq('code', ids.category).single()
    expect(data.label_en).toBe('Edited on Supabase')
  })

  it('the triggers work again afterwards', async () => {
    const { data: doc } = await target.db
      .from('case_documents')
      .insert({ case_id: ids.taxCase, direction: 'client_upload', storage_path: 'hornung/c/2025/client_upload/b.pdf', file_name: 'b.pdf' })
      .select()
      .single()
    const { data: mirror } = await target.db.from('client_documents').select('status').eq('source_case_document_id', doc.id).single()
    expect(mirror.status).toBe('uploaded')
  })
})

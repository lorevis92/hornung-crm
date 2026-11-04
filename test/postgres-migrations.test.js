// The move to Neon, against a real Postgres (PGlite, test/helpers/pgliteDb.js):
//   1. every migration applies on a plain Postgres — Supabase's objects
//      only exist as the stand-ins of db/supabase-compat.sql;
//   2. migration 53 leaves nothing of Supabase behind (policies, RLS, the
//      pg_net webhook, the auth.users mirror, the stand-in schemas/roles)
//      and keeps everything the server relies on;
//   3. api/_db.js — the query builder the server code talks to instead of
//      supabase-js/PostgREST — compiles every construct the code uses into
//      SQL that Postgres accepts, and returns values in PostgREST's shape.
import { beforeAll, describe, expect, it } from 'vitest'
import { createPgliteDb } from './helpers/pgliteDb.js'
import { migrationFiles } from '../db/migrate.js'

let pg
let db
let query
let applied

beforeAll(async () => {
  ;({ pg, db, query, applied } = await createPgliteDb())
}, 120000)

const one = async (sql, params) => (await query(sql, params)).rows[0]

describe('the migrations on a plain Postgres', () => {
  it('apply in order, every one of them', () => {
    expect(applied).toEqual(migrationFiles())
    expect(applied).toContain('20260101000053_leave_supabase.sql')
    expect(applied).toContain('20260101000054_extraction_jobs.sql')
    expect(applied.length).toBeGreaterThanOrEqual(54)
  })

  it('are recorded, so a second run applies nothing', async () => {
    const { migrate } = await import('../db/migrate.js')
    const again = await migrate({ exec: (sql) => pg.exec(sql), query })
    expect(again).toEqual([])
  })
})

describe('after migration 53', () => {
  it('no RLS policy and no table with RLS left', async () => {
    expect((await one("select count(*)::int as n from pg_policies")).n).toBe(0)
    const rls = await query(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity"
    )
    expect(rls.rows).toEqual([])
  })

  it('no Supabase schema, role, webhook or auth.users mirror', async () => {
    const schemas = await query("select nspname from pg_namespace where nspname in ('auth', 'supabase_auth', 'storage', 'net')")
    expect(schemas.rows).toEqual([])
    const roles = await query("select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')")
    expect(roles.rows).toEqual([])
    const triggers = await query(
      "select tgname from pg_trigger where tgname in ('client_documents_notify_uploaded', 'app_profiles_mirror_auth_user', 'auth_users_mirror_update')"
    )
    expect(triggers.rows).toEqual([])
    const functions = await query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname in ('notify_document_uploaded', 'mirror_auth_user_on_profile',
          'mirror_auth_user_update', 'is_hornung_staff', 'my_client_id', 'current_profile_id', 'swap_primary_and_spouse',
          'update_my_contact', 'mark_client_active', 'auth_user_id_by_email')`
    )
    expect(functions.rows).toEqual([])
  })

  it('nothing left refers to auth.uid() or to the dropped helpers', async () => {
    const bodies = await query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (prosrc ~ 'auth\\.' or prosrc ~ 'current_profile_id|is_hornung_staff|my_client_id')`
    )
    expect(bodies.rows).toEqual([])
  })

  it('keeps the login tables, the consistency triggers and the server-side swap', async () => {
    const tables = await query(
      "select tablename from pg_tables where schemaname = 'public' and tablename in ('auth_accounts', 'auth_sessions', 'auth_tokens') order by 1"
    )
    expect(tables.rows.map((r) => r.tablename)).toEqual(['auth_accounts', 'auth_sessions', 'auth_tokens'])
    const triggers = await query(
      "select tgname from pg_trigger where tgname in ('case_documents_mirror_to_client_documents', 'tax_cases_status_log') order by 1"
    )
    expect(triggers.rows.map((r) => r.tgname)).toEqual(['case_documents_mirror_to_client_documents', 'tax_cases_status_log'])
    expect(await one("select to_regprocedure('public.swap_primary_and_spouse_server(uuid)') is not null as ok")).toEqual({ ok: true })
  })

  it('promote_to_specialist() now finds the login in auth_accounts', async () => {
    const { data: account } = await db.from('auth_accounts').insert({ email: 'boss@hornung.test' }).select().single()
    const { rows } = await query("select public.promote_to_specialist('Boss@Hornung.test') as message")
    expect(rows[0].message).toMatch(/^OK/)
    const { data: profile } = await db.from('app_profiles').select('role, user_id').eq('user_id', account.id).single()
    expect(profile).toEqual({ role: 'specialist', user_id: account.id })
    expect((await query("select public.promote_to_specialist('nobody@x.test') as m")).rows[0].m).toMatch(/^No account/)
  })

  it('the status log still records a status change (actor unknown, as before)', async () => {
    const { client, taxCase } = await seedCase()
    expect(client.id).toBeTruthy()
    await db.from('tax_cases').update({ status: 'in_process' }).eq('id', taxCase.id)
    const { data: events } = await db.from('case_events').select('event_type, from_status, to_status, actor_id').eq('case_id', taxCase.id)
    expect(events).toContainEqual({ event_type: 'status_change', from_status: 'opened', to_status: 'in_process', actor_id: null })
  })

  it('an uploaded case document is still mirrored into client_documents, as "uploaded"', async () => {
    const { taxCase, client } = await seedCase()
    const { data: doc } = await db
      .from('case_documents')
      .insert({ case_id: taxCase.id, direction: 'client_upload', storage_path: 'hornung/x/2025/client_upload/a.pdf', file_name: 'a.pdf' })
      .select()
      .single()
    const { data: mirror } = await db.from('client_documents').select('client_id, status, tax_year').eq('source_case_document_id', doc.id).single()
    expect(mirror).toEqual({ client_id: client.id, status: 'uploaded', tax_year: 2025 })
  })
})

let seq = 0
async function seedCase() {
  seq++
  const { data: client, error } = await db
    .from('clients')
    .insert({ app_id: 'hornung_crm', first_name: `Anna${seq}`, last_name: 'Muster', email: `anna${seq}@x.test`, status: 'active' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  const { data: taxCase, error: caseError } = await db
    .from('tax_cases')
    .insert({ client_id: client.id, tax_year: 2025, status: 'opened', due_date: '2026-03-31' })
    .select()
    .single()
  if (caseError) throw new Error(caseError.message)
  return { client, taxCase }
}

describe('api/_db.js on Postgres: the supabase-js subset the server code uses', () => {
  it('values come back as PostgREST returned them', async () => {
    const { taxCase } = await seedCase()
    const { data } = await db.from('tax_cases').select('*').eq('id', taxCase.id).single()
    expect(data.due_date).toBe('2026-03-31') // a date stays a date string, never shifted by a time zone
    expect(typeof data.tax_year).toBe('number')
    expect(data.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/)
    expect(new Date(data.created_at).getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(data.fee_excluded_codes).toEqual([]) // text[]
  })

  it('jsonb and text[] columns take JS values', async () => {
    const { taxCase } = await seedCase()
    const breakdown = [{ code: 'base', amount: 450.5 }, { code: 'extra', amount: 80 }]
    const { data, error } = await db
      .from('tax_cases')
      .update({ fee_breakdown: breakdown, fee_excluded_codes: ['a', 'b c', 'd"e'] })
      .eq('id', taxCase.id)
      .select('fee_breakdown, fee_excluded_codes')
      .single()
    expect(error).toBeNull()
    expect(data).toEqual({ fee_breakdown: breakdown, fee_excluded_codes: ['a', 'b c', 'd"e'] })
  })

  it('filters: eq, neq, in, is, not in, not is, gt/gte, ilike — order and limit', async () => {
    const { client } = await seedCase()
    for (const [year, status] of [[2023, 'finished'], [2024, 'waiting_client']]) {
      await db.from('tax_cases').insert({ client_id: client.id, tax_year: year, status })
    }
    const years = async (q) => (await q).data.map((r) => r.tax_year)
    const base = () => db.from('tax_cases').select('tax_year').eq('client_id', client.id)
    expect(await years(base().order('tax_year', { ascending: true }))).toEqual([2023, 2024, 2025])
    expect(await years(base().neq('status', 'finished').order('tax_year'))).toEqual([2024, 2025])
    expect(await years(base().in('status', ['finished', 'opened']).order('tax_year', { ascending: false }))).toEqual([2025, 2023])
    expect(await years(base().not('status', 'in', '(finished,opened)'))).toEqual([2024])
    expect(await years(base().gt('tax_year', 2023).gte('tax_year', 2024).order('tax_year').limit(1))).toEqual([2024])
    expect(await years(base().is('finished_at', null).order('tax_year'))).toEqual([2023, 2024, 2025])
    expect(await years(base().in('status', []))).toEqual([])
    const { data: byMail } = await db.from('clients').select('id').ilike('email', client.email.toUpperCase())
    expect(byMail).toEqual([{ id: client.id }])
    const { data: notNull } = await db.from('clients').select('id').eq('id', client.id).not('email', 'is', null)
    expect(notNull).toHaveLength(1)
  })

  it('embeds the many-to-one relation the code asks for ("client:clients(...)")', async () => {
    const { client, taxCase } = await seedCase()
    const { data } = await db
      .from('tax_cases')
      .select('id, tax_year, client:clients(first_name, email)')
      .eq('id', taxCase.id)
      .single()
    expect(data).toEqual({ id: taxCase.id, tax_year: 2025, client: { first_name: client.first_name, email: client.email } })
    const { data: all } = await db.from('tax_cases').select('*, client:clients(*)').eq('id', taxCase.id).single()
    expect(all.client.id).toBe(client.id)
    expect(all.status).toBe('opened')
  })

  it('single() / maybeSingle(): PostgREST error codes and shapes', async () => {
    const none = await db.from('clients').select('id').eq('email', 'nobody@x.test').maybeSingle()
    expect(none).toEqual({ data: null, error: null })
    const missing = await db.from('clients').select('id').eq('email', 'nobody@x.test').single()
    expect(missing.error.code).toBe('PGRST116')
    await seedCase()
    await seedCase()
    const many = await db.from('clients').select('id').eq('last_name', 'Muster').maybeSingle()
    expect(many.data).toBeNull()
    expect(many.error.code).toBe('PGRST116')
  })

  it('a unique violation is reported as { error.code: "23505" }, never thrown', async () => {
    const { client } = await seedCase()
    const result = await db.from('tax_cases').insert({ client_id: client.id, tax_year: 2025, status: 'opened' }).select().single()
    expect(result.data).toBeNull()
    expect(result.error.code).toBe('23505')
  })

  it('insert without select() returns no data; with select() the inserted rows', async () => {
    const { taxCase } = await seedCase()
    const plain = await db.from('case_events').insert({ case_id: taxCase.id, event_type: 'note', note: 'x' })
    expect(plain).toEqual({ data: null, error: null })
    const rows = await db
      .from('case_events')
      .insert([{ case_id: taxCase.id, event_type: 'note', note: 'a' }, { case_id: taxCase.id, event_type: 'note', note: 'b' }])
      .select('note')
    expect(rows.data.map((r) => r.note).sort()).toEqual(['a', 'b'])
  })

  it('upsert on a composite conflict target updates instead of duplicating', async () => {
    const { client } = await seedCase()
    const upsert = (patch) =>
      db.from('client_persons').upsert({ client_id: client.id, person_type: 'primary', ...patch }, { onConflict: 'client_id,person_type' })
    expect((await upsert({ first_name: 'Anna' })).error).toBeNull()
    expect((await upsert({ first_name: 'Anne', date_of_birth: '1980-02-29' })).error).toBeNull()
    const { data } = await db.from('client_persons').select('first_name, date_of_birth').eq('client_id', client.id)
    expect(data).toEqual([{ first_name: 'Anne', date_of_birth: '1980-02-29' }])
  })

  it('the atomic claim of the extraction: update ... where status = X returning, only once', async () => {
    const { taxCase } = await seedCase()
    const { data: doc } = await db
      .from('case_documents')
      .insert({ case_id: taxCase.id, direction: 'client_upload', storage_path: 'p/q.pdf', file_name: 'q.pdf' })
      .select()
      .single()
    const { data: mirror } = await db.from('client_documents').select('id').eq('source_case_document_id', doc.id).single()
    const claim = () =>
      db.from('client_documents').update({ status: 'extracting' }).eq('id', mirror.id).in('status', ['uploaded']).select().maybeSingle()
    const [first, second] = await Promise.all([claim(), claim()])
    expect([first.data, second.data].filter(Boolean)).toHaveLength(1)
  })

  it('delete with filters, and rpc() into a SQL function (raise -> error.message)', async () => {
    const { client, taxCase } = await seedCase()
    await db.from('case_events').insert({ case_id: taxCase.id, event_type: 'note', note: 'gone' })
    const removed = await db.from('case_events').delete().eq('case_id', taxCase.id).eq('note', 'gone').select('note')
    expect(removed.data).toEqual([{ note: 'gone' }])
    const noSpouse = await db.rpc('swap_primary_and_spouse_server', { p_client_id: client.id })
    expect(noSpouse.error.message).toMatch(/NO_SPOUSE/)
    await db.from('client_persons').insert([
      { client_id: client.id, person_type: 'primary', first_name: 'Anna' },
      { client_id: client.id, person_type: 'spouse', first_name: 'Marco' }
    ])
    expect(await db.rpc('swap_primary_and_spouse_server', { p_client_id: client.id })).toEqual({ data: null, error: null })
    const { data } = await db.from('client_persons').select('person_type, first_name').eq('client_id', client.id).order('person_type')
    expect(data).toEqual([{ person_type: 'primary', first_name: 'Marco' }, { person_type: 'spouse', first_name: 'Anna' }])
  })

  it('refuses an identifier that is not a plain column name, instead of building SQL with it', async () => {
    const result = await db.from('clients').select('id').eq('id; drop table clients', 'x')
    expect(result.error.message).toMatch(/refusing identifier/)
    expect((await one('select count(*)::int as n from clients')).n).toBeGreaterThan(0)
  })
})

// What `neon init` leaves in a new Neon database before our first migration:
// Neon Auth / Data API's own "auth" schema (owner cloud_admin, with its own
// auth.uid()), and the Data API roles "authenticated" and "anonymous".
const NEON_LIKE = `
  create role cloud_admin nologin;
  create role authenticated nologin;
  create role anonymous nologin;
  create schema auth authorization cloud_admin;
  create function auth.uid() returns text language sql stable as $$ select null::text $$;
  alter function auth.uid() owner to cloud_admin;
`

describe('on a database that already has Neon Auth / the Data API', () => {
  let neon
  beforeAll(async () => {
    neon = await createPgliteDb({ prepare: NEON_LIKE })
  }, 120000)

  it('every migration still applies', () => {
    expect(neon.applied).toEqual(migrationFiles())
  })

  it("Neon's auth schema and roles are left alone", async () => {
    const { rows } = await neon.query("select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname in ('auth', 'supabase_auth')")
    expect(rows).toEqual([{ nspname: 'auth', owner: 'cloud_admin' }])
    const roles = await neon.query("select rolname from pg_roles where rolname in ('anon', 'authenticated', 'anonymous', 'service_role') order by 1")
    expect(roles.rows.map((r) => r.rolname)).toEqual(['anonymous', 'authenticated'])
  })

  it('the Data API roles have no access to anything of this app', async () => {
    const { rows } = await neon.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('authenticated', 'anonymous')`
    )
    expect(rows).toEqual([])
    const fn = await neon.query(
      "select has_function_privilege('authenticated', 'public.swap_primary_and_spouse_server(uuid)', 'execute') as can"
    )
    expect(fn.rows[0].can).toBe(false)
  })
})

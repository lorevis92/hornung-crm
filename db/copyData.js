// Copies the Hornung data from the Supabase database into the (already
// migrated, see scripts/db-migrate.mjs) Neon database. Core of
// scripts/copy-data-from-supabase.mjs, tested Postgres-to-Postgres in
// test/copy-data.test.js.
//
//   * every table of the Neon schema except the ones only the new setup
//     has (schema_migrations, the extraction job tables) and auth_sessions
//     (everyone simply signs in again);
//   * the Supabase database is shared with WisiHealth: from the shared
//     tables only Hornung's rows — apps 'hornung_crm', its app_profiles,
//     the auth_accounts (and their pending links) of those profiles, and
//     any table with an app_id column only where app_id = 'hornung_crm';
//   * the target tables are emptied first (the migrations seeded
//     catalogues the source has, possibly edited since), then filled in
//     foreign-key order, with user triggers off so the copy is exact (no
//     case_documents -> client_documents mirror firing twice);
//   * rows travel as JSON and are rebuilt by Postgres itself
//     (json_populate_recordset), so dates, numerics, jsonb and arrays keep
//     their exact values;
//   * sequences are moved past the copied ids; row counts are compared.
//
// source.query / target.query: (sql, params) -> { rows }; target.exec: multi-statement SQL.

export const APP_ID = 'hornung_crm'
const SKIP = new Set(['schema_migrations', 'extraction_jobs', 'extraction_job_items', 'auth_sessions'])
const BATCH = 500

const PROFILE_IDS = `select user_id from public.app_profiles where app_id = '${APP_ID}'`
const FILTERS = {
  apps: `id = '${APP_ID}'`,
  app_profiles: `app_id = '${APP_ID}'`,
  auth_accounts: `id in (${PROFILE_IDS})`,
  auth_tokens: `account_id in (${PROFILE_IDS})`
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`

async function tablesInDependencyOrder(target) {
  const { rows: tables } = await target.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    []
  )
  const names = tables.map((t) => t.tablename).filter((t) => !SKIP.has(t))
  const { rows: edges } = await target.query(
    `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
       from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace`,
    []
  )
  const strip = (n) => n.replace(/^public\./, '').replace(/^"|"$/g, '')
  const parents = new Map(names.map((n) => [n, new Set()]))
  for (const { child, parent } of edges) {
    const c = strip(child)
    const p = strip(parent)
    if (c !== p && parents.has(c) && parents.has(p)) parents.get(c).add(p)
  }
  const ordered = []
  const seen = new Set()
  const visit = (n, stack = new Set()) => {
    if (seen.has(n)) return
    if (stack.has(n)) throw new Error(`copy: foreign-key cycle through ${n}`)
    stack.add(n)
    for (const p of parents.get(n)) visit(p, stack)
    stack.delete(n)
    seen.add(n)
    ordered.push(n)
  }
  names.forEach((n) => visit(n))
  return ordered
}

async function columnsOf(db, table) {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'
      order by ordinal_position`,
    [table]
  )
  return rows.map((r) => r.column_name)
}

function whereFor(table, columns) {
  if (FILTERS[table]) return FILTERS[table]
  if (columns.includes('app_id')) return `app_id = '${APP_ID}'`
  return 'true'
}

export async function copyData({ source, target, log = () => {} }) {
  const tables = await tablesInDependencyOrder(target)
  const sourceTables = new Set(
    (await source.query(`select tablename from pg_tables where schemaname = 'public'`, [])).rows.map((r) => r.tablename)
  )
  const plan = []
  for (const table of tables) {
    if (!sourceTables.has(table)) {
      log(`${table}: not in the source, left as the migrations made it`)
      continue
    }
    const targetColumns = await columnsOf(target, table)
    const sourceColumns = new Set(await columnsOf(source, table))
    plan.push({ table, columns: targetColumns.filter((c) => sourceColumns.has(c)) })
  }

  await target.exec(`truncate ${plan.map((p) => `public.${q(p.table)}`).join(', ')} restart identity cascade`)
  for (const { table } of plan) await target.exec(`alter table public.${q(table)} disable trigger user`)

  const report = []
  try {
    for (const { table, columns } of plan) {
      const where = whereFor(table, columns)
      const list = columns.map(q).join(', ')
      let copied = 0
      for (let offset = 0; ; offset += BATCH) {
        const { rows } = await source.query(
          `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text as batch
             from (select ${list} from public.${q(table)} where ${where} order by 1 limit ${BATCH} offset ${offset}) t`,
          []
        )
        const batch = rows[0].batch
        if (batch === '[]') break
        const { rows: inserted } = await target.query(
          `with ins as (
             insert into public.${q(table)} (${list}) overriding system value
             select ${list} from json_populate_recordset(null::public.${q(table)}, $1::json)
             returning 1)
           select count(*)::int as n from ins`,
          [batch]
        )
        copied += inserted[0].n
        if (inserted[0].n < BATCH) break
      }
      const { rows: expected } = await source.query(`select count(*)::int as n from public.${q(table)} where ${where}`, [])
      report.push({ table, copied, expected: expected[0].n })
      log(`${table}: ${copied} row(s)`)
    }
  } finally {
    for (const { table } of plan) await target.exec(`alter table public.${q(table)} enable trigger user`)
  }

  // Past the copied ids, for any serial/identity column.
  const { rows: sequences } = await target.query(
    `select s.seqrelid::regclass::text as seq, t.relname as tbl, a.attname as col
       from pg_depend d
       join pg_sequence s on s.seqrelid = d.objid
       join pg_class t on t.oid = d.refobjid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      where t.relnamespace = 'public'::regnamespace`,
    []
  )
  for (const { seq, tbl, col } of sequences) {
    await target.query(
      `select setval('${seq.replace(/'/g, "''")}', coalesce((select max(${q(col)}) from public.${q(tbl)}), 0) + 1, false)`,
      []
    )
  }

  const mismatches = report.filter((r) => r.copied !== r.expected)
  return { tables: report, mismatches }
}

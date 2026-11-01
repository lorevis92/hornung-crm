// The database client of the server code: Neon (plain Postgres) behind the
// same small query-builder API the code was written against with
// supabase-js —
//
//   admin.from('clients').select('id, status').eq('app_id', APP_ID).maybeSingle()
//   admin.from('tax_cases').insert(row).select().single()
//   admin.from('client_persons').upsert(rows, { onConflict: 'client_id,person_type' })
//   admin.rpc('swap_primary_and_spouse_server', { p_client_id })
//
// — compiled here into ONE parameterized SQL statement each (values always
// travel as $n parameters, identifiers are checked against a strict
// pattern and quoted), with supabase-js's result shape: { data, error },
// never a throw for a database error, error.code = the Postgres SQLSTATE
// (e.g. '23505' for a unique violation) or PostgREST's 'PGRST116' when
// single()/maybeSingle() gets the wrong number of rows.
//
// Only the subset the code uses is implemented; anything else throws at
// call time instead of silently doing something different:
//   select('*' | 'a, b' | 'alias:table(cols)')   (many-to-one embed through
//                                                 the <alias>_id column)
//   insert / update / upsert(onConflict) / delete, + .select() for RETURNING
//   eq neq gt gte lt lte in is ilike like, not(col, 'in' | 'is', value)
//   order(col, { ascending, nullsFirst }), limit(n), single(), maybeSingle()
//
// Values come back the way PostgREST returned them, so nothing downstream
// changes: numeric/bigint as numbers, date/timestamp as ISO strings (never
// JS Dates), json/jsonb parsed. That is the executor's job (see
// neonExecutor below, and test/helpers/pgliteDb.js for the tests).

const IDENT = /^[a-z_][a-z0-9_]*$/

function ident(name) {
  const value = String(name).trim()
  if (!IDENT.test(value)) throw new Error(`db: refusing identifier ${JSON.stringify(name)}`)
  return `"${value}"`
}

// "a, b, alias:table(x, y)" -> top-level items (commas inside () ignored).
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of String(text)) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function columnList(columns, tableAlias) {
  const items = splitTopLevel(columns || '*')
  if (!items.length) return `${tableAlias}.*`
  return items
    .map((item) => {
      if (item === '*') return `${tableAlias}.*`
      const embed = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)\((.*)\)$/i.exec(item)
      if (embed) {
        const [, alias, table, inner] = embed
        const name = alias || table
        // Many-to-one only: tax_cases.client_id -> clients.id for
        // "client:clients(...)". Nothing else is used by the code.
        return (
          `(select row_to_json(e) from (select ${columnList(inner, 'r')} from ${ident(table)} r ` +
          `where r."id" = ${tableAlias}.${ident(`${name}_id`)}) e) as ${ident(name)}`
        )
      }
      const renamed = /^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)$/i.exec(item)
      if (renamed) return `${tableAlias}.${ident(renamed[2])} as ${ident(renamed[1])}`
      return `${tableAlias}.${ident(item)}`
    })
    .join(', ')
}

// PostgREST list syntax "(a,b,"c d")" -> ['a', 'b', 'c d']
function parseList(value) {
  if (Array.isArray(value)) return value
  const inner = String(value).trim().replace(/^\(/, '').replace(/\)$/, '')
  if (!inner) return []
  return inner.split(',').map((v) => v.trim().replace(/^"(.*)"$/, '$1'))
}

class QueryBuilder {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.action = 'select'
    this.columns = '*'
    this.returning = null
    this.filters = []
    this.orders = []
    this.limitN = null
    this.payload = null
    this.options = {}
    this.expect = null // 'single' | 'maybeSingle'
  }

  // ---------------------------------------------------------- actions ----
  select(columns = '*') {
    if (this.action === 'select') this.columns = columns
    else this.returning = columns || '*'
    return this
  }

  insert(payload, options = {}) {
    this.action = 'insert'
    this.payload = payload
    this.options = options
    return this
  }

  upsert(payload, options = {}) {
    this.action = 'upsert'
    this.payload = payload
    this.options = options
    return this
  }

  update(payload) {
    this.action = 'update'
    this.payload = payload
    return this
  }

  delete() {
    this.action = 'delete'
    return this
  }

  // ---------------------------------------------------------- filters ----
  filter(col, op, value) {
    this.filters.push({ col, op, value })
    return this
  }

  eq(col, value) { return this.filter(col, 'eq', value) }
  neq(col, value) { return this.filter(col, 'neq', value) }
  gt(col, value) { return this.filter(col, 'gt', value) }
  gte(col, value) { return this.filter(col, 'gte', value) }
  lt(col, value) { return this.filter(col, 'lt', value) }
  lte(col, value) { return this.filter(col, 'lte', value) }
  like(col, value) { return this.filter(col, 'like', value) }
  ilike(col, value) { return this.filter(col, 'ilike', value) }
  in(col, values) { return this.filter(col, 'in', parseList(values)) }
  is(col, value) { return this.filter(col, 'is', value) }

  not(col, op, value) {
    if (op === 'in') return this.filter(col, 'not_in', parseList(value))
    if (op === 'is') return this.filter(col, 'not_is', value)
    if (op === 'eq') return this.filter(col, 'neq', value)
    throw new Error(`db: not(${op}) is not supported`)
  }

  order(col, { ascending = true, nullsFirst } = {}) {
    this.orders.push({ col, ascending, nullsFirst })
    return this
  }

  limit(n) {
    this.limitN = Math.max(0, Math.floor(Number(n)))
    return this
  }

  single() {
    this.expect = 'single'
    return this
  }

  maybeSingle() {
    this.expect = 'maybeSingle'
    return this
  }

  // --------------------------------------------------------- compiling ----
  whereClause(params, alias) {
    if (!this.filters.length) return ''
    const add = (value) => {
      params.push(value)
      return `$${params.length}`
    }
    const conditions = this.filters.map(({ col, op, value }) => {
      const c = `${alias}.${ident(col)}`
      switch (op) {
        case 'eq': return `${c} = ${add(this.db.toParam(this.table, col, value))}`
        case 'neq': return `${c} <> ${add(this.db.toParam(this.table, col, value))}`
        case 'gt': return `${c} > ${add(value)}`
        case 'gte': return `${c} >= ${add(value)}`
        case 'lt': return `${c} < ${add(value)}`
        case 'lte': return `${c} <= ${add(value)}`
        case 'like': return `${c} like ${add(value)}`
        case 'ilike': return `${c} ilike ${add(value)}`
        case 'in': return value.length ? `${c} = any(${add(value)})` : 'false'
        case 'not_in': return value.length ? `not (${c} = any(${add(value)}))` : 'true'
        case 'is':
        case 'not_is': {
          const keyword = value === null ? 'null' : value === true ? 'true' : value === false ? 'false' : null
          if (!keyword) throw new Error(`db: is(${col}, ${JSON.stringify(value)}) is not supported`)
          return `${c} is ${op === 'not_is' ? 'not ' : ''}${keyword}`
        }
        default: throw new Error(`db: unknown filter ${op}`)
      }
    })
    return ` where ${conditions.join(' and ')}`
  }

  compile() {
    const t = ident(this.table)
    const params = []
    const add = (value) => {
      params.push(value)
      return `$${params.length}`
    }
    const returning = this.returning ? ` returning ${columnList(this.returning, t)}` : ''

    if (this.action === 'select') {
      let text = `select ${columnList(this.columns, 't')} from ${t} t${this.whereClause(params, 't')}`
      if (this.orders.length) {
        text += ' order by ' + this.orders
          .map(({ col, ascending, nullsFirst }) =>
            `t.${ident(col)} ${ascending ? 'asc' : 'desc'}${nullsFirst === undefined ? '' : nullsFirst ? ' nulls first' : ' nulls last'}`)
          .join(', ')
      }
      if (this.limitN !== null) text += ` limit ${this.limitN}`
      return { text, params }
    }

    if (this.action === 'insert' || this.action === 'upsert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
      if (!rows.length) return null
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r || {})))]
      let text
      if (!columns.length) {
        text = `insert into ${t} default values`
      } else {
        const values = rows
          .map((row) => `(${columns.map((c) => (Object.prototype.hasOwnProperty.call(row, c) && row[c] !== undefined
            ? add(this.db.toParam(this.table, c, row[c]))
            : 'default')).join(', ')})`)
          .join(', ')
        text = `insert into ${t} (${columns.map(ident).join(', ')}) values ${values}`
      }
      if (this.action === 'upsert') {
        const conflict = String(this.options.onConflict || 'id').split(',').map((c) => c.trim()).filter(Boolean)
        const updates = columns.filter((c) => !conflict.includes(c))
        text += ` on conflict (${conflict.map(ident).join(', ')}) `
        text += this.options.ignoreDuplicates || !updates.length
          ? 'do nothing'
          : `do update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`
      }
      return { text: text + returning, params }
    }

    if (this.action === 'update') {
      const columns = Object.keys(this.payload || {}).filter((c) => this.payload[c] !== undefined)
      if (!columns.length) throw new Error('db: update() with nothing to update')
      const set = columns.map((c) => `${ident(c)} = ${add(this.db.toParam(this.table, c, this.payload[c]))}`).join(', ')
      return { text: `update ${t} set ${set}${this.whereClause(params, t)}${returning}`, params }
    }

    if (this.action === 'delete') {
      return { text: `delete from ${t}${this.whereClause(params, t)}${returning}`, params }
    }
    throw new Error(`db: unknown action ${this.action}`)
  }

  async execute() {
    let rows
    try {
      await this.db.ready()
      const compiled = this.compile()
      rows = compiled ? (await this.db.query(compiled.text, compiled.params)).rows : []
    } catch (error) {
      return { data: null, error: toPostgrestError(error) }
    }
    const wantsRows = this.action === 'select' || this.returning
    if (this.expect === 'single' || this.expect === 'maybeSingle') {
      if (rows.length > 1 || (this.expect === 'single' && rows.length === 0)) {
        return {
          data: null,
          error: {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `The result contains ${rows.length} rows`
          }
        }
      }
      return { data: wantsRows ? rows[0] ?? null : null, error: null }
    }
    return { data: wantsRows ? rows : null, error: null }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

export function toPostgrestError(error) {
  return {
    code: error.code || 'DB_ERROR',
    message: error.message || String(error),
    details: error.detail || null,
    hint: error.hint || null
  }
}

/**
 * query(text, params) -> { rows } with values already in PostgREST's shape.
 * The column types (one query per isolate) let JS arrays reach json/jsonb
 * columns as JSON and text[] columns as Postgres arrays.
 */
export function createDb({ query }) {
  let columnTypes = null
  let loading = null
  const db = {
    query,
    async ready() {
      if (columnTypes) return
      loading ||= query(
        `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`,
        []
      ).then(({ rows }) => {
        columnTypes = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]))
      }).finally(() => {
        loading = null
      })
      await loading
    },
    toParam(table, column, value) {
      if (value === null || value === undefined) return null
      const type = columnTypes?.get(`${table}.${column}`)
      if (type === 'json' || type === 'jsonb') return JSON.stringify(value)
      if (value instanceof Date) return value.toISOString()
      return value
    },
    from(table) {
      return new QueryBuilder(db, table)
    },
    async rpc(name, args = {}) {
      try {
        const params = []
        const named = Object.entries(args).map(([key, value]) => {
          params.push(value)
          return `${ident(key)} => $${params.length}`
        })
        // PostgREST's shape: a scalar (or void -> null) for a function
        // returning one value, the rows for one returning a table.
        const { rows } = await query(`select * from public.${ident(name)}(${named.join(', ')})`, params)
        const keys = rows.length === 1 ? Object.keys(rows[0]) : []
        if (keys.length === 1 && keys[0] === name) return { data: rows[0][name] ?? null, error: null }
        return { data: rows, error: null }
      } catch (error) {
        return { data: null, error: toPostgrestError(error) }
      }
    }
  }
  return db
}

// ---------------------------------------------------------------------------
// Value shapes (shared by the Neon executor and the PGlite one in tests)
// ---------------------------------------------------------------------------
// Postgres text output -> what PostgREST put in its JSON.
const toNumber = (text) => Number(text)
function toIsoTimestamp(text) {
  // "2026-01-01 10:00:00.123+00" -> "2026-01-01T10:00:00.123+00:00"
  return String(text).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
}
const keep = (text) => text

// type oid -> parser for the text representation
export const TYPE_PARSERS = {
  20: toNumber, // int8
  21: toNumber, // int2
  23: toNumber, // int4
  700: toNumber, // float4
  701: toNumber, // float8
  1700: toNumber, // numeric
  16: (text) => text === 't' || text === 'true', // bool
  114: (text) => JSON.parse(text), // json
  3802: (text) => JSON.parse(text), // jsonb
  1082: keep, // date
  1083: keep, // time
  1114: (text) => String(text).replace(' ', 'T'), // timestamp
  1184: toIsoTimestamp, // timestamptz
  2950: keep, // uuid
  25: keep, // text
  1043: keep, // varchar
  2278: () => null // void (a function returning nothing, through rpc())
}

// Postgres array literal "{a,b,"c d",NULL}" -> ['a', 'b', 'c d', null]
export function parseTextArray(text, item = keep) {
  const out = []
  const s = String(text)
  let i = 1
  while (i < s.length - 1) {
    let value = ''
    let quoted = false
    if (s[i] === '"') {
      quoted = true
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') i++
        value += s[i++]
      }
      i++
    } else {
      while (i < s.length - 1 && s[i] !== ',') value += s[i++]
    }
    out.push(!quoted && value === 'NULL' ? null : item(value))
    i++ // the comma
  }
  return out
}

const ARRAY_PARSERS = {
  1009: (text) => parseTextArray(text), // text[]
  1015: (text) => parseTextArray(text), // varchar[]
  2951: (text) => parseTextArray(text), // uuid[]
  1007: (text) => parseTextArray(text, toNumber), // int4[]
  1016: (text) => parseTextArray(text, toNumber), // int8[]
  1231: (text) => parseTextArray(text, toNumber) // numeric[]
}

export function parserFor(oid) {
  return TYPE_PARSERS[oid] || ARRAY_PARSERS[oid] || keep
}

// ---------------------------------------------------------------------------
// Neon (serverless driver, one HTTPS request per statement — works on
// Workers without a TCP socket or a connection pool)
// ---------------------------------------------------------------------------
export function neonExecutor(sql) {
  const types = { getTypeParser: (oid) => parserFor(oid) }
  return {
    async query(text, params) {
      const result = await sql.query(text, params, { fullResults: true, types })
      return { rows: result.rows, rowCount: result.rowCount }
    }
  }
}

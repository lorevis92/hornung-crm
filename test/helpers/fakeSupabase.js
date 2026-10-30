// In-memory stand-in for the service-role supabase-js client, covering
// exactly the query-builder subset the serverless functions use. Lets the
// authorization tests run the REAL endpoint handlers end to end (cookie ->
// session -> access check -> query) without a database.
import { randomUUID } from 'node:crypto'

const UNIQUE = {
  auth_accounts: [['email']],
  auth_sessions: [['token_hash']],
  auth_tokens: [['token_hash']],
  app_profiles: [['user_id', 'app_id']],
  tax_cases: [['client_id', 'tax_year']],
  client_details: [['client_id']],
  client_persons: [['client_id', 'person_type']],
  ai_model_settings: [['key']]
}

function likeToRegex(pattern) {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
}

function project(row, columns) {
  if (!columns || columns.trim() === '*') return { ...row }
  const out = {}
  for (const col of columns.split(',').map((c) => c.trim()).filter(Boolean)) out[col] = row[col]
  return out
}

class Query {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.action = 'select'
    this.columns = '*'
    this.returning = false
    this.filters = []
    this.orders = []
    this.limitN = null
    this.payload = null
    this.options = {}
  }

  rows() {
    if (!this.db.tables[this.table]) this.db.tables[this.table] = []
    return this.db.tables[this.table]
  }

  select(columns = '*') {
    if (this.action === 'select') this.columns = columns
    else this.returning = columns
    return this
  }
  insert(payload) {
    this.action = 'insert'
    this.payload = payload
    return this
  }
  update(payload) {
    this.action = 'update'
    this.payload = payload
    return this
  }
  upsert(payload, options = {}) {
    this.action = 'upsert'
    this.payload = payload
    this.options = options
    return this
  }
  delete() {
    this.action = 'delete'
    return this
  }

  eq(col, value) {
    this.filters.push((r) => r[col] === value)
    return this
  }
  neq(col, value) {
    this.filters.push((r) => r[col] !== value)
    return this
  }
  in(col, values) {
    this.filters.push((r) => values.includes(r[col]))
    return this
  }
  is(col, value) {
    this.filters.push((r) => (value === null ? r[col] === null || r[col] === undefined : r[col] === value))
    return this
  }
  gt(col, value) {
    this.filters.push((r) => r[col] > value)
    return this
  }
  gte(col, value) {
    this.filters.push((r) => r[col] >= value)
    return this
  }
  lt(col, value) {
    this.filters.push((r) => r[col] < value)
    return this
  }
  ilike(col, pattern) {
    const re = likeToRegex(pattern)
    this.filters.push((r) => re.test(String(r[col] ?? '')))
    return this
  }
  not(col, operator, value) {
    if (operator !== 'in') throw new Error(`fake: not(${operator}) unsupported`)
    const list = String(value).replace(/^\(|\)$/g, '').split(',')
    this.filters.push((r) => !list.includes(String(r[col])))
    return this
  }
  order(col, { ascending = true } = {}) {
    this.orders.push([col, ascending])
    return this
  }
  limit(n) {
    this.limitN = n
    return this
  }

  matching() {
    return this.rows().filter((r) => this.filters.every((f) => f(r)))
  }

  violates(candidate, ignore) {
    for (const keys of UNIQUE[this.table] || []) {
      const clash = this.rows().find(
        (r) => r !== ignore && keys.every((k) => candidate[k] !== undefined && r[k] === candidate[k])
      )
      if (clash) return true
    }
    return false
  }

  withDefaults(row) {
    const now = new Date().toISOString()
    return { id: randomUUID(), created_at: now, ...row }
  }

  run() {
    this.db.log.push({ table: this.table, action: this.action })
    const conflict = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    let result
    if (this.action === 'select') {
      result = this.matching().map((r) => project(r, this.columns))
      for (const [col, asc] of [...this.orders].reverse()) {
        result.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)))
      }
      if (this.limitN !== null) result = result.slice(0, this.limitN)
    } else if (this.action === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => this.withDefaults(r))
      for (const row of list) if (this.violates(row)) return conflict
      this.rows().push(...list)
      result = list
    } else if (this.action === 'update') {
      result = this.matching()
      for (const row of result) {
        if (this.violates({ ...row, ...this.payload }, row)) return conflict
      }
      for (const row of result) Object.assign(row, this.payload)
    } else if (this.action === 'upsert') {
      const keys = String(this.options.onConflict || 'id').split(',').map((k) => k.trim())
      result = []
      for (const incoming of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const existing = this.rows().find((r) => keys.every((k) => r[k] === incoming[k]))
        if (existing) {
          Object.assign(existing, incoming)
          result.push(existing)
        } else {
          const row = this.withDefaults(incoming)
          if (this.violates(row)) return conflict
          this.rows().push(row)
          result.push(row)
        }
      }
    } else if (this.action === 'delete') {
      result = this.matching()
      this.db.tables[this.table] = this.rows().filter((r) => !result.includes(r))
    }
    const columns = this.action === 'select' ? null : this.returning
    const data = columns ? result.map((r) => project(r, columns)) : this.action === 'select' ? result : null
    return { data, error: null, all: result }
  }

  async single() {
    const { data, error } = this.run()
    if (error) return { data: null, error }
    const list = data || []
    if (list.length !== 1) return { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${list.length}` } }
    return { data: list[0], error: null }
  }

  async maybeSingle() {
    const { data, error } = this.run()
    if (error) return { data: null, error }
    const list = data || []
    if (list.length > 1) return { data: null, error: { code: 'PGRST116', message: 'more than one row' } }
    return { data: list[0] ?? null, error: null }
  }

  then(resolve, reject) {
    try {
      const { data, error } = this.run()
      return Promise.resolve({ data, error }).then(resolve, reject)
    } catch (err) {
      return Promise.reject(err).then(resolve, reject)
    }
  }
}

export function createFakeDb(seed = {}) {
  const db = {
    tables: structuredClone(seed.tables || {}),
    objects: new Set(seed.objects || []),
    removed: [],
    signedUploads: [],
    rpcCalls: [],
    rpcs: seed.rpcs || {},
    log: [],
    from(table) {
      return new Query(db, table)
    },
    async rpc(name, args) {
      db.rpcCalls.push({ name, args })
      const fn = db.rpcs[name]
      if (!fn) return { data: null, error: null }
      try {
        return { data: await fn(args, db), error: null }
      } catch (err) {
        return { data: null, error: { message: err.message } }
      }
    },
    storage: {
      from() {
        return {
          async createSignedUploadUrl(path) {
            db.signedUploads.push(path)
            return { data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: 't', path }, error: null }
          },
          async createSignedUrl(path) {
            return { data: { signedUrl: `https://storage.test/signed/${path}` }, error: null }
          },
          async remove(paths) {
            for (const p of paths) {
              db.removed.push(p)
              db.objects.delete(p)
            }
            return { data: paths, error: null }
          },
          async list(prefix, { search = '' } = {}) {
            const items = [...db.objects]
              .filter((p) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes('/'))
              .map((p) => ({ id: p, name: p.slice(prefix.length + 1) }))
              .filter((o) => o.name.includes(search))
            return { data: items, error: null }
          }
        }
      }
    },
    snapshot() {
      return JSON.stringify({ tables: db.tables, objects: [...db.objects].sort() })
    }
  }
  return db
}

// Minimal Vercel-style req/res pair.
export function makeReq({ method = 'POST', body = {}, cookie = null, query = {}, headers = {}, url = '/' } = {}) {
  return {
    method,
    body,
    query,
    url,
    headers: { host: 'app.test', ...(cookie ? { cookie } : {}), ...headers }
  }
}

export function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code
      return res
    },
    json(payload) {
      res.body = payload
      return res
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()]
    },
    writeHead(code, headers = {}) {
      res.statusCode = code
      for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = v
    },
    end() {}
  }
  return res
}

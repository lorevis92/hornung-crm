// There is no demo / sample-data mode any more: the app only ever talks to
// the real backend. A deployment without its server environment variables
// must say so clearly (BackendUnavailable, driven by /api/auth/me answering
// MISSING_DATABASE_ENV) instead of quietly running on fake data.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  delete process.env.DATABASE_URL
  process.env.PUBLIC_SITE_URL = 'https://app.test'
})
vi.mock('../api/_dbClient.js', () => ({
  createServiceClient: () => {
    throw new Error('no database client may be created without configuration')
  }
}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }))

const { default: authHandler } = await import('../api/auth/[action].js')
const { default: dataHandler } = await import('../api/data/[op].js')
const { makeReq, makeRes } = await import('./helpers/fakeSupabase.js')

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : /\.(jsx?|tsx?)$/.test(entry) ? [full] : []
  })
}

describe('the browser code has no path that works without a backend', () => {
  const files = walk('src')

  it('the demo data layer and its seed are gone', () => {
    expect(existsSync('src/lib/data/demo.js')).toBe(false)
    expect(existsSync('src/lib/demoSeed.js')).toBe(false)
  })

  it('nothing refers to a demo mode', () => {
    const offenders = files.filter((f) => /IS_DEMO|isDemo|signInDemo|VITE_DEMO_MODE|demoApi|demoBadge/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the one data layer is the API client', () => {
    const index = readFileSync('src/lib/data/index.js', 'utf8')
    expect(index).toMatch(/export const api = supabaseApi/)
    expect(index).not.toMatch(/\?/)
  })

  it('a failing /api/auth/me shows the backend error page, not the login form', () => {
    const auth = readFileSync('src/context/AuthContext.jsx', 'utf8')
    expect(auth).toMatch(/setBackendError\(\{ code: err\.code/)
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/if \(backendError\)[\s\S]*<BackendUnavailable/)
  })
})

describe('a server without its environment variables says so', () => {
  it('GET /api/auth/me answers 500 MISSING_DATABASE_ENV (what the page turns into "not configured")', async () => {
    const res = makeRes()
    await authHandler(makeReq({ method: 'GET', query: { action: 'me' } }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.code).toBe('MISSING_DATABASE_ENV')
  })

  it('login is refused the same way — never accepted against anything else', async () => {
    const res = makeRes()
    await authHandler(
      makeReq({ query: { action: 'login' }, headers: { origin: 'https://app.test' }, body: { email: 'a@b.ch', password: 'whatever-123' } }),
      res
    )
    expect(res.statusCode).toBe(500)
    expect(res.body.code).toBe('MISSING_DATABASE_ENV')
  })

  it('a data call is refused the same way', async () => {
    const res = makeRes()
    await dataHandler(makeReq({ query: { op: 'listPricing' }, headers: { origin: 'https://app.test' }, cookie: 'hc_session=x' }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.code).toBe('MISSING_DATABASE_ENV')
  })
})

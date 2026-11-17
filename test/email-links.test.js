// The links in the invite / reset / confirmation e-mails, taken from the
// e-mail exactly as it is handed to Resend, and then used.
//
// The token travels in the query string (?token=), not in the fragment
// (#token=): mail link rewriters (Gmail's safe-browsing redirect and
// similar) can drop what follows "#", and the link then arrived without
// its token ("This link is no longer valid").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@db.test/test'
  delete process.env.OWNER_EMAIL
  return { db: null, sent: [] }
})
vi.mock('../api/_dbClient.js', () => ({ createServiceClient: () => state.db }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }))
vi.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = { send: async (payload) => (state.sent.push(payload), { data: { id: 'test' }, error: null }) }
    }
  }
}))

const { default: authHandler } = await import('../api/auth/[action].js')
const auth = await import('../api/_auth.js')
const { readLinkToken, addressWithoutToken } = await import('../src/lib/linkToken.js')
const { buildWorld, IDS, sessionCookie } = await import('./helpers/world.js')
const { makeReq, makeRes } = await import('./helpers/fakeSupabase.js')
const ENDPOINTS = {
  register: (await import('../api/register.js')).default,
  'reset-password': (await import('../api/reset-password.js')).default,
  'invite-client': (await import('../api/invite-client.js')).default,
  'invite-staff': (await import('../api/invite-staff.js')).default
}

const SITE = 'https://app.test' // the host of makeReq, so same-origin checks pass
let db
beforeEach(() => {
  db = buildWorld()
  state.db = db
  state.sent = []
  process.env.RESEND_API_KEY = 're_test'
  process.env.PUBLIC_SITE_URL = SITE
})
afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.REQUIRE_EMAIL_CONFIRMATION
})

async function endpoint(name, body, cookie = null) {
  const res = makeRes()
  await ENDPOINTS[name](makeReq({ body, cookie }), res)
  return res
}
async function authCall(action, { body = {}, method = 'POST', query = {} } = {}) {
  const res = makeRes()
  await authHandler(makeReq({ method, body, query: { action, ...query } }), res)
  return res
}

// The one link of the last e-mail that carries a token.
function linkInLastEmail(to) {
  const mail = state.sent.at(-1)
  expect(mail?.to).toEqual([to])
  const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  const withToken = links.filter((href) => href.includes('token'))
  expect(withToken).toHaveLength(1)
  return new URL(withToken[0])
}

// What a mail link rewriter may do: keep the address, lose the fragment.
const withoutFragment = (url) => new URL(url.origin + url.pathname + url.search)

function expectTokenInQuery(url, path) {
  expect(url.origin).toBe(SITE)
  expect(url.pathname).toBe(path)
  expect(url.hash).toBe('')
  expect(url.searchParams.get('token')).toMatch(/\S{20,}/)
}

// The page's side: what SetPassword reads from window.location.
const pageToken = (url) => readLinkToken({ search: url.search, hash: url.hash })

describe('setPasswordLink', () => {
  it('puts the token in the query string, URL-encoded, never in the fragment', () => {
    const url = new URL(auth.setPasswordLink(SITE, 'a/b+c=d'))
    expectTokenInQuery(new URL(auth.setPasswordLink(SITE, 'x'.repeat(30))), '/set-password')
    expect(url.searchParams.get('token')).toBe('a/b+c=d')
    expect(url.hash).toBe('')
  })
})

describe('the links in the real e-mails work with the token in the query string', () => {
  it('reset password: the link survives losing the fragment, sets the password, and works once', async () => {
    expect((await endpoint('reset-password', { email: 'b@client.test' })).statusCode).toBe(200)
    const link = withoutFragment(linkInLastEmail('b@client.test'))
    expectTokenInQuery(link, '/set-password')

    const token = pageToken(link)
    expect((await authCall('check-link', { body: { token } })).body).toMatchObject({ valid: true, purpose: 'recovery' })
    const set = await authCall('set-password', { body: { token, password: 'reset from mail 1' } })
    expect(set.statusCode).toBe(200)
    expect(set.body.user.id).toBe(IDS.accB)
    expect((await authCall('set-password', { body: { token, password: 'second use pw 1' } })).statusCode).toBe(400)
  })

  it('client invite (new login): the link activates the account', async () => {
    const asStaff = sessionCookie(db, IDS.accStaff)
    const res = await endpoint('invite-client', { first_name: 'Nina', last_name: 'N', email: 'nina@client.test', preferred_language: 'it' }, asStaff)
    expect(res.statusCode).toBe(200)
    const link = withoutFragment(linkInLastEmail('nina@client.test'))
    expectTokenInQuery(link, '/set-password')
    const set = await authCall('set-password', { body: { token: pageToken(link), password: 'nina password 1' } })
    expect(set.statusCode).toBe(200)
    expect(set.body.user.email).toBe('nina@client.test')
  })

  it('client invite sent again: a new working link', async () => {
    const asStaff = sessionCookie(db, IDS.accStaff)
    await endpoint('invite-client', { first_name: 'Nina', last_name: 'N', email: 'nina@client.test' }, asStaff)
    const clientId = db.tables.clients.find((c) => c.email === 'nina@client.test').id
    expect((await endpoint('invite-client', { clientId, resend: true }, asStaff)).statusCode).toBe(200)
    const link = withoutFragment(linkInLastEmail('nina@client.test'))
    expectTokenInQuery(link, '/set-password')
    expect((await authCall('set-password', { body: { token: pageToken(link), password: 'nina password 2' } })).statusCode).toBe(200)
  })

  it('staff invite (new login): the link activates the account', async () => {
    const asStaff = sessionCookie(db, IDS.accStaff)
    const res = await endpoint('invite-staff', { full_name: 'Sam S', email: 'sam@hornung.test' }, asStaff)
    expect(res.statusCode).toBe(200)
    const link = withoutFragment(linkInLastEmail('sam@hornung.test'))
    expectTokenInQuery(link, '/set-password')
    expect((await authCall('set-password', { body: { token: pageToken(link), password: 'sam password 1' } })).statusCode).toBe(200)
  })

  it('e-mail confirmation: the server-side link (already ?token=) confirms and redirects to /login', async () => {
    process.env.REQUIRE_EMAIL_CONFIRMATION = 'true'
    expect((await endpoint('register', { email: 'fresh@client.test', password: 'fresh password 1' })).body.needsConfirmation).toBe(true)
    const link = withoutFragment(linkInLastEmail('fresh@client.test'))
    expectTokenInQuery(link, '/api/auth/confirm-email')
    const res = await authCall('confirm-email', { method: 'GET', query: { token: link.searchParams.get('token') } })
    expect(res.headers?.location || res.getHeader?.('location') || JSON.stringify(res)).toContain(`${SITE}/login?confirmed=1`)
    expect(db.tables.auth_accounts.find((a) => a.email === 'fresh@client.test').email_confirmed_at).toBeTruthy()
  })
})

describe('the /set-password page', () => {
  const at = (href) => {
    const u = new URL(href)
    return { pathname: u.pathname, search: u.search, hash: u.hash }
  }

  it('reads the token from the query string', () => {
    expect(readLinkToken(at(`${SITE}/set-password?token=abc%2Bdef`))).toBe('abc+def')
  })

  it('still reads links sent before the change (#token=..., invites stay valid 7 days)', () => {
    expect(readLinkToken(at(`${SITE}/set-password#token=old-link`))).toBe('old-link')
  })

  it('no token: empty (the page shows "link no longer valid")', () => {
    expect(readLinkToken(at(`${SITE}/set-password`))).toBe('')
  })

  it('removes the token from the address once read, keeping any other parameter', () => {
    expect(addressWithoutToken(at(`${SITE}/set-password?token=abc`))).toBe('/set-password')
    expect(addressWithoutToken(at(`${SITE}/set-password?lang=it&token=abc`))).toBe('/set-password?lang=it')
  })
})

// Own login (api/_auth.js + api/auth/[action].js) and every endpoint whose
// access check moved from a Supabase JWT to the session cookie. Real
// handlers, in-memory database: each test is what someone could do by
// calling the endpoint directly, without the app's pages.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@db.test/test'
  process.env.PUBLIC_SITE_URL = 'https://app.test'
  delete process.env.RESEND_API_KEY
  delete process.env.OWNER_EMAIL
  return { db: null }
})
vi.mock('../api/_dbClient.js', () => ({ createServiceClient: () => state.db }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }))

const { default: authHandler } = await import('../api/auth/[action].js')
const auth = await import('../api/_auth.js')
const { buildWorld, IDS, PASSWORD, sessionCookie } = await import('./helpers/world.js')
const { makeReq, makeRes } = await import('./helpers/fakeSupabase.js')

const ENDPOINTS = {
  register: (await import('../api/register.js')).default,
  'reset-password': (await import('../api/reset-password.js')).default,
  'claim-profile': (await import('../api/claim-profile.js')).default,
  'invite-client': (await import('../api/invite-client.js')).default,
  'invite-staff': (await import('../api/invite-staff.js')).default,
  'delete-client': (await import('../api/delete-client.js')).default,
  'notify-late-upload': (await import('../api/notify-late-upload.js')).default,
  'case-status': (await import('../api/case-status.js')).default,
  'case-assistant': (await import('../api/case-assistant.js')).default,
  'extract-document-now': (await import('../api/extract-document-now.js')).default,
  'retry-extraction': (await import('../api/retry-extraction.js')).default,
  'reprocess-client-year': (await import('../api/reprocess-client-year.js')).default,
  'sync-personal-details': (await import('../api/sync-personal-details.js')).default,
  'sync-property-suggestion': (await import('../api/sync-property-suggestion.js')).default,
  'sync-child-suggestions': (await import('../api/sync-child-suggestions.js')).default
}

let db
beforeEach(() => {
  db = buildWorld()
  state.db = db
})

async function authCall(action, { body = {}, cookie = null, method = 'POST', headers = {}, query = {} } = {}) {
  const res = makeRes()
  await authHandler(makeReq({ method, body, cookie, headers, query: { action, ...query } }), res)
  return res
}

async function endpoint(name, body, cookie = null, headers = {}) {
  const res = makeRes()
  await ENDPOINTS[name](makeReq({ body, cookie, headers }), res)
  return res
}

function cookieFrom(res) {
  const list = [].concat(res.getHeader('set-cookie') || [])
  const line = list.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`))
  return line ? line.split(';')[0] : null
}

describe('login', () => {
  it('right password: an httpOnly, Secure, SameSite session cookie; only its hash is stored', async () => {
    const res = await authCall('login', { body: { email: 'B@Client.test ', password: PASSWORD } })
    expect(res.statusCode).toBe(200)
    expect(res.body.profile.id).toBe(IDS.pB)
    expect(res.body.client.id).toBe(IDS.cB)
    const line = [].concat(res.getHeader('set-cookie')).find((c) => c.startsWith('hc_session='))
    expect(line).toMatch(/HttpOnly/)
    expect(line).toMatch(/Secure/)
    expect(line).toMatch(/SameSite=Lax/)
    expect(line).toMatch(/Path=\//)
    const token = cookieFrom(res).split('=')[1]
    expect(db.tables.auth_sessions.some((s) => s.token_hash === auth.hashToken(token))).toBe(true)
    expect(JSON.stringify(db.tables.auth_sessions)).not.toContain(token)
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[ab]\$/)
  })

  it('a password hash written by Supabase Auth ($2a$) still works', async () => {
    expect(db.tables.auth_accounts.find((a) => a.id === IDS.accA).password_hash.startsWith('$2a$')).toBe(true)
    const res = await authCall('login', { body: { email: 'a@client.test', password: PASSWORD } })
    expect(res.statusCode).toBe(200)
  })

  it('wrong password and unknown e-mail look exactly the same', async () => {
    const wrong = await authCall('login', { body: { email: 'b@client.test', password: 'nope-nope-nope' } })
    const unknown = await authCall('login', { body: { email: 'ghost@client.test', password: 'nope-nope-nope' } })
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.body).toEqual(unknown.body)
    expect(cookieFrom(wrong)).toBeNull()
  })

  // Four bcrypt cost-12 comparisons (the unknown-e-mail path compares
  // against a dummy hash on purpose): seconds of CPU, more than vitest's
  // default 5 s when the image tests run alongside.
  it('an e-mail with SQL wildcards matches nobody', async () => {
    for (const email of ['%', '%@client.test', 'b@client.tes_', '_@client.test']) {
      const res = await authCall('login', { body: { email, password: PASSWORD } })
      expect(res.statusCode).toBe(401)
    }
  }, 30000)

  it('locks the account after repeated failures, even for the right password', async () => {
    for (let i = 0; i < auth.MAX_FAILED_LOGINS; i++) {
      await authCall('login', { body: { email: 'b@client.test', password: `wrong-${i}-xxxx` } })
    }
    const res = await authCall('login', { body: { email: 'b@client.test', password: PASSWORD } })
    expect(res.statusCode).toBe(429)
    expect(cookieFrom(res)).toBeNull()
  })

  it('an unconfirmed self sign-up cannot sign in', async () => {
    const res = await authCall('login', { body: { email: 'new@client.test', password: PASSWORD } })
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('EMAIL_NOT_CONFIRMED')
  })

  it('refuses a login posted from another site', async () => {
    const res = await authCall('login', {
      body: { email: 'b@client.test', password: PASSWORD },
      headers: { origin: 'https://evil.test' }
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('session lifecycle', () => {
  it('me without a cookie is "signed out", never someone else', async () => {
    const res = await authCall('me', { method: 'GET' })
    expect(res.body).toEqual({ user: null, profile: null, client: null })
  })

  it('me activates an invited client (what mark_client_active() did)', async () => {
    const res = await authCall('me', { method: 'GET', cookie: sessionCookie(db, IDS.accA) })
    expect(res.body.client.id).toBe(IDS.cA)
    expect(db.tables.clients.find((c) => c.id === IDS.cA).status).toBe('active')
  })

  it('logout deletes the session server-side: the old cookie stops working', async () => {
    const cookie = sessionCookie(db, IDS.accB)
    await authCall('logout', { cookie })
    expect(db.tables.auth_sessions.some((s) => s.account_id === IDS.accB)).toBe(false)
    const res = await authCall('me', { method: 'GET', cookie })
    expect(res.body.user).toBeNull()
  })

  it('change-password needs a session, and signs every other browser out', async () => {
    expect((await authCall('change-password', { body: { password: 'new password 123' } })).statusCode).toBe(401)
    const here = sessionCookie(db, IDS.accB)
    const elsewhere = sessionCookie(db, IDS.accB)
    const res = await authCall('change-password', { body: { password: 'new password 123' }, cookie: here })
    expect(res.statusCode).toBe(200)
    expect((await authCall('me', { method: 'GET', cookie: here })).body.user.id).toBe(IDS.accB)
    expect((await authCall('me', { method: 'GET', cookie: elsewhere })).body.user).toBeNull()
    expect((await authCall('login', { body: { email: 'b@client.test', password: 'new password 123' } })).statusCode).toBe(200)
  })

  it('change-password cannot be used to change someone else\'s password', async () => {
    const before = db.tables.auth_accounts.find((a) => a.id === IDS.accB).password_hash
    await authCall('change-password', {
      body: { password: 'attacker pass 1', accountId: IDS.accB, email: 'b@client.test' },
      cookie: sessionCookie(db, IDS.accA)
    })
    expect(db.tables.auth_accounts.find((a) => a.id === IDS.accB).password_hash).toBe(before)
  })
})

describe('one-time links (invite / reset / confirm)', () => {
  it('set-password: the link sets the password, confirms the e-mail, signs in, and works only once', async () => {
    const token = await auth.issueToken(db, IDS.accUnconfirmed, 'invite')
    expect((await authCall('check-link', { body: { token } })).body).toMatchObject({ valid: true, email: 'new@client.test' })
    const res = await authCall('set-password', { body: { token, password: 'brand new pw 1' } })
    expect(res.statusCode).toBe(200)
    expect(cookieFrom(res)).not.toBeNull()
    expect(db.tables.auth_accounts.find((a) => a.id === IDS.accUnconfirmed).email_confirmed_at).not.toBeNull()
    const again = await authCall('set-password', { body: { token, password: 'second try pw 1' } })
    expect(again.statusCode).toBe(400)
    expect((await authCall('check-link', { body: { token } })).body.valid).toBe(false)
  })

  it('a reset link signs out every existing session of that account', async () => {
    const old = sessionCookie(db, IDS.accB)
    const token = await auth.issueToken(db, IDS.accB, 'recovery')
    await authCall('set-password', { body: { token, password: 'reset password 1' } })
    expect((await authCall('me', { method: 'GET', cookie: old })).body.user).toBeNull()
  })

  it('expired, made-up, or wrong-purpose tokens are refused', async () => {
    const expired = await auth.issueToken(db, IDS.accB, 'recovery')
    db.tables.auth_tokens.at(-1).expires_at = new Date(Date.now() - 1000).toISOString()
    const confirmOnly = await auth.issueToken(db, IDS.accB, 'confirm_email')
    for (const token of [expired, confirmOnly, 'made-up-token', '', null]) {
      const res = await authCall('set-password', { body: { token, password: 'whatever pw 12' } })
      expect(res.statusCode).toBe(400)
    }
    expect(db.tables.auth_accounts.find((a) => a.id === IDS.accB).password_changed_at).toBeUndefined()
  })

  it('tokens are stored hashed only', async () => {
    const token = await auth.issueToken(db, IDS.accB, 'recovery')
    expect(JSON.stringify(db.tables.auth_tokens)).not.toContain(token)
  })

  it('confirm-email confirms with a valid link, redirects either way', async () => {
    const token = await auth.issueToken(db, IDS.accUnconfirmed, 'confirm_email')
    const ok = await authCall('confirm-email', { method: 'GET', query: { token } })
    expect(ok.statusCode).toBe(302)
    expect(ok.getHeader('location')).toBe('https://app.test/login?confirmed=1')
    expect(db.tables.auth_accounts.find((a) => a.id === IDS.accUnconfirmed).email_confirmed_at).not.toBeNull()
    const bad = await authCall('confirm-email', { method: 'GET', query: { token } })
    expect(bad.getHeader('location')).toBe('https://app.test/login?confirmed=0')
  })
})

describe('register / reset-password / claim-profile', () => {
  it('register creates a login only — no profile, so no access to anything yet', async () => {
    const res = await endpoint('register', { email: 'Fresh@Client.test', password: 'fresh password 1' })
    expect(res.statusCode).toBe(200)
    const account = db.tables.auth_accounts.find((a) => a.email === 'fresh@client.test')
    expect(account.password_hash.startsWith('$2')).toBe(true)
    expect(db.tables.app_profiles.some((p) => p.user_id === account.id)).toBe(false)
    expect((await endpoint('register', { email: 'fresh@client.test', password: 'other password 1' })).body.code).toBe('EMAIL_IN_USE')
  })

  it('registering the OWNER_EMAIL address (staff on first sign-in) always needs the e-mail link', async () => {
    process.env.OWNER_EMAIL = 'Owner@Hornung.test'
    try {
      const res = await endpoint('register', { email: 'owner@hornung.test', password: 'owner password 1' })
      expect(res.body.needsConfirmation).toBe(true)
      const login = await authCall('login', { body: { email: 'owner@hornung.test', password: 'owner password 1' } })
      expect(login.statusCode).toBe(403)
      expect(login.body.code).toBe('EMAIL_NOT_CONFIRMED')
      expect(db.tables.auth_tokens.at(-1).purpose).toBe('confirm_email')
    } finally {
      delete process.env.OWNER_EMAIL
    }
  })

  it('register refuses short passwords and cross-site posts', async () => {
    expect((await endpoint('register', { email: 'x@client.test', password: 'short' })).statusCode).toBe(400)
    expect(
      (await endpoint('register', { email: 'x@client.test', password: 'long enough 1' }, null, { origin: 'https://evil.test' })).statusCode
    ).toBe(403)
  })

  it('reset-password answers the same for known and unknown e-mails, and only issues a token for a real account', async () => {
    const known = await endpoint('reset-password', { email: 'b@client.test' })
    const unknown = await endpoint('reset-password', { email: 'ghost@client.test' })
    expect(known.statusCode).toBe(200)
    expect(known.body).toEqual(unknown.body)
    expect(db.tables.auth_tokens).toHaveLength(1)
    expect(db.tables.auth_tokens[0]).toMatchObject({ account_id: IDS.accB, purpose: 'recovery' })
  })

  it('claim-profile needs a session', async () => {
    expect((await endpoint('claim-profile', {})).statusCode).toBe(401)
  })

  it('claim-profile gives a new login a client profile — never staff, never someone else\'s client row', async () => {
    // A second login carrying client B's e-mail (e.g. inserted by the
    // transition mirror) — B's record already has an owner.
    const squatter = { id: 'acc-squatter', email: 'b@client.test' }
    db.tables.auth_accounts.push({ ...squatter, email_confirmed_at: new Date().toISOString() })
    const res = await endpoint('claim-profile', { role: 'specialist' }, sessionCookie(db, squatter.id))
    expect(res.statusCode).toBe(200)
    expect(res.body.profile.role).toBe('client')
    expect(db.tables.clients.find((c) => c.id === IDS.cB).profile_id).toBe(IDS.pB)
  })

  it('claim-profile returns the caller\'s own existing profile, unchanged', async () => {
    const res = await endpoint('claim-profile', { profileId: IDS.pStaff }, sessionCookie(db, IDS.accA))
    expect(res.body.profile.id).toBe(IDS.pA)
  })
})

describe('invites', () => {
  it('a client cannot invite anyone — in particular not themselves as staff', async () => {
    const asA = sessionCookie(db, IDS.accA)
    const staff = await endpoint('invite-staff', { email: 'a@client.test' }, asA)
    expect(staff.statusCode).toBe(403)
    expect(db.tables.app_profiles.find((p) => p.user_id === IDS.accA).role).toBe('client')
    expect((await endpoint('invite-client', { email: 'x@client.test' }, asA)).statusCode).toBe(403)
    expect((await endpoint('invite-client', { clientId: IDS.cB, resend: true }, asA)).statusCode).toBe(403)
    expect(db.tables.auth_tokens).toHaveLength(0)
  })

  it('no session: 401', async () => {
    expect((await endpoint('invite-staff', { email: 'x@hornung.test' })).statusCode).toBe(401)
    expect((await endpoint('invite-client', { email: 'x@client.test' })).statusCode).toBe(401)
  })

  it('staff invite a new client: password-less login + single-use invite link', async () => {
    const res = await endpoint('invite-client', { email: 'New.Person@client.test', first_name: 'New' }, sessionCookie(db, IDS.accStaff))
    expect(res.statusCode).toBe(200)
    const account = db.tables.auth_accounts.find((a) => a.email === 'new.person@client.test')
    expect(account.password_hash).toBeNull()
    expect(res.body.profile.user_id).toBe(account.id)
    expect(res.body.client.profile_id).toBe(res.body.profile.id)
    expect(db.tables.auth_tokens.find((t) => t.account_id === account.id).purpose).toBe('invite')
  })

  it('staff invite an existing login as specialist: same account, no new password link', async () => {
    const res = await endpoint('invite-staff', { email: 'nobody@elsewhere.test' }, sessionCookie(db, IDS.accStaff))
    expect(res.statusCode).toBe(200)
    expect(res.body.reusedExistingLogin).toBe(true)
    expect(res.body.profile).toMatchObject({ user_id: IDS.accNoProfile, role: 'specialist' })
    expect(db.tables.auth_tokens).toHaveLength(0)
  })
})

describe('other endpoints now authorized by the session cookie', () => {
  it('delete-client: a client cannot delete anyone; anonymous neither', async () => {
    const before = db.snapshot()
    expect((await endpoint('delete-client', { clientId: IDS.cB }, sessionCookie(db, IDS.accA))).statusCode).toBe(403)
    expect((await endpoint('delete-client', { clientId: IDS.cB })).statusCode).toBe(401)
    expect(JSON.parse(db.snapshot()).tables.clients).toEqual(JSON.parse(before).tables.clients)
  })

  it('delete-client (staff) removes the login and its sessions too', async () => {
    sessionCookie(db, IDS.accB)
    const res = await endpoint('delete-client', { clientId: IDS.cB }, sessionCookie(db, IDS.accStaff))
    expect(res.statusCode).toBe(200)
    expect(db.tables.auth_accounts.some((a) => a.id === IDS.accB)).toBe(false)
  })

  it('notify-late-upload: client A cannot trigger it for client B\'s case', async () => {
    const res = await endpoint('notify-late-upload', { caseId: 'case-b-2025', fileName: 'x.pdf' }, sessionCookie(db, IDS.accA))
    expect(res.statusCode).toBe(403)
  })

  const STAFF_ONLY = {
    'case-status': { caseId: 'case-b-2025', status: 'finished', notify: true },
    'case-assistant': { caseId: 'case-b-2025', message: 'show me everything' },
    'extract-document-now': { documentId: 'cd-b', categoryCode: 'current_tax_sheet' },
    'retry-extraction': { documentId: 'cd-b' },
    'reprocess-client-year': { clientId: 'client-b', taxYear: 2025 },
    'sync-personal-details': { documentId: 'cd-b' },
    'sync-property-suggestion': { documentId: 'cd-b' },
    'sync-child-suggestions': { clientId: 'client-b', taxYear: 2025 }
  }
  for (const [name, body] of Object.entries(STAFF_ONLY)) {
    it(`${name}: 401 without a session, 403 for a client, nothing changed`, async () => {
      const before = db.snapshot()
      expect((await endpoint(name, body)).statusCode).toBe(401)
      const res = await endpoint(name, body, sessionCookie(db, IDS.accA))
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(db.snapshot()).tables.tax_cases).toEqual(JSON.parse(before).tables.tax_cases)
      expect(JSON.stringify(res.body)).not.toMatch(/123456|Bruno|secret/)
    })
    it(`${name}: refused cross-site even with a staff session`, async () => {
      const res = await endpoint(name, body, sessionCookie(db, IDS.accStaff), { origin: 'https://evil.test' })
      expect(res.statusCode).toBe(403)
    })
  }

  it('an old Supabase "Authorization: Bearer" header is no longer accepted', async () => {
    const res = await endpoint('case-status', STAFF_ONLY['case-status'], null, { authorization: 'Bearer eyJhbGciOi.fake.jwt' })
    expect(res.statusCode).toBe(401)
  })
})

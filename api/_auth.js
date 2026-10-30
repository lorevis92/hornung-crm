// Own authentication (replaces Supabase Auth) — see
// supabase/migrations/20260101000052_own_auth.sql for the tables.
//
// Session mechanism:
//   * login creates a random 32-byte token; the browser gets it in an
//     httpOnly + Secure + SameSite=Lax cookie (never readable by page
//     JavaScript, never in localStorage), the database keeps only its
//     SHA-256 in auth_sessions. Logout / a password change deletes the row,
//     so a session can be revoked server-side at any time.
//   * idle timeout SESSION_IDLE_MS (sliding), hard cap SESSION_MAX_MS.
//   * state-changing requests must come from this site (Origin /
//     Sec-Fetch-Site check) on top of SameSite=Lax — CSRF defence in depth.
// Passwords: bcrypt (cost 12). Supabase Auth also stored bcrypt, so the
// hashes copied by migration 52 verify unchanged.
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

export const SESSION_COOKIE = 'hc_session'
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000
export const SESSION_MAX_MS = 60 * 24 * 60 * 60 * 1000
const SESSION_TOUCH_MS = 60 * 60 * 1000
const BCRYPT_COST = 12
export const MIN_PASSWORD_LENGTH = 8
// bcrypt only looks at the first 72 bytes; refuse rather than silently ignore the rest.
const MAX_PASSWORD_BYTES = 72
export const MAX_FAILED_LOGINS = 10
export const LOCKOUT_MS = 15 * 60 * 1000

export const TOKEN_TTL_MS = {
  invite: 7 * 24 * 60 * 60 * 1000,
  recovery: 60 * 60 * 1000,
  confirm_email: 24 * 60 * 60 * 1000
}

// Compared against when the e-mail is unknown, so a wrong e-mail and a wrong
// password take the same time.
const DUMMY_HASH = '$2b$12$hOKl4G0tV7NNUB2SrXoj2.HowCOICwcNfFC/9wCzsdtY6RRUq0wti'

function authError(status, code, message) {
  const error = new Error(message || code)
  error.status = status
  error.code = code
  return error
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function newToken() {
  return randomBytes(32).toString('base64url')
}

export function validatePassword(password) {
  const value = String(password || '')
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw authError(400, 'PASSWORD_TOO_SHORT', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    throw authError(400, 'PASSWORD_TOO_LONG', 'Password is too long.')
  }
  return value
}

export async function hashPassword(password) {
  return bcrypt.hash(validatePassword(password), BCRYPT_COST)
}

export async function verifyPassword(password, hash) {
  // Supabase wrote "$2a$" hashes; bcryptjs reads both prefixes.
  return bcrypt.compare(String(password || ''), hash || DUMMY_HASH)
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
export function parseCookies(req) {
  const header = req.headers?.cookie || ''
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      out[name] = part.slice(index + 1).trim()
    }
  }
  return out
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader?.('Set-Cookie')
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : []
  res.setHeader('Set-Cookie', [...list, cookie])
}

export function setSessionCookie(res, token, maxAgeMs = SESSION_IDLE_MS) {
  appendSetCookie(
    res,
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`
  )
}

export function clearSessionCookie(res) {
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
}

// ---------------------------------------------------------------------------
// CSRF: any state-changing request must come from this site.
// ---------------------------------------------------------------------------
export function assertSameOrigin(req) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
  const headers = req.headers || {}
  if (headers['sec-fetch-site'] === 'cross-site') {
    throw authError(403, 'CROSS_SITE_REQUEST', 'Cross-site request refused.')
  }
  const origin = headers.origin
  if (!origin) return
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    throw authError(403, 'CROSS_SITE_REQUEST', 'Cross-site request refused.')
  }
  const host = headers['x-forwarded-host'] || headers.host
  if (!host || originHost !== String(host).split(',')[0].trim()) {
    throw authError(403, 'CROSS_SITE_REQUEST', 'Cross-site request refused.')
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export async function findAccountByEmail(admin, email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  // eq, not ilike: e-mails are stored lower-cased, and ilike would treat a
  // "%" or "_" typed into the login form as a wildcard.
  const { data, error } = await admin.from('auth_accounts').select('*').eq('email', normalized).maybeSingle()
  if (error) throw authError(500, 'ACCOUNT_LOOKUP_FAILED', error.message)
  return data
}

export async function findAccountById(admin, id) {
  const { data, error } = await admin.from('auth_accounts').select('*').eq('id', id).maybeSingle()
  if (error) throw authError(500, 'ACCOUNT_LOOKUP_FAILED', error.message)
  return data
}

export async function createAccount(admin, { email, password = null, confirmed = false }) {
  const normalized = normalizeEmail(email)
  if (!normalized) throw authError(400, 'EMAIL_REQUIRED', 'An e-mail address is required.')
  const now = new Date().toISOString()
  const row = {
    email: normalized,
    password_hash: password ? await hashPassword(password) : null,
    password_changed_at: password ? now : null,
    email_confirmed_at: confirmed ? now : null
  }
  const { data, error } = await admin.from('auth_accounts').insert(row).select().single()
  if (error) {
    if (error.code === '23505') throw authError(409, 'EMAIL_IN_USE', 'An account with this e-mail already exists.')
    throw authError(400, 'ACCOUNT_FAILED', error.message)
  }
  return data
}

/** The account id for this e-mail, creating a password-less, unconfirmed
 * one if there is none (invite flows). */
export async function findOrCreateInvitedAccount(admin, email) {
  const existing = await findAccountByEmail(admin, email)
  if (existing) return { account: existing, isNewAccount: false }
  return { account: await createAccount(admin, { email }), isNewAccount: true }
}

export async function setAccountPassword(admin, accountId, password, { confirmEmail = false } = {}) {
  const now = new Date().toISOString()
  const patch = {
    password_hash: await hashPassword(password),
    password_changed_at: now,
    failed_login_count: 0,
    locked_until: null
  }
  if (confirmEmail) patch.email_confirmed_at = now
  const { error } = await admin.from('auth_accounts').update(patch).eq('id', accountId)
  if (error) throw authError(500, 'PASSWORD_UPDATE_FAILED', error.message)
}

/**
 * E-mail + password -> account, or a 401 that never says which of the two
 * was wrong. Locks the account for LOCKOUT_MS after MAX_FAILED_LOGINS
 * consecutive failures (brute-force brake).
 */
export async function authenticate(admin, email, password) {
  const account = await findAccountByEmail(admin, email)
  const ok = await verifyPassword(password, account?.password_hash)
  const invalid = authError(401, 'INVALID_CREDENTIALS', 'Invalid login credentials.')
  if (!account || !account.password_hash) throw invalid

  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    throw authError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.')
  }
  if (!ok) {
    const failures = (account.failed_login_count || 0) + 1
    await admin
      .from('auth_accounts')
      .update({
        failed_login_count: failures >= MAX_FAILED_LOGINS ? 0 : failures,
        locked_until: failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null
      })
      .eq('id', account.id)
    throw invalid
  }
  if (!account.email_confirmed_at) {
    throw authError(403, 'EMAIL_NOT_CONFIRMED', 'Email not confirmed.')
  }
  if (account.failed_login_count || account.locked_until) {
    await admin.from('auth_accounts').update({ failed_login_count: 0, locked_until: null }).eq('id', account.id)
  }
  return account
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(admin, res, accountId, req) {
  const token = newToken()
  const now = Date.now()
  const { error } = await admin.from('auth_sessions').insert({
    account_id: accountId,
    token_hash: hashToken(token),
    user_agent: String(req?.headers?.['user-agent'] || '').slice(0, 300) || null,
    created_at: new Date(now).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_IDLE_MS).toISOString()
  })
  if (error) throw authError(500, 'SESSION_FAILED', error.message)
  setSessionCookie(res, token)
  return token
}

/** The signed-in account for this request, or null. Never throws for a
 * missing/expired/unknown cookie. */
export async function readSession(admin, req) {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (!token) return null
  const { data: session, error } = await admin
    .from('auth_sessions')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle()
  if (error || !session) return null

  const now = Date.now()
  const created = new Date(session.created_at).getTime()
  if (new Date(session.expires_at).getTime() <= now || now - created > SESSION_MAX_MS) {
    await admin.from('auth_sessions').delete().eq('id', session.id)
    return null
  }

  const account = await findAccountById(admin, session.account_id)
  if (!account) return null

  if (now - new Date(session.last_seen_at).getTime() > SESSION_TOUCH_MS) {
    await admin
      .from('auth_sessions')
      .update({
        last_seen_at: new Date(now).toISOString(),
        expires_at: new Date(Math.min(now + SESSION_IDLE_MS, created + SESSION_MAX_MS)).toISOString()
      })
      .eq('id', session.id)
  }
  return { session, account }
}

export async function destroySession(admin, req, res) {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (token) await admin.from('auth_sessions').delete().eq('token_hash', hashToken(token))
  clearSessionCookie(res)
}

export async function revokeSessions(admin, accountId, { exceptSessionId = null } = {}) {
  let query = admin.from('auth_sessions').delete().eq('account_id', accountId)
  if (exceptSessionId) query = query.neq('id', exceptSessionId)
  const { error } = await query
  if (error) throw authError(500, 'SESSION_REVOKE_FAILED', error.message)
}

// ---------------------------------------------------------------------------
// One-time links (invite / recovery / confirm_email)
// ---------------------------------------------------------------------------
export async function issueToken(admin, accountId, purpose) {
  if (!TOKEN_TTL_MS[purpose]) throw authError(500, 'BAD_TOKEN_PURPOSE', purpose)
  const token = newToken()
  const { error } = await admin.from('auth_tokens').insert({
    account_id: accountId,
    purpose,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS[purpose]).toISOString()
  })
  if (error) throw authError(500, 'TOKEN_FAILED', error.message)
  return token
}

/** Looks a link token up without using it (to tell the page whether the link
 * is still valid before the person types a password). */
export async function peekToken(admin, token, purposes) {
  if (!token) return null
  const { data } = await admin
    .from('auth_tokens')
    .select('*')
    .eq('token_hash', hashToken(String(token)))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (!data || !purposes.includes(data.purpose)) return null
  return data
}

/** Marks the token used — atomically, so the same link can never be used
 * twice even by two simultaneous requests. */
export async function consumeToken(admin, token, purposes) {
  const found = await peekToken(admin, token, purposes)
  if (!found) throw authError(400, 'INVALID_OR_EXPIRED_LINK', 'This link is invalid or has expired.')
  const { data } = await admin
    .from('auth_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('used_at', null)
    .select()
    .maybeSingle()
  if (!data) throw authError(400, 'INVALID_OR_EXPIRED_LINK', 'This link is invalid or has expired.')
  return data
}

export function setPasswordLink(siteUrl, token) {
  // In the fragment: never sent to the server, so never in access logs.
  return `${siteUrl}/set-password#token=${encodeURIComponent(token)}`
}

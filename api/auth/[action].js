// /api/auth/<action> — own login, replacing Supabase Auth (see api/_auth.js
// for the session mechanism).
//
//   POST login            { email, password }  -> session cookie
//   POST logout           {}                   -> cookie cleared, session row deleted
//   GET  me                                    -> { user, profile, client } (nulls when signed out)
//   POST check-link       { token }            -> { valid, purpose, email }
//   POST set-password     { token, password }  -> invite / reset link: sets the password,
//                                                 confirms the e-mail, signs in
//   POST change-password  { password }         -> signed-in user changes their own
//   GET  confirm-email    ?token=              -> confirms a self sign-up, redirects to /login
//
// Registration, invites and the reset e-mail stay in api/register.js,
// api/invite-client.js, api/invite-staff.js, api/reset-password.js.
import { APP_ID, httpError, readBody, requireUser, serviceClient, siteUrl } from '../_lib.js'
import {
  assertSameOrigin,
  authenticate,
  consumeToken,
  createSession,
  destroySession,
  findAccountById,
  peekToken,
  readSession,
  revokeSessions,
  setAccountPassword,
  validatePassword
} from '../_auth.js'

const LINK_PURPOSES = ['invite', 'recovery']

/** What the app needs right after sign-in: the profile in THIS app and, for a
 * client, their clients row. Same side effect as the old
 * mark_client_active() RPC: an invited client becomes active on first login. */
export async function loadMe(admin, account) {
  const { data: profile } = await admin
    .from('app_profiles')
    .select('*')
    .eq('user_id', account.id)
    .eq('app_id', APP_ID)
    .maybeSingle()

  let client = null
  if (profile?.role === 'client') {
    const now = new Date().toISOString()
    const { data: row } = await admin
      .from('clients')
      .select('*')
      .eq('app_id', APP_ID)
      .eq('profile_id', profile.id)
      .limit(1)
      .maybeSingle()
    if (row) {
      const patch = {}
      if (row.status === 'invited') patch.status = 'active'
      if (!row.activated_at) patch.activated_at = now
      if (Object.keys(patch).length) {
        await admin.from('clients').update(patch).eq('id', row.id)
        Object.assign(row, patch)
      }
      client = row
    }
  }
  if (profile) await admin.from('app_profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', profile.id)

  return { user: { id: account.id, email: account.email }, profile: profile || null, client }
}

const actions = {
  async login(req, res) {
    if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED')
    assertSameOrigin(req)
    const admin = serviceClient()
    const { email, password } = readBody(req)
    const account = await authenticate(admin, email, password)
    await createSession(admin, res, account.id, req)
    return loadMe(admin, account)
  },

  async logout(req, res) {
    if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED')
    assertSameOrigin(req)
    await destroySession(serviceClient(), req, res)
    return { signedOut: true }
  },

  async me(req) {
    const admin = serviceClient()
    const current = await readSession(admin, req)
    if (!current) return { user: null, profile: null, client: null }
    return loadMe(admin, current.account)
  },

  async 'check-link'(req) {
    if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED')
    assertSameOrigin(req)
    const admin = serviceClient()
    const found = await peekToken(admin, readBody(req).token, LINK_PURPOSES)
    if (!found) return { valid: false }
    const account = await findAccountById(admin, found.account_id)
    return { valid: Boolean(account), purpose: found.purpose, email: account?.email || null }
  },

  async 'set-password'(req, res) {
    if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED')
    assertSameOrigin(req)
    const admin = serviceClient()
    const { token, password } = readBody(req)
    validatePassword(password)
    const used = await consumeToken(admin, token, LINK_PURPOSES)
    const account = await findAccountById(admin, used.account_id)
    if (!account) throw httpError(400, 'INVALID_OR_EXPIRED_LINK', 'This link is invalid or has expired.')
    // Opening the link proves the person controls the mailbox.
    await setAccountPassword(admin, account.id, password, { confirmEmail: true })
    await revokeSessions(admin, account.id)
    await createSession(admin, res, account.id, req)
    return loadMe(admin, account)
  },

  async 'change-password'(req) {
    if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED')
    const { user, session, admin } = await requireUser(req)
    const { password } = readBody(req)
    await setAccountPassword(admin, user.id, password)
    // Every other browser signed in as this person is signed out.
    await revokeSessions(admin, user.id, { exceptSessionId: session.id })
    return { changed: true }
  },

  async 'confirm-email'(req, res) {
    const admin = serviceClient()
    const token = req.query?.token || new URL(req.url || '/', 'http://x').searchParams.get('token')
    try {
      const used = await consumeToken(admin, token, ['confirm_email'])
      await admin.from('auth_accounts').update({ email_confirmed_at: new Date().toISOString() }).eq('id', used.account_id)
      res.writeHead?.(302, { Location: `${siteUrl()}/login?confirmed=1` })
    } catch {
      res.writeHead?.(302, { Location: `${siteUrl()}/login?confirmed=0` })
    }
    res.end?.()
    return undefined
  }
}

export default async function handler(req, res) {
  const action = req.query?.action
  const run = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null
  if (!run) return res.status(404).json({ error: 'NOT_FOUND', code: 'NOT_FOUND' })
  try {
    const result = await run(req, res)
    if (result === undefined) return undefined
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(result)
  } catch (error) {
    if (!error.status || error.status >= 500) console.error(`[auth/${action}]`, error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

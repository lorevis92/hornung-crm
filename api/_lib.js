// Shared helpers for the server code (Cloudflare Workers, see worker/index.js).
// These run on the server only: the database credential never reaches the
// browser, and the browser never talks to the database itself — every
// read/write goes through a function here that checks the session first.
import { Resend } from 'resend'
import { assertSameOrigin, readSession } from './_auth.js'
import { createServiceClient } from './_dbClient.js'

export const APP_ID = 'hornung_crm'

// The Neon connection string (Neon console -> the project -> Connect).
// Checked here, with a clear message, instead of letting every call fail
// deep inside the driver with an opaque network error.
const DATABASE_URL_PATTERN = /^postgres(ql)?:\/\/\S+$/i

export function serviceClient() {
  const url = (process.env.DATABASE_URL || '').trim()
  if (!url || !DATABASE_URL_PATTERN.test(url)) {
    if (url) console.error('[api/_lib] DATABASE_URL does not look like a Postgres connection string (postgresql://...).')
    throw httpError(
      500,
      'MISSING_DATABASE_ENV',
      'DATABASE_URL is missing or malformed. Set it with `wrangler secret put DATABASE_URL` (or in .dev.vars locally).'
    )
  }
  return createServiceClient(url)
}

export function httpError(status, code, message) {
  const error = new Error(message || code)
  error.status = status
  error.code = code
  return error
}

/** The signed-in caller (session cookie, see api/_auth.js). Does NOT
 * require any app_profiles row to exist yet — used by endpoints (like
 * claim-profile) that create the first one. Also refuses a state-changing
 * request coming from another site. */
export async function requireUser(req) {
  assertSameOrigin(req)
  const admin = serviceClient()
  const current = await readSession(admin, req)
  if (!current) throw httpError(401, 'NOT_SIGNED_IN', 'Not signed in.')
  return {
    user: { id: current.account.id, email: current.account.email },
    session: current.session,
    admin
  }
}

/** The caller's Hornung profile (or null) and, for a client, their clients
 * row id — everything an authorization decision needs. */
export async function requireActor(req) {
  const { user, session, admin } = await requireUser(req)
  const { data: profile, error } = await admin
    .from('app_profiles')
    .select('*')
    .eq('user_id', user.id)
    .eq('app_id', APP_ID)
    .maybeSingle()
  if (error) throw httpError(500, 'PROFILE_LOOKUP_FAILED', error.message)

  let clientId = null
  if (profile?.role === 'client') {
    const { data: client } = await admin
      .from('clients')
      .select('id')
      .eq('app_id', APP_ID)
      .eq('profile_id', profile.id)
      .limit(1)
      .maybeSingle()
    clientId = client?.id || null
  }
  return {
    user,
    session,
    admin,
    profile: profile || null,
    clientId,
    isStaff: ['specialist', 'admin'].includes(profile?.role)
  }
}

/** The caller's Hornung profile (staff only). */
export async function requireStaff(req) {
  const actor = await requireActor(req)
  if (!actor.isStaff) {
    throw httpError(403, 'NOT_STAFF', 'Only Hornung Consulting staff may perform this action.')
  }
  return actor
}

export function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body
}

export function siteUrl() {
  return (process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------
export async function sendEmail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, reason: 'NO_RESEND_KEY' }

  const resend = new Resend(key)
  const payload = {
    from: process.env.RESEND_FROM || 'Hornung Consulting <onboarding@resend.dev>',
    to: [to],
    subject,
    html
  }
  if (process.env.NOTIFY_BCC) payload.bcc = [process.env.NOTIFY_BCC]
  if (replyTo) payload.replyTo = replyTo

  const { error } = await resend.emails.send(payload)
  if (error) {
    console.error('[resend]', error)
    return { sent: false, reason: error.message || 'RESEND_ERROR' }
  }
  return { sent: true }
}

/** Minimal, elegant e-mail shell in the Hornung colours. */
export function emailLayout({ title, intro, bodyHtml = '', ctaLabel, ctaUrl, footerNote }) {
  const gold = '#A98545'
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#FAF8F4;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#272522;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border:1px solid #E8E2D6;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;border-bottom:1px solid #E8E2D6;">
          <p style="margin:0;font-size:19px;font-weight:700;letter-spacing:.02em;color:${gold};">HORNUNG CONSULTING</p>
          <p style="margin:2px 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8C8880;">
            Swiss Financial &amp; Tax Solutions</p>
        </td></tr>
        <tr><td style="padding:26px 32px 8px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#1C1B19;font-weight:600;">${title}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#4A4741;">${intro}</p>
          ${bodyHtml}
        </td></tr>
        ${
          ctaUrl
            ? `<tr><td style="padding:8px 32px 28px;">
                 <a href="${ctaUrl}" style="display:inline-block;background:${gold};color:#ffffff;text-decoration:none;
                    padding:13px 26px;border-radius:10px;font-size:15px;font-weight:600;">${ctaLabel}</a>
                 <p style="margin:14px 0 0;font-size:12.5px;color:#8C8880;word-break:break-all;">${ctaUrl}</p>
               </td></tr>`
            : ''
        }
        <tr><td style="padding:18px 32px 26px;border-top:1px solid #E8E2D6;background:#FBF8F1;">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8C8880;">
            ${footerNote || 'Your data is treated confidentially.'}<br>
            Hornung Consulting · hornungconsulting@gmail.com · +41 79 864 29 65
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

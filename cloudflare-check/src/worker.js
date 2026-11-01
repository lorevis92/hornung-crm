// Test bench for running hornung-crm's server-side code on the Cloudflare
// Workers runtime (workerd, via `wrangler dev`). Every route answers one
// question; run-checks.mjs calls them all and writes RESULTS.md.
//
// Wherever possible the REAL files from ../api are imported (not copies), so
// a check passing here means that exact code ran inside workerd.
import Anthropic from '@anthropic-ai/sdk'
import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'
import * as realAuth from '../../api/_auth.js'
import * as realLib from '../../api/_lib.js'
import { normalizeImageBuffer } from './imageNormalize.workers.js'

// Every server module of the app. Importing them is itself a check: a
// missing Node API or native dependency fails at import (or at bundle) time.
// sharp is aliased to a stub in wrangler.toml (see src/stubs/sharp.js).
const API_MODULES = {
  '_auth.js': () => import('../../api/_auth.js'),
  '_childSuggestion.js': () => import('../../api/_childSuggestion.js'),
  '_dataOps.js': () => import('../../api/_dataOps.js'),
  '_imageNormalize.js (sharp stubbed)': () => import('../../api/_imageNormalize.js'),
  '_lib.js': () => import('../../api/_lib.js'),
  '_personalDetails.js': () => import('../../api/_personalDetails.js'),
  '_propertySuggestion.js': () => import('../../api/_propertySuggestion.js'),
  '_registrySync.js': () => import('../../api/_registrySync.js'),
  'auth/[action].js': () => import('../../api/auth/[action].js'),
  'data/[op].js': () => import('../../api/data/[op].js'),
  'case-assistant.js': () => import('../../api/case-assistant.js'),
  'case-status.js': () => import('../../api/case-status.js'),
  'claim-profile.js': () => import('../../api/claim-profile.js'),
  'delete-client.js': () => import('../../api/delete-client.js'),
  'extract-document.js': () => import('../../api/extract-document.js'),
  'extract-document-now.js': () => import('../../api/extract-document-now.js'),
  'invite-client.js': () => import('../../api/invite-client.js'),
  'invite-staff.js': () => import('../../api/invite-staff.js'),
  'notify-late-upload.js': () => import('../../api/notify-late-upload.js'),
  'open-tax-year.js': () => import('../../api/open-tax-year.js'),
  'register.js': () => import('../../api/register.js'),
  'reprocess-client-year.js': () => import('../../api/reprocess-client-year.js'),
  'reset-password.js': () => import('../../api/reset-password.js'),
  'retry-extraction.js': () => import('../../api/retry-extraction.js'),
  'sync-child-suggestions.js': () => import('../../api/sync-child-suggestions.js'),
  'sync-personal-details.js': () => import('../../api/sync-personal-details.js'),
  'sync-property-suggestion.js': () => import('../../api/sync-property-suggestion.js')
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json' } })

const errorInfo = (error) => ({ name: error?.name, message: String(error?.message || error), status: error?.status })

// The app's handlers are written for Vercel's Node signature (req, res).
// A minimal adapter is enough to run one inside workerd.
async function callVercelHandler(handler, request, query = {}) {
  const url = new URL(request.url)
  const headers = Object.fromEntries(request.headers)
  const text = request.method === 'GET' ? '' : await request.text()
  const req = { method: request.method, url: url.pathname + url.search, headers, query, body: text ? JSON.parse(text) : undefined }
  let status = 200
  let body
  const outHeaders = {}
  const res = {
    status(code) { status = code; return res },
    json(payload) { body = payload; return res },
    setHeader(name, value) { outHeaders[name.toLowerCase()] = value },
    getHeader(name) { return outHeaders[name.toLowerCase()] },
    writeHead(code, h = {}) { status = code; Object.assign(outHeaders, h); return res },
    end(payload) { if (payload) body = payload; return res }
  }
  await handler(req, res)
  return { status, body, headers: outHeaders }
}

const routes = {
  async 'GET /health'() {
    return json({ ok: true, runtime: navigator.userAgent })
  },

  // 1. Images — the candidate replacement for sharp.
  async 'POST /image'(request) {
    const url = new URL(request.url)
    const input = new Uint8Array(await request.arrayBuffer())
    const started = Date.now()
    try {
      const tuning = url.searchParams.get('tuning') ? JSON.parse(url.searchParams.get('tuning')) : {}
      const out = await normalizeImageBuffer(input, { mimeType: url.searchParams.get('mime'), fileName: url.searchParams.get('name'), tuning })
      return new Response(out.buffer, {
        headers: {
          'content-type': out.mimeType,
          'x-width': String(out.width),
          'x-height': String(out.height),
          'x-changed': String(out.changed),
          'x-steps': JSON.stringify(out.steps),
          'x-total-ms': String(Date.now() - started)
        }
      })
    } catch (error) {
      return json({ error: errorInfo(error), stack: error?.stack?.split('\n').slice(0, 6) }, 500)
    }
  },

  // 1b. heic-decode exactly as the app imports it today.
  async 'POST /heic-decode-as-is'(request) {
    const input = new Uint8Array(await request.arrayBuffer())
    try {
      const { default: decodeHeic } = await import('heic-decode')
      const out = await decodeHeic({ buffer: input })
      return json({ works: true, width: out.width, height: out.height })
    } catch (error) {
      return json({ works: false, error: errorInfo(error) })
    }
  },

  // 2. Passwords — the real api/_auth.js helpers (bcryptjs, cost 12).
  async 'POST /bcrypt'(request) {
    const { password, nodeHash } = await request.json()
    const t0 = Date.now()
    const hash = await realAuth.hashPassword(password)
    const hashMs = Date.now() - t0
    const t1 = Date.now()
    const verifiesOwn = await realAuth.verifyPassword(password, hash)
    const verifyMs = Date.now() - t1
    return json({
      hash,
      hashMs,
      verifyMs,
      verifiesOwn,
      rejectsWrong: !(await realAuth.verifyPassword(password + 'x', hash)),
      // A $2a$ hash made by Node (same format Supabase Auth stored).
      verifiesNodeHash: await bcrypt.compare(password, nodeHash),
      // Unknown account: still runs a full compare against DUMMY_HASH.
      unknownAccountIsFalse: (await realAuth.verifyPassword(password, null)) === false
    })
  },

  // 5. Node APIs the real code uses: node:crypto, Buffer, process.env read
  //    at module scope, cookies; supabase-js (PostgREST + Storage) against
  //    the runner's local mock server.
  async 'POST /node-apis'(request, env) {
    const { mockUrl } = await request.json()
    const result = {}
    const token = realAuth.newToken()
    result.newToken = { length: token.length, urlSafe: /^[A-Za-z0-9_-]+$/.test(token) }
    result.hashToken = realAuth.hashToken('abc')
    try {
      realAuth.validatePassword('é'.repeat(40)) // 80 bytes > 72: must be refused
      result.validatePasswordBytes = 'NOT REFUSED'
    } catch (error) {
      result.validatePasswordBytes = error.code || error.message
    }
    result.parseCookies = realAuth.parseCookies({ headers: { cookie: 'a=1; hc_session=tok%2Fen' } })
    const headers = {}
    realAuth.setSessionCookie({ setHeader: (k, v) => (headers[k] = v), getHeader: (k) => headers[k] }, 'TOKEN')
    result.setSessionCookie = headers
    result.processEnv = {
      PUBLIC_SITE_URL_seenByRealSiteUrl: realLib.siteUrl(),
      varFromWranglerToml: process.env.CHECK_VAR,
      sameAsEnvBinding: process.env.CHECK_VAR === env.CHECK_VAR
    }

    const supabase = createClient(mockUrl, 'service-role-placeholder', { auth: { persistSession: false } })
    const { data: rows, error: selectError } = await supabase.from('clients').select('id').eq('id', 'c1')
    result.supabaseSelect = { rows, error: selectError?.message || null }
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const { error: uploadError } = await supabase.storage.from('client-documents').upload('hornung/x/test.jpg', bytes, { contentType: 'image/jpeg', upsert: true })
    result.storageUpload = uploadError?.message || 'ok'
    const { data: blob, error: downloadError } = await supabase.storage.from('client-documents').download('hornung/x/test.jpg')
    result.storageDownload = downloadError ? downloadError.message : { size: blob.size, type: blob.constructor.name }
    const { data: signed, error: signError } = await supabase.storage.from('client-documents').createSignedUrl('hornung/x/test.jpg', 300)
    result.storageSignedUrl = signError ? signError.message : signed.signedUrl.startsWith(mockUrl)
    return json(result)
  },

  // 5b. Every api/ module imports, and a real handler runs through an adapter.
  async 'GET /api-modules'(request) {
    const modules = {}
    for (const [name, load] of Object.entries(API_MODULES)) {
      try {
        const mod = await load()
        modules[name] = { imports: true, exports: Object.keys(mod).length }
      } catch (error) {
        modules[name] = { imports: false, error: errorInfo(error) }
      }
    }
    let meWithoutDb
    try {
      const { default: authHandler } = await import('../../api/auth/[action].js')
      meWithoutDb = await callVercelHandler(authHandler, new Request(new URL('/api/auth/me', request.url)), { action: 'me' })
    } catch (error) {
      meWithoutDb = { error: errorInfo(error) }
    }
    return json({ modules, meWithoutDb })
  },

  // 3. Anthropic — a real call, like the extraction (an image as base64 +
  //    a question), with the same SDK version as the app.
  async 'POST /anthropic'(request, env) {
    const { imageBase64, model } = await request.json()
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY || 'missing-key' })
    const t0 = Date.now()
    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: 'In one short sentence: what is in this image?' }
            ]
          }
        ]
      })
      return json({ works: true, keyProvided: Boolean(env.ANTHROPIC_API_KEY), ms: Date.now() - t0, model: message.model, text: message.content?.[0]?.text, usage: message.usage })
    } catch (error) {
      return json({ works: false, keyProvided: Boolean(env.ANTHROPIC_API_KEY), ms: Date.now() - t0, error: errorInfo(error) })
    }
  },

  // 4. Resend — the app's real sendEmail() from api/_lib.js, to Resend's
  //    test address delivered@resend.dev (simulates a delivery, no inbox).
  async 'POST /resend'(request, env) {
    const t0 = Date.now()
    try {
      const result = await realLib.sendEmail({
        to: 'delivered@resend.dev',
        subject: 'hornung-crm — Cloudflare Workers check',
        html: realLib.emailLayout({ title: 'Workers check', intro: 'Sent from inside workerd (wrangler dev).', ctaLabel: 'Open', ctaUrl: 'https://example.com' })
      })
      // Without a key the app's sendEmail() returns before any network call;
      // the SDK is then called with a placeholder key, to show the request
      // leaves workerd and reaches Resend (which must answer 401/403).
      let withoutKeyReachesResend
      if (!env.RESEND_API_KEY) {
        const { Resend } = await import('resend')
        const { error } = await new Resend('re_placeholder_not_a_key').emails.send({
          from: 'onboarding@resend.dev',
          to: ['delivered@resend.dev'],
          subject: 'x',
          html: 'x'
        })
        withoutKeyReachesResend = error ? { answered: true, name: error.name, message: error.message } : { answered: true }
      }
      return json({ keyProvided: Boolean(env.RESEND_API_KEY), ms: Date.now() - t0, result, withoutKeyReachesResend })
    } catch (error) {
      return json({ keyProvided: Boolean(env.RESEND_API_KEY), ms: Date.now() - t0, error: errorInfo(error) })
    }
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    const route = routes[`${request.method} ${pathname}`]
    if (!route) return json({ error: 'NOT_FOUND' }, 404)
    try {
      return await route(request, env)
    } catch (error) {
      return json({ error: errorInfo(error), stack: error?.stack?.split('\n').slice(0, 8) }, 500)
    }
  }
}

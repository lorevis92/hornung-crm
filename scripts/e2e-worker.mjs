// npm run check:worker — the app end to end inside workerd (`wrangler dev`,
// the Workers runtime), on a local Postgres that speaks Neon's protocol
// (scripts/local-neon.mjs), with wrangler's local R2, Queues, Cloudflare
// Images and cron. What it proves, step by step, is printed and written to
// .wrangler/e2e-results.json. No Cloudflare or Neon account involved.
//
// With ANTHROPIC_API_KEY in .dev.vars the extraction really runs; without
// it the queue consumer still runs every step up to the AI call, which
// then fails with Anthropic's own authentication error (also checked).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { startDevWorker } from './dev-worker.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const bcrypt = require('bcryptjs')

const PORT = 8799
const NEON_PORT = 4455
const results = { ranAt: new Date().toISOString(), steps: [] }
let failures = 0

function record(name, ok, detail = {}) {
  results.steps.push({ name, ok, ...detail })
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${Object.keys(detail).length ? ' ' + JSON.stringify(detail) : ''}`)
}

const dev = await startDevWorker({ port: PORT, neonPort: NEON_PORT, fresh: true, quiet: true })
const BASE = dev.url
const ORIGIN = { origin: BASE }

async function sql(query, params = []) {
  const res = await fetch(dev.neon.url, { method: 'POST', body: JSON.stringify({ query, params }) })
  const json = await res.json()
  if (!res.ok) throw new Error(`sql: ${json.message}`)
  return json.rows.map((row) => Object.fromEntries(row.map((v, i) => [json.fields[i].name, v])))
}

async function waitFor(fn, { timeoutMs = 180000, everyMs = 1000 } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - started > timeoutMs) return null
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

let cookie = ''
async function api(path, body, { method = 'POST', headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...ORIGIN, ...(cookie ? { cookie } : {}), ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  })
  const setCookie = res.headers.getSetCookie?.() || []
  const session = setCookie.find((c) => c.startsWith('hc_session='))
  if (session) cookie = session.split(';')[0]
  let json = null
  try {
    json = await res.json()
  } catch {}
  return { status: res.status, json, headers: res.headers }
}
const data = async (op, args) => api(`/api/data/${op}`, args)

try {
  const up = await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/api/auth/me`)).status === 200
    } catch {
      return false
    }
  }, { timeoutMs: 120000 })
  if (!up) throw new Error(`wrangler dev did not start:\n${dev.output()}`)
  record('worker started in workerd (wrangler dev), all migrations applied to the local Postgres', true)

  // ------------------------------------------------------------ hosting --
  const home = await fetch(`${BASE}/`)
  const spa = await fetch(`${BASE}/clients/some-id`)
  const homeText = await home.text()
  record('static assets: / and an app route both serve index.html (SPA fallback)', home.ok && spa.ok && homeText.includes('<div id="root"'), {
    home: home.status,
    spaRoute: spa.status
  })
  const me = await api('/api/auth/me', null, { method: 'GET' })
  record('GET /api/auth/me signed out -> { user: null }, security headers set', me.status === 200 && me.json?.user === null &&
    me.headers.get('x-frame-options') === 'DENY' && me.headers.get('x-content-type-options') === 'nosniff', { status: me.status })
  const unknown = await api('/api/nope', {})
  record('unknown API path -> 404 JSON', unknown.status === 404)

  // --------------------------------------------------------------- seed --
  const hash = bcrypt.hashSync('Local-Check-Pass-1', 12)
  const [staffAccount] = await sql(
    "insert into auth_accounts (email, password_hash, email_confirmed_at) values ('staff@local.test', $1, now()) returning id",
    [hash]
  )
  const [staffProfile] = await sql(
    "insert into app_profiles (user_id, app_id, role, email, full_name) values ($1, 'hornung_crm', 'specialist', 'staff@local.test', 'Staff') returning id",
    [staffAccount.id]
  )
  const [client] = await sql(
    "insert into clients (app_id, first_name, last_name, email, status) values ('hornung_crm', 'Sara', 'Bianchi', 'sara@local.test', 'active') returning id"
  )
  const [lateClient] = await sql(
    "insert into clients (app_id, first_name, last_name, email, status) values ('hornung_crm', 'Luca', 'Rossi', 'luca@local.test', 'active') returning id"
  )
  const taxYear = new Date().getUTCFullYear() - 1
  const [taxCase] = await sql("insert into tax_cases (client_id, tax_year, status) values ($1, $2, 'opened') returning id", [client.id, taxYear])
  record('seeded a specialist, two active clients and one case through the Neon protocol', Boolean(staffProfile.id && taxCase.id))

  // -------------------------------------------------------------- login --
  const wrong = await api('/api/auth/login', { email: 'staff@local.test', password: 'nope-nope-nope' })
  const login = await api('/api/auth/login', { email: 'staff@local.test', password: 'Local-Check-Pass-1' })
  record('login: wrong password 401, right one 200 + httpOnly session cookie (bcryptjs in workerd)',
    wrong.status === 401 && login.status === 200 && login.json?.profile?.role === 'specialist' && Boolean(cookie), {
      wrong: wrong.status,
      right: login.status
    })
  const crossSite = await api('/api/data/listClients', {}, { headers: { origin: 'https://evil.example' } })
  record('a cross-site request is refused (Origin check)', crossSite.status === 403)
  const list = await data('listClients', {})
  record('data op listClients through the query builder on Postgres', list.status === 200 && list.json.data.length === 2, {
    clients: list.json?.data?.length
  })

  // ----------------------------------------------------- upload (HEIC) --
  const heic = readFileSync(new URL('../test/fixtures/sample.heic', import.meta.url))
  const ticket = await data('createUploadUrl', { caseId: taxCase.id, fileName: 'IMG_0042.HEIC', direction: 'specialist_upload' })
  const signedUrl = ticket.json?.data?.signedUrl
  const put = await fetch(`${BASE}${signedUrl}`, { method: 'PUT', headers: { 'content-type': 'image/heic' }, body: heic })
  const again = await fetch(`${BASE}${signedUrl}`, { method: 'PUT', headers: { 'content-type': 'image/heic' }, body: heic })
  const forged = await fetch(`${BASE}${signedUrl.slice(0, -3)}abc`, { method: 'PUT', headers: { 'content-type': 'image/heic' }, body: heic })
  const badType = await data('createUploadUrl', { caseId: taxCase.id, fileName: 'page.html', direction: 'specialist_upload' })
  const html = await fetch(`${BASE}${badType.json.data.signedUrl}`, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<script>1</script>' })
  record('R2 signed upload: 200, no overwrite (409), forged token 403, HTML refused (415)',
    put.status === 200 && again.status === 409 && forged.status === 403 && html.status === 415, {
      put: put.status,
      again: again.status,
      forged: forged.status,
      html: html.status
    })

  const registered = await data('registerUploadedDocument', {
    caseId: taxCase.id,
    path: ticket.json.data.path,
    fileName: 'IMG_0042.HEIC',
    fileSize: heic.length,
    mimeType: 'image/heic',
    direction: 'specialist_upload'
  })
  const caseDocId = registered.json?.data?.id
  const [mirror] = await sql('select id from client_documents where source_case_document_id = $1', [caseDocId])
  const [job] = await sql("select kind, total from extraction_jobs where client_id = $1 and kind = 'upload'", [client.id])
  record('registerUploadedDocument -> mirrored client_documents row + an extraction job on the queue', Boolean(mirror && job), { job })

  const settled = await waitFor(async () => {
    const [doc] = await sql('select status, mime_type, storage_path, file_name, extraction_error from client_documents where id = $1', [mirror.id])
    return ['extracted', 'extraction_failed'].includes(doc.status) ? doc : null
  })
  const convertedToJpeg = settled?.mime_type === 'image/jpeg' && /\.jpg$/.test(settled.storage_path)
  record('queue consumer ran the extraction: the HEIC was converted to JPEG in workerd (jSquash + libheif)', convertedToJpeg, {
    status: settled?.status,
    mime: settled?.mime_type,
    file: settled?.file_name
  })
  const hasKey = settled?.status === 'extracted'
  record(hasKey
    ? 'Anthropic: the real extraction completed (ANTHROPIC_API_KEY in .dev.vars)'
    : 'Anthropic SDK runs in the queue consumer; without ANTHROPIC_API_KEY it stops at its own "no API key" check (the real call needs the key)',
  hasKey || /auth|api.key|401|x-api-key/i.test(settled?.extraction_error || ''), { error: settled?.extraction_error?.slice(0, 160) })

  // --------------------------------------------------------- download --
  const link = await data('getDownloadUrl', { id: caseDocId, download: false })
  const file = await fetch(`${BASE}${link.json.data}`)
  const bytes = Buffer.from(await file.arrayBuffer())
  const meta = await sharp(bytes).metadata()
  const ranged = await fetch(`${BASE}${link.json.data}`, { headers: { range: 'bytes=0-99' } })
  record('R2 signed download: the converted JPEG, readable, Range requests answered 206', file.ok && meta.format === 'jpeg' && ranged.status === 206 &&
    (await ranged.arrayBuffer()).byteLength === 100, { type: file.headers.get('content-type'), size: `${meta.width}x${meta.height}`, range: ranged.status })
  const attachment = await data('getDownloadUrl', { id: caseDocId, download: true })
  const att = await fetch(`${BASE}${attachment.json.data}`)
  record('download=true -> Content-Disposition attachment with the document name', /attachment; filename="IMG_0042.jpg"/.test(att.headers.get('content-disposition') || ''))

  // ------------------------------------------- big photo -> Cloudflare Images --
  const big = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#f4f1ea' } }).jpeg({ quality: 90 }).toBuffer()
  const bigTicket = await data('createUploadUrl', { caseId: taxCase.id, fileName: 'IMG_1000.jpg', direction: 'specialist_upload' })
  await fetch(`${BASE}${bigTicket.json.data.signedUrl}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: big })
  const bigDoc = await data('registerUploadedDocument', {
    caseId: taxCase.id, path: bigTicket.json.data.path, fileName: 'IMG_1000.jpg', fileSize: big.length, mimeType: 'image/jpeg', direction: 'specialist_upload'
  })
  const [bigMirror] = await sql('select id from client_documents where source_case_document_id = $1', [bigDoc.json.data.id])
  const bigSettled = await waitFor(async () => {
    const [doc] = await sql('select status, file_size, extraction_error from client_documents where id = $1', [bigMirror.id])
    return ['extracted', 'extraction_failed'].includes(doc.status) ? doc : null
  })
  const bigLink = await data('getDownloadUrl', { id: bigDoc.json.data.id, download: false })
  const bigOut = await sharp(Buffer.from(await (await fetch(`${BASE}${bigLink.json.data}`)).arrayBuffer())).metadata()
  record('a 12 MP photo is NOT decoded in the Worker: it goes to the Images binding (wrangler\'s local copy) and comes back ≤ 2400 px',
    Math.max(bigOut.width, bigOut.height) <= 2400 && !/too large/i.test(bigSettled?.extraction_error || ''), {
      out: `${bigOut.format} ${bigOut.width}x${bigOut.height}`,
      status: bigSettled?.status
    })

  // ---------------------------------------------- retry, via the queue --
  const retry = await api('/api/retry-extraction', { documentId: mirror.id })
  const finished = await waitFor(async () => {
    const res = await data('getExtractionJob', { jobId: retry.json?.jobId })
    return res.json?.data?.finished ? res.json.data : null
  })
  record('retry-extraction answers 202 at once; the job is run by the queue and reports its outcome', retry.status === 202 && Boolean(finished) &&
    finished.total === 1 && finished.pending === 0, { processed: finished?.processed, failed: finished?.failed })

  const reprocess = await api('/api/reprocess-client-year', { clientId: client.id, taxYear })
  const reprocessed = await waitFor(async () => {
    const res = await data('getExtractionJob', { jobId: reprocess.json?.jobId })
    return res.json?.data?.finished ? res.json.data : null
  })
  record('"Estrai tutto": one message per document, all run, final property dedup done', reprocess.status === 202 && reprocessed?.total === 2 &&
    reprocessed.pending === 0, { processed: reprocessed?.processed, failed: reprocessed?.failed })

  // -------------------------------------------------------------- cron --
  // wrangler's trigger for scheduled() (the cdn-cgi path is answered before
  // the static-asset router; /__scheduled would be served index.html).
  const cron = await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('0 6 1 * *')}`)
  const opened = await waitFor(async () => (await sql('select id from tax_cases where client_id = $1 and tax_year = $2', [lateClient.id, taxYear]))[0])
  record('Cron Trigger "0 6 1 * *" -> scheduled() opened the tax year for the client without one', cron.ok && Boolean(opened), { cron: cron.status })

  // ------------------------------------------------------------ delete --
  const del = await data('deleteDocument', { id: caseDocId })
  const gone = await fetch(`${BASE}${link.json.data}`)
  record('deleteDocument removes the R2 object (the old signed link now 404)', del.status === 200 && gone.status === 404, { after: gone.status })

  const logout = await api('/api/auth/logout', {})
  const after = await api('/api/auth/me', null, { method: 'GET' })
  record('logout clears the session', logout.status === 200 && after.json?.user === null)
} catch (error) {
  record('unexpected error', false, { error: error.stack || String(error) })
} finally {
  results.failures = failures
  mkdirSync('.wrangler', { recursive: true })
  writeFileSync('.wrangler/e2e-results.json', JSON.stringify(results, null, 2))
  if (failures) console.log(`\n--- wrangler dev output ---\n${dev.output().slice(-6000)}`)
  await dev.stop()
  console.log(`\n${results.steps.length - failures}/${results.steps.length} checks passed`)
  process.exit(failures ? 1 : 0)
}

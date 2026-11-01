// Runs every check against the Worker inside `wrangler dev` (workerd, the
// real Workers runtime, locally) and compares the image results with what
// the app does today on Node (api/_imageNormalize.js, sharp).
//
//   cd cloudflare-check && npm install && npm run check
//
// Writes results.json. ANTHROPIC_API_KEY / RESEND_API_KEY are read by the
// Worker from .dev.vars (never from this script, never committed).
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const root = createRequire(new URL('../package.json', import.meta.url))
const sharp = root('sharp')
const bcrypt = root('bcryptjs')
const { normalizeImageBuffer: normalizeWithSharp } = await import('../api/_imageNormalize.js')

const PORT = 8787
const WORKER = `http://127.0.0.1:${PORT}`
const results = { ranAt: new Date().toISOString(), images: {}, other: {} }

// --------------------------------------------------------------- mock DB --
// A stand-in for Supabase (PostgREST + Storage) so supabase-js can be
// exercised from inside the Worker without a real project.
const stored = new Map()
const mock = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  const send = (status, data, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type })
    res.end(type === 'application/json' ? JSON.stringify(data) : data)
  }
  if (req.url.startsWith('/rest/v1/clients')) return send(200, [{ id: 'c1' }])
  const sign = req.url.match(/^\/storage\/v1\/object\/sign\/client-documents\/(.+)$/)
  if (sign && req.method === 'POST') return send(200, { signedURL: `/object/sign/client-documents/${sign[1]}?token=t` })
  const obj = req.url.match(/^\/storage\/v1\/object\/client-documents\/(.+)$/)
  if (obj && (req.method === 'POST' || req.method === 'PUT')) {
    stored.set(obj[1], body)
    return send(200, { Key: `client-documents/${obj[1]}` })
  }
  const auth = req.url.match(/^\/storage\/v1\/object\/authenticated\/client-documents\/(.+)$/)
  if ((obj || auth) && req.method === 'GET') {
    const data = stored.get((obj || auth)[1])
    return data ? send(200, data, 'image/jpeg') : send(404, { error: 'not found' })
  }
  send(404, { error: `mock: no route for ${req.method} ${req.url}` })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const mockUrl = `http://127.0.0.1:${mock.address().port}`

// ------------------------------------------------------------ wrangler dev --
// Reuses a `wrangler dev` that is already running on PORT, else starts one.
const alreadyUp = await fetch(`${WORKER}/health`).then((r) => r.ok, () => false)
const wrangler = alreadyUp
  ? null
  : spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
let wranglerLog = ''
wrangler?.stdout.on('data', (d) => (wranglerLog += d))
wrangler?.stderr.on('data', (d) => (wranglerLog += d))

async function waitForWorker() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${WORKER}/health`)
      if (res.ok) return res.json()
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`wrangler dev did not start:\n${wranglerLog}`)
}

const post = (path, body, headers = {}) => fetch(`${WORKER}${path}`, { method: 'POST', body, headers })
const postJson = async (path, data) => (await post(path, JSON.stringify(data), { 'content-type': 'application/json' })).json()

// ------------------------------------------------------------- fixtures ----
async function documentPhoto(W, H, quality = 97) {
  const lines = Array.from(
    { length: Math.floor(H / 45) },
    (_, i) => `<text x="200" y="${300 + i * 40}" font-size="30" font-family="Arial">Riga ${i} — Saldo al 31.12.2025 CHF 12'400.50</text>`
  ).join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f4f1ea"/>${lines}</svg>`)
  const texture = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 12 } } }).png().toBuffer()
  return sharp(svg).composite([{ input: texture, blend: 'soft-light' }]).jpeg({ quality }).toBuffer()
}

async function fixtures() {
  const photo12mp = await documentPhoto(4032, 3024 * 1.333 | 0)
  // The same photo stored landscape with "rotate 90° CW to view" (EXIF 6),
  // as a phone held upright writes it.
  const sideways = await sharp(await documentPhoto(3024, 4032)).rotate(-90).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer()
  const transparentPng = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  const screenshotPng = await sharp(await documentPhoto(2880, 1800, 90)).png().toBuffer()
  const small = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  const webp = await sharp(await documentPhoto(3000, 4000, 90)).webp({ quality: 90 }).toBuffer()
  const gif = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).gif().toBuffer()
  const photo48mp = await documentPhoto(8000, 6000, 92)
  return {
    'HEIC iPhone (test/fixtures/sample.heic)': { buf: readFileSync(new URL('../test/fixtures/sample.heic', import.meta.url)), mime: 'image/heic', name: 'IMG_0042.HEIC' },
    'JPEG 12 MP document photo': { buf: photo12mp, mime: 'image/jpeg', name: 'scan.jpg' },
    'JPEG sideways (EXIF orientation 6)': { buf: sideways, mime: 'image/jpeg', name: 'rotated.jpg' },
    'PNG transparent 300x200': { buf: transparentPng, mime: 'image/png', name: 'screenshot.png' },
    'PNG screenshot 2880x1800': { buf: screenshotPng, mime: 'image/png', name: 'screen.png' },
    'JPEG small, already fine (untouched)': { buf: small, mime: 'image/jpeg', name: 'ok.jpg' },
    'WebP 3000x4000': { buf: webp, mime: 'image/webp', name: 'photo.webp' },
    'GIF 64x64': { buf: gif, mime: 'image/gif', name: 'anim.gif' },
    'JPEG 48 MP (8000x6000, stress)': { buf: photo48mp, mime: 'image/jpeg', name: 'huge.jpg' }
  }
}

// PSNR of two images after bringing both to the same size: a measure of how
// alike the Worker's JPEG and sharp's JPEG look (> 35 dB: visually identical).
async function psnr(a, b) {
  const meta = await sharp(a).metadata()
  const raw = async (buf) => sharp(buf).resize(meta.width, meta.height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  const [x, y] = await Promise.all([raw(a), raw(b)])
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += (x[i] - y[i]) ** 2
  const mse = sum / x.length
  return mse === 0 ? Infinity : +(10 * Math.log10((255 * 255) / mse)).toFixed(1)
}

// ------------------------------------------------------------------ run ----
try {
  results.worker = await waitForWorker()
  console.log('worker up:', results.worker.runtime)

  for (const [label, f] of Object.entries(await fixtures())) {
    const entry = { input: { bytes: f.buf.length, mime: f.mime } }
    try {
      const inMeta = await sharp(f.buf).metadata()
      entry.input.size = `${inMeta.width}x${inMeta.height}`
    } catch {
      entry.input.size = 'sharp cannot read it either'
    }
    const t0 = Date.now()
    const res = await post(`/image?mime=${encodeURIComponent(f.mime)}&name=${encodeURIComponent(f.name)}`, f.buf)
    const roundTripMs = Date.now() - t0
    if (!res.ok) {
      entry.worker = { works: false, ...(await res.json()) }
    } else {
      const out = Buffer.from(await res.arrayBuffer())
      const readBack = await sharp(out).metadata()
      entry.worker = {
        works: true,
        changed: res.headers.get('x-changed') === 'true',
        size: `${res.headers.get('x-width')}x${res.headers.get('x-height')}`,
        bytes: out.length,
        readableBySharpAs: `${readBack.format} ${readBack.width}x${readBack.height}`,
        totalMsInWorker: Number(res.headers.get('x-total-ms')),
        roundTripMs,
        steps: JSON.parse(res.headers.get('x-steps') || '{}')
      }
      entry._out = out
    }
    try {
      const t1 = Date.now()
      const ref = await normalizeWithSharp(f.buf, { mimeType: f.mime, fileName: f.name })
      entry.sharpToday = { changed: ref.changed, size: `${ref.width}x${ref.height}`, bytes: ref.buffer.length, ms: Date.now() - t1 }
      if (entry._out) {
        entry.comparison = {
          sameSize: entry.worker.size === entry.sharpToday.size,
          bytesWorkerVsSharp: +(entry.worker.bytes / ref.buffer.length).toFixed(2),
          psnrDb: await psnr(ref.buffer, entry._out)
        }
      }
    } catch (error) {
      entry.sharpToday = { error: error.message }
    }
    if (label.startsWith('HEIC') && entry._out) {
      writeFileSync(new URL('./out-heic-worker.jpg', import.meta.url), entry._out)
      results.heicJpegBase64 = entry._out.toString('base64')
    }
    delete entry._out
    results.images[label] = entry
    console.log('IMAGE', label, JSON.stringify(entry))
  }

  results.other.heicDecodeAsIs = await (await post('/heic-decode-as-is', readFileSync(new URL('../test/fixtures/sample.heic', import.meta.url)))).json()
  console.log('heic-decode as is:', JSON.stringify(results.other.heicDecodeAsIs))

  const nodeHash = bcrypt.hashSync('Correct-Horse-9', bcrypt.genSaltSync(10)).replace(/^\$2b\$/, '$2a$')
  results.other.bcrypt = await postJson('/bcrypt', { password: 'Correct-Horse-9', nodeHash })
  // ...and the Worker's hash verifies in Node too.
  results.other.bcrypt.workerHashVerifiesInNode = bcrypt.compareSync('Correct-Horse-9', results.other.bcrypt.hash)
  console.log('bcrypt:', JSON.stringify(results.other.bcrypt))

  results.other.nodeApis = await postJson('/node-apis', { mockUrl })
  console.log('node apis:', JSON.stringify(results.other.nodeApis))

  results.other.apiModules = await (await fetch(`${WORKER}/api-modules`)).json()
  console.log('api modules:', JSON.stringify(results.other.apiModules))

  results.other.anthropic = await postJson('/anthropic', { imageBase64: results.heicJpegBase64, model: 'claude-haiku-4-5-20251001' })
  console.log('anthropic:', JSON.stringify(results.other.anthropic))

  results.other.resend = await postJson('/resend', {})
  console.log('resend:', JSON.stringify(results.other.resend))
} finally {
  delete results.heicJpegBase64
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2))
  mock.close()
  if (wrangler) {
    wrangler.kill()
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(wrangler.pid), '/T', '/F'], { shell: true })
  }
}

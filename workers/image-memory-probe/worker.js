// A throw-away Worker that answers the one question `wrangler dev` cannot:
// up to how many megapixels does the in-Worker image conversion
// (api/_imageNormalize.js) fit in Cloudflare's real 128 MB isolate?
//
// Deploy it next to the app (needs the Cloudflare account), run run.mjs
// against it, read the table, delete it:
//   npx wrangler deploy -c workers/image-memory-probe/wrangler.toml
//   node workers/image-memory-probe/run.mjs https://hornung-image-memory-probe.<subdomain>.workers.dev
//   npx wrangler delete -c workers/image-memory-probe/wrangler.toml
//
// POST /app (body: an image) -> the app's own path, see below.
// POST /convert (body: a JPEG or, with content-type image/heic, a HEIC) -> converts it INSIDE the Worker whatever
// its size (no Cloudflare Images fallback), answers size and timings. A
// photo that does not fit makes Cloudflare kill the isolate: the request
// fails with "Worker exceeded memory limit" (error 1102) instead.
import { neon } from '@neondatabase/serverless'
import { normalizeImageBuffer } from '../../api/_imageNormalize.js'

// GET /neon?n=20 (needs the DATABASE_URL secret on this probe): n
// sequential `select 1` through the app's driver -> Worker -> Neon latency
// (ms per query), and, with a large n, the subrequest limit per invocation.
async function neonProbe(env, n) {
  const sql = neon(env.DATABASE_URL)
  const times = []
  for (let i = 0; i < n; i++) {
    const t = Date.now()
    try { await sql`select 1` } catch (error) { return { ok: false, failedAt: i + 1, error: error.message.slice(0, 300), times: stats(times) } }
    times.push(Date.now() - t)
  }
  return { ok: true, queries: n, times: stats(times) }
}
function stats(t) {
  const s = [...t].sort((a, b) => a - b)
  return s.length ? { first: t[0], median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] } : {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/neon') return Response.json(await neonProbe(env, Number(url.searchParams.get('n')) || 20))
    // POST /app: what the app does — production threshold, and Cloudflare
    // Images (env.IMAGES) above it. Answers which path converted the image.
    if (request.method === 'POST' && url.pathname === '/app') {
      delete globalThis.process.env.IMAGE_MAX_WORKER_PIXELS
      const input = new Uint8Array(await request.arrayBuffer())
      const out = await normalizeImageBuffer(input, { mimeType: request.headers.get('content-type') || 'image/jpeg', images: env.IMAGES })
      if (url.searchParams.has('raw')) return new Response(out.buffer, { headers: { 'content-type': 'image/jpeg', 'x-via': out.via || 'worker' } })
      return Response.json({ ok: true, via: out.via || 'worker', inputBytes: input.length, out: `${out.width}x${out.height}`, outBytes: out.buffer.length })
    }
    if (request.method !== 'POST' || url.pathname !== '/convert') return new Response('POST /convert or /app', { status: 404 })
    // A fresh isolate per size is what makes the answer meaningful.
    globalThis.process.env.IMAGE_MAX_WORKER_PIXELS = String(200_000_000)
    const input = new Uint8Array(await request.arrayBuffer())
    const started = Date.now()
    const stages = {}
    const out = await normalizeImageBuffer(input, {
      mimeType: request.headers.get('content-type') || 'image/jpeg', // image/heic for phone photos
      onStage: (stage) => (stages[stage] = Date.now() - started)
    })
    return Response.json({ ok: true, inputBytes: input.length, out: `${out.width}x${out.height}`, outBytes: out.buffer.length, ms: stages })
  }
}

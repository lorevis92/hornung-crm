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
// POST /convert (body: a JPEG) -> converts it INSIDE the Worker whatever
// its size (no Cloudflare Images fallback), answers size and timings. A
// photo that does not fit makes Cloudflare kill the isolate: the request
// fails with "Worker exceeded memory limit" (error 1102) instead.
import { normalizeImageBuffer } from '../../api/_imageNormalize.js'

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/convert') return new Response('POST /convert', { status: 404 })
    // A fresh isolate per size is what makes the answer meaningful.
    globalThis.process.env.IMAGE_MAX_WORKER_PIXELS = String(200_000_000)
    const input = new Uint8Array(await request.arrayBuffer())
    const started = Date.now()
    const stages = {}
    const out = await normalizeImageBuffer(input, {
      mimeType: 'image/jpeg',
      onStage: (stage) => (stages[stage] = Date.now() - started)
    })
    return Response.json({ ok: true, inputBytes: input.length, out: `${out.width}x${out.height}`, outBytes: out.buffer.length, ms: stages })
  }
}

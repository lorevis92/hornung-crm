// node workers/image-memory-probe/run.mjs <deployed probe URL>
// Sends phone-like document photos of growing size to the probe Worker and
// prints which ones Cloudflare converts inside the 128 MB isolate. Set
// IMAGE_MAX_WORKER_PIXELS (wrangler secret / [vars]) of the app to the
// largest size that passed, with a margin.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const base = process.argv[2]?.replace(/\/$/, '')
if (!base) {
  console.error('usage: node workers/image-memory-probe/run.mjs https://hornung-image-memory-probe.<subdomain>.workers.dev')
  process.exit(1)
}

async function photo(W, H) {
  const lines = Array.from({ length: Math.floor(H / 45) }, (_, i) =>
    `<text x="200" y="${300 + i * 40}" font-size="30" font-family="Arial">Riga ${i} — Saldo al 31.12.2025 CHF 12'400.50</text>`).join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f4f1ea"/>${lines}</svg>`)
  const texture = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 12 } } }).png().toBuffer()
  return sharp(svg).composite([{ input: texture, blend: 'soft-light' }]).jpeg({ quality: 92 }).toBuffer()
}

const SIZES = [[2448, 3264], [2736, 3648], [3000, 4000], [3024, 4032], [3456, 4608], [4284, 5712]] // 8, 10, 12, 12.2, 16, 24.5 MP
for (const [W, H] of SIZES) {
  const body = await photo(W, H)
  const started = Date.now()
  let line
  try {
    const res = await fetch(`${base}/convert`, { method: 'POST', body, headers: { 'content-type': 'image/jpeg' } })
    const text = await res.text()
    line = res.ok ? `OK    ${text}` : `FAIL  HTTP ${res.status} ${text.slice(0, 200)}`
  } catch (error) {
    line = `FAIL  ${error.message}`
  }
  console.log(`${((W * H) / 1e6).toFixed(1).padStart(5)} MP  ${String(Date.now() - started).padStart(6)} ms  ${line}`)
}

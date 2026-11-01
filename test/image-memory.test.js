// The memory brake of api/_imageNormalize.js. A Cloudflare Worker has 128 MB
// per isolate, which `wrangler dev` does not enforce, so:
//  - always: an image too big to decode safely is recognised from its
//    header alone (never decoded), and either handed to Cloudflare Images
//    or refused with a readable message;
//  - with `npm run measure:image-memory` (needs --expose-gc): the peak
//    memory of a conversion done in the Worker is measured — the numbers
//    the 8 MP limit is based on.
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  IMAGE_MAX_SIDE,
  IMAGE_MAX_WORKER_PIXELS,
  normalizeImageBuffer,
  readImageInfo
} from '../api/_imageNormalize.js'

async function documentPhoto(W, H, quality = 95) {
  const lines = Array.from(
    { length: Math.floor(H / 45) },
    (_, i) => `<text x="200" y="${300 + i * 40}" font-size="30" font-family="Arial">Riga ${i} — Saldo al 31.12.2025 CHF 12'400.50</text>`
  ).join('')
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f4f1ea"/>${lines}</svg>`
  )
  const texture = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 12 } } })
    .png()
    .toBuffer()
  return sharp(svg).composite([{ input: texture, blend: 'soft-light' }]).jpeg({ quality }).toBuffer()
}

const plain = (width, height, format = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: '#ffffff' } })[format]().toBuffer()

// A stand-in for env.IMAGES that records the call (the real one runs on
// Cloudflare; `wrangler dev` has a reduced local copy).
function recordingImagesBinding(outputJpeg) {
  const calls = []
  return {
    calls,
    input(stream) {
      const call = { stream }
      calls.push(call)
      const chain = {
        transform(options) {
          call.transform = options
          return chain
        },
        async output(options) {
          call.output = options
          return { response: () => new Response(outputJpeg) }
        }
      }
      return chain
    }
  }
}

describe('an image too large to decode inside the Worker', () => {
  it('is measured from its header, without being decoded', async () => {
    expect(readImageInfo(await plain(4032, 3024))).toMatchObject({ format: 'jpeg', width: 4032, height: 3024 })
    expect(readImageInfo(await plain(5000, 2000, 'png'))).toMatchObject({ format: 'png', width: 5000, height: 2000 })
    expect(readImageInfo(await plain(3000, 4000, 'webp'))).toMatchObject({ format: 'webp', width: 3000, height: 4000 })
  })

  it('is refused with a readable message when there is no Cloudflare Images binding', async () => {
    const big = await plain(4032, 3024)
    const started = performance.now()
    const error = await normalizeImageBuffer(big, { mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' }).catch((e) => e)
    expect(error.code).toBe('IMAGE_TOO_LARGE')
    expect(error.message).toMatch(/4032×3024 px \(12\.2 MP\)/)
    expect(error.message).toMatch(/lower resolution or as a PDF/)
    // Header only: no decoder ran (a 12 MP decode takes hundreds of ms).
    expect(performance.now() - started).toBeLessThan(150)
  })

  it('goes to Cloudflare Images (JPEG, 2400 px, quality 85, white background) when the binding exists', async () => {
    const images = recordingImagesBinding(await plain(2400, 1800))
    const out = await normalizeImageBuffer(await plain(4032, 3024), { mimeType: 'image/jpeg', fileName: 'IMG_1.jpg', images })
    expect(images.calls).toHaveLength(1)
    expect(images.calls[0].transform).toEqual({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'scale-down', background: '#ffffff' })
    expect(images.calls[0].output).toEqual({ format: 'image/jpeg', quality: 85, anim: false })
    expect(out).toMatchObject({ changed: true, mimeType: 'image/jpeg', width: 2400, height: 1800, via: 'cloudflare-images' })
  })

  it('a GIF goes to Cloudflare Images too, and is refused without it', async () => {
    const gif = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).gif().toBuffer()
    const error = await normalizeImageBuffer(gif, { mimeType: 'image/gif' }).catch((e) => e)
    expect(error.code).toBe('GIF_NOT_SUPPORTED')
    const images = recordingImagesBinding(await plain(64, 64))
    const out = await normalizeImageBuffer(gif, { mimeType: 'image/gif', images })
    expect(out.via).toBe('cloudflare-images')
  })

  it('anything at or below the limit is converted in the Worker, not sent out', async () => {
    const images = recordingImagesBinding(new Uint8Array())
    expect(3264 * 2448).toBeLessThanOrEqual(IMAGE_MAX_WORKER_PIXELS)
    const out = await normalizeImageBuffer(await documentPhoto(3264, 2448), { mimeType: 'image/jpeg', images }) // an "8 MP" camera
    expect(images.calls).toHaveLength(0)
    expect([out.width, out.height]).toEqual([2400, 1800])
  }, 60000)
})

// npm run measure:image-memory
describe.runIf(typeof globalThis.gc === 'function')('peak memory of a conversion in the Worker', () => {
  const MB = 1e6
  async function peakOf(W, H) {
    const photo = new Uint8Array(await documentPhoto(W, H))
    globalThis.gc()
    globalThis.gc()
    const base = process.memoryUsage().external
    const stages = {}
    await normalizeImageBuffer(photo, {
      mimeType: 'image/jpeg',
      // allocated: everything since the start, garbage included (at
      // 'decoded' that is the true peak: the decoder's heap and its copy of
      // the pixels coexist for an instant). live: after a full GC.
      onStage(stage) {
        const allocated = Math.round((process.memoryUsage().external - base) / MB)
        globalThis.gc()
        stages[stage] = { allocated, live: Math.round((process.memoryUsage().external - base) / MB) }
      }
    })
    return { megapixels: +((W * H) / 1e6).toFixed(1), inputMB: +(photo.length / MB).toFixed(1), externalMBAfter: stages }
  }

  it('stays well under 128 MB at the 8 MP limit', async () => {
    const result = await peakOf(3264, 2448)
    console.log('[image-memory]', JSON.stringify(result))
    // At 'decoded' the decoder's heap and its copy of the pixels are both
    // still alive: the real peak.
    expect(result.externalMBAfter.decoded.allocated).toBeLessThan(80)
  }, 120000)

  it('(for the record) 12 MP and 24 MP would not fit', async () => {
    const saved = process.env.IMAGE_MAX_WORKER_PIXELS
    process.env.IMAGE_MAX_WORKER_PIXELS = '30000000'
    try {
      for (const [W, H] of [[4032, 3024], [5712, 4284]]) {
        const result = await peakOf(W, H)
        console.log('[image-memory]', JSON.stringify(result))
        expect(result.externalMBAfter.decoded.allocated).toBeGreaterThan(90)
      }
    } finally {
      if (saved === undefined) delete process.env.IMAGE_MAX_WORKER_PIXELS
      else process.env.IMAGE_MAX_WORKER_PIXELS = saved
    }
  }, 300000)
})

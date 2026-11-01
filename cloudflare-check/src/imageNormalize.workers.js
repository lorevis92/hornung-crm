// Candidate Workers-compatible replacement for api/_imageNormalize.js's
// normalizeImageBuffer(): same thresholds, same decisions, no native binary.
//
//   sharp (native libvips)         ->  jSquash (WebAssembly builds of the
//                                      Squoosh codecs: mozjpeg, png, webp,
//                                      resize)
//   heic-decode (libheif-js, wasm) ->  the same libheif-js wasm, loaded as a
//                                      pre-compiled WebAssembly.Module
//                                      (see heicDecode.workers.js)
//
// What sharp did implicitly and has to be done by hand here:
//   .metadata()        -> readJpegInfo(): JPEG size + EXIF orientation from
//                         the file headers, without decoding the pixels
//   .rotate()          -> applyOrientation(): the jSquash mozjpeg decoder does
//                         NOT apply the EXIF orientation (found by the runner's
//                         orientation-6 photo), so the pixels are turned here
//   .flatten(#fff)     -> flattenOnWhite()
//   .resize(inside)    -> fitInside() + @jsquash/resize (lanczos3, the
//                         kernel sharp uses by default; linearRGB off, as in
//                         sharp — jSquash's default linear-light resize costs
//                         ~3x the CPU time)
//   .jpeg(q85 mozjpeg) -> @jsquash/jpeg encode, quality 85 (it IS mozjpeg)
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode'
import encodeJpeg, { init as initJpegEncode } from '@jsquash/jpeg/encode'
import decodePng, { init as initPngDecode } from '@jsquash/png/decode'
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode'
import resize, { initResize } from '@jsquash/resize'
import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'
import JPEG_ENC_WASM from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'
import PNG_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm'
import WEBP_DEC_WASM from '@jsquash/webp/codec/dec/webp_dec.wasm'
import RESIZE_WASM from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'
import { decodeHeic } from './heicDecode.workers.js'

// Same values as api/_imageNormalize.js.
export const IMAGE_MAX_SIDE = 2400
export const IMAGE_JPEG_QUALITY = 85
export const IMAGE_MAX_BYTES_UNTOUCHED = 2.5 * 1024 * 1024

// Workers have no ImageData; the jSquash codecs only need its shape.
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data
      this.width = width
      this.height = height
      this.colorSpace = 'srgb'
    }
  }
}

let ready
function initCodecs() {
  ready ||= Promise.all([
    initJpegDecode(JPEG_DEC_WASM),
    initJpegEncode(JPEG_ENC_WASM),
    initPngDecode(PNG_WASM),
    initWebpDecode(WEBP_DEC_WASM),
    initResize(RESIZE_WASM)
  ])
  return ready
}

function isHeic(mimeType, fileName) {
  return mimeType === 'image/heic' || mimeType === 'image/heif' || /\.hei[cf]$/i.test(fileName || '')
}

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to))

function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'png'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp'
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif'
  return null
}

// JPEG width/height (SOFn marker) and EXIF orientation (APP1), headers only.
export function readJpegInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  let width = 0
  let height = 0
  let orientation = 1
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break
    const marker = bytes[offset + 1]
    if (marker === 0xd9 || marker === 0xda) break
    const length = view.getUint16(offset + 2)
    const segment = offset + 4
    if (marker === 0xe1 && ascii(bytes, segment, segment + 4) === 'Exif') {
      const tiff = segment + 6
      const little = view.getUint16(tiff) === 0x4949
      const ifd0 = tiff + view.getUint32(tiff + 4, little)
      const entries = view.getUint16(ifd0, little)
      for (let i = 0; i < entries; i++) {
        const entry = ifd0 + 2 + i * 12
        if (view.getUint16(entry, little) === 0x0112) orientation = view.getUint16(entry + 8, little)
      }
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = view.getUint16(segment + 1)
      width = view.getUint16(segment + 3)
    }
    offset = segment + length - 2
  }
  return { width, height, orientation }
}

// sharp's .flatten({ background: '#ffffff' }): a transparent pixel would
// otherwise turn black in a JPEG.
function flattenOnWhite(image) {
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a === 255) continue
    const k = a / 255
    d[i] = d[i] * k + 255 * (1 - k)
    d[i + 1] = d[i + 1] * k + 255 * (1 - k)
    d[i + 2] = d[i + 2] * k + 255 * (1 - k)
    d[i + 3] = 255
  }
  return image
}

// EXIF orientation 2..8 -> upright pixels (sharp's .rotate()).
export function applyOrientation(image, orientation) {
  if (!orientation || orientation === 1 || orientation > 8) return image
  const { width: w, height: h } = image
  const src = new Uint32Array(image.data.buffer, image.data.byteOffset, w * h)
  const swap = orientation >= 5
  const W = swap ? h : w
  const H = swap ? w : h
  const out = new Uint32Array(W * H)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let X
      let Y
      switch (orientation) {
        case 2: X = w - 1 - x; Y = y; break
        case 3: X = w - 1 - x; Y = h - 1 - y; break
        case 4: X = x; Y = h - 1 - y; break
        case 5: X = y; Y = x; break
        case 6: X = h - 1 - y; Y = x; break
        case 7: X = h - 1 - y; Y = w - 1 - x; break
        case 8: X = y; Y = w - 1 - x; break
      }
      out[Y * W + X] = src[y * w + x]
    }
  }
  return new ImageData(new Uint8ClampedArray(out.buffer), W, H)
}

// fit: 'inside', withoutEnlargement: true
function fitInside(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

// Uint8Array -> { buffer, mimeType: 'image/jpeg', width, height, changed, steps }
// tuning (test bench only): { linearRGB, method, encode: {...mozjpeg options} }
export async function normalizeImageBuffer(input, { mimeType, fileName, tuning = {} } = {}) {
  await initCodecs()
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const steps = {}
  const now = () => performance.now()
  let start = now()

  let image
  let orientation = 1
  if (isHeic(mimeType, fileName)) {
    const decoded = await decodeHeic(bytes)
    image = new ImageData(
      new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      decoded.width,
      decoded.height
    )
  } else {
    const format = sniff(bytes)
    if (format === 'jpeg') {
      const meta = readJpegInfo(bytes)
      orientation = meta.orientation
      const upright = !meta.orientation || meta.orientation === 1
      if (upright && Math.max(meta.width, meta.height) <= IMAGE_MAX_SIDE && bytes.length <= IMAGE_MAX_BYTES_UNTOUCHED) {
        return { buffer: bytes, mimeType: 'image/jpeg', width: meta.width, height: meta.height, changed: false, steps }
      }
      image = await decodeJpeg(toArrayBuffer(bytes))
    } else if (format === 'png') {
      image = await decodePng(toArrayBuffer(bytes))
    } else if (format === 'webp') {
      image = await decodeWebp(toArrayBuffer(bytes))
    } else if (format === 'gif') {
      // jSquash has no GIF decoder; sharp read the first frame.
      throw new Error('GIF_NOT_SUPPORTED')
    } else {
      throw new Error('unreadable file')
    }
  }
  steps.decodeMs = now() - start
  steps.decodedPixelBytes = image.data.byteLength

  start = now()
  flattenOnWhite(image)
  image = applyOrientation(image, orientation)
  steps.flattenAndRotateMs = now() - start

  start = now()
  const target = fitInside(image.width, image.height, IMAGE_MAX_SIDE)
  if (target.width !== image.width || target.height !== image.height) {
    image = await resize(image, {
      width: target.width,
      height: target.height,
      method: tuning.method || 'lanczos3',
      fitMethod: 'stretch',
      premultiply: false, // already flattened: no alpha left
      linearRGB: tuning.linearRGB ?? false
    })
  }
  steps.resizeMs = now() - start

  start = now()
  const jpeg = new Uint8Array(await encodeJpeg(image, { quality: IMAGE_JPEG_QUALITY, ...(tuning.encode || {}) }))
  steps.encodeMs = now() - start
  return { buffer: jpeg, mimeType: 'image/jpeg', width: image.width, height: image.height, changed: true, steps }
}

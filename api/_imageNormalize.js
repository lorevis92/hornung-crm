// Every uploaded image is turned into a reasonably sized JPEG before
// anything reads it — the extraction, the document viewer, the download.
//
// Why here: the first server-side step after an upload is the extraction
// (api/extract-document.js, run from the extraction queue as soon as the
// document is registered). So runExtraction calls normalizeStoredImage
// first: the original is replaced in storage by the converted file, and
// both document rows (client_documents and the case_documents it mirrors)
// point at the new one.
//
// Two problems, one step:
//  - iPhone photos are HEIC, which Claude does not read;
//  - phone photos are huge (12–48 MP, several MB): a tax document needs to
//    stay readable, not keep a camera's native resolution.
//
// PDFs, text and office files are never touched.
//
// Runs on Cloudflare Workers, so no native code (sharp/libvips cannot load
// there) and no runtime wasm compilation (Workers only instantiate wasm
// modules bundled at deploy time — every .wasm below is imported as a
// pre-compiled WebAssembly.Module; vitest.config.js does the same in tests):
//   JPEG decode/encode  mozjpeg (the @jsquash/jpeg build, = sharp's mozjpeg)
//   WebP decode         libwebp (@jsquash/webp)
//   PNG decode          fast-png (plain JS)
//   HEIC decode         libheif (libheif-js, the library heic-decode wraps)
//   resize              api/_imageResize.js (lanczos3, as sharp)
// Validated against sharp in the cloudflare-check bench (branch
// verifica-cloudflare): same sizes, PSNR 36–48 dB, files 3–13% heavier.
//
// Memory. A Worker isolate has 128 MB, and decoding costs ~8.3 bytes per
// pixel at its peak (4 for the pixels in the decoder's wasm heap, 4 for the
// copy it hands over, plus the file): measured, a 12 MP phone photo peaks
// at ~100 MB, a 24 MP one at ~200 MB (test/image-memory.test.js). So,
// BEFORE anything is decoded, the pixel size is read from the file headers:
//   * up to IMAGE_MAX_WORKER_PIXELS (8 MP, ~70 MB peak): converted here;
//   * above, up to 100 MP / 20 MB: handed to Cloudflare Images (the IMAGES
//     binding, see wrangler.toml), which resizes outside the Worker's
//     memory — same output: JPEG, longest side 2400, quality 85, EXIF
//     rotation applied, transparency on white;
//   * otherwise (or without the binding): refused with a clear message,
//     never decoded in the hope that it fits.
// And for what is decoded here:
//   * every wasm codec gets a fresh instance per image that is dropped
//     right after use (a wasm heap only grows, never shrinks: a shared
//     instance would keep the biggest image ever seen reserved forever);
//   * the resize reads the decoded pixels in place (no second full copy)
//     and the EXIF rotation is applied to the small, resized image.
import { decode as decodePngJs } from 'fast-png'
import { initEmscriptenModule } from '@jsquash/jpeg/utils.js'
import { defaultOptions as JPEG_ENCODE_DEFAULTS } from '@jsquash/jpeg/meta.js'
import mozjpegDecFactory from '@jsquash/jpeg/codec/dec/mozjpeg_dec.js'
import mozjpegEncFactory from '@jsquash/jpeg/codec/enc/mozjpeg_enc.js'
import webpDecFactory from '@jsquash/webp/codec/dec/webp_dec.js'
import libheifFactory from 'libheif-js/libheif-wasm/libheif.js'
import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'
import JPEG_ENC_WASM from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'
import WEBP_DEC_WASM from '@jsquash/webp/codec/dec/webp_dec.wasm'
import LIBHEIF_WASM from 'libheif-js/libheif-wasm/libheif.wasm'
import { resizeLanczos3 } from './_imageResize.js'
import { runtimeBinding } from './_runtime.js'

// Longest side kept: 2400 px leaves an A4 page at ~200 dpi — small print and
// table figures stay sharp for the eye, and well above what the extraction
// model works at (it scales images down to ~1568 px on its own).
export const IMAGE_MAX_SIDE = 2400
// JPEG quality 85 (mozjpeg): text edges stay clean; a lower quality starts
// smearing thin digits, which costs extraction reliability for little gain.
export const IMAGE_JPEG_QUALITY = 85
// A JPEG already within the size limit and below this weight is left as it
// is: re-encoding it would only lose quality (and a document re-extracted
// later would be re-compressed every time).
export const IMAGE_MAX_BYTES_UNTOUCHED = 2.5 * 1024 * 1024
// The memory brake (see the header). Overridable with
// IMAGE_MAX_WORKER_PIXELS once workers/image-memory-probe has measured the
// real limit on Cloudflare.
export const IMAGE_MAX_WORKER_PIXELS = 8_000_000
// Cloudflare Images limits (developers.cloudflare.com/images/get-started/limits).
export const IMAGES_BINDING_MAX_PIXELS = 100_000_000
export const IMAGES_BINDING_MAX_BYTES = 20 * 1024 * 1024

export function maxDecodePixels() {
  const fromEnv = Number(globalThis.process?.env?.IMAGE_MAX_WORKER_PIXELS)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : IMAGE_MAX_WORKER_PIXELS
}

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|heif)$/i

// Some browsers send no type for a .heic file (Windows, older Android).
export function isImageUpload(mimeType, fileName) {
  if (IMAGE_MIME_TYPES.has(mimeType)) return true
  return (!mimeType || mimeType === 'application/octet-stream') && IMAGE_EXTENSIONS.test(fileName || '')
}

export function jpegFileName(fileName) {
  const base = String(fileName || 'image').replace(/\.[^./\\]+$/, '')
  return `${base}.jpg`
}

export class ImageNormalizeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// The emscripten glue checks for Node (true under nodejs_compat) and then
// reads __dirname to build a path it never uses (instantiateWasm is given).
// Workers have no __dirname.
globalThis.__dirname ??= '/'

// Workers have no ImageData; the mozjpeg/webp glue only needs its shape.
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

// A brand-new instance of a codec, for one image only.
function freshCodec(factory, wasmModule) {
  return initEmscriptenModule(factory, wasmModule)
}

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to))

function looksLikeHeic(bytes) {
  return bytes.length > 12 && ascii(bytes, 4, 8) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(bytes, 8, 12))
}

function sniff(bytes, mimeType, fileName) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'png'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp'
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif'
  if (looksLikeHeic(bytes)) return 'heic'
  if (mimeType === 'image/heic' || mimeType === 'image/heif' || /\.hei[cf]$/i.test(fileName || '')) return 'heic'
  return null
}

// --------------------------------------------------------------------------
// Pixel size from the headers — nothing decoded
// --------------------------------------------------------------------------

// JPEG width/height (SOFn marker) and EXIF orientation (APP1).
export function readJpegInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  let width = 0
  let height = 0
  let orientation = 1
  try {
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]
      if (marker === 0xff) {
        offset += 1 // fill byte
        continue
      }
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
  } catch {
    // A truncated header: whatever was read so far.
  }
  return { width, height, orientation: orientation >= 1 && orientation <= 8 ? orientation : 1 }
}

function readPngInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return { width: 0, height: 0 }
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function readWebpInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunk = ascii(bytes, 12, 16)
  const u24 = (at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
  if (chunk === 'VP8X' && bytes.length >= 30) return { width: u24(24) + 1, height: u24(27) + 1 }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const b = view.getUint32(21, true)
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  return { width: 0, height: 0 }
}

// HEIC: the "ispe" (image spatial extent) properties in the meta box. A
// grid image (what iPhones write) has one for the whole picture and one per
// 512×512 tile; the thumbnail has a small one. The largest is the picture.
export function readHeicInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  const end = Math.min(bytes.length - 16, 4 * 1024 * 1024)
  for (let i = 4; i < end; i++) {
    if (bytes[i] === 0x69 && bytes[i + 1] === 0x73 && bytes[i + 2] === 0x70 && bytes[i + 3] === 0x65) {
      // [size][ 'ispe' ][version+flags][width][height]
      const w = view.getUint32(i + 8)
      const h = view.getUint32(i + 12)
      if (w * h > width * height) {
        width = w
        height = h
      }
    }
  }
  return { width, height }
}

export function readImageInfo(bytes, { mimeType, fileName } = {}) {
  const format = sniff(bytes, mimeType, fileName)
  const info =
    format === 'jpeg' ? readJpegInfo(bytes)
      : format === 'png' ? readPngInfo(bytes)
        : format === 'webp' ? readWebpInfo(bytes)
          : format === 'heic' ? readHeicInfo(bytes)
            : { width: 0, height: 0 }
  return { format, orientation: 1, ...info }
}

// --------------------------------------------------------------------------
// Pixel operations
// --------------------------------------------------------------------------

// sharp's .flatten({ background: '#ffffff' }): a transparent pixel would
// otherwise turn black in a JPEG. In place.
function flattenOnWhite(data) {
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i]
    if (a === 255) continue
    const k = a / 255
    data[i - 3] = data[i - 3] * k + 255 * (1 - k)
    data[i - 2] = data[i - 2] * k + 255 * (1 - k)
    data[i - 1] = data[i - 1] * k + 255 * (1 - k)
    data[i] = 255
  }
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
  return { data: new Uint8ClampedArray(out.buffer), width: W, height: H }
}

// fit: 'inside', withoutEnlargement: true
function fitInside(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// --------------------------------------------------------------------------
// Decoders (fresh instance each, see the header)
// --------------------------------------------------------------------------
async function decodeJpeg(bytes) {
  const codec = await freshCodec(mozjpegDecFactory, JPEG_DEC_WASM)
  const result = codec.decode(bytes, false)
  if (!result) throw new Error('JPEG decoding error')
  return { data: result.data, width: result.width, height: result.height }
}

async function decodeWebp(bytes) {
  const codec = await freshCodec(webpDecFactory, WEBP_DEC_WASM)
  const result = codec.decode(bytes)
  if (!result) throw new Error('WebP decoding error')
  return { data: result.data, width: result.width, height: result.height }
}

function decodePng(bytes) {
  const png = decodePngJs(bytes)
  const { width, height } = png
  const channels = png.channels
  const src = png.data
  // Normalize every PNG flavour (grey, grey+alpha, RGB, RGBA, 16-bit,
  // palette) to 8-bit RGBA.
  const out = new Uint8ClampedArray(width * height * 4)
  const shift = png.depth === 16 ? 8 : 0
  const palette = png.palette
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    if (palette) {
      const entry = palette[src[i]] || [0, 0, 0, 255]
      out[p] = entry[0]
      out[p + 1] = entry[1]
      out[p + 2] = entry[2]
      out[p + 3] = entry.length > 3 ? entry[3] : 255
      continue
    }
    const s = i * channels
    if (channels <= 2) {
      const v = src[s] >> shift
      out[p] = v
      out[p + 1] = v
      out[p + 2] = v
      out[p + 3] = channels === 2 ? src[s + 1] >> shift : 255
    } else {
      out[p] = src[s] >> shift
      out[p + 1] = src[s + 1] >> shift
      out[p + 2] = src[s + 2] >> shift
      out[p + 3] = channels === 4 ? src[s + 3] >> shift : 255
    }
  }
  return { data: out, width, height }
}

async function decodeHeic(bytes) {
  const libheif = libheifFactory({
    instantiateWasm(imports, callback) {
      const instance = new WebAssembly.Instance(LIBHEIF_WASM, imports)
      callback(instance, LIBHEIF_WASM)
      return instance.exports
    }
  })
  await libheif.ready
  const decoder = new libheif.HeifDecoder()
  const images = decoder.decode(bytes)
  try {
    if (!images.length) throw new Error('HEIF image not found')
    const image = images[0]
    const width = image.get_width()
    const height = image.get_height()
    // The headers said one thing, libheif another: trust the bigger one.
    if (width * height > maxDecodePixels()) throw tooLarge(width, height)
    const data = await new Promise((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (display) =>
        display ? resolve(display.data) : reject(new Error('HEIF processing error'))
      )
    })
    return { data, width, height }
  } finally {
    for (const image of images) image.free()
    decoder.decoder.delete()
  }
}

// Baseline, not progressive: a progressive mozjpeg keeps every DCT
// coefficient of the image in its heap until the end — measured, ~90 MB for
// a 2400×1800 output against ~70 MB baseline. Same quantization (quality
// 85), so the same picture; the file is a little heavier.
async function encodeJpeg(image) {
  const codec = await freshCodec(mozjpegEncFactory, JPEG_ENC_WASM)
  const view = codec.encode(image.data, image.width, image.height, { ...JPEG_ENCODE_DEFAULTS, quality: IMAGE_JPEG_QUALITY, progressive: false })
  // Copied out of the wasm heap, so the instance can go.
  return new Uint8Array(view)
}

function tooLarge(width, height, maxPixels = maxDecodePixels()) {
  const mp = ((width * height) / 1e6).toFixed(1)
  const max = (maxPixels / 1e6).toFixed(0)
  return new ImageNormalizeError(
    'IMAGE_TOO_LARGE',
    `This image is ${width}×${height} px (${mp} MP), above the ${max} MP the server can convert safely. ` +
      'Upload it at a lower resolution or as a PDF.'
  )
}

// Cloudflare Images: decoding and resizing happen outside the isolate.
// "scale-down" = fit inside, never enlarge; EXIF rotation is always applied
// by Cloudflare Images, transparency goes on the white background.
async function convertWithImagesBinding(images, bytes) {
  const result = await images
    .input(new Blob([bytes]).stream())
    .transform({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'scale-down', background: '#ffffff' })
    .output({ format: 'image/jpeg', quality: IMAGE_JPEG_QUALITY, anim: false })
  const jpeg = new Uint8Array(await result.response().arrayBuffer())
  const info = readJpegInfo(jpeg)
  return { buffer: jpeg, mimeType: 'image/jpeg', width: info.width, height: info.height, changed: true, via: 'cloudflare-images' }
}

// --------------------------------------------------------------------------
// buffer -> { buffer, mimeType: 'image/jpeg', width, height, changed }.
// changed is false when the image was already a small enough JPEG (the
// very same buffer object is returned).
// images: the Cloudflare Images binding (env.IMAGES), when configured.
// onStage(name) is only for test/image-memory.test.js.
// --------------------------------------------------------------------------
export async function normalizeImageBuffer(buffer, { mimeType, fileName, images = null, onStage } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const info = readImageInfo(bytes, { mimeType, fileName })
  if (!info.format) throw new ImageNormalizeError('UNREADABLE_IMAGE', 'unreadable file')

  const pixels = info.width * info.height
  const fitsHere = info.format !== 'gif' && pixels > 0 && pixels <= maxDecodePixels()
  if (!fitsHere) {
    // GIF: no decoder in this build (sharp used to take the first frame;
    // Cloudflare Images does the same with anim: false).
    if (images && bytes.length <= IMAGES_BINDING_MAX_BYTES && pixels <= IMAGES_BINDING_MAX_PIXELS) {
      return convertWithImagesBinding(images, bytes)
    }
    if (info.format === 'gif') {
      throw new ImageNormalizeError('GIF_NOT_SUPPORTED', 'GIF images are not supported — upload a JPEG, PNG or PDF.')
    }
    if (!pixels) throw new ImageNormalizeError('UNREADABLE_IMAGE', 'unreadable file (no image size in its header)')
    throw tooLarge(info.width, info.height, images ? IMAGES_BINDING_MAX_PIXELS : maxDecodePixels())
  }

  if (info.format === 'jpeg') {
    const upright = info.orientation === 1
    if (upright && Math.max(info.width, info.height) <= IMAGE_MAX_SIDE && bytes.length <= IMAGE_MAX_BYTES_UNTOUCHED) {
      return { buffer, mimeType: 'image/jpeg', width: info.width, height: info.height, changed: false }
    }
  }

  let image =
    info.format === 'jpeg' ? await decodeJpeg(bytes)
      : info.format === 'png' ? decodePng(bytes)
        : info.format === 'webp' ? await decodeWebp(bytes)
          : await decodeHeic(bytes)
  onStage?.('decoded')

  if (info.format === 'png' || info.format === 'webp') flattenOnWhite(image.data)

  const target = fitInside(image.width, image.height, IMAGE_MAX_SIDE)
  if (target.width !== image.width || target.height !== image.height) {
    image = resizeLanczos3(image, target.width, target.height)
    onStage?.('resized')
  }
  image = applyOrientation(image, info.orientation)

  const jpeg = await encodeJpeg(image)
  onStage?.('encoded')
  return { buffer: jpeg, mimeType: 'image/jpeg', width: image.width, height: image.height, changed: true }
}

// The stored document (a claimed client_documents row) -> the same row,
// pointing at the converted file when there was anything to convert.
export async function normalizeStoredImage(admin, document, bucket, { images = runtimeBinding('IMAGES') } = {}) {
  if (!isImageUpload(document.mime_type, document.file_name)) return document

  const { data: blob, error: downloadError } = await admin.storage.from(bucket).download(document.storage_path)
  if (downloadError) throw downloadError
  let original = new Uint8Array(await blob.arrayBuffer())

  let result
  try {
    result = await normalizeImageBuffer(original, { mimeType: document.mime_type, fileName: document.file_name, images })
  } catch (error) {
    if (error.code === 'IMAGE_TOO_LARGE' || error.code === 'GIF_NOT_SUPPORTED') throw error
    throw new Error(`Could not convert this image to JPEG (${error.message || 'unreadable file'}).`)
  }
  if (!result.changed) return document
  original = null

  const newPath = jpegFileName(document.storage_path)
  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(newPath, result.buffer, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) throw uploadError

  const patch = {
    storage_path: newPath,
    file_name: jpegFileName(document.file_name),
    mime_type: 'image/jpeg',
    file_size: result.buffer.length
  }
  const { error: docError } = await admin.from('client_documents').update(patch).eq('id', document.id)
  if (docError) throw docError
  if (document.source_case_document_id) {
    const { error: caseDocError } = await admin
      .from('case_documents')
      .update(patch)
      .eq('id', document.source_case_document_id)
    if (caseDocError) throw caseDocError
  }

  // Only once both rows point at the new file is the original removed.
  if (newPath !== document.storage_path) {
    const { error: removeError } = await admin.storage.from(bucket).remove([document.storage_path])
    if (removeError) console.error('[image-normalize] could not remove the original', document.storage_path, removeError)
  }
  return { ...document, ...patch }
}

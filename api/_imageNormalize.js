// Every uploaded image is turned into a reasonably sized JPEG before
// anything reads it — the extraction, the document viewer, the download.
//
// Why here: uploads go from the browser straight to Supabase Storage (no
// server in between), and the first server-side step after an upload is the
// extraction webhook (api/extract-document.js), which fires as soon as the
// document row exists. So runExtraction calls normalizeStoredImage first:
// the original is replaced in Storage by the converted file, and both
// document rows (client_documents and the case_documents it mirrors) point
// at the new one. Nothing else ever sees the original for more than the few
// seconds between upload and webhook.
//
// Two problems, one step:
//  - iPhone photos are HEIC, which Claude does not read. sharp's prebuilt
//    binaries cannot decode HEIC (HEVC) either — only AVIF — so HEIC goes
//    through heic-decode (libheif in WebAssembly) first, then sharp.
//  - Phone photos are huge (12–48 MP, several MB): a tax document needs to
//    stay readable, not keep a camera's native resolution.
//
// PDFs, text and office files are never touched.
import sharp from 'sharp'
import decodeHeic from 'heic-decode'

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

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|heif)$/i

// Some browsers send no type for a .heic file (Windows, older Android).
export function isImageUpload(mimeType, fileName) {
  if (IMAGE_MIME_TYPES.has(mimeType)) return true
  return (!mimeType || mimeType === 'application/octet-stream') && IMAGE_EXTENSIONS.test(fileName || '')
}

function isHeic(mimeType, fileName) {
  return mimeType === 'image/heic' || mimeType === 'image/heif' || /\.hei[cf]$/i.test(fileName || '')
}

export function jpegFileName(fileName) {
  const base = String(fileName || 'image').replace(/\.[^./\\]+$/, '')
  return `${base}.jpg`
}

// buffer -> { buffer, mimeType: 'image/jpeg', width, height, changed }.
// changed is false when the image was already a small enough JPEG.
export async function normalizeImageBuffer(buffer, { mimeType, fileName } = {}) {
  let image
  if (isHeic(mimeType, fileName)) {
    const decoded = await decodeHeic({ buffer })
    const pixels = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength)
    image = sharp(pixels, { raw: { width: decoded.width, height: decoded.height, channels: 4 } })
  } else {
    // .rotate() applies the EXIF orientation: a phone photo taken sideways
    // would otherwise be stored (and read by the model) sideways.
    image = sharp(buffer).rotate()
    const meta = await sharp(buffer).metadata()
    const longSide = Math.max(meta.width || 0, meta.height || 0)
    const upright = !meta.orientation || meta.orientation === 1
    if (
      meta.format === 'jpeg' &&
      upright &&
      longSide <= IMAGE_MAX_SIDE &&
      buffer.length <= IMAGE_MAX_BYTES_UNTOUCHED
    ) {
      return { buffer, mimeType: 'image/jpeg', width: meta.width, height: meta.height, changed: false }
    }
  }

  const { data, info } = await image
    .flatten({ background: '#ffffff' }) // a transparent PNG would turn black in a JPEG
    .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { buffer: data, mimeType: 'image/jpeg', width: info.width, height: info.height, changed: true }
}

// The stored document (a claimed client_documents row) -> the same row,
// pointing at the converted file when there was anything to convert.
export async function normalizeStoredImage(admin, document, bucket) {
  if (!isImageUpload(document.mime_type, document.file_name)) return document

  const { data: blob, error: downloadError } = await admin.storage.from(bucket).download(document.storage_path)
  if (downloadError) throw downloadError
  const original = Buffer.from(await blob.arrayBuffer())

  let result
  try {
    result = await normalizeImageBuffer(original, { mimeType: document.mime_type, fileName: document.file_name })
  } catch (error) {
    throw new Error(`Could not convert this image to JPEG (${error.message || 'unreadable file'}).`)
  }
  if (!result.changed) return document

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

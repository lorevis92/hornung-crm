// /api/files/<token> — the signed URLs of api/_storage.js.
//
//   PUT  <upload token>     the browser uploads ONE file to the path the
//                           server chose (api/_dataOps.js createUploadUrl);
//                           refused if it already exists (no overwrite).
//   GET  <download token>   streams the object from R2 (inline, or as an
//                           attachment named as the document when the token
//                           says so). Range requests work (the PDF viewer).
//
// A Workers fetch handler (Request -> Response), not a Vercel (req, res)
// one: the body is streamed, never buffered as JSON.
import { ALLOWED_UPLOAD_TYPES, FILES_BINDING, MAX_UPLOAD_BYTES, verifyFileToken } from './_storage.js'
import { runtimeBinding } from './_runtime.js'

const json = (status, error, code) =>
  new Response(JSON.stringify({ error, code, message: error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })

const EXTENSION_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
  txt: 'text/plain'
}

// The type the file is stored (and later served) with: what the browser
// said if it is one of the allowed ones; for a file the browser sent
// without a type (a .heic on Windows), the one its extension implies.
function uploadType(request, path) {
  const sent = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (ALLOWED_UPLOAD_TYPES.has(sent)) return sent
  if (!sent || sent === 'application/octet-stream') {
    const ext = path.split('.').pop().toLowerCase()
    return EXTENSION_TYPES[ext] || null
  }
  return null
}

function contentDisposition(kind, fileName) {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function handleFileRequest(request, token) {
  const bucket = runtimeBinding(FILES_BINDING)
  if (!bucket) return json(500, 'The FILES (R2) binding is not configured.', 'MISSING_FILES_BINDING')

  let claims
  try {
    claims = await verifyFileToken(token)
  } catch (error) {
    return json(500, error.message, error.code)
  }
  if (!claims) return json(403, 'This link is invalid or has expired.', 'INVALID_SIGNATURE')

  const method = request.method.toUpperCase()

  if (method === 'PUT' || method === 'POST') {
    if (claims.method !== 'PUT') return json(403, 'This link does not allow uploads.', 'INVALID_SIGNATURE')
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return json(413, 'The file is larger than 25 MB.', 'FILE_TOO_LARGE')
    }
    const type = uploadType(request, claims.path)
    if (!type) return json(415, 'This file type is not accepted.', 'INVALID_MIME_TYPE')
    if (await bucket.head(claims.path)) return json(409, 'The resource already exists.', 'Duplicate')
    const body = await request.arrayBuffer()
    if (body.byteLength > MAX_UPLOAD_BYTES) return json(413, 'The file is larger than 25 MB.', 'FILE_TOO_LARGE')
    if (!body.byteLength) return json(400, 'The file is empty.', 'EMPTY_FILE')
    await bucket.put(claims.path, body, { httpMetadata: { contentType: type } })
    return new Response(JSON.stringify({ Key: claims.path }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
  }

  if (method === 'GET' || method === 'HEAD') {
    if (claims.method !== 'GET') return json(403, 'This link does not allow downloads.', 'INVALID_SIGNATURE')
    const object = method === 'HEAD'
      ? await bucket.head(claims.path)
      : await bucket.get(claims.path, { range: request.headers })
    if (!object) return json(404, 'Object not found.', 'NotFound')

    const stored = object.httpMetadata?.contentType || ''
    // Only the accepted document types are ever served as themselves (with
    // nosniff, from the app's own origin); anything else is a download.
    const safeType = ALLOWED_UPLOAD_TYPES.has(stored) ? stored : 'application/octet-stream'
    const fileName = claims.download || claims.path.split('/').pop()
    const headers = new Headers({
      'Content-Type': safeType,
      'Content-Disposition': contentDisposition(claims.download || safeType === 'application/octet-stream' ? 'attachment' : 'inline', fileName),
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      ETag: object.httpEtag
    })
    let status = 200
    if (object.range && method === 'GET') {
      const offset = object.range.offset ?? (object.range.suffix ? object.size - object.range.suffix : 0)
      const length = object.range.length ?? object.size - offset
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
      headers.set('Content-Length', String(length))
      status = 206
    } else {
      headers.set('Content-Length', String(object.size))
    }
    return new Response(method === 'HEAD' ? null : object.body, { status, headers })
  }

  return json(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED')
}

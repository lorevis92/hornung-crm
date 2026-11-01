// File storage on Cloudflare R2 (the FILES bucket binding), behind the same
// small API the code used with Supabase Storage:
//
//   admin.storage.from(bucket).createSignedUploadUrl(path)    -> { signedUrl, token, path }
//   admin.storage.from(bucket).createSignedUrl(path, seconds, { download }) -> { signedUrl }
//   admin.storage.from(bucket).upload(path, bytes, { contentType, upsert })
//   admin.storage.from(bucket).download(path)                 -> Blob
//   admin.storage.from(bucket).list(prefix, { search, limit }) -> [{ id, name }] (id null = folder)
//   admin.storage.from(bucket).remove(paths)
//
// Signed URLs. R2 is private; the browser never gets an R2 credential.
// A signed URL points at THIS Worker — /api/files/<token> — where the token
// is the object key, the allowed method (GET or PUT), an expiry and the
// download file name, signed with HMAC-SHA256 under FILES_SIGNING_SECRET.
// api/files.js checks the signature and the expiry, then streams the object
// from / to R2. Same guarantees as Supabase's signed URLs: short-lived, one
// object, no session needed (so the viewer can open it in a new tab), and
// the path inside is chosen by the server, never by the browser.
//
// The bucket name argument is kept for compatibility; there is one bucket
// (wrangler.toml → [[r2_buckets]] binding "FILES").
import { runtimeBinding } from './_runtime.js'

export const FILES_BINDING = 'FILES'
// Same limits as the Supabase bucket (db/migrations/20260101000004_storage.sql).
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'text/plain'
])
const UPLOAD_URL_SECONDS = 2 * 60 * 60 // Supabase's signed upload URLs also lasted 2 h

function storageError(message, status = 400, code = 'STORAGE_ERROR') {
  return { message, status, statusCode: String(status), code }
}

function bucketBinding() {
  const bucket = runtimeBinding(FILES_BINDING)
  if (!bucket) {
    const error = new Error('The FILES (R2) binding is not configured — see wrangler.toml.')
    error.status = 500
    error.code = 'MISSING_FILES_BINDING'
    throw error
  }
  return bucket
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const encoder = new TextEncoder()

function base64url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text) {
  const binary = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function signingSecret() {
  const secret = process.env.FILES_SIGNING_SECRET
  if (!secret || secret.length < 32) {
    const error = new Error('FILES_SIGNING_SECRET is missing or shorter than 32 characters.')
    error.status = 500
    error.code = 'MISSING_FILES_SIGNING_SECRET'
    throw error
  }
  return secret
}

let cachedKey = null
async function hmacKey() {
  const secret = signingSecret()
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    }
  }
  return cachedKey.key
}

/** { path, method, exp (unix seconds), download? } -> URL-safe token */
export async function signFileToken(claims) {
  const body = base64url(encoder.encode(JSON.stringify(claims)))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(body)))
  return `${body}.${base64url(signature)}`
}

/** token -> claims, or null when forged, malformed or expired. */
export async function verifyFileToken(token, now = Date.now()) {
  const [body, signature, extra] = String(token || '').split('.')
  if (!body || !signature || extra !== undefined) return null
  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(), fromBase64url(signature), encoder.encode(body))
  } catch (error) {
    if (error.code === 'MISSING_FILES_SIGNING_SECRET') throw error
    return null
  }
  if (!valid) return null
  let claims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(body)))
  } catch {
    return null
  }
  if (!claims || typeof claims.path !== 'string' || !['GET', 'PUT'].includes(claims.method)) return null
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) return null
  return claims
}

export function fileUrl(token) {
  // Relative: the browser resolves it against the app's own origin.
  return `/api/files/${token}`
}

// ---------------------------------------------------------------------------
// The supabase-js-shaped API
// ---------------------------------------------------------------------------
function asBody(data) {
  if (data instanceof Uint8Array || data instanceof ArrayBuffer || data instanceof ReadableStream) return data
  if (data instanceof Blob) return data.stream()
  if (typeof data === 'string') return data
  return new Uint8Array(data)
}

export function storageClient() {
  return {
    from() {
      return {
        async createSignedUploadUrl(path) {
          try {
            const exp = Math.floor(Date.now() / 1000) + UPLOAD_URL_SECONDS
            const token = await signFileToken({ path, method: 'PUT', exp })
            return { data: { signedUrl: fileUrl(token), token, path }, error: null }
          } catch (error) {
            return { data: null, error: storageError(error.message, error.status || 500, error.code) }
          }
        },

        async createSignedUrl(path, seconds, { download } = {}) {
          try {
            const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(seconds) || 60)
            const claims = { path, method: 'GET', exp }
            if (download) claims.download = download === true ? path.split('/').pop() : String(download)
            const token = await signFileToken(claims)
            return { data: { signedUrl: fileUrl(token) }, error: null }
          } catch (error) {
            return { data: null, error: storageError(error.message, error.status || 500, error.code) }
          }
        },

        async upload(path, data, { contentType, upsert = false } = {}) {
          try {
            const bucket = bucketBinding()
            if (!upsert && (await bucket.head(path))) {
              return { data: null, error: storageError('The resource already exists', 409, 'Duplicate') }
            }
            await bucket.put(path, asBody(data), contentType ? { httpMetadata: { contentType } } : undefined)
            return { data: { path }, error: null }
          } catch (error) {
            return { data: null, error: storageError(error.message, error.status || 500, error.code) }
          }
        },

        async download(path) {
          try {
            const object = await bucketBinding().get(path)
            if (!object) return { data: null, error: storageError('Object not found', 404, 'NotFound') }
            const type = object.httpMetadata?.contentType || 'application/octet-stream'
            return { data: new Blob([await object.arrayBuffer()], { type }), error: null }
          } catch (error) {
            return { data: null, error: storageError(error.message, error.status || 500, error.code) }
          }
        },

        // Immediate children of a "folder" like Supabase's list(): files
        // with an id, sub-folders with id null.
        async list(prefix = '', { search = '', limit = 1000 } = {}) {
          try {
            const base = prefix ? `${String(prefix).replace(/\/$/, '')}/` : ''
            const items = []
            let cursor
            do {
              const page = await bucketBinding().list({ prefix: base, delimiter: '/', cursor, limit: 1000 })
              for (const folder of page.delimitedPrefixes || []) {
                items.push({ id: null, name: folder.slice(base.length).replace(/\/$/, '') })
              }
              for (const object of page.objects || []) {
                items.push({ id: object.key, name: object.key.slice(base.length), metadata: { size: object.size } })
              }
              cursor = page.truncated ? page.cursor : undefined
            } while (cursor && items.length < limit)
            const filtered = items.filter((item) => item.name.includes(search))
            return { data: filtered.slice(0, limit), error: null }
          } catch (error) {
            return { data: null, error: storageError(error.message, error.status || 500, error.code) }
          }
        },

        async remove(paths) {
          try {
            const list = (paths || []).filter(Boolean)
            // R2 deletes up to 1000 keys per call.
            for (let i = 0; i < list.length; i += 1000) await bucketBinding().delete(list.slice(i, i + 1000))
            return { data: list.map((name) => ({ name })), error: null }
          } catch (error) {
            return { data: null, error: storageError(error.message, error.status || 500, error.code) }
          }
        }
      }
    }
  }
}

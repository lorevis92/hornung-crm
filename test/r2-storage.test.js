// File storage on R2 (api/_storage.js + api/files.js): the signed URLs that
// replace Supabase Storage's, and the supabase-js-shaped API the server code
// uses. R2 is replaced by an in-memory bucket with the binding's methods
// (the real one runs in scripts/e2e-worker.mjs, inside wrangler dev).
import { beforeEach, describe, expect, it } from 'vitest'
import { setRuntime } from '../api/_runtime.js'
import { signFileToken, storageClient, verifyFileToken } from '../api/_storage.js'
import { handleFileRequest } from '../api/files.js'
import { createNodeResponse, toNodeRequest } from '../worker/vercelAdapter.js'

function memoryBucket() {
  const objects = new Map()
  const asObject = (key, entry) => ({
    key,
    size: entry.bytes.byteLength,
    httpEtag: '"e"',
    httpMetadata: entry.httpMetadata,
    body: new Blob([entry.bytes]).stream(),
    arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength)
  })
  return {
    objects,
    async head(key) {
      return objects.has(key) ? asObject(key, objects.get(key)) : null
    },
    async get(key) {
      return objects.has(key) ? asObject(key, objects.get(key)) : null
    },
    async put(key, value, options = {}) {
      const bytes = new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer())
      objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} })
    },
    async delete(keys) {
      for (const key of [].concat(keys)) objects.delete(key)
    },
    async list({ prefix = '', delimiter } = {}) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const folders = new Set()
      const files = []
      for (const key of keys) {
        const rest = key.slice(prefix.length)
        if (delimiter && rest.includes(delimiter)) folders.add(prefix + rest.split(delimiter)[0] + delimiter)
        else files.push({ key, size: objects.get(key).bytes.byteLength })
      }
      return { objects: files, delimitedPrefixes: [...folders], truncated: false }
    }
  }
}

let bucket
beforeEach(() => {
  process.env.FILES_SIGNING_SECRET = 'test-only-signing-secret-0123456789abcdef'
  bucket = memoryBucket()
  setRuntime({ env: { FILES: bucket } })
})

const storage = () => storageClient().from('client-documents')
const tokenOf = (signedUrl) => signedUrl.replace('/api/files/', '')

describe('signed file tokens', () => {
  it('round-trip, and any change to them is refused', async () => {
    const token = await signFileToken({ path: 'hornung/c/2025/client_upload/a.pdf', method: 'GET', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(await verifyFileToken(token)).toMatchObject({ path: 'hornung/c/2025/client_upload/a.pdf', method: 'GET' })
    const [body, sig] = token.split('.')
    const otherBody = Buffer.from(JSON.stringify({ path: 'hornung/OTHER/x.pdf', method: 'GET', exp: 9999999999 })).toString('base64url')
    expect(await verifyFileToken(`${otherBody}.${sig}`)).toBeNull()
    expect(await verifyFileToken(`${body}.${sig.slice(0, -2)}xx`)).toBeNull()
    expect(await verifyFileToken('garbage')).toBeNull()
  })

  it('expire', async () => {
    const token = await signFileToken({ path: 'a', method: 'GET', exp: Math.floor(Date.now() / 1000) - 1 })
    expect(await verifyFileToken(token)).toBeNull()
  })

  it('are refused under another secret', async () => {
    const token = await signFileToken({ path: 'a', method: 'GET', exp: Math.floor(Date.now() / 1000) + 60 })
    process.env.FILES_SIGNING_SECRET = 'another-secret-another-secret-0123456789'
    expect(await verifyFileToken(token)).toBeNull()
  })

  it('without a (long enough) secret nothing is signed', async () => {
    process.env.FILES_SIGNING_SECRET = 'short'
    const { error } = await storage().createSignedUrl('a', 60)
    expect(error.code).toBe('MISSING_FILES_SIGNING_SECRET')
  })
})

describe('upload and download through /api/files/<token>', () => {
  it('upload once to the path the server chose, then read it back', async () => {
    const { data } = await storage().createSignedUploadUrl('hornung/c/2025/client_upload/u-scan.pdf')
    const pdf = new TextEncoder().encode('%PDF-1.7 test')
    const put = (body, type = 'application/pdf') =>
      handleFileRequest(new Request(`https://app.test${data.signedUrl}`, { method: 'PUT', headers: { 'content-type': type }, body }), tokenOf(data.signedUrl))
    expect((await put(pdf)).status).toBe(200)
    expect((await put(pdf)).status).toBe(409) // no overwrite, like x-upsert: false

    const { data: link } = await storage().createSignedUrl('hornung/c/2025/client_upload/u-scan.pdf', 300, { download: 'Lohnausweis 2025.pdf' })
    const res = await handleFileRequest(new Request(`https://app.test${link.signedUrl}`), tokenOf(link.signedUrl))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="Lohnausweis 2025.pdf"/)
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('%PDF-1.7 test')
  })

  it('a download link cannot upload, an upload link cannot download', async () => {
    const { data: up } = await storage().createSignedUploadUrl('k/a.pdf')
    const { data: down } = await storage().createSignedUrl('k/a.pdf', 60)
    expect((await handleFileRequest(new Request('https://app.test/x', { method: 'GET' }), tokenOf(up.signedUrl))).status).toBe(403)
    const putWithDownload = new Request('https://app.test/x', { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: 'x' })
    expect((await handleFileRequest(putWithDownload, tokenOf(down.signedUrl))).status).toBe(403)
  })

  it('only the accepted document types, at most 25 MB', async () => {
    const { data } = await storage().createSignedUploadUrl('k/page.html')
    const html = new Request('https://app.test/x', { method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<script>alert(1)</script>' })
    expect((await handleFileRequest(html, tokenOf(data.signedUrl))).status).toBe(415)
    const huge = new Request('https://app.test/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'content-length': String(26 * 1024 * 1024) },
      body: 'x'
    })
    expect((await handleFileRequest(huge, tokenOf(data.signedUrl))).status).toBe(413)
  })

  it('a .heic sent without a type (Windows) is accepted and stored as image/heic', async () => {
    const { data } = await storage().createSignedUploadUrl('k/IMG_1.HEIC')
    const res = await handleFileRequest(new Request('https://app.test/x', { method: 'PUT', body: new Uint8Array([1, 2, 3]) }), tokenOf(data.signedUrl))
    expect(res.status).toBe(200)
    expect(bucket.objects.get('k/IMG_1.HEIC').httpMetadata.contentType).toBe('image/heic')
  })

  it('a stored file of any other type is only ever served as a download', async () => {
    await bucket.put('k/odd.bin', new Uint8Array([1]), { httpMetadata: { contentType: 'text/html' } })
    const { data } = await storage().createSignedUrl('k/odd.bin', 60)
    const res = await handleFileRequest(new Request('https://app.test/x'), tokenOf(data.signedUrl))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
  })
})

describe('the supabase-js-shaped API on R2', () => {
  it('upload / download / list (files and folders) / remove', async () => {
    const s = storage()
    expect((await s.upload('hornung/c1/2025/client_upload/a.jpg', new Uint8Array([9, 9]), { contentType: 'image/jpeg' })).error).toBeNull()
    expect((await s.upload('hornung/c1/2025/client_upload/a.jpg', new Uint8Array([1]))).error.statusCode).toBe('409')
    expect((await s.upload('hornung/c1/2025/client_upload/a.jpg', new Uint8Array([7]), { upsert: true })).error).toBeNull()
    await s.upload('hornung/c1/2024/specialist_upload/b.pdf', new Uint8Array([1]))

    const blob = (await s.download('hornung/c1/2025/client_upload/a.jpg')).data
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([7])
    expect((await s.download('nope')).error.statusCode).toBe('404')

    const top = (await s.list('hornung/c1')).data
    expect(top).toEqual([{ id: null, name: '2024' }, { id: null, name: '2025' }])
    const files = (await s.list('hornung/c1/2025/client_upload', { search: 'a.j' })).data
    expect(files.map((f) => [f.id, f.name])).toEqual([['hornung/c1/2025/client_upload/a.jpg', 'a.jpg']])

    await s.remove(['hornung/c1/2025/client_upload/a.jpg', 'hornung/c1/2024/specialist_upload/b.pdf'])
    expect(bucket.objects.size).toBe(0)
  })
})

describe('worker/vercelAdapter.js', () => {
  it('turns a Request into the req the handlers read, and res back into a Response with every cookie', async () => {
    const request = new Request('https://app.test/api/data/listClients?x=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://app.test', Cookie: 'hc_session=abc' },
      body: JSON.stringify({ a: 1 })
    })
    const req = await toNodeRequest(request, { op: 'listClients' })
    expect(req).toMatchObject({ method: 'POST', url: '/api/data/listClients?x=1', query: { x: '1', op: 'listClients' }, body: { a: 1 } })
    expect(req.headers.origin).toBe('https://app.test')
    expect(req.headers.cookie).toBe('hc_session=abc')

    const { res, toResponse } = createNodeResponse()
    res.setHeader('Set-Cookie', ['a=1; Path=/'])
    res.setHeader('Set-Cookie', [...res.getHeader('Set-Cookie'), 'b=2; Path=/'])
    res.status(201).json({ ok: true })
    const response = toResponse()
    expect(response.status).toBe(201)
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(await response.json()).toEqual({ ok: true })
  })

  it('a redirect (writeHead + end) stays a redirect', async () => {
    const { res, toResponse } = createNodeResponse()
    res.writeHead(302, { Location: 'https://app.test/login?confirmed=1' })
    res.end()
    const response = toResponse()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://app.test/login?confirmed=1')
  })
})

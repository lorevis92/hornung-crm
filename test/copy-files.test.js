// scripts/copy-files-to-r2.mjs — the one-time copy of the document files
// from Supabase Storage to R2 — against an in-memory Supabase Storage API and
// an in-memory R2 (S3) endpoint.
import { describe, expect, it } from 'vitest'
import { copyFiles, listSupabaseFiles } from '../scripts/copy-files-to-r2.mjs'

const SUPABASE = 'https://ref.supabase.test'
const R2 = 'https://acct.r2.test/hornung-client-documents'

function fakeSupabase(files) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.authorization })
    if (url === `${SUPABASE}/storage/v1/object/list/client-documents`) {
      const { prefix } = JSON.parse(init.body)
      const children = new Map()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(`${prefix}/`)) continue
        const [name, ...rest] = path.slice(prefix.length + 1).split('/')
        children.set(name, rest.length ? { name, id: null } : { name, id: `id-${path}`, metadata: { size: files[path].length, mimetype: 'application/pdf' } })
      }
      return Response.json([...children.values()])
    }
    const prefix = `${SUPABASE}/storage/v1/object/client-documents/`
    if (url.startsWith(prefix)) {
      const path = url.slice(prefix.length).split('/').map(decodeURIComponent).join('/')
      return files[path] ? new Response(files[path]) : new Response('nope', { status: 404 })
    }
    return new Response('unexpected', { status: 500 })
  }
  return { fetchImpl, calls }
}

function fakeR2() {
  const objects = new Map()
  return {
    objects,
    async fetch(url, init = {}) {
      const key = url.slice(R2.length + 1).split('/').map(decodeURIComponent).join('/')
      if (init.method === 'HEAD') {
        return objects.has(key) ? new Response(null, { headers: { 'content-length': String(objects.get(key).length) } }) : new Response(null, { status: 404 })
      }
      if (init.method === 'PUT') {
        objects.set(key, init.body)
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 400 })
    }
  }
}

const files = {
  'hornung/c1/2025/client_upload/a b.pdf': new Uint8Array([1, 2, 3]),
  'hornung/c1/2025/specialist_upload/c.pdf': new Uint8Array([4]),
  'hornung/c2/2024/client_upload/d.pdf': new Uint8Array([5, 6])
}

describe('copying the files from Supabase Storage to R2', () => {
  it('lists every file under hornung/, through the folder entries', async () => {
    const { fetchImpl } = fakeSupabase(files)
    const listed = await listSupabaseFiles({ supabaseUrl: SUPABASE, key: 'k', fetchImpl })
    expect(listed.map((f) => f.path).sort()).toEqual(Object.keys(files).sort())
  })

  it('copies each one to the same key, then skips them on a second run', async () => {
    const { fetchImpl } = fakeSupabase(files)
    const r2 = fakeR2()
    const first = await copyFiles({ supabaseUrl: SUPABASE, key: 'k', r2, r2Endpoint: R2, fetchImpl, log: () => {} })
    expect(first).toMatchObject({ total: 3, copied: 3, skipped: 0, failed: [] })
    expect([...r2.objects.keys()].sort()).toEqual(Object.keys(files).sort())
    expect([...r2.objects.get('hornung/c1/2025/client_upload/a b.pdf')]).toEqual([1, 2, 3])
    const second = await copyFiles({ supabaseUrl: SUPABASE, key: 'k', r2, r2Endpoint: R2, fetchImpl, log: () => {} })
    expect(second).toMatchObject({ copied: 0, skipped: 3 })
  })

  it('--dry-run writes nothing', async () => {
    const { fetchImpl, calls } = fakeSupabase(files)
    const r2 = fakeR2()
    await copyFiles({ supabaseUrl: SUPABASE, key: 'k', r2, r2Endpoint: R2, fetchImpl, dryRun: true, log: () => {} })
    expect(r2.objects.size).toBe(0)
    expect(calls.every((c) => c.url.includes('/object/list/'))).toBe(true) // nothing downloaded either
  })
})

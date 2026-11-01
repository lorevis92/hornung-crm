// One-time copy of every document file from Supabase Storage (bucket
// "client-documents") to the R2 bucket of the Worker, keeping each object's
// path — so the storage_path stored on case_documents / client_documents
// keeps pointing at the same file.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   [R2_BUCKET=hornung-client-documents] \
//     node scripts/copy-files-to-r2.mjs [--dry-run]
//
// Re-runnable: an object already in R2 with the same size is skipped.
// Only reads from Supabase. Credentials come from the environment and are
// never printed. Only the hornung/ tree is copied (the bucket layout of
// db/migrations/20260101000004_storage.sql).
import { AwsClient } from 'aws4fetch'

export const BUCKET = 'client-documents'
export const ROOT = 'hornung'

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/')

/** Every file under `prefix` in a Supabase Storage bucket: [{ path, size, type }]. */
export async function listSupabaseFiles({ supabaseUrl, key, fetchImpl = fetch, prefix = ROOT, bucket = BUCKET }) {
  const files = []
  const walk = async (folder) => {
    for (let offset = 0; ; offset += 1000) {
      const res = await fetchImpl(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      })
      if (!res.ok) throw new Error(`Supabase list ${folder}: HTTP ${res.status}`)
      const items = await res.json()
      for (const item of items) {
        const path = `${folder}/${item.name}`
        // Supabase returns "folders" as entries without an id.
        if (item.id === null || item.id === undefined) await walk(path)
        else files.push({ path, size: Number(item.metadata?.size ?? -1), type: item.metadata?.mimetype || 'application/octet-stream' })
      }
      if (items.length < 1000) break
    }
  }
  await walk(prefix)
  return files
}

export async function copyFiles({ supabaseUrl, key, r2, r2Endpoint, fetchImpl = fetch, dryRun = false, log = console.log }) {
  const files = await listSupabaseFiles({ supabaseUrl, key, fetchImpl })
  const summary = { total: files.length, copied: 0, skipped: 0, failed: [] }
  for (const file of files) {
    const target = `${r2Endpoint}/${encodePath(file.path)}`
    try {
      const head = await r2.fetch(target, { method: 'HEAD' })
      if (head.ok && Number(head.headers.get('content-length')) === file.size) {
        summary.skipped++
        continue
      }
      if (dryRun) {
        log(`would copy ${file.path} (${file.size} bytes)`)
        continue
      }
      const download = await fetchImpl(`${supabaseUrl}/storage/v1/object/${BUCKET}/${encodePath(file.path)}`, {
        headers: { authorization: `Bearer ${key}`, apikey: key }
      })
      if (!download.ok) throw new Error(`download HTTP ${download.status}`)
      const body = new Uint8Array(await download.arrayBuffer())
      if (file.size >= 0 && body.byteLength !== file.size) throw new Error(`size ${body.byteLength} != ${file.size}`)
      const put = await r2.fetch(target, { method: 'PUT', body, headers: { 'content-type': file.type } })
      if (!put.ok) throw new Error(`R2 PUT HTTP ${put.status}`)
      summary.copied++
      log(`copied ${file.path}`)
    } catch (error) {
      summary.failed.push({ path: file.path, error: error.message })
      log(`FAILED ${file.path}: ${error.message}`)
    }
  }
  return summary
}

if (process.argv[1]?.endsWith('copy-files-to-r2.mjs')) {
  const env = process.env
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !env[k])
  if (missing.length) {
    console.error(`Missing in the environment: ${missing.join(', ')} (see docs/MIGRAZIONE-CLOUDFLARE.md).`)
    process.exit(1)
  }
  const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
  const r2Endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET || 'hornung-client-documents'}`
  const summary = await copyFiles({
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    r2,
    r2Endpoint,
    dryRun: process.argv.includes('--dry-run')
  })
  console.log(JSON.stringify({ ...summary, failed: summary.failed.length }, null, 2))
  if (summary.failed.length) {
    console.error(summary.failed)
    process.exit(1)
  }
}

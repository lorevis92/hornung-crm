// Runs automatically after `npm run build` (via the "postbuild" npm
// lifecycle hook — see package.json) and fails the build if the client
// bundle contains anything that looks like a privileged Supabase
// credential. This exists because VITE_SUPABASE_ANON_KEY was once
// misconfigured in Vercel with the service_role key's value instead of the
// anon key's — Vite faithfully baked it into the public bundle, shipping
// full database access (RLS bypass) to every visitor's browser. Nothing in
// this app's own source caused that (src/lib/config.js and
// src/lib/supabaseClient.js only ever read VITE_SUPABASE_ANON_KEY), so this
// check can't catch a *code* regression — it exists to catch the
// *configuration* mistake recurring, which is exactly what actually
// happened. src/lib/config.js also now refuses to use a key that looks
// privileged in the first place; this is the second, independent layer —
// checking the artifact that's actually deployed, not just the code that
// produced it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST_DIR = 'dist'

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(js|mjs|html|css|json|map)$/i.test(entry)) out.push(full)
  }
  return out
}

function decodeJwtRole(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return payload?.role || null
  } catch {
    return null
  }
}

let files
try {
  files = walk(DIST_DIR)
} catch (error) {
  console.error(`[check-bundle-secrets] Could not read "${DIST_DIR}" — did the build actually run first?`, error.message)
  process.exit(1)
}

const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g
// A real key: the prefix followed by an actual token body. The bare prefix
// string alone (e.g. "sb_secret_") legitimately appears in the Supabase SDK's
// own key-format detector and in this app's own guard (src/lib/config.js) —
// matching on that alone flags perfectly safe code, not a leaked credential.
const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]{16,}/g
// Likewise, "SUPABASE_SERVICE_ROLE_KEY" as an env var NAME only ever matters
// paired with a real value next to it (an inlined `process.env.X="...")
// replacement, or an accidental `define`) — the bare identifier alone is
// exactly what api/_lib.js's own source comments/code legitimately contain,
// and api/ is never part of the client bundle in the first place.
const SERVICE_ROLE_NAME_WITH_VALUE_PATTERN = /SUPABASE_SERVICE_ROLE_KEY["'\s]*[:=]\s*["'][^"']{10,}["']/g
const findings = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')

  for (const match of text.matchAll(SERVICE_ROLE_NAME_WITH_VALUE_PATTERN)) {
    findings.push(`${file}: "SUPABASE_SERVICE_ROLE_KEY" appears paired with an inlined value: ${match[0].slice(0, 40)}…`)
  }
  for (const match of text.matchAll(SECRET_KEY_PATTERN)) {
    findings.push(`${file}: contains a real Supabase secret key (${match[0].slice(0, 18)}…)`)
  }
  for (const match of text.matchAll(JWT_PATTERN)) {
    const role = decodeJwtRole(match[0])
    if (role === 'service_role') {
      findings.push(`${file}: contains a Supabase JWT with "role":"service_role"`)
    }
  }
}

if (findings.length) {
  console.error('\n🚨 [check-bundle-secrets] Privileged Supabase credential(s) found in the build output:\n')
  for (const f of findings) console.error('  -', f)
  console.error(
    '\nThis build output must never be deployed. Check the VITE_SUPABASE_ANON_KEY / ' +
      'VITE_SUPABASE_URL environment variables in Vercel — one of them likely holds a ' +
      'service_role/secret key instead of the public anon/publishable key.\n'
  )
  process.exit(1)
}

console.log(`[check-bundle-secrets] OK — scanned ${files.length} file(s) in ${DIST_DIR}/, no privileged Supabase credentials found.`)

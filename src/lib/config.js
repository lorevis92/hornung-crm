// Central configuration.
// If the Supabase variables are missing the app boots in DEMO MODE: everything
// works against seeded local data so the UI can be reviewed before the backend
// is connected.

// A valid Supabase project URL always looks like https://<ref>.supabase.co
// (no extra characters glued onto the host). Validating it here means a
// mistyped/corrupted VITE_SUPABASE_URL env var fails loudly, in the console,
// with a clear message — instead of silently sending every request to a
// non-existent host (ERR_NAME_NOT_RESOLVED) that's hard to trace back to
// "the env var is wrong".
const RAW_SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/i

function resolveSupabaseUrl() {
  if (!RAW_SUPABASE_URL) return ''
  if (!SUPABASE_URL_PATTERN.test(RAW_SUPABASE_URL)) {
    console.error(
      `[config] VITE_SUPABASE_URL doesn't look like a valid Supabase project URL: "${RAW_SUPABASE_URL}". ` +
        'Expected something like "https://xxxxxxxxxxxxxxxxxxxx.supabase.co" with no extra characters. ' +
        'Falling back to demo mode until this is fixed on Vercel (Settings → Environment Variables).'
    )
    return ''
  }
  return RAW_SUPABASE_URL.replace(/\/$/, '')
}

export const SUPABASE_URL = resolveSupabaseUrl()
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const APP_ID = import.meta.env.VITE_APP_ID || 'hornung_crm'

export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY

export const STORAGE_BUCKET = 'client-documents'
export const STORAGE_ROOT = 'hornung'

export const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB — keep in sync with the bucket
export const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'text/plain'
]

export const CONTACT = {
  company: 'Hornung Consulting',
  email: 'hornungconsulting@gmail.com',
  phone: '+41 79 864 29 65'
}

/**
 * The tax year currently being filed. In Switzerland the declaration for year
 * N is filed during year N+1, so the default is "last calendar year".
 */
export function currentTaxYear() {
  const override = import.meta.env.VITE_CURRENT_TAX_YEAR
  if (override && /^\d{4}$/.test(override)) return Number(override)
  return new Date().getFullYear() - 1
}

// Feature flags — code stays in place, disabled until the future phase that
// needs it is switched on.
export const FEATURES = {
  requestedDocumentsChecklist: false, // fase futura: checklist personalizzata per cliente
  clientFeeEstimate: false,           // fase futura: stima onorario visibile al cliente
  // Quando true, ogni nuova registrazione cliente (self sign-up da /register)
  // manda una mail di cortesia allo specialista (OWNER_EMAIL) con l'indirizzo
  // del nuovo iscritto. Letta anche (ridichiarata minimale) da
  // api/claim-profile.js, che gira in Node e non può importare questo file.
  notifySpecialistOnSelfRegistration: false
}

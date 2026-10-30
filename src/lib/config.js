// Central configuration.
// DEMO MODE (no backend: everything works against seeded local data, so the
// UI can be reviewed before anything is connected):
//   VITE_DEMO_MODE=true   -> demo
//   VITE_DEMO_MODE=false  -> live (talks to our own /api functions)
//   unset                 -> live only if VITE_SUPABASE_URL is set, so the
//                            existing Vercel / local env files keep working
//                            unchanged.
// The browser itself never connects to the database or reads any database
// key any more: every read/write goes through /api (session cookie + access
// checks server-side, see api/_dataOps.js). That also means no Supabase key
// is compiled into the bundle at all — scripts/check-bundle-secrets.mjs still
// verifies that after every build.
const DEMO_FLAG = String(import.meta.env.VITE_DEMO_MODE || '').trim().toLowerCase()
const HAS_LEGACY_BACKEND_ENV = Boolean(String(import.meta.env.VITE_SUPABASE_URL || '').trim())

export const APP_ID = import.meta.env.VITE_APP_ID || 'hornung_crm'

export const IS_DEMO = DEMO_FLAG === 'true' || (DEMO_FLAG !== 'false' && !HAS_LEGACY_BACKEND_ENV)

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

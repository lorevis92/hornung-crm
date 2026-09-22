// Central configuration.
// If the Supabase variables are missing the app boots in DEMO MODE: everything
// works against seeded local data so the UI can be reviewed before the backend
// is connected.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

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
  clientFeeEstimate: false            // fase futura: stima onorario visibile al cliente
}

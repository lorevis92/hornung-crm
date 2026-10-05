// Shared enums / display metadata.

export const CASE_STATUSES = ['opened', 'waiting_client', 'in_process', 'review', 'finished']

// Order in which the client sees the progress bar.
export const STATUS_STEPS = ['opened', 'in_process', 'review', 'finished']

export const STATUS_META = {
  opened: {
    tone: 'neutral',
    dot: 'bg-ink-300',
    chip: 'bg-ink-100 text-ink-700 ring-ink-200'
  },
  waiting_client: {
    tone: 'warning',
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 ring-amber-200'
  },
  in_process: {
    tone: 'info',
    dot: 'bg-gold-500',
    chip: 'bg-gold-50 text-gold-800 ring-gold-200'
  },
  review: {
    tone: 'info',
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-800 ring-sky-200'
  },
  finished: {
    tone: 'success',
    dot: 'bg-emerald-600',
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200'
  }
}

export const DOC_CATEGORIES = ['base', 'income', 'deductions', 'assets', 'property', 'other']

// Case statuses during which a client may delete a document they uploaded
// themselves. Mirrors public.case_is_open_for_client() in
// supabase/migrations/20260101000003_hornung_rls.sql exactly ("documents:
// client delete own" policy) — keep both lists in sync if either changes.
// NOTE: uploading is intentionally NOT gated by this anymore — clients can
// always upload regardless of status (see the "documents: client upload"
// policy and api/notify-late-upload.js, which alerts staff instead).
export const CLIENT_DELETE_OPEN_STATUSES = ['opened', 'waiting_client', 'in_process']

// How long Login.jsx / Register.jsx wait, after a successful sign-in, for the
// app profile to resolve (app_profiles lookup + the /api/claim-profile
// fallback in AuthContext) before giving up and showing an explicit error
// instead of leaving the spinner running forever.
export const PROFILE_WAIT_TIMEOUT_MS = 12000

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' }
]

export const MARITAL_STATUSES = [
  'single',
  'married',
  'registered_partnership',
  'separated',
  'divorced',
  'widowed'
]

export const PERMIT_TYPES = ['B', 'C', 'L', 'G', 'Ci', 'CH', 'other']

export const CANTONS = [
  'AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE','NW','OW',
  'SG','SH','SO','SZ','TG','TI','UR','VD','VS','ZG','ZH'
]

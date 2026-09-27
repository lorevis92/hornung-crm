// Maps a "current_tax_sheet" document's extracted fields onto the client's
// registry data (clients.canton, client_persons primary/spouse) — a pure
// function with no I/O, shared between api/_personalDetails.js (real
// Supabase data, server-side) and the demo data layer, same reasoning as
// src/lib/taxCalculation.js. Given the extraction and the client's current
// registry state, it decides — for each mappable field — whether to fill
// it in (currently empty) or flag a conflict for the specialist to accept
// or ignore (currently holds a different value). It never touches the
// database itself.

// Splits "First Middle Last" into { first: 'First', last: 'Middle Last' } —
// same convention as Account.jsx's splitFullName, duplicated here (it's a
// three-line pure helper, not worth a cross-import for).
function splitFullName(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] || '', last: parts.slice(1).join(' ') }
}

const MARITAL_SYNONYMS = {
  single: ['single', 'ledig', 'célibataire', 'celibataire', 'celibe', 'nubile'],
  married: ['married', 'verheiratet', 'marié', 'marie', 'mariée', 'mariee', 'coniugato', 'coniugata'],
  registered_partnership: [
    'registered partnership', 'eingetragene partnerschaft', 'partenariat enregistré',
    'partenariat enregistre', 'unione domestica registrata'
  ],
  separated: ['separated', 'getrennt', 'séparé', 'separe', 'séparée', 'separee', 'separato', 'separata'],
  divorced: ['divorced', 'geschieden', 'divorcé', 'divorce', 'divorcée', 'divorcee', 'divorziato', 'divorziata'],
  widowed: ['widowed', 'verwitwet', 'veuf', 'veuve', 'vedovo', 'vedova']
}

// Extraction can come back in any of the app's four languages — only
// applied when it confidently matches a known term; an unrecognized value
// is skipped rather than guessed at (marital_status is a constrained
// dropdown in the UI, so writing an arbitrary string would just show up as
// unselected).
function normalizeMaritalStatus(raw) {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  for (const [key, synonyms] of Object.entries(MARITAL_SYNONYMS)) {
    if (synonyms.includes(v)) return key
  }
  return null
}

// extractedFields: extracted_document_fields rows for ONE current_tax_sheet
//   document (needs field_key, field_value).
// canton: the client's current clients.canton (string or null/undefined).
// primary/spouse: the client's current client_persons rows for that
//   person_type, or null/undefined if that record doesn't exist yet.
//
// Returns:
//   autoFill    — fields with no current value: [{ table, person, field, value }]
//   suggestions — fields with a DIFFERENT current value, needing a
//                 specialist decision: [{ table, person, field, fieldLabel,
//                 currentValue, suggestedValue }]
//   resolved    — fields extracted here whose value now matches the current
//                 one exactly, so a stale pending suggestion (if any) is no
//                 longer relevant: [{ table, person, field }]
export function computePersonalDetailsSync({ extractedFields, canton, primary, spouse }) {
  const byKey = Object.fromEntries((extractedFields || []).map((f) => [f.field_key, f.field_value]))

  const autoFill = []
  const suggestions = []
  const resolved = []

  const consider = (table, person, field, fieldLabel, rawValue, currentValue) => {
    if (!rawValue || !String(rawValue).trim()) return
    const value = String(rawValue).trim()
    const current = currentValue == null ? '' : String(currentValue).trim()
    if (!current) {
      autoFill.push({ table, person, field, value })
    } else if (current !== value) {
      suggestions.push({ table, person, field, fieldLabel, currentValue: current, suggestedValue: value })
    } else {
      resolved.push({ table, person, field })
    }
  }

  consider('clients', 'none', 'canton', 'Canton', byKey.canton, canton)

  if (byKey.full_name) {
    const { first, last } = splitFullName(byKey.full_name)
    consider('client_persons', 'primary', 'first_name', 'First name', first, primary?.first_name)
    consider('client_persons', 'primary', 'last_name', 'Last name', last, primary?.last_name)
  }
  consider('client_persons', 'primary', 'date_of_birth', 'Date of birth', byKey.date_of_birth, primary?.date_of_birth)
  const normalizedMarital = normalizeMaritalStatus(byKey.marital_status)
  if (normalizedMarital) {
    consider('client_persons', 'primary', 'marital_status', 'Marital status', normalizedMarital, primary?.marital_status)
  }
  consider(
    'client_persons', 'primary', 'religious_denomination', 'Religious denomination',
    byKey.religious_affiliation, primary?.religious_denomination
  )

  if (byKey.partner_full_name) {
    const { first, last } = splitFullName(byKey.partner_full_name)
    consider('client_persons', 'spouse', 'first_name', "Partner's first name", first, spouse?.first_name)
    consider('client_persons', 'spouse', 'last_name', "Partner's last name", last, spouse?.last_name)
  }
  consider(
    'client_persons', 'spouse', 'date_of_birth', "Partner's date of birth",
    byKey.partner_date_of_birth, spouse?.date_of_birth
  )
  consider(
    'client_persons', 'spouse', 'religious_denomination', "Partner's religious denomination",
    byKey.partner_religious_affiliation, spouse?.religious_denomination
  )

  return { autoFill, suggestions, resolved }
}

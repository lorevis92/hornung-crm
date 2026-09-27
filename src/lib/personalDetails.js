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

// Italian (and to a lesser extent French) marital-status adjectives agree in
// number — a real Swiss tax document describing a couple jointly reads
// "Coniugati dal 2016", not the singular "coniugato" this list originally
// only had. Both singular and plural forms are listed explicitly (matched
// as whole words, see normalizeMaritalStatus below, so the surrounding
// "dal 2016" doesn't prevent a match).
const MARITAL_SYNONYMS = {
  single: ['single', 'ledig', 'célibataire', 'celibataire', 'celibe', 'nubile'],
  married: [
    'married', 'verheiratet', 'marié', 'marie', 'mariée', 'mariee', 'mariés', 'maries', 'mariées', 'mariees',
    'coniugato', 'coniugata', 'coniugati', 'coniugate'
  ],
  registered_partnership: [
    'registered partnership', 'eingetragene partnerschaft', 'partenariat enregistré',
    'partenariat enregistre', 'unione domestica registrata'
  ],
  separated: [
    'separated', 'getrennt', 'séparé', 'separe', 'séparée', 'separee', 'séparés', 'separes', 'séparées', 'separees',
    'separato', 'separata', 'separati', 'separate'
  ],
  divorced: [
    'divorced', 'geschieden', 'divorcé', 'divorce', 'divorcée', 'divorcee', 'divorcés', 'divorces', 'divorcées', 'divorcees',
    'divorziato', 'divorziata', 'divorziati', 'divorziate'
  ],
  widowed: ['widowed', 'verwitwet', 'veuf', 'veuve', 'veufs', 'veuves', 'vedovo', 'vedova', 'vedovi', 'vedove']
}

// Extraction can come back in any of the app's four languages — only
// applied when it confidently matches a known term; an unrecognized value
// is skipped rather than guessed at (marital_status is a constrained
// dropdown in the UI, so writing an arbitrary string would just show up as
// unselected).
function normalizeMaritalStatus(raw) {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  // Exact match first (the common case — extraction returns just the
  // status word). Real documents often add context instead ("Coniugati dal
  // 2016", "Married since 2018") — a whole-word match anywhere in the
  // string catches those too, without e.g. "separated" matching inside an
  // unrelated longer word.
  for (const [key, synonyms] of Object.entries(MARITAL_SYNONYMS)) {
    if (synonyms.includes(v)) return key
  }
  for (const [key, synonyms] of Object.entries(MARITAL_SYNONYMS)) {
    if (synonyms.some((syn) => new RegExp(`(?:^|[^\\p{L}])${syn}(?:$|[^\\p{L}])`, 'iu').test(v))) return key
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
// Fields where the extraction's own confidence, when high enough, is
// trusted to overwrite an existing (different) value outright instead of
// sitting as a pending suggestion. Reserved for structural data the
// calculation engine itself depends on — marital status directly gates
// which tax_parameters rows apply (e.g. the wealth-exempt amount, several
// social deductions) — not for identity fields like a name, which stay
// conservative even at high confidence. Below this confidence, or when the
// extraction carried no confidence at all, the normal suggest-on-conflict
// path still applies.
const FORCE_APPLY_THRESHOLD = 0.75
const FORCE_APPLY_FIELDS = new Set(['marital_status'])

export function computePersonalDetailsSync({ extractedFields, canton, primary, spouse }) {
  const byKey = Object.fromEntries((extractedFields || []).map((f) => [f.field_key, f.field_value]))
  const confidenceByKey = Object.fromEntries((extractedFields || []).map((f) => [f.field_key, f.confidence]))

  const autoFill = []
  const suggestions = []
  const resolved = []

  const consider = (table, person, field, fieldLabel, rawValue, currentValue, sourceFieldKey) => {
    if (!rawValue || !String(rawValue).trim()) return
    const value = String(rawValue).trim()
    const current = currentValue == null ? '' : String(currentValue).trim()
    const confidence = sourceFieldKey ? confidenceByKey[sourceFieldKey] : null
    const forceApply =
      FORCE_APPLY_FIELDS.has(field) && (confidence == null || confidence >= FORCE_APPLY_THRESHOLD)
    if (!current || (forceApply && current !== value)) {
      autoFill.push({ table, person, field, value })
    } else if (current !== value) {
      suggestions.push({ table, person, field, fieldLabel, currentValue: current, suggestedValue: value })
    } else {
      resolved.push({ table, person, field })
    }
  }

  consider('clients', 'none', 'canton', 'Canton', byKey.canton, canton, 'canton')

  if (byKey.full_name) {
    const { first, last } = splitFullName(byKey.full_name)
    consider('client_persons', 'primary', 'first_name', 'First name', first, primary?.first_name)
    consider('client_persons', 'primary', 'last_name', 'Last name', last, primary?.last_name)
  }
  consider('client_persons', 'primary', 'date_of_birth', 'Date of birth', byKey.date_of_birth, primary?.date_of_birth)
  const normalizedMarital = normalizeMaritalStatus(byKey.marital_status)
  if (normalizedMarital) {
    consider(
      'client_persons', 'primary', 'marital_status', 'Marital status',
      normalizedMarital, primary?.marital_status, 'marital_status'
    )
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

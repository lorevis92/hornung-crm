// Maps a "current_tax_sheet" document's extracted fields onto the client's
// registry data (clients.canton, client_persons primary/spouse) — a pure
// function with no I/O, shared between api/_personalDetails.js (real
// Supabase data, server-side) and the demo data layer. Given the
// extraction and the client's current
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

// clients.canton is the short code (src/lib/constants.js's CANTONS list —
// "VS", "GE", ...) — but a document's own text names the canton out in
// whatever language it's written in ("Vallese"/"Wallis"/"Valais"), and
// nothing about the extraction constrains the AI to the short form. Writing
// that name straight into clients.canton would leave a value no canton
// selector in the app recognises. Names as this app's
// own i18n canton blocks spell them (src/i18n/{en,de,fr,it}.js) — matched
// case-insensitively, accents stripped, so "Genève"/"GENEVE"/"geneve" all
// resolve the same way; an already-valid code passes through unchanged.
const CANTON_CODES = new Set([
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE', 'NW', 'OW',
  'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'
])
const CANTON_NAME_TO_CODE = {
  aargau: 'AG', argovie: 'AG', argovia: 'AG',
  'appenzell innerrhoden': 'AI', 'appenzell rhodes-interieures': 'AI', 'appenzello interno': 'AI',
  'appenzell ausserrhoden': 'AR', 'appenzell rhodes-exterieures': 'AR', 'appenzello esterno': 'AR',
  bern: 'BE', berne: 'BE', berna: 'BE',
  'basel-landschaft': 'BL', 'bale-campagne': 'BL', 'basilea campagna': 'BL',
  'basel-stadt': 'BS', 'bale-ville': 'BS', 'basilea citta': 'BS',
  fribourg: 'FR', freiburg: 'FR', friburgo: 'FR',
  geneva: 'GE', genf: 'GE', geneve: 'GE', ginevra: 'GE',
  glarus: 'GL', glaris: 'GL', glarona: 'GL',
  graubunden: 'GR', grisons: 'GR', grigioni: 'GR',
  jura: 'JU', giura: 'JU',
  lucerne: 'LU', luzern: 'LU', lucerna: 'LU',
  neuchatel: 'NE', neuenburg: 'NE',
  nidwalden: 'NW', nidwald: 'NW', nidvaldo: 'NW',
  obwalden: 'OW', obwald: 'OW', obvaldo: 'OW',
  'st. gallen': 'SG', 'st gallen': 'SG', 'saint-gall': 'SG', 'san gallo': 'SG', 'sankt gallen': 'SG',
  schaffhausen: 'SH', schaffhouse: 'SH', sciaffusa: 'SH',
  solothurn: 'SO', soleure: 'SO', soletta: 'SO',
  schwyz: 'SZ', schwytz: 'SZ', svitto: 'SZ',
  thurgau: 'TG', thurgovie: 'TG', turgovia: 'TG',
  ticino: 'TI', tessin: 'TI',
  uri: 'UR',
  vaud: 'VD', waadt: 'VD',
  valais: 'VS', wallis: 'VS', vallese: 'VS',
  zug: 'ZG', zoug: 'ZG', zugo: 'ZG',
  zurich: 'ZH', zuerich: 'ZH', zurigo: 'ZH'
}

function normalizeCanton(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (CANTON_CODES.has(upper)) return upper
  const key = trimmed
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return CANTON_NAME_TO_CODE[key] || null
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
//
// The Questionnaire is never overwritten automatically: an empty field is
// filled in, but a value already there and different ALWAYS becomes a
// suggestion the specialist accepts or rejects — whatever the field, and
// whatever the extraction's confidence (even 100%).

// Same reasoning as normalizeMaritalStatus below — extraction can come back
// in any of the app's four languages, matched whole-word so surrounding
// context ("Sesso: M") doesn't prevent it. Used for the husband-first
// display order (src/lib/personOrder.js), never for anything the client
// can't correct later — an unmatched value is simply left blank. Titles and
// forms of address count too ("Signora", "Herr", "Madame"): the extraction
// may read the gender from them (api/extract-document.js's
// genderInstruction) and occasionally returns the title itself.
const GENDER_SYNONYMS = {
  male: [
    'male', 'm', 'mann', 'männlich', 'mannlich', 'homme', 'masculin', 'uomo', 'maschio', 'maschile',
    'signor', 'signore', 'herr', 'monsieur', 'mr', 'mister'
  ],
  female: [
    'female', 'f', 'frau', 'weiblich', 'femme', 'féminin', 'feminin', 'donna', 'femmina', 'femminile',
    'signora', 'madame', 'mme', 'mrs', 'ms', 'miss'
  ]
}

function normalizeGender(raw) {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  for (const [key, synonyms] of Object.entries(GENDER_SYNONYMS)) {
    if (synonyms.includes(v)) return key
  }
  for (const [key, synonyms] of Object.entries(GENDER_SYNONYMS)) {
    if (synonyms.some((syn) => new RegExp(`(?:^|[^\\p{L}])${syn}(?:$|[^\\p{L}])`, 'iu').test(v))) return key
  }
  return null
}

function isValidCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

// Swiss documents write dates as "18.06.1987" (day first) — client_persons.
// date_of_birth is a Postgres `date` column, which rejects that literally
// (throws "date/time field value out of range"). Converts to ISO when the
// value parses to a real calendar date; otherwise drops it, same as any
// other field this module refuses to guess at — better to leave a date of
// birth blank than let one malformed string crash the entire bundled
// client_persons upsert (which would silently take every other field in
// the same patch down with it — see api/_personalDetails.js).
function normalizeDate(raw) {
  if (!raw) return null
  const v = String(raw).trim()
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, y, m, d] = iso
    return isValidCalendarDate(+y, +m, +d) ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null
  }
  const dmy = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    return isValidCalendarDate(+y, +m, +d) ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null
  }
  return null
}

export function computePersonalDetailsSync({ extractedFields, canton, primary, spouse }) {
  const byKey = Object.fromEntries((extractedFields || []).map((f) => [f.field_key, f.field_value]))

  const autoFill = []
  const suggestions = []
  const resolved = []

  const consider = (table, person, field, fieldLabel, rawValue, currentValue) => {
    if (!rawValue || !String(rawValue).trim()) return
    const value = String(rawValue).trim()
    const current = currentValue == null ? '' : String(currentValue).trim()
    // Spouse fields are suggestion-only even when empty: a spouse row that
    // doesn't exist yet is an identity to confirm, never created behind the
    // specialist's back.
    if (person !== 'spouse' && !current) {
      autoFill.push({ table, person, field, value })
    } else if (current !== value) {
      suggestions.push({ table, person, field, fieldLabel, currentValue: current, suggestedValue: value })
    } else {
      resolved.push({ table, person, field })
    }
  }

  consider('clients', 'none', 'canton', 'Canton', normalizeCanton(byKey.canton), canton)

  if (byKey.full_name) {
    const { first, last } = splitFullName(byKey.full_name)
    consider('client_persons', 'primary', 'first_name', 'First name', first, primary?.first_name)
    consider('client_persons', 'primary', 'last_name', 'Last name', last, primary?.last_name)
  }
  consider(
    'client_persons', 'primary', 'date_of_birth', 'Date of birth',
    normalizeDate(byKey.date_of_birth), primary?.date_of_birth
  )
  // Combined into the single free-text address client_persons already
  // stores (e.g. "Bahnhofstrasse 12, 6300 Zug") — municipality/zip alone
  // don't have their own target column, they only exist to build this.
  const addressLine = [byKey.zip, byKey.municipality].filter(Boolean).join(' ')
  const combinedAddress = [byKey.street_address, addressLine].filter(Boolean).join(', ')
  if (combinedAddress) {
    consider(
      'client_persons', 'primary', 'current_address', 'Current address',
      combinedAddress, primary?.current_address
    )
  }
  const normalizedMarital = normalizeMaritalStatus(byKey.marital_status)
  if (normalizedMarital) {
    consider(
      'client_persons', 'primary', 'marital_status', 'Marital status',
      normalizedMarital, primary?.marital_status
    )
  }
  consider(
    'client_persons', 'primary', 'religious_denomination', 'Religious denomination',
    byKey.religious_affiliation, primary?.religious_denomination
  )
  consider(
    'client_persons', 'primary', 'gender', 'Gender',
    normalizeGender(byKey.gender), primary?.gender
  )

  if (byKey.partner_full_name) {
    const { first, last } = splitFullName(byKey.partner_full_name)
    consider('client_persons', 'spouse', 'first_name', "Partner's first name", first, spouse?.first_name)
    consider('client_persons', 'spouse', 'last_name', "Partner's last name", last, spouse?.last_name)
  }
  consider(
    'client_persons', 'spouse', 'date_of_birth', "Partner's date of birth",
    normalizeDate(byKey.partner_date_of_birth), spouse?.date_of_birth
  )
  consider(
    'client_persons', 'spouse', 'religious_denomination', "Partner's religious denomination",
    byKey.partner_religious_affiliation, spouse?.religious_denomination
  )
  consider(
    'client_persons', 'spouse', 'gender', "Partner's gender",
    normalizeGender(byKey.partner_gender), spouse?.gender
  )

  return { autoFill, suggestions, resolved }
}

// A "property_tax_value" document's own address/value fields, proposed as a
// client_properties row — always a suggestion to confirm (never
// auto-applied, since accepting it creates or overwrites a whole record,
// same reasoning as the spouse fields above), and always the SAME
// suggestion slot for the same source document, so a specialist re-running
// extraction gets an updated proposal instead of a second, duplicate one.
//
// The same real property gets described differently by different
// documents — a tax-value statement, a mortgage certificate, a rental
// statement — in case, punctuation, and whether the municipality/ZIP is
// appended ("RUE DES FINETTES 6" vs. "Rue des Finettes 6, 1920 Martigny").
// Comparing/deduplicating by this normalized form (just the street +
// number, lowercased, accents stripped, punctuation collapsed) instead of
// the raw string is what keeps one real property as one client_properties
// row no matter which document happens to mention it.
export function normalizePropertyAddress(address) {
  if (!address) return ''
  const streetPart = String(address).split(',')[0]
  return streetPart
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// extractedFields: extracted_document_fields rows for ONE property_tax_value
//   document.
// existingProperty: the client_properties row this document's address
//   matches — either because it's already linked to this exact documentId
//   (source_document_id), or because a DIFFERENT document already created
//   a property with the same normalized address — or null/undefined if
//   neither.
//
// Returns null when there's nothing worth proposing (no address at all, or
// the proposal is identical to what's already linked), otherwise
// { address, payload } — payload is what to insert/update on accept.
export function buildPropertySuggestionPayload({ extractedFields, existingProperty }) {
  const byKey = Object.fromEntries((extractedFields || []).map((f) => [f.field_key, f.field_value]))
  const address = byKey.property_address?.trim()
  if (!address) return null

  const payload = { address }
  const taxValue = parseFloat(byKey.tax_value)
  if (Number.isFinite(taxValue)) payload.tax_value = taxValue
  const rentalIncome = parseFloat(byKey.annual_rental_income)
  if (Number.isFinite(rentalIncome)) payload.rental_income = rentalIncome

  if (existingProperty) {
    const unchanged = Object.entries(payload).every(([key, value]) => {
      if (key === 'address') return normalizePropertyAddress(existingProperty.address) === normalizePropertyAddress(value)
      return String(existingProperty[key] ?? '') === String(value)
    })
    if (unchanged) return null
  }

  return { address, payload }
}

// Cross-references the child count from a "current_tax_sheet" document with
// any child name (and, when the same document states it, date of birth)
// found elsewhere (e.g. "child_name"/"child_date_of_birth" on a
// childcare_costs document) so the pending suggestion arrives pre-filled
// instead of an empty row — still a suggestion, never auto-applied.
//
// childrenCount: parsed current_tax_sheet children_count, or null/undefined
//   if not extracted.
// candidates: [{ name, dateOfBirth }] found on OTHER documents (e.g.
//   childcare invoices) for this same client/year — dateOfBirth is
//   whatever raw string the document had (any of the formats normalizeDate
//   above accepts), or null/undefined if that document didn't state one.
// existingChildren: the client's current client_children rows.
//
// Returns an array of { full_name, date_of_birth, key } proposals — capped
// at childrenCount when it's known, so re-processing the same invoice twice
// (or two invoices naming the same child) doesn't propose more children
// than the personal-details document actually states. `key` is what the
// caller uses as the suggestion's dedup key (a name, lowercased, or a stable
// "pending-N" for a placeholder — never blank, which would collide across
// several placeholders on the same unique constraint).
//
// A named candidate fills a still-missing slot first; if childrenCount
// says there are MORE missing children than any name could be
// cross-referenced for (the common case — no childcare document at all
// yet), the remaining slots still get a suggestion, just with an empty
// name for the specialist to fill in when accepting it, rather than
// silently producing nothing until a second document happens to name them.
// fallbackDateOfBirth: a date of birth found on the current_tax_sheet
//   document itself (current_tax_sheet.child_date_of_birth) rather than on
//   a childcare invoice — that document only ever tracks children_count as
//   a single number, never a per-child name, so a date found there can't be
//   attributed to a SPECIFIC child when there's more than one; only applied
//   when childrenCount is exactly 1 and there's exactly one resulting
//   candidate to attach it to, so this never guesses whose date it is.
export function buildChildSuggestionCandidates({ childrenCount, candidates, existingChildren, fallbackDateOfBirth }) {
  const existingNames = new Set(
    (existingChildren || []).map((c) => (c.full_name || '').trim().toLowerCase()).filter(Boolean)
  )
  const seen = new Set()
  const unique = []
  for (const candidate of candidates || []) {
    const name = (candidate?.name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (existingNames.has(key) || seen.has(key)) continue
    seen.add(key)
    unique.push({ name, dateOfBirth: normalizeDate(candidate?.dateOfBirth) })
  }

  const existingCount = (existingChildren || []).length
  const missingCount = Number.isFinite(childrenCount) ? Math.max(0, childrenCount - existingCount) : unique.length

  const named = unique.slice(0, missingCount).map((c) => ({
    full_name: c.name,
    date_of_birth: c.dateOfBirth || null,
    key: c.name.toLowerCase()
  }))
  const placeholderCount = Math.max(0, missingCount - named.length)
  const placeholders = Array.from({ length: placeholderCount }, (_, i) => ({
    full_name: '',
    date_of_birth: null,
    key: `pending-${i + 1}`
  }))
  const result = [...named, ...placeholders]

  const normalizedFallback = normalizeDate(fallbackDateOfBirth)
  if (normalizedFallback && childrenCount === 1 && result.length === 1 && !result[0].date_of_birth) {
    result[0] = { ...result[0], date_of_birth: normalizedFallback }
  }
  return result
}

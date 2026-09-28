// A handful of document categories legitimately report the SAME kind of
// field more than once on one document — several distinct donations on one
// receipts bundle, several dividend distributions or securities positions
// on one broker statement, several pillar 3a payments on one certificate.
// extracted_document_fields is still one row per (document_id, field_key),
// so a second/third/... occurrence is stored under the same field_key with
// a numeric suffix — "annual_amount", "annual_amount_2", "annual_amount_3"
// — the first occurrence keeps the plain key so an ordinary, single-entry
// document behaves exactly as before.
//
// Only field keys explicitly listed here are ever treated this way: a
// completely unrelated field that happens to end in a number of its own
// (e.g. bank_securities_crypto_statement's "account_balance_31_12") is
// never mistaken for a repeated occurrence.
export const REPEATABLE_FIELD_KEYS = new Set([
  // donation_certificate — several distinct gifts on the same receipts PDF.
  'recipient_organization',
  'annual_amount',
  'has_consideration',
  // bank_securities_crypto_statement — several dividend distributions
  // and/or several year-end positions on the same statement.
  'dividend_income',
  'account_balance_31_12',
  // pillar_3a_certificate — several separate payments in the year.
  'annual_contribution'
])

const SUFFIX_PATTERN = /^(.*)_(\d+)$/

// The field this one is a repeated occurrence of — itself, if it isn't one
// (no suffix, or a suffix that isn't actually a registered repeatable key,
// e.g. "account_balance_31_12" is left untouched even though it ends in a
// number).
export function baseFieldKey(fieldKey) {
  const key = fieldKey || ''
  const match = SUFFIX_PATTERN.exec(key)
  if (match && REPEATABLE_FIELD_KEYS.has(match[1])) return match[1]
  return key
}

// The suffix this field_key carries relative to its base ("" for the first
// occurrence, "_2", "_3", ... for later ones) — appended to a sibling
// field's own base key to find the matching occurrence of THAT field
// rather than always its first one (e.g. donation #2's own
// has_consideration, not donation #1's).
export function fieldSuffix(fieldKey) {
  const base = baseFieldKey(fieldKey)
  return (fieldKey || '').slice(base.length)
}

// 1 for the first/plain occurrence, 2/3/... for a suffixed one — used to
// sort a field's occurrences back into the order they were found in.
export function occurrenceIndex(fieldKey) {
  const suffix = fieldSuffix(fieldKey)
  return suffix ? parseInt(suffix.slice(1), 10) : 1
}

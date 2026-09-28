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
// Keyed by "category_code:field_key", NOT by field_key alone — generic
// names like "annual_amount" are reused by many unrelated categories
// (alimony, childcare, pension buy-in, training costs, ...), and only
// donation_certificate's own annual_amount is ever actually repeatable.
// Whitelisting the bare name treated EVERY category using that name as
// repeatable too, which is what silently doubled a childcare document's
// single invoice line the first time this shipped.
export const REPEATABLE_FIELD_KEYS = new Set([
  // donation_certificate — several distinct gifts on the same receipts PDF.
  'donation_certificate:recipient_organization',
  'donation_certificate:annual_amount',
  'donation_certificate:has_consideration',
  // bank_securities_crypto_statement — several dividend distributions
  // and/or several year-end positions on the same statement — and, just as
  // often, several distinct ACCOUNTS bundled into one certificate (e.g. a
  // bank issuing one combined statement covering the parents' joint account
  // and a child's own savings account) — institution_name/account_type were
  // originally missed, which meant a second account's own interest/balance
  // had no institution/type to be identified by even once dividend_income
  // and account_balance_31_12 themselves became repeatable.
  'bank_securities_crypto_statement:institution_name',
  'bank_securities_crypto_statement:account_type',
  'bank_securities_crypto_statement:dividend_income',
  'bank_securities_crypto_statement:interest_income',
  'bank_securities_crypto_statement:account_balance_31_12',
  // pillar_3a_certificate — several separate payments in the year.
  'pillar_3a_certificate:annual_contribution',
  // health_insurance_policy — one uploaded document can bundle separate
  // policies for different family members (e.g. "premi_cassa_malati.pdf"
  // listing each person's own insurer and premium), not one combined
  // policy with a single premium.
  'health_insurance_policy:insurer_name',
  'health_insurance_policy:annual_premium',
  // debt_certificate — one mortgage/loan statement can cover more than one
  // distinct debt (e.g. a Sion mortgage and a Martigny mortgage on the same
  // bank certificate), each with its own creditor, balance and interest.
  'debt_certificate:creditor_name',
  'debt_certificate:debt_type',
  'debt_certificate:debt_balance',
  'debt_certificate:annual_interest_paid',
  'debt_certificate:annual_amortization'
])

const SUFFIX_PATTERN = /^(.*)_(\d+)$/

// The field this one is a repeated occurrence of — itself, if it isn't one
// (no suffix, or a suffix on a field_key/category_code pair that isn't
// actually registered as repeatable, e.g. childcare_costs' own
// "annual_amount", or bank_securities_crypto_statement's
// "account_balance_31_12" which just happens to end in a number already).
export function baseFieldKey(categoryCode, fieldKey) {
  const key = fieldKey || ''
  const match = SUFFIX_PATTERN.exec(key)
  if (match && REPEATABLE_FIELD_KEYS.has(`${categoryCode}:${match[1]}`)) return match[1]
  return key
}

// The suffix this field_key carries relative to its base ("" for the first
// occurrence, "_2", "_3", ... for later ones) — appended to a sibling
// field's own base key to find the matching occurrence of THAT field
// rather than always its first one (e.g. donation #2's own
// has_consideration, not donation #1's).
export function fieldSuffix(categoryCode, fieldKey) {
  const base = baseFieldKey(categoryCode, fieldKey)
  return (fieldKey || '').slice(base.length)
}

// 1 for the first/plain occurrence, 2/3/... for a suffixed one — used to
// sort a field's occurrences back into the order they were found in.
export function occurrenceIndex(categoryCode, fieldKey) {
  const suffix = fieldSuffix(categoryCode, fieldKey)
  return suffix ? parseInt(suffix.slice(1), 10) : 1
}

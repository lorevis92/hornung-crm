// Replaces the old suffix-based "REPEATABLE_FIELD_KEYS" model
// (src/lib/repeatableFields.js, removed): a repeated field used to be its
// OWN independent list ("account_balance_31_12", "..._2", "..._3"), with a
// SEPARATE independent list for every other repeatable field on the same
// document ("institution_name", "..._2"). Nothing tied one list's Nth entry
// to another's — which is exactly how Sara Bianchi's three bank accounts
// ended up with every balance labeled "BANQUE DES ALPES" regardless of
// which bank it actually came from, once a second institution appeared.
//
// The new model: every extracted_document_fields row carries a `row_key`
// (see the extracted_document_fields.row_key migration) — a plain string
// the extraction itself assigns, shared by every field that describes the
// SAME real-world entity (the same account, the same insurance premium,
// the same mortgage, ...). field_key is always the plain, canonical key
// from category_field_definitions — never suffixed — and row_key alone
// distinguishes one occurrence from another. Grouping by (document_id,
// row_key) recovers the row; document-level fields (an employer name, a
// salary statement's own gross salary, a bank statement's single reporting
// currency) simply share the same row_key, '' — see ROW_KEY_DOCUMENT_LEVEL.
export const ROW_KEY_DOCUMENT_LEVEL = ''

// Per row-based category, the field(s) that identify WHO or WHAT a row is
// — used to build its label ("Sara Bianchi — Banque du Léman — Conto
// risparmio — CH12…6789"), in this exact order. A category not listed here
// has no row concept: every field on its documents is document-level.
export const ROW_IDENTITY_FIELDS = {
  bank_securities_crypto_statement: [
    'account_holder_name', 'institution_name', 'account_type', 'account_iban', 'account_number'
  ],
  health_insurance_policy: ['insured_person_name', 'insurer_name', 'policy_type'],
  pillar_3a_certificate: ['policyholder_name', 'institution_name', 'policy_number'],
  medical_costs: ['person_name'],
  debt_certificate: ['creditor_name', 'debt_type', 'contract_number'],
  donation_certificate: ['recipient_organization'],
  life_insurance_policy: ['policyholder_name', 'insurer_name', 'policy_number'],
  pension_fund_statement: ['insured_person_name', 'institution_name']
}

export function isRowBasedCategory(categoryCode) {
  return Object.prototype.hasOwnProperty.call(ROW_IDENTITY_FIELDS, categoryCode)
}

// Detects the OLD suffix convention ("account_balance_31_12_2",
// "annual_premium_3", ...) — never a real field_key any rule matches under
// the row_key model, so without this check a document extracted under the
// old model would just look silently empty (no components at all) instead
// of clearly asking to be re-extracted. Returns the un-suffixed base key,
// or null if `fieldKey` doesn't look like an old suffixed occurrence.
const LEGACY_SUFFIX_PATTERN = /^(.+)_(\d+)$/

export function legacySuffixBaseKey(fieldKey) {
  const match = LEGACY_SUFFIX_PATTERN.exec(fieldKey || '')
  return match ? match[1] : null
}

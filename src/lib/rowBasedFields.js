// Every extracted_document_fields row carries a `row_key` — a plain string
// the extraction itself assigns, shared by every field that describes the
// SAME real-world thing (the same account, the same insurance premium, the
// same mortgage, ...). field_key is always the plain key from
// category_field_definitions, and row_key alone tells one occurrence from
// another. Fields that describe the document as a whole (an employer name,
// a salary statement's gross salary, a bank statement's single reporting
// currency) share the row_key '' — see ROW_KEY_DOCUMENT_LEVEL.
export const ROW_KEY_DOCUMENT_LEVEL = ''

// Per row-based category, the field(s) that identify WHO or WHAT a row is
// — used to build its label when the extraction gave none ("Sara Bianchi —
// Banque du Léman — Conto risparmio — CH12…6789"), in this exact order. A
// category not listed here has no row concept: every field on its
// documents is document-level.
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

// The identity field that names the PERSON a row belongs to, where the
// category has one — shown next to the row in Tax Summary, so a document
// covering several family members says whose each row is.
export const ROW_PERSON_FIELDS = {
  bank_securities_crypto_statement: ['account_holder_name'],
  health_insurance_policy: ['insured_person_name'],
  pillar_3a_certificate: ['policyholder_name'],
  medical_costs: ['person_name'],
  life_insurance_policy: ['policyholder_name'],
  pension_fund_statement: ['insured_person_name']
}

export function isRowBasedCategory(categoryCode) {
  return Object.prototype.hasOwnProperty.call(ROW_IDENTITY_FIELDS, categoryCode)
}

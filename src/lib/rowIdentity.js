// How one extracted ROW (see rowBasedFields.js — one bank account, one
// insurance premium, one mortgage) is named on screen and in the assistant's
// context: "Sara Bianchi — Banque du Léman — Conto risparmio — CH12…6789".
//
// A pure module with no I/O, shared by src/lib/extraction.js (the on-screen
// "What each document says" row headers) and src/lib/extractionQuality.js
// (which asks the same question the other way round: does this row have ANY
// identity at all, or does a specialist still have to say whose it is).
// Keeping both on one implementation is the point — a row must never be
// labelled one way in the document view and judged "unidentified" by the
// other.
import { ROW_IDENTITY_FIELDS } from './rowBasedFields.js'

// "CH1234567890123456789" -> "CH12…6789" — enough to recognize an account
// without printing the whole number everywhere the label appears.
export function maskIban(raw) {
  const compact = String(raw || '').replace(/\s+/g, '')
  if (compact.length <= 8) return compact
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`
}

// Swiss health insurance is split into the compulsory basic cover and
// voluntary supplementary cover — which one a premium is for is the single
// most useful thing to show next to the insured person's name, and every
// document writes it in its own language.
const POLICY_TYPE_BASE_VALUES = new Set(['lamal', 'kvg', 'base', 'basic', 'obligatoire', 'obbligatoria', 'di base'])
const POLICY_TYPE_SUPPLEMENTARY_VALUES = new Set([
  'lca', 'vvg', 'complementare', 'complementary', 'complémentaire', 'zusatzversicherung', 'zusatz', 'integrativa'
])

export function normalizePolicyTypeLabel(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (POLICY_TYPE_BASE_VALUES.has(v)) return 'LAMal/KVG'
  if (POLICY_TYPE_SUPPLEMENTARY_VALUES.has(v)) return 'LCA/VVG'
  return null
}

const IBAN_IDENTITY_FIELD_KEYS = new Set(['account_iban'])

// Walks ROW_IDENTITY_FIELDS[categoryCode] in order, joining whichever
// identity fields this row actually has a value for. Returns null when the
// row has none of them — which is exactly what "not identified" means, and
// what extractionQuality.js turns into a finding for the specialist to
// resolve.
//
// fieldAt(fieldKey): the raw field_value for that key ON THIS ROW, or
//   undefined — the caller decides what "this row" means (a row_key group).
export function buildRowIdentityLabel({ categoryCode, fieldAt }) {
  const identityFields = ROW_IDENTITY_FIELDS[categoryCode]
  if (!identityFields) return null
  const parts = []
  for (const key of identityFields) {
    const raw = fieldAt(key)
    if (!raw) continue
    if (IBAN_IDENTITY_FIELD_KEYS.has(key)) parts.push(maskIban(raw))
    else if (key === 'policy_type') parts.push(normalizePolicyTypeLabel(raw) || raw)
    else parts.push(raw)
  }
  return parts.length ? parts.join(' — ') : null
}

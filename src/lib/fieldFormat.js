// How an extracted value is written on screen: amounts with thousands
// separators and their currency, dates in words, counts and years as plain
// numbers. The value saved in the database is never changed — this only
// decides how it reads. Anything that cannot be parsed is shown exactly as
// the document wrote it, rather than guessed at.

const LOCALES = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }

// Numeric fields that are not money (see category_field_definitions).
const NOT_MONEY = /(_count$|_year$|^year$|percent|_pct$|_rate$)/
const PERCENT = /(percent|_pct$|_rate$)/

// Tolerant amount parser: "CHF 15 000.00", "1'240.00 USD", "15000" — the
// same value written in the ways documents write it. Returns null for
// anything that is not a number once currency words and separators are gone.
export function parseAmount(value) {
  if (value == null) return null
  const cleaned = String(value)
    .trim()
    .replace(/[a-zA-Z]+/g, '')
    .replace(/['’\s]/g, '')
    .replace(/,/g, '')
    .trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function currencyIn(text) {
  const match = String(text || '').match(/\b([A-Z]{3})\b/)
  return match ? match[1] : null
}

// Thousands always grouped: some locales (Italian among them) leave a
// four-digit amount like 4800 ungrouped by default.
function formatNumber(n, lang, options = {}) {
  return new Intl.NumberFormat(LOCALES[lang] || 'de-CH', { useGrouping: 'always', ...options }).format(n)
}

function formatMoney(n, currency, lang) {
  const fraction = Number.isInteger(n) ? 0 : 2
  try {
    return formatNumber(n, lang, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2
    })
  } catch {
    // Not an ISO currency code — keep the number readable anyway.
    return `${currency} ${formatNumber(n, lang, { minimumFractionDigits: fraction, maximumFractionDigits: 2 })}`
  }
}

// "2025-12-31", "31.12.2025", "31/12/2025" -> a Date; anything else -> null.
function parseDate(value) {
  const text = String(value || '').trim()
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
  return null
}

// value: the raw field_value. valueType: category_field_definitions.value_type
// ('text' | 'numeric' | 'date' | 'boolean'). currency: the currency the
// document states for this row (or for the whole document), if any.
export function formatFieldValue({ value, valueType, fieldKey = '', currency = null }, lang = 'it') {
  const raw = value == null ? '' : String(value).trim()
  if (!raw) return ''

  if (valueType === 'date') {
    const date = parseDate(raw)
    if (!date || Number.isNaN(date.getTime())) return raw
    return date.toLocaleDateString(LOCALES[lang] || 'it-CH', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  if (valueType === 'numeric') {
    const n = parseAmount(raw)
    if (n == null) return raw
    if (PERCENT.test(fieldKey)) return `${formatNumber(n, lang, { maximumFractionDigits: 2 })} %`
    if (/_year$|^year$/.test(fieldKey)) return String(n)
    if (NOT_MONEY.test(fieldKey)) return formatNumber(n, lang, { maximumFractionDigits: 2 })
    return formatMoney(n, currencyIn(raw) || currency || 'CHF', lang)
  }

  return raw
}

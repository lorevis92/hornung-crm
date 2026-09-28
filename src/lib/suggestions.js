import { formatChfSwiss } from './format'

// client_properties/client_children suggestions carry a small JSON payload
// in suggested_value (several fields proposed together, e.g. address + tax
// value) instead of the single scalar every other suggestion type uses —
// rendered as its own readable summary rather than the raw JSON string.
// Shared between the client's suggestion feed (SpecialistClient) and the
// Questionnaire/documents consistency banner (CasePage), which both surface
// the exact same client_field_suggestions rows.
export function describeSuggestion(s, t) {
  if (s.target_table === 'client_properties') {
    const payload = JSON.parse(s.suggested_value)
    const parts = [payload.address]
    if (payload.tax_value != null) parts.push(`${t('data.f.taxValue')}: ${formatChfSwiss(payload.tax_value)}`)
    if (payload.rental_income != null) parts.push(`${t('data.f.rentalIncome')}: ${formatChfSwiss(payload.rental_income)}`)
    return t('specialist.suggestionPropertyText', { details: parts.filter(Boolean).join(' — ') })
  }
  if (s.target_table === 'client_children') {
    const payload = JSON.parse(s.suggested_value)
    // No name to show yet — the personal-details document's child count
    // exceeds what any other document could name (e.g. no childcare
    // invoice at all). Still an actionable suggestion, just one the
    // specialist fills in rather than confirms as-is.
    return payload.full_name ? t('specialist.suggestionChildText', { name: payload.full_name }) : t('specialist.suggestionChildPendingText')
  }
  return t('specialist.suggestionText', { field: s.field_label || s.target_field, from: s.current_value, to: s.suggested_value })
}

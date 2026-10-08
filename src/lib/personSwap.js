// Swapping who is "primary" and who is "spouse" for one client (the
// Questionnaire's "Scambia contribuente e coniuge"). The real backend does it
// in one SQL function (migration 51, swap_primary_and_spouse); demo mode
// does it with these pure helpers. Both follow the same rules:
//   - each person's OWN data moves with the person (PERSONAL_FIELDS);
//   - the data of the couple as a whole stays on its row (COUPLE_FIELDS):
//     it describes the household, not one of the two;
//   - a document attributed to a ROLE ('taxpayer'/'spouse',
//     src/lib/documentPerson.js) follows the person, so every document
//     already extracted still names the right one without re-extracting;
//   - pending suggestions for a person's own field follow the person;
//   - clients.person_order_override names rows, so it is flipped and the
//     husband-first order on screen (src/lib/personOrder.js) stays the same.

// Must match the column list in
// supabase/migrations/20260101000051_swap_primary_and_spouse.sql.
export const PERSONAL_FIELDS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'gender',
  'religious_denomination',
  'email',
  'mobile_phone',
  'profession',
  'employer',
  'employer_address',
  'work_address',
  'work_percentage',
  'public_transport_costs',
  'car_km_home_to_work',
  'other_work_costs',
  'is_self_employed',
  'qualifying_shareholdings',
  'asset_statement_count'
]

export const COUPLE_FIELDS = ['marital_status', 'current_address', 'address_dec31']

// Two client_persons rows -> the same two rows (same id, same person_type,
// same couple fields) with their personal fields exchanged.
export function swapPersonRows(primary, spouse) {
  const take = (row) => Object.fromEntries(PERSONAL_FIELDS.map((f) => [f, row[f] ?? null]))
  return {
    primary: { ...primary, ...take(spouse) },
    spouse: { ...spouse, ...take(primary) }
  }
}

export function swapRoleRef(ref) {
  if (ref === 'taxpayer') return 'spouse'
  if (ref === 'spouse') return 'taxpayer'
  return ref
}

export function swapSuggestionPerson(suggestion) {
  if (suggestion.target_table !== 'client_persons' || COUPLE_FIELDS.includes(suggestion.target_field)) {
    return suggestion.target_person
  }
  if (suggestion.target_person === 'primary') return 'spouse'
  if (suggestion.target_person === 'spouse') return 'primary'
  return suggestion.target_person
}

export function flipOrderOverride(override) {
  if (override === 'primary_first') return 'spouse_first'
  if (override === 'spouse_first') return 'primary_first'
  return override ?? null
}

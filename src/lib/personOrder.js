// Which of a married couple's two client_persons rows is shown FIRST,
// wherever both appear together (Questionnaire, Tax Summary header, the
// exported PDF, ...). The consultant's rule: husband first — regardless of
// which one happens to be `person_type = 'primary'` in the database (that's
// an internal identity, never a presentation order) or which one holds the
// client login. A pure function, no I/O, mirroring src/lib/personalDetails.js's
// own "no side effects" convention.
//
// primaryPerson/spousePerson: client_persons rows (or null/undefined).
// overrideOrder: clients.person_order_override ('primary_first' |
//   'spouse_first' | null) — a specialist's explicit resolution of the
//   "can't tell" case below, which always wins once set.
//
// Returns:
//   ordered — [{ kind: 'primary' | 'spouse', person }], one entry when
//     there's no spouse at all, otherwise exactly two, in display order.
//   needsVerification — true when the order had to fall back to
//     primary-first because gender is missing on either side, or the same
//     on both (including a legitimate same-sex couple — there's no
//     husband/wife distinction to derive there either) — never guessed at.
//   overridden — true when overrideOrder decided it, so the caller can
//     show "resolved by a specialist" instead of "still needs a decision".
export function resolvePersonDisplayOrder({ primaryPerson, spousePerson, overrideOrder }) {
  const hasSpouse = Boolean(
    spousePerson && (spousePerson.first_name || spousePerson.last_name || spousePerson.date_of_birth)
  )
  if (!hasSpouse) {
    return { ordered: [{ kind: 'primary', person: primaryPerson || null }], needsVerification: false, overridden: false }
  }

  const primaryFirst = { ordered: [{ kind: 'primary', person: primaryPerson }, { kind: 'spouse', person: spousePerson }] }
  const spouseFirst = { ordered: [{ kind: 'spouse', person: spousePerson }, { kind: 'primary', person: primaryPerson }] }

  if (overrideOrder === 'primary_first') return { ...primaryFirst, needsVerification: false, overridden: true }
  if (overrideOrder === 'spouse_first') return { ...spouseFirst, needsVerification: false, overridden: true }

  const primaryGender = primaryPerson?.gender
  const spouseGender = spousePerson?.gender
  if (primaryGender === 'male' && spouseGender === 'female') {
    return { ...primaryFirst, needsVerification: false, overridden: false }
  }
  if (primaryGender === 'female' && spouseGender === 'male') {
    return { ...spouseFirst, needsVerification: false, overridden: false }
  }
  // Missing on either side, or the same on both — never guessed at.
  return { ...primaryFirst, needsVerification: true, overridden: false }
}

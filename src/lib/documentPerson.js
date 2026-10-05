// Whom a document refers to. The extraction (api/extract-document.js) picks
// one of the case's own persons — never a free-text name — and saves it on
// the document (client_documents.person_ref, migration 50); Tax Summary
// shows it as the first thing of every document. Pure functions, shared by
// the server (building the choices, checking the answer) and the screen
// (naming and ordering).
//
// person_ref values:
//   'taxpayer' | 'spouse' | 'both_spouses' | 'household' | 'unknown'
//   'child:<client_children.id>'
// NULL means the document has not been extracted with this version yet.

const CHILD_PREFIX = 'child:'

function nameOf(person) {
  if (!person) return ''
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
}

function hasSpouse(spouse) {
  return Boolean(spouse && (spouse.first_name || spouse.last_name || spouse.date_of_birth))
}

// The choices offered to the extraction for one case, in a fixed order.
// primary/spouse: client_persons rows; children: client_children rows.
export function buildPersonOptions({ primary, spouse, children = [] }) {
  const options = [{ ref: 'taxpayer', name: nameOf(primary), meaning: 'the taxpayer' }]
  if (hasSpouse(spouse)) {
    options.push({ ref: 'spouse', name: nameOf(spouse), meaning: "the taxpayer's spouse" })
    options.push({ ref: 'both_spouses', name: '', meaning: 'both spouses together (a joint document)' })
  }
  for (const child of children) {
    if (!child?.id) continue
    options.push({ ref: `${CHILD_PREFIX}${child.id}`, name: child.full_name || '', meaning: 'a child of the household' })
  }
  options.push({
    ref: 'household',
    name: '',
    meaning: 'the whole household, or several of its persons on different rows of the same document'
  })
  options.push({ ref: 'unknown', name: '', meaning: 'cannot be determined from the document' })
  return options
}

// The list as it is written into the extraction prompt.
export function describePersonOptions(options) {
  return options
    .map((o) => `- "${o.ref}": ${o.meaning}${o.name ? ` — ${o.name}` : ''}`)
    .join('\n')
}

// The model's answer -> the four columns saved on the document. Anything
// that is not one of the offered refs becomes 'unknown': the extraction may
// only choose, never invent a person.
export function normalizePersonChoice(raw, options, { isPdf = false } = {}) {
  const chosen = options.find((o) => o.ref === raw?.ref) || options.find((o) => o.ref === 'unknown')
  const quote = typeof raw?.quote === 'string' && raw.quote.trim() ? raw.quote.trim().slice(0, 1000) : null
  const page = Number(raw?.page)
  return {
    person_ref: chosen.ref,
    person_name: chosen.name || null,
    person_quote: chosen.ref === 'unknown' ? null : quote,
    person_page: isPdf && Number.isInteger(page) && page > 0 && chosen.ref !== 'unknown' ? page : null
  }
}

// What the screen shows for one document: a kind (for the label) and the
// person's CURRENT name from the Questionnaire, falling back to the name
// saved at extraction time.
// household: { primary, spouse, children } as in buildPersonOptions.
export function describeDocumentPerson(doc, household = {}) {
  const ref = doc?.person_ref || null
  if (!ref) return { kind: 'pending', name: '' }
  if (ref.startsWith(CHILD_PREFIX)) {
    const id = ref.slice(CHILD_PREFIX.length)
    const child = (household.children || []).find((c) => c.id === id)
    return { kind: 'child', name: child?.full_name || doc.person_name || '' }
  }
  if (ref === 'taxpayer') return { kind: 'taxpayer', name: nameOf(household.primary) || doc.person_name || '' }
  if (ref === 'spouse') return { kind: 'spouse', name: nameOf(household.spouse) || doc.person_name || '' }
  if (['both_spouses', 'household', 'unknown'].includes(ref)) return { kind: ref, name: '' }
  return { kind: 'unknown', name: '' }
}

// Sort key for the document list: the two spouses (husband first, see
// src/lib/personOrder.js — `spouseFirst` comes from there), both spouses,
// each child in Questionnaire order, the household, "cannot be determined",
// and last the documents not extracted yet.
export function personSortKey(doc, { children = [], spouseFirst = false } = {}) {
  const ref = doc?.person_ref || null
  if (!ref) return 900
  if (ref === 'taxpayer') return spouseFirst ? 2 : 1
  if (ref === 'spouse') return spouseFirst ? 1 : 2
  if (ref === 'both_spouses') return 3
  if (ref.startsWith(CHILD_PREFIX)) {
    const index = children.findIndex((c) => c.id === ref.slice(CHILD_PREFIX.length))
    return 10 + (index === -1 ? 99 : index)
  }
  if (ref === 'household') return 200
  return 300
}

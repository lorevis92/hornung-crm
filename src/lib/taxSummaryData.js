// Tax Summary's data: one load function (every query, so a failing one
// reaches useLoad as an error instead of a spinner that never ends) and one
// pure function that turns the rows into the ordered, read-only document
// list the page shows.
import { describeDocumentPerson, personSortKey } from './documentPerson.js'
import { groupDocumentRows } from './extraction.js'
import { buildQualityFindings } from './extractionQuality.js'
import { resolvePersonDisplayOrder } from './personOrder.js'

// Document types in the order a tax return reads: personal data, income,
// deductions, wealth (assets and property), everything else.
const GROUP_ORDER = ['base', 'income', 'deductions', 'assets', 'property', 'other']

export async function loadTaxSummary(api, caseId) {
  const caseRow = await api.getCase(caseId)
  if (!caseRow) return null
  const [documents, categories, fieldDefs, questionnaire] = await Promise.all([
    api.listClientDocuments(caseRow.client_id, caseRow.tax_year),
    api.listDocumentCategories(),
    api.listFieldDefinitions(),
    api.getQuestionnaire(caseRow.client_id)
  ])
  const [fieldsPerDocument, otherFindings] = await Promise.all([
    Promise.all(documents.map((d) => api.listExtractedFieldsForDocument(d.id))),
    api.listOtherFindingsForDocuments(documents.map((d) => d.id))
  ])
  const extractedFields = documents.flatMap((d, i) => fieldsPerDocument[i].map((f) => ({ ...f, document_id: d.id })))
  return { caseRow, documents, categories, fieldDefs, questionnaire, extractedFields, otherFindings }
}

export function householdOf(questionnaire) {
  const persons = questionnaire?.persons || []
  return {
    primary: persons.find((p) => p.person_type === 'primary') || null,
    spouse: persons.find((p) => p.person_type === 'spouse') || null,
    children: questionnaire?.children || []
  }
}

// The document list, ordered by PERSON first (the two spouses — husband
// first, as everywhere else — then both spouses together, each child, the
// whole household, "cannot be determined", and last the documents not
// extracted yet), then by document TYPE (GROUP_ORDER, then the category's
// own sort order), then by file name.
//
// Every item: { doc, category, person, rows, findings, notes, needsReview }
//   person   — describeDocumentPerson(): whom the document refers to;
//   rows     — groupDocumentRows(): the extracted values, grouped by row;
//   findings — "other information found" for this document;
//   notes    — buildQualityFindings() for this document (shown discreetly);
//   needsReview — true when there is a note, or the extraction failed.
export function buildDocumentList({
  documents = [],
  categories = [],
  fieldDefs = [],
  extractedFields = [],
  otherFindings = [],
  household = {},
  personOrderOverride = null
}) {
  const categoryByCode = new Map(categories.map((c) => [c.code, c]))
  const spouseFirst =
    resolvePersonDisplayOrder({
      primaryPerson: household.primary,
      spousePerson: household.spouse,
      overrideOrder: personOrderOverride
    }).ordered[0]?.kind === 'spouse'
  const notes = buildQualityFindings({ documents, extractedFields, otherFindings })

  const typeRank = (category) => {
    if (!category) return [GROUP_ORDER.length + 1, 0]
    const group = GROUP_ORDER.indexOf(category.group_key)
    return [group === -1 ? GROUP_ORDER.length : group, category.sort_order ?? 0]
  }

  const items = documents.map((doc) => {
    const category = categoryByCode.get(doc.category_code) || null
    const docNotes = notes.filter((n) => n.documentId === doc.id)
    return {
      doc,
      category,
      person: describeDocumentPerson(doc, household),
      rows: groupDocumentRows(
        fieldDefs.filter((d) => d.category_code === doc.category_code),
        extractedFields.filter((f) => f.document_id === doc.id),
        doc.category_code
      ),
      findings: otherFindings.filter((f) => f.document_id === doc.id),
      notes: docNotes,
      needsReview: docNotes.length > 0 || doc.status === 'extraction_failed'
    }
  })

  const sortKey = (item) => [
    personSortKey(item.doc, { children: household.children || [], spouseFirst }),
    ...typeRank(item.category)
  ]
  return items.sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return (a.doc.file_name || '').localeCompare(b.doc.file_name || '')
  })
}

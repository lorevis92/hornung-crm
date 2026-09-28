import { isMarriedHousehold } from './taxCalculation'

// Compares what the Questionnaire declares (marital status, children,
// properties, employment) against what the uploaded documents actually
// show for the same client/tax year, for a specialist reviewing a case.
// Pure function, no I/O — same shape as taxCalculation.js/personalDetails.js
// so it can be unit-tested and shared between the demo and Supabase data
// layers without duplicating the comparison logic in either.
//
// Two kinds of findings, deliberately kept separate:
//  - discrepancies: a document says something different from (or additional
//    to) what the Questionnaire records. Where the field is one the
//    extraction auto-fill already manages (marital status, a child's name,
//    the client's own details, a property), this is literally the SAME
//    pending row already sitting in client_field_suggestions — surfaced
//    here too rather than re-detected, so accepting it here uses the exact
//    same mechanism, editable inline before confirming. A children-count
//    mismatch with nothing pending yet (the sync hasn't caught up, e.g.
//    right after a document lands) falls back to a plain informational
//    note instead — there's no single target field a bare count could
//    overwrite on its own.
//  - missingDocuments: cautious, simple heuristics for a document category
//    the Questionnaire's own declarations would lead you to expect but that
//    isn't present at all. Only the clearest cases — never for something
//    that could reasonably be optional, to avoid a banner that cries wolf.
export function computeQuestionnaireConsistency({
  questionnaire,
  documents,
  currentTaxSheetFields,
  pendingSuggestions
}) {
  const discrepancies = []
  const missingDocuments = []

  const persons = questionnaire?.persons || []
  const primary = persons.find((p) => p.person_type === 'primary') || null
  const spouse = persons.find((p) => p.person_type === 'spouse') || null
  const children = questionnaire?.children || []
  const properties = questionnaire?.properties || []
  const docs = documents || []

  for (const s of pendingSuggestions || []) {
    discrepancies.push({ key: `suggestion:${s.id}`, kind: 'suggestion', suggestion: s })
  }

  const hasPendingChildSuggestion = (pendingSuggestions || []).some((s) => s.target_table === 'client_children')
  const countField = (currentTaxSheetFields || []).find(
    (f) => f.field_key === 'children_count' && f.included_in_calculation !== false && f.field_value
  )
  const declaredCount = countField ? parseInt(countField.field_value, 10) : null
  if (Number.isFinite(declaredCount) && declaredCount !== children.length && !hasPendingChildSuggestion) {
    discrepancies.push({
      key: 'children-count',
      kind: 'childrenCount',
      documentValue: declaredCount,
      questionnaireValue: children.length
    })
  }

  if (properties.length && !docs.some((d) => d.category_code === 'property_tax_value')) {
    missingDocuments.push({ key: 'missing-property', kind: 'missingProperty', count: properties.length })
  }

  const isMarried = isMarriedHousehold(primary, spouse)
  const spouseAppearsEmployed = Boolean(spouse) && (spouse.work_percentage == null || spouse.work_percentage > 0)
  const primaryAppearsEmployed = !primary || primary.work_percentage == null || primary.work_percentage > 0
  const salaryDocCount = docs.filter((d) => d.category_code === 'salary_statement').length
  if (isMarried && spouseAppearsEmployed && primaryAppearsEmployed && salaryDocCount < 2) {
    missingDocuments.push({ key: 'missing-spouse-salary', kind: 'missingSpouseSalary' })
  }

  return { discrepancies, missingDocuments }
}

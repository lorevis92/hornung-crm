// The case pages are one page seen by two different people. Most of the
// difference is already handled inline (`isStaff ? ... : ...` around whole
// controls and sections), but a handful of strings are not a section at
// all — they are the SAME heading or sentence written from the client's
// point of view ("Your documents", "Your declaration is being prepared"),
// and a specialist consulting someone else's file was reading them as if
// the file were their own.
//
// This maps the viewer's role to the i18n key to use for each of those
// strings, in one place, so that a) nobody has to remember which of the
// two keys exists while editing a page, and b) the pairing is checkable
// without rendering anything (see test/viewer-copy.test.js, which also
// asserts both variants really exist in all four locales — the failure
// mode otherwise is a key added to en.js only, showing the raw key name
// to a German-speaking specialist).
//
// isStaff: the viewer's role, exactly as useAuth() reports it.
// Returns i18n key paths (not translated text) — the caller still runs
// them through t().
const CLIENT_COPY = {
  // CasePage — the client's own upload zone.
  caseDocumentsTitle: 'case.yourDocuments',
  caseDocumentsHelp: 'case.yourDocumentsHelp',
  // ChecklistPanel — the agreed/possible document list inside that zone.
  casePossibleDocs: 'case.possibleDocs',
  casePossibleDocsHelp: 'case.possibleDocsHelp',
  caseNoChecklist: 'case.noChecklist',
  // CasePage — the zone for what Hornung Consulting sends back.
  caseSpecialistDocsHelp: 'case.fromSpecialistHelp',
  caseNoSpecialistDocs: 'case.noSpecialistDocs',
  // CasePage header — prefix, completed with the case's own status
  // (`${prefix}.${status}`); every status.* key exists under both.
  statusDescPrefix: 'status.desc',
  // Pricing — the same price list is shown to both.
  pricingSubtitle: 'pricing.subtitle'
}

const STAFF_COPY = {
  caseDocumentsTitle: 'case.clientDocuments',
  caseDocumentsHelp: 'case.clientDocumentsHelp',
  casePossibleDocs: 'case.possibleDocsStaff',
  casePossibleDocsHelp: 'case.possibleDocsStaffHelp',
  caseNoChecklist: 'case.noChecklistStaff',
  caseSpecialistDocsHelp: 'case.fromSpecialistHelpStaff',
  caseNoSpecialistDocs: 'case.noSpecialistDocsStaff',
  statusDescPrefix: 'status.staffDesc',
  pricingSubtitle: 'pricing.staffSubtitle'
}

export function viewerCopy(isStaff) {
  return isStaff ? STAFF_COPY : CLIENT_COPY
}

// Exported for the test (and for anyone adding a new role-dependent
// string: add it to BOTH tables, the test enforces they stay parallel).
export const VIEWER_COPY_SLOTS = Object.keys(CLIENT_COPY)
export { CLIENT_COPY, STAFF_COPY }

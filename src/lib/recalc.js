import { api } from './data'

// Thin "fire a server-computed side effect, log but don't surface errors"
// wrappers around a mutation that already succeeded: a background refresh
// shouldn't interrupt whatever the user was actually doing.
//
// For the "Personal details" -> client registry auto-fill
// (src/lib/personalDetails.js) — used by the catch-up below; a fresh
// extraction triggers the same sync server-side (api/extract-document.js).
async function syncPersonalDetailsInBackground(documentId) {
  if (!documentId) return null
  try {
    return await api.syncPersonalDetails(documentId)
  } catch (error) {
    console.error('[syncPersonalDetailsInBackground]', error)
    return null
  }
}

// Same reasoning, for the "property_tax_value" -> client_properties
// suggestion (src/lib/personalDetails.js's buildPropertySuggestionPayload).
async function syncPropertySuggestionInBackground(documentId) {
  if (!documentId) return null
  try {
    return await api.syncPropertySuggestion(documentId)
  } catch (error) {
    console.error('[syncPropertySuggestionInBackground]', error)
    return null
  }
}

// Same reasoning, for the child-name/child-count cross-reference
// (src/lib/personalDetails.js's buildChildSuggestionCandidates).
async function syncChildSuggestionsInBackground(clientId, taxYear) {
  if (!clientId || !taxYear) return null
  try {
    return await api.syncChildSuggestions(clientId, taxYear)
  } catch (error) {
    console.error('[syncChildSuggestionsInBackground]', error)
    return null
  }
}

// Catches up the registry sync for documents that were already extracted
// before this pipeline existed (or before a required migration had been
// run) — the sync functions above only ever fire as a side effect of a
// FRESH extraction (api/extract-document.js), so an older document's data
// can sit in extracted_document_fields forever without ever reaching
// client_persons/clients/client_properties/client_children, leaving the
// Questionnaire empty even though Tax Summary shows the same data just
// fine (it reads extracted_document_fields directly, unaffected by any of
// this). Called once when a specialist opens a client, across every tax
// year they have a case for. Safe to call repeatedly: every sync function
// it calls only fills in what's still empty or flags a genuine conflict
// (see computePersonalDetailsSync) — never a blind overwrite.
export async function catchUpRegistrySyncInBackground(clientId, cases) {
  if (!clientId || !cases?.length) return
  try {
    const perYear = await Promise.all(
      cases.map(async (c) => ({
        taxYear: c.tax_year,
        documents: await api.listClientDocuments(clientId, c.tax_year)
      }))
    )
    const jobs = []
    for (const { taxYear, documents } of perYear) {
      let hasChildRelevantDoc = false
      for (const doc of documents || []) {
        if (doc.status !== 'extracted') continue
        if (doc.category_code === 'current_tax_sheet') {
          jobs.push(syncPersonalDetailsInBackground(doc.id))
          hasChildRelevantDoc = true
        } else if (doc.category_code === 'property_tax_value') {
          jobs.push(syncPropertySuggestionInBackground(doc.id))
        } else if (doc.category_code === 'childcare_costs') {
          hasChildRelevantDoc = true
        }
      }
      if (hasChildRelevantDoc) jobs.push(syncChildSuggestionsInBackground(clientId, taxYear))
    }
    await Promise.all(jobs)
  } catch (error) {
    console.error('[catchUpRegistrySyncInBackground]', error)
  }
}

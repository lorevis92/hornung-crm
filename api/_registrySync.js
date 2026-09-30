// Registry catch-up for one client/tax year: re-reads every eligible
// document already on file and pushes what it says into the client's own
// registry (client_persons / clients.canton, client_properties,
// client_children). Called right after a fresh extraction
// (api/extract-document.js) so the Questionnaire reflects a newly uploaded
// document without anyone having to open a specific page first.
//
// This is the half of the old api/_recalc.js that survived the removal of
// the tax calculation engine: recalculateAndPersist used to do this catch-up
// AND recompute tax_aggregates/tax_aggregate_components. Only the catch-up
// is still meaningful — the app no longer computes a declaration.
//
// Best-effort per document: one document failing to sync (a malformed date,
// a row another process is holding) must not abort the rest, so each is
// wrapped on its own and logged rather than thrown.
import { syncPersonalDetails } from './_personalDetails.js'
import { syncPropertySuggestion } from './_propertySuggestion.js'
import { syncChildSuggestions } from './_childSuggestion.js'

export async function syncRegistryForClientYear(admin, clientId, taxYear) {
  // Ordered by uploaded_at: this re-syncs personal details from EVERY
  // eligible document every time, and force-apply fields (name, marital
  // status, address, ...) always take whichever document processed LAST —
  // with no explicit order that would be whatever Postgres happened to
  // return. A client who uses "fill from pasted text" more than once (each
  // use is its own permanent document) needs the newest one to reliably win.
  const { data: documents, error: docsError } = await admin
    .from('client_documents')
    .select('id, category_code, status, uploaded_at')
    .eq('client_id', clientId)
    .eq('tax_year', taxYear)
    .order('uploaded_at', { ascending: true })
  if (docsError) throw docsError

  let hasChildRelevantDocument = false
  for (const doc of documents || []) {
    if (doc.status !== 'extracted') continue
    if (doc.category_code === 'current_tax_sheet') {
      hasChildRelevantDocument = true
      try {
        await syncPersonalDetails(admin, doc.id)
      } catch (error) {
        console.error(`[registry-sync] personal details failed for document ${doc.id}:`, error)
      }
    } else if (doc.category_code === 'property_tax_value') {
      try {
        await syncPropertySuggestion(admin, doc.id)
      } catch (error) {
        console.error(`[registry-sync] property suggestion failed for document ${doc.id}:`, error)
      }
    } else if (doc.category_code === 'childcare_costs') {
      hasChildRelevantDocument = true
    }
  }

  if (hasChildRelevantDocument) {
    try {
      await syncChildSuggestions(admin, clientId, taxYear)
    } catch (error) {
      console.error(`[registry-sync] child suggestions failed for client ${clientId}/${taxYear}:`, error)
    }
  }
}

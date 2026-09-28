// Shared by api/calculate-aggregates.js (the manual "Recalculate" button)
// and api/extract-document.js (so a fresh AI extraction updates the totals
// on its own too, the same as an edit/exclude/delete already does from the
// browser side) — one place that reads the calculation inputs, runs
// computeTaxAggregate, and persists the result to tax_aggregates /
// tax_aggregate_components.
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'
import { syncPersonalDetails } from './_personalDetails.js'
import { syncPropertySuggestion } from './_propertySuggestion.js'
import { syncChildSuggestions } from './_childSuggestion.js'

export async function recalculateAndPersist(admin, clientId, taxYear, lang = 'en') {
  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id, canton')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) throw clientError
  if (!client) throw new Error('CLIENT_NOT_FOUND')

  // Every document for this client/year, not just the categorized ones —
  // readiness needs to see a document still stuck at 'uploaded'/'extracting'
  // even before it has a category_code, otherwise a batch that's still
  // mid-extraction would look "ready" simply because none of its documents
  // have reached the calculation input yet.
  const { data: allDocuments, error: docsError } = await admin
    .from('client_documents')
    .select('id, category_code, file_name, status')
    .eq('client_id', clientId)
    .eq('tax_year', taxYear)
  if (docsError) throw docsError

  // Registry catch-up, run on every recalculation rather than only as a
  // side effect of a fresh extraction (api/extract-document.js) or of a
  // specialist happening to open a page that also triggers it
  // (SpecialistClient.jsx's own catch-up on mount). Neither of those two
  // is guaranteed to ever run for a given client — an older document
  // extracted before this sync existed, or one nobody has revisited the
  // client's own page for since, is exactly what left client_persons
  // (and so the Questionnaire and the marital-status-driven wealth
  // exemption) empty for a client with data sitting right there in
  // extracted_document_fields. Recalculation itself, by contrast, runs
  // constantly — on every extraction, edit, suggestion accept, and the
  // "reload everything" action — so anchoring the catch-up here instead
  // reaches every client, not just the ones whose specialist happens to
  // click through a specific page. Run BEFORE reading client_persons/
  // client_children below, so this same call already computes the
  // correct total instead of only fixing the registry for next time.
  for (const doc of allDocuments || []) {
    if (doc.status !== 'extracted') continue
    if (doc.category_code === 'current_tax_sheet') {
      try {
        await syncPersonalDetails(admin, doc.id)
      } catch (error) {
        console.error(`[recalculateAndPersist] personal-details catch-up failed for document ${doc.id}:`, error)
      }
    } else if (doc.category_code === 'property_tax_value') {
      try {
        await syncPropertySuggestion(admin, doc.id)
      } catch (error) {
        console.error(`[recalculateAndPersist] property-suggestion catch-up failed for document ${doc.id}:`, error)
      }
    }
  }
  if ((allDocuments || []).some((d) => d.status === 'extracted' && ['current_tax_sheet', 'childcare_costs'].includes(d.category_code))) {
    try {
      await syncChildSuggestions(admin, clientId, taxYear)
    } catch (error) {
      console.error(`[recalculateAndPersist] child-suggestion catch-up failed for client ${clientId}/${taxYear}:`, error)
    }
  }

  const [personsRes, childrenRes] = await Promise.all([
    admin.from('client_persons').select('*').eq('client_id', clientId),
    admin.from('client_children').select('*').eq('client_id', clientId)
  ])
  if (personsRes.error) throw personsRes.error
  if (childrenRes.error) throw childrenRes.error
  const primaryPerson = (personsRes.data || []).find((p) => p.person_type === 'primary') || null
  const spousePerson = (personsRes.data || []).find((p) => p.person_type === 'spouse') || null
  const children = childrenRes.data || []

  const documents = (allDocuments || []).filter((d) => d.category_code)
  const documentIds = documents.map((d) => d.id)
  let extractedFields = []
  if (documentIds.length) {
    const { data, error } = await admin
      .from('extracted_document_fields')
      .select('document_id, field_key, field_value, included_in_calculation, verified_by_specialist')
      .in('document_id', documentIds)
    if (error) throw error
    extractedFields = data || []
  }

  const [rulesRes, fieldDefsRes, categoriesRes, parametersRes] = await Promise.all([
    admin.from('field_calculation_rules').select('*'),
    admin.from('category_field_definitions').select('category_code, field_key, field_label'),
    admin.from('document_categories').select('code, group_key, label_en, label_de, label_fr, label_it'),
    admin.from('tax_parameters').select('*').eq('tax_year', taxYear)
  ])
  if (rulesRes.error) throw rulesRes.error
  if (fieldDefsRes.error) throw fieldDefsRes.error
  if (categoriesRes.error) throw categoriesRes.error
  if (parametersRes.error) throw parametersRes.error

  // Canton: prefer the client's own record; fall back to an included
  // current_tax_sheet.canton extraction. Never invent a default.
  let canton = (client.canton || '').trim() || null
  if (!canton) {
    const sheetDoc = (documents || []).find((d) => d.category_code === 'current_tax_sheet')
    if (sheetDoc) {
      const cantonField = extractedFields.find(
        (f) => f.document_id === sheetDoc.id && f.field_key === 'canton' && f.included_in_calculation !== false
      )
      if (cantonField?.field_value) canton = cantonField.field_value.trim() || null
    }
  }

  const result = computeTaxAggregate({
    canton,
    documents: documents || [],
    extractedFields,
    rules: rulesRes.data || [],
    fieldDefs: fieldDefsRes.data || [],
    categories: categoriesRes.data || [],
    parameters: parametersRes.data || [],
    taxYear,
    primaryPerson,
    spousePerson,
    children,
    lang
  })

  // Never "ready for simulation" while a document for this client/year is
  // still mid-pipeline — 'uploaded' (not even classified yet) or
  // 'extracting' (claimed but not finished, including one stuck there by a
  // crashed/timed-out run). 'extracted', 'extraction_failed',
  // 'verified_by_specialist' and 'rejected' are all final one way or
  // another; the aggregate can be ready even alongside a failed extraction
  // (the completeness banner already surfaces that separately) but never
  // while one is genuinely still in flight.
  const documentsStillProcessing = (allDocuments || []).some((d) => ['uploaded', 'extracting'].includes(d.status))
  // Nor while a component with a REAL, nonzero amount is still sitting in
  // "needs verification" (a foreign-currency broker balance not yet
  // converted, a missing cap parameter, ...) — every document may well have
  // finished extracting, but the total above doesn't actually include that
  // money yet, so calling it "ready" would tell the specialist a figure is
  // final when a known, sized gap is still open. A needs-verification row
  // with amount 0 (nothing to actually add) doesn't block readiness.
  const hasUnresolvedVerification = result.components.some((c) => c.needsVerification && c.amount)
  const aggregateStatus = documentsStillProcessing || hasUnresolvedVerification ? 'draft' : 'ready_for_simulation'

  const { data: aggregate, error: aggregateError } = await admin
    .from('tax_aggregates')
    .upsert(
      {
        client_id: clientId,
        tax_year: taxYear,
        taxable_income_cantonal: result.taxableIncomeCantonal,
        taxable_wealth_cantonal: result.taxableWealthCantonal,
        taxable_income_federal: result.taxableIncomeFederal,
        uncertain_parameters: result.uncertainParameterNotes || [],
        status: aggregateStatus,
        computed_at: new Date().toISOString()
      },
      { onConflict: 'client_id,tax_year' }
    )
    .select()
    .single()
  if (aggregateError) throw aggregateError

  // Recomputed from scratch every time — clear the previous breakdown
  // before writing the fresh one.
  const { error: deleteError } = await admin
    .from('tax_aggregate_components')
    .delete()
    .eq('aggregate_id', aggregate.id)
  if (deleteError) throw deleteError

  let insertedComponents = []
  if (result.components.length) {
    const { data, error: insertError } = await admin
      .from('tax_aggregate_components')
      .insert(
        result.components.map((c) => ({
          aggregate_id: aggregate.id,
          document_id: c.documentId,
          field_key: c.fieldKey || null,
          component_type: c.componentType,
          section_key: c.sectionKey,
          amount: c.amount,
          needs_verification: c.needsVerification || false,
          currency_code: c.currencyCode || null,
          label: c.label,
          field_label: c.fieldLabel,
          source_label: c.sourceLabel
        }))
      )
      .select()
    if (insertError) throw insertError
    insertedComponents = data || []
  }

  return {
    aggregate,
    components: insertedComponents,
    warnings: result.warnings,
    cantonUsed: canton,
    cantonMissing: !canton
  }
}

// Shared by api/calculate-aggregates.js (the manual "Recalculate" button)
// and api/extract-document.js (so a fresh AI extraction updates the totals
// on its own too, the same as an edit/exclude/delete already does from the
// browser side) — one place that reads the calculation inputs, runs
// computeTaxAggregate, and persists the result to tax_aggregates /
// tax_aggregate_components.
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'

export async function recalculateAndPersist(admin, clientId, taxYear, lang = 'en') {
  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id, canton')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) throw clientError
  if (!client) throw new Error('CLIENT_NOT_FOUND')

  const [personsRes, childrenRes] = await Promise.all([
    admin.from('client_persons').select('*').eq('client_id', clientId),
    admin.from('client_children').select('*').eq('client_id', clientId)
  ])
  if (personsRes.error) throw personsRes.error
  if (childrenRes.error) throw childrenRes.error
  const primaryPerson = (personsRes.data || []).find((p) => p.person_type === 'primary') || null
  const spousePerson = (personsRes.data || []).find((p) => p.person_type === 'spouse') || null
  const children = childrenRes.data || []

  const { data: documents, error: docsError } = await admin
    .from('client_documents')
    .select('id, category_code, file_name')
    .eq('client_id', clientId)
    .eq('tax_year', taxYear)
    .not('category_code', 'is', null)
  if (docsError) throw docsError

  const documentIds = (documents || []).map((d) => d.id)
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

  const { data: aggregate, error: aggregateError } = await admin
    .from('tax_aggregates')
    .upsert(
      {
        client_id: clientId,
        tax_year: taxYear,
        taxable_income_cantonal: result.taxableIncomeCantonal,
        taxable_wealth_cantonal: result.taxableWealthCantonal,
        taxable_income_federal: result.taxableIncomeFederal,
        status: 'ready_for_simulation',
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

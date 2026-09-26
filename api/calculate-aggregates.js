// POST /api/calculate-aggregates
//   { clientId, taxYear, lang }
//
// Computes taxable income/wealth for a client + tax year from verified
// extracted fields, using field_calculation_rules and tax_parameters, and
// persists the result to tax_aggregates / tax_aggregate_components. Staff
// only (requireStaff), same service-role pattern as api/extract-document.js
// — no calculation logic runs in the browser. The actual math lives in
// src/lib/taxCalculation.js, shared verbatim with the demo data layer so
// nothing is duplicated between the two.
import { httpError, readBody, requireStaff } from './_lib.js'
import { computeTaxAggregate } from '../src/lib/taxCalculation.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const clientId = body.clientId
    const taxYear = Number(body.taxYear)
    const lang = ['en', 'de', 'fr', 'it'].includes(body.lang) ? body.lang : 'en'
    if (!clientId || !taxYear) {
      throw httpError(400, 'MISSING_PARAMS', 'clientId and taxYear are required.')
    }

    const { data: client, error: clientError } = await admin
      .from('clients')
      .select('id, canton')
      .eq('id', clientId)
      .maybeSingle()
    if (clientError) throw clientError
    if (!client) throw httpError(404, 'CLIENT_NOT_FOUND', 'Client not found.')

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
        .select('document_id, field_key, field_value, verified_by_specialist, included_in_calculation')
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

    // Canton: prefer the client's own record; fall back to a verified,
    // included current_tax_sheet.canton extraction. Never invent a default.
    let canton = (client.canton || '').trim() || null
    if (!canton) {
      const sheetDoc = (documents || []).find((d) => d.category_code === 'current_tax_sheet')
      if (sheetDoc) {
        const cantonField = extractedFields.find(
          (f) =>
            f.document_id === sheetDoc.id &&
            f.field_key === 'canton' &&
            f.verified_by_specialist &&
            f.included_in_calculation !== false
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
            amount: c.amount,
            label: c.label,
            field_label: c.fieldLabel,
            source_label: c.sourceLabel
          }))
        )
        .select()
      if (insertError) throw insertError
      insertedComponents = data || []
    }

    return res.status(200).json({
      aggregate,
      components: insertedComponents,
      warnings: result.warnings,
      cantonUsed: canton,
      cantonMissing: !canton
    })
  } catch (error) {
    console.error('[calculate-aggregates]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

// POST /api/diagnose-client
//   { email?, clientId?, taxYear }
//
// Staff-only diagnostic dump: exactly what raw data produced a client's
// current tax calculation, for a given tax year — client demographics the
// engine reads, every document + its extracted fields (flagging which were
// hand-edited by a specialist vs. still the original extraction), and every
// persisted tax_aggregate_components row from the last calculation. Built
// to answer "why does this specific client's number look wrong" without
// reconstructing it by eye from the UI — reads only, never writes anything.
import { httpError, readBody, requireStaff } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const taxYear = Number(body.taxYear)
    const email = (body.email || '').trim().toLowerCase()
    const clientIdInput = body.clientId || null
    if (!taxYear || (!email && !clientIdInput)) {
      throw httpError(400, 'MISSING_PARAMS', 'taxYear and either email or clientId are required.')
    }

    let clientQuery = admin.from('clients').select('*')
    clientQuery = clientIdInput ? clientQuery.eq('id', clientIdInput) : clientQuery.ilike('email', email)
    const { data: client, error: clientError } = await clientQuery.maybeSingle()
    if (clientError) throw clientError
    if (!client) throw httpError(404, 'CLIENT_NOT_FOUND', 'No client matches that email/id.')

    const [personsRes, childrenRes, documentsRes, categoriesRes, fieldDefsRes, aggregateRes] = await Promise.all([
      admin.from('client_persons').select('*').eq('client_id', client.id),
      admin.from('client_children').select('*').eq('client_id', client.id),
      admin
        .from('client_documents')
        .select('*')
        .eq('client_id', client.id)
        .eq('tax_year', taxYear)
        .order('uploaded_at', { ascending: true }),
      admin.from('document_categories').select('code, label_en, group_key'),
      admin.from('category_field_definitions').select('category_code, field_key, field_label'),
      admin.from('tax_aggregates').select('*').eq('client_id', client.id).eq('tax_year', taxYear).maybeSingle()
    ])
    if (personsRes.error) throw personsRes.error
    if (childrenRes.error) throw childrenRes.error
    if (documentsRes.error) throw documentsRes.error
    if (categoriesRes.error) throw categoriesRes.error
    if (fieldDefsRes.error) throw fieldDefsRes.error
    if (aggregateRes.error) throw aggregateRes.error

    const documents = documentsRes.data || []
    const documentIds = documents.map((d) => d.id)
    const { data: fieldsData, error: fieldsError } = documentIds.length
      ? await admin.from('extracted_document_fields').select('*').in('document_id', documentIds)
      : { data: [], error: null }
    if (fieldsError) throw fieldsError
    const fields = fieldsData || []

    let components = []
    if (aggregateRes.data) {
      const { data: compsData, error: compsError } = await admin
        .from('tax_aggregate_components')
        .select('*')
        .eq('aggregate_id', aggregateRes.data.id)
      if (compsError) throw compsError
      components = compsData || []
    }

    const categoryLabel = Object.fromEntries((categoriesRes.data || []).map((c) => [c.code, c.label_en]))
    const fieldLabel = Object.fromEntries(
      (fieldDefsRes.data || []).map((f) => [`${f.category_code}:${f.field_key}`, f.field_label])
    )
    const fieldsByDoc = {}
    for (const f of fields) (fieldsByDoc[f.document_id] ||= []).push(f)

    const documentsOut = documents.map((doc) => ({
      documentId: doc.id,
      fileName: doc.file_name,
      categoryCode: doc.category_code,
      categoryLabel: doc.category_code ? categoryLabel[doc.category_code] || doc.category_code : null,
      status: doc.status,
      uploadedAt: doc.uploaded_at,
      processedAt: doc.processed_at,
      fields: (fieldsByDoc[doc.id] || []).map((f) => ({
        fieldKey: f.field_key,
        fieldLabel: doc.category_code ? fieldLabel[`${doc.category_code}:${f.field_key}`] || f.field_key : f.field_key,
        value: f.field_value,
        confidence: f.confidence,
        includedInCalculation: f.included_in_calculation !== false,
        handEditedBySpecialist: f.verified_by_specialist === true,
        verifiedAt: f.verified_at,
        verifiedBy: f.verified_by
      }))
    }))

    const componentsOut = components.map((c) => ({
      documentId: c.document_id,
      sourceDocument: documentsOut.find((d) => d.documentId === c.document_id)?.fileName || null,
      componentType: c.component_type,
      sectionKey: c.section_key,
      amount: c.amount,
      includedInTotal: !c.needs_verification,
      needsVerification: c.needs_verification,
      currencyCode: c.currency_code,
      fieldLabel: c.field_label,
      sourceLabel: c.source_label,
      label: c.label
    }))

    const result = {
      generatedAt: new Date().toISOString(),
      client: {
        id: client.id,
        email: client.email,
        firstName: client.first_name,
        lastName: client.last_name,
        canton: client.canton,
        status: client.status
      },
      persons: (personsRes.data || []).map((p) => ({
        personType: p.person_type,
        firstName: p.first_name,
        lastName: p.last_name,
        maritalStatus: p.marital_status,
        dateOfBirth: p.date_of_birth,
        workPercentage: p.work_percentage
      })),
      children: (childrenRes.data || []).map((c) => ({
        fullName: c.full_name,
        dateOfBirth: c.date_of_birth,
        untilWhen: c.until_when
      })),
      taxYear,
      documents: documentsOut,
      aggregate: aggregateRes.data
        ? {
            computedAt: aggregateRes.data.computed_at,
            status: aggregateRes.data.status,
            taxableIncomeCantonal: aggregateRes.data.taxable_income_cantonal,
            taxableWealthCantonal: aggregateRes.data.taxable_wealth_cantonal,
            taxableIncomeFederal: aggregateRes.data.taxable_income_federal,
            uncertainParameters: aggregateRes.data.uncertain_parameters || []
          }
        : null,
      components: componentsOut,
      // Quick pointer to exactly the fields a specialist has hand-touched —
      // the thing this tool exists to make visible without hunting through
      // every document one by one.
      handEditedFields: documentsOut.flatMap((doc) =>
        doc.fields
          .filter((f) => f.handEditedBySpecialist)
          .map((f) => ({ document: doc.fileName, category: doc.categoryLabel, field: f.fieldLabel, value: f.value, verifiedAt: f.verifiedAt }))
      )
    }

    return res.status(200).json(result)
  } catch (error) {
    console.error('[diagnose-client]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

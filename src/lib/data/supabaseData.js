// ---------------------------------------------------------------------------
// Supabase data layer. Same method signatures as the demo layer.
// Everything is additionally protected by RLS on the database side — the
// filters here are for convenience, not for security.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient'
import { APP_ID, STORAGE_BUCKET, STORAGE_ROOT } from '../config'
import { safeFileName } from '../format'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function callApi(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || 'REQUEST_FAILED')
    err.code = json.code
    err.details = json
    throw err
  }
  return json
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export const supabaseApi = {
  isDemo: false,

  async listDocumentTypes() {
    return unwrap(
      await supabase
        .from('document_types')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true })
    )
  },

  async listPricing() {
    return unwrap(
      await supabase
        .from('pricing_items')
        .select('*')
        .eq('app_id', APP_ID)
        .eq('active', true)
        .order('sort_order', { ascending: true })
    )
  },

  async getMyClient(profileId) {
    if (!profileId) return null
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error) throw error
    return data
  },

  async listClients({ q = '', year = null, status = null, includeArchived = false } = {}) {
    let query = supabase
      .from('clients')
      .select('*, tax_cases(id, tax_year, status, updated_at)')
      .eq('app_id', APP_ID)
      .order('last_name', { ascending: true })

    if (!includeArchived) {
      query = query.neq('status', 'archived')
    }

    if (q) {
      const needle = `%${q}%`
      query = query.or(
        `first_name.ilike.${needle},last_name.ilike.${needle},email.ilike.${needle}`
      )
    }

    let rows = unwrap(await query) || []

    rows = rows.map((c) => {
      const cases = [...(c.tax_cases || [])].sort((a, b) => b.tax_year - a.tax_year)
      return { ...c, cases_count: cases.length, latest_case: cases[0] || null, cases }
    })

    if (year) rows = rows.filter((c) => c.cases.some((k) => k.tax_year === Number(year)))
    if (status) {
      rows = rows.filter((c) =>
        c.cases.some((k) => k.status === status && (!year || k.tax_year === Number(year)))
      )
    }
    return rows
  },

  async getClient(id) {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data
  },

  // Creates the auth user (or links an existing one), the profile, the client
  // row and sends the invitation e-mail through Resend.
  async createClient(payload) {
    return callApi('/api/invite-client', payload)
  },

  async resendInvite(clientId) {
    return callApi('/api/invite-client', { clientId, resend: true })
  },

  async inviteStaff(payload) {
    return callApi('/api/invite-staff', payload)
  },

  async updateClient(id, patch) {
    return unwrap(await supabase.from('clients').update(patch).eq('id', id).select().single())
  },

  // Permanently removes the client, every row that hangs off it in THIS app,
  // its app_profiles row for hornung_crm, and — only if the same login isn't
  // also used by another WisiApp — the underlying auth.users account. This
  // needs service-role privileges (to see app_profiles rows across other
  // apps, and to call the auth admin API), so it runs server-side.
  async deleteClient(id) {
    return callApi('/api/delete-client', { clientId: id })
  },

  async getQuestionnaire(clientId) {
    const [details, persons, children, vehicles, properties] = await Promise.all([
      supabase.from('client_details').select('*').eq('client_id', clientId).maybeSingle(),
      supabase.from('client_persons').select('*').eq('client_id', clientId),
      supabase.from('client_children').select('*').eq('client_id', clientId).order('sort_order'),
      supabase.from('client_vehicles').select('*').eq('client_id', clientId).order('sort_order'),
      supabase.from('client_properties').select('*').eq('client_id', clientId).order('sort_order')
    ])
    return {
      details: details.data || { client_id: clientId },
      persons: persons.data || [],
      children: children.data || [],
      vehicles: vehicles.data || [],
      properties: properties.data || []
    }
  },

  async saveQuestionnaire(clientId, payload) {
    const { details, persons = [], children = [], vehicles = [], properties = [] } = payload

    unwrap(
      await supabase
        .from('client_details')
        .upsert({ ...details, client_id: clientId }, { onConflict: 'client_id' })
    )

    // persons are keyed by (client_id, person_type)
    if (persons.length) {
      unwrap(
        await supabase.from('client_persons').upsert(
          persons.map((p) => ({ ...p, client_id: clientId })),
          { onConflict: 'client_id,person_type' }
        )
      )
    }
    const keptTypes = persons.map((p) => p.person_type)
    if (keptTypes.length) {
      await supabase
        .from('client_persons')
        .delete()
        .eq('client_id', clientId)
        .not('person_type', 'in', `(${keptTypes.join(',')})`)
    }

    // child collections: replace wholesale (small lists, keeps the UI simple)
    const replaceAll = async (table, rows) => {
      await supabase.from(table).delete().eq('client_id', clientId)
      if (rows.length) {
        unwrap(
          await supabase.from(table).insert(
            rows.map(({ id, ...rest }, index) => ({ ...rest, client_id: clientId, sort_order: index }))
          )
        )
      }
    }
    await replaceAll('client_children', children)
    await replaceAll('client_vehicles', vehicles)
    await replaceAll('client_properties', properties)

    // A self-registered client has no other way to put their name on file —
    // the questionnaire's "primary" person is the only place they can enter
    // it. Mirror it onto clients.first_name/last_name (and app_profiles.
    // full_name) so the greeting and every other place reading from
    // `clients` show the real name instead of the e-mail forever.
    // update_my_contact() is a SECURITY DEFINER RPC (see
    // 20260101000003_hornung_rls.sql): clients have no direct UPDATE policy
    // on `clients`, so this is the only way for them to do it themselves.
    // Note: supabase.rpc() returns a PostgrestBuilder, which is "thenable"
    // but not a real Promise (no .catch()) — always await it inside a plain
    // try/catch, never chain .catch() directly on it.
    const primary = persons.find((p) => p.person_type === 'primary')
    const primaryFirstName = primary?.first_name?.trim()
    const primaryLastName = primary?.last_name?.trim()
    if (primaryFirstName || primaryLastName) {
      try {
        await supabase.rpc('update_my_contact', {
          p_first_name: primaryFirstName || null,
          p_last_name: primaryLastName || null,
          p_phone: null,
          p_language: null
        })
      } catch (err) {
        console.error('[saveQuestionnaire] update_my_contact failed', err)
      }
    }

    return this.getQuestionnaire(clientId)
  },

  async listCases(clientId) {
    const cases = unwrap(
      await supabase
        .from('tax_cases')
        .select('*')
        .eq('client_id', clientId)
        .order('tax_year', { ascending: false })
    )
    if (!cases?.length) return []

    const counts = unwrap(
      await supabase
        .from('case_documents')
        .select('case_id, direction')
        .in('case_id', cases.map((c) => c.id))
    )
    return cases.map((c) => ({
      ...c,
      client_documents: counts.filter((d) => d.case_id === c.id && d.direction === 'client_upload').length,
      specialist_documents: counts.filter((d) => d.case_id === c.id && d.direction === 'specialist_upload').length
    }))
  },

  async getCase(caseId) {
    const { data, error } = await supabase
      .from('tax_cases')
      .select('*, client:clients(*)')
      .eq('id', caseId)
      .maybeSingle()
    if (error) throw error
    return data
  },

  async createCase(clientId, taxYear) {
    const { data, error } = await supabase
      .from('tax_cases')
      .insert({ client_id: clientId, tax_year: Number(taxYear), status: 'opened' })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') throw new Error('YEAR_EXISTS')
      throw error
    }
    return data
  },

  async updateCase(caseId, patch) {
    return unwrap(await supabase.from('tax_cases').update(patch).eq('id', caseId).select().single())
  },

  async setCaseStatus(caseId, { status, client_message = null, notify = false }) {
    if (notify) {
      // the serverless function updates the row AND sends the e-mail
      return callApi('/api/case-status', { caseId, status, clientMessage: client_message, notify })
    }
    const patch = { status }
    if (client_message !== null) patch.client_message = client_message
    const data = unwrap(
      await supabase.from('tax_cases').update(patch).eq('id', caseId).select().single()
    )
    return { case: data, emailSent: false }
  },

  async listDocuments(caseId) {
    const rows = unwrap(
      await supabase
        .from('case_documents')
        .select('*, client_documents(category_code)')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
    )
    return (rows || []).map((r) => ({
      ...r,
      category_code: r.client_documents?.category_code ?? null
    }))
  },

  // Catalogue for the extraction module (supabase/migrations/20260101000007_tax_extraction_schema.sql).
  async listDocumentCategories() {
    return unwrap(
      await supabase
        .from('document_categories')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true })
    )
  },

  // Assigns/changes the category of the client_documents row mirrored from
  // this case_documents row (see 20260101000008_client_documents_mirror.sql).
  async setDocumentCategory(caseDocumentId, categoryCode) {
    return unwrap(
      await supabase
        .from('client_documents')
        .update({ category_code: categoryCode })
        .eq('source_case_document_id', caseDocumentId)
        .select()
        .single()
    )
  },

  // Tax settings — admin-editable dictionary of expected fields per document
  // category (staff only, enforced by RLS: "field defs: staff write").
  async listFieldDefinitions() {
    return unwrap(
      await supabase
        .from('category_field_definitions')
        .select('*')
        .order('category_code', { ascending: true })
        .order('sort_order', { ascending: true })
    )
  },

  async createFieldDefinition(payload) {
    return unwrap(
      await supabase.from('category_field_definitions').insert(payload).select().single()
    )
  },

  async updateFieldDefinition(id, patch) {
    return unwrap(
      await supabase
        .from('category_field_definitions')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
    )
  },

  async deleteFieldDefinition(id) {
    unwrap(await supabase.from('category_field_definitions').delete().eq('id', id))
    return true
  },

  // Specialist verification of AI-extracted values (extracted_document_fields
  // is keyed by client_documents.id, so we resolve it from the case_documents
  // id every caller actually has — same indirection as setDocumentCategory).
  // "Direct" primitives — the caller already has the real client_documents.id
  // (e.g. the tax summary, which queries client_documents itself).
  async listExtractedFieldsForDocument(documentId) {
    return unwrap(
      await supabase.from('extracted_document_fields').select('*').eq('document_id', documentId)
    )
  },

  async saveExtractedFieldForDocument(documentId, payload) {
    return unwrap(
      await supabase
        .from('extracted_document_fields')
        .upsert({ document_id: documentId, ...payload }, { onConflict: 'document_id,field_key' })
        .select()
        .single()
    )
  },

  // Case-document-indirected variants — DocumentList only ever has the
  // case_documents.id (see setDocumentCategory), so resolve the mirrored
  // client_documents row first and delegate to the direct primitives above.
  async listExtractedFields(caseDocumentId) {
    const { data: clientDoc, error: clientDocError } = await supabase
      .from('client_documents')
      .select('id')
      .eq('source_case_document_id', caseDocumentId)
      .maybeSingle()
    if (clientDocError) throw clientDocError
    if (!clientDoc) return []
    return this.listExtractedFieldsForDocument(clientDoc.id)
  },

  async saveExtractedField(caseDocumentId, payload) {
    const { data: clientDoc, error: clientDocError } = await supabase
      .from('client_documents')
      .select('id')
      .eq('source_case_document_id', caseDocumentId)
      .maybeSingle()
    if (clientDocError) throw clientDocError
    if (!clientDoc) throw new Error('CLIENT_DOCUMENT_NOT_FOUND')
    return this.saveExtractedFieldForDocument(clientDoc.id, payload)
  },

  // All of a client's documents for one tax year, across every case in that
  // year — the tax summary's raw material.
  async listClientDocuments(clientId, taxYear) {
    return unwrap(
      await supabase
        .from('client_documents')
        .select('*')
        .eq('client_id', clientId)
        .eq('tax_year', Number(taxYear))
    )
  },

  async uploadDocument(caseId, file, meta = {}) {
    const { clientId, taxYear, direction = 'client_upload', profileId } = meta
    const path = [
      STORAGE_ROOT,
      clientId,
      taxYear,
      direction,
      `${crypto.randomUUID()}-${safeFileName(file.name)}`
    ].join('/')

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
    if (uploadError) throw uploadError

    const row = unwrap(
      await supabase
        .from('case_documents')
        .insert({
          case_id: caseId,
          document_type_id: meta.document_type_id || null,
          direction,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          note: meta.note || null,
          uploaded_by: profileId || null
        })
        .select()
        .single()
    )

    await supabase.from('case_events').insert({
      case_id: caseId,
      event_type: 'document_uploaded',
      note: file.name,
      actor_id: profileId || null
    })

    return row
  },

  async deleteDocument(doc) {
    await supabase.storage.from(STORAGE_BUCKET).remove([doc.storage_path])
    unwrap(await supabase.from('case_documents').delete().eq('id', doc.id))
    return true
  },

  async notifyLateUpload(payload) {
    return callApi('/api/notify-late-upload', payload)
  },

  async getDownloadUrl(doc, { download = true } = {}) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(doc.storage_path, 300, download ? { download: doc.file_name } : {})
    if (error) throw error
    return data.signedUrl
  },

  async listRequested(caseId) {
    return unwrap(
      await supabase.from('case_requested_documents').select('*').eq('case_id', caseId)
    )
  },

  async setRequested(caseId, typeIds) {
    await supabase.from('case_requested_documents').delete().eq('case_id', caseId)
    if (typeIds.length) {
      unwrap(
        await supabase
          .from('case_requested_documents')
          .insert(typeIds.map((id) => ({ case_id: caseId, document_type_id: id, required: true })))
      )
    }
    return this.listRequested(caseId)
  },

  async listEvents(caseId) {
    return unwrap(
      await supabase
        .from('case_events')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(50)
    )
  },

  async listExtracted(caseId) {
    const rows = unwrap(
      await supabase
        .from('extracted_fields')
        .select('*, document:case_documents(file_name)')
        .eq('case_id', caseId)
    )
    return (rows || []).map((r) => ({ ...r, document_name: r.document?.file_name || null }))
  },

  async getStats(year) {
    const rows = unwrap(
      await supabase.from('tax_cases').select('status, tax_year').eq('tax_year', Number(year))
    )
    const clients = unwrap(
      await supabase.from('clients').select('id, status').eq('app_id', APP_ID)
    )
    return {
      open: rows.filter((c) => c.status !== 'finished').length,
      waiting: rows.filter((c) => c.status === 'waiting_client').length,
      inProcess: rows.filter((c) => c.status === 'in_process').length,
      finished: rows.filter((c) => c.status === 'finished').length,
      clients: clients.filter((c) => c.status !== 'archived').length
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase data layer. Same method signatures as the demo layer.
// Everything is additionally protected by RLS on the database side — the
// filters here are for convenience, not for security.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient'
import { APP_ID, STORAGE_BUCKET, STORAGE_ROOT } from '../config'
import { safeFileName } from '../format'
import { normalizePropertyAddress } from '../personalDetails'

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

  // Staff-only price-list management (/pricing-settings) — includes
  // inactive (soft-deleted) rows so a specialist can see the full history,
  // not just what clients currently see.
  async listPricingItemsForStaff() {
    return unwrap(
      await supabase
        .from('pricing_items')
        .select('*')
        .eq('app_id', APP_ID)
        .order('sort_order', { ascending: true })
    )
  },

  async createPricingItem(payload) {
    return unwrap(
      await supabase
        .from('pricing_items')
        .insert({ app_id: APP_ID, active: true, ...payload })
        .select()
        .single()
    )
  },

  async updatePricingItem(id, patch) {
    return unwrap(await supabase.from('pricing_items').update(patch).eq('id', id).select().single())
  },

  // Soft delete only — pricing_items has no FK pointing at it, but a past
  // fee estimate's own line items already snapshot label/price at the time,
  // so nothing downstream needs this row to keep existing; `active: false`
  // is enough to stop it appearing anywhere (read RLS/listPricing already
  // filter on it) while keeping it visible in the staff-only management
  // list above.
  async deletePricingItem(id) {
    return unwrap(await supabase.from('pricing_items').update({ active: false }).eq('id', id).select().single())
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

  // Swaps who is "primary" and who is "spouse" — persons, documents already
  // attributed to them, pending suggestions and the display-order override,
  // all in one transaction (migration 51; rules in src/lib/personSwap.js).
  async swapPrimaryAndSpouse(clientId) {
    unwrap(await supabase.rpc('swap_primary_and_spouse', { p_client_id: clientId }))
    return this.getQuestionnaire(clientId)
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
    // A failed read must not look like an empty questionnaire: saving that
    // form would then overwrite the real one with blanks.
    const failed = [details, persons, children, vehicles, properties].find((r) => r.error)
    if (failed) throw failed.error
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

  // The client's own "Add tax year" button (see selectableClientTaxYears/
  // validateClientCaseCreation in src/lib/caseCreation.js for the picker
  // range and the client-side mirror of the RLS rule below) — same table,
  // same row shape as createCase above, just tagged created_by_client so
  // the specialist's own case list can flag it. The real gate is
  // "cases: client insert own" (see migration
  // 20260101000041_client_created_tax_year.sql): client_id must be the
  // caller's own, and tax_year must not be in the future — a mismatched
  // clientId or a future year is rejected by Postgres itself, not just by
  // this app's own UI.
  async createOwnCase(clientId, taxYear) {
    const { data, error } = await supabase
      .from('tax_cases')
      .insert({ client_id: clientId, tax_year: Number(taxYear), status: 'opened', created_by_client: true })
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

  // AI-extracted values, read-only (written only by api/extract-document.js).
  // Keyed by client_documents.id — Tax Summary has it directly.
  async listExtractedFieldsForDocument(documentId) {
    return unwrap(
      await supabase.from('extracted_document_fields').select('*').eq('document_id', documentId)
    )
  },

  // "Other information found" — values a document holds that no whitelist
  // field covers (document_other_findings, migration 46). Read-only here:
  // they are written exclusively by api/extract-document.js and replaced
  // wholesale whenever the document is re-extracted.
  async listOtherFindingsForDocuments(documentIds) {
    if (!documentIds?.length) return []
    return unwrap(
      await supabase
        .from('document_other_findings')
        .select('*')
        .in('document_id', documentIds)
        .order('created_at', { ascending: true })
    )
  },

  // The same values by case_documents.id — the case page only has that id
  // (its Questionnaire check reads the personal-details sheet this way), so
  // resolve the mirrored client_documents row first.
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

  async retryExtraction(documentId) {
    return callApi('/api/retry-extraction', { documentId })
  },

  // The "reload everything" safety net — re-extracts every document of a
  // client/year in one action instead of one at a time (see
  // api/reprocess-client-year.js).
  async reprocessClientYear(clientId, taxYear) {
    return callApi('/api/reprocess-client-year', { clientId, taxYear: Number(taxYear) })
  },

  // Questionnaire "fill from a document/pasted text" action: routes through
  // the same upload + extraction pipeline as any other document (so the
  // result lands as client_field_suggestions to confirm, not a direct
  // write), but forces category_code so there's no classification ambiguity
  // and triggers extraction synchronously instead of waiting for the async
  // pg_net webhook (see api/extract-document-now.js).
  async fillQuestionnaireFromDocument(caseId, file, meta = {}) {
    const caseDoc = await this.uploadDocument(caseId, file, { ...meta, direction: 'client_upload' })
    const clientDoc = unwrap(
      await supabase
        .from('client_documents')
        .select('id')
        .eq('source_case_document_id', caseDoc.id)
        .maybeSingle()
    )
    if (!clientDoc) throw new Error('MIRROR_NOT_READY')
    return callApi('/api/extract-document-now', { documentId: clientDoc.id, categoryCode: 'current_tax_sheet' })
  },

  async fillQuestionnaireFromText(caseId, text, meta = {}) {
    const file = new File([text], `pasted-text-${Date.now()}.txt`, { type: 'text/plain' })
    return this.fillQuestionnaireFromDocument(caseId, file, meta)
  },

  // Tax Summary's "ask about this case" chat bubble — see
  // api/case-assistant.js (staff-only, rebuilds the case's context from the
  // database on every call) and case_assistant_messages (staff-only RLS,
  // never client-visible). Read directly (RLS already scopes it to staff),
  // the question itself goes through the serverless function since it's
  // the one holding the Anthropic key.
  async listCaseAssistantMessages(caseId) {
    return unwrap(
      await supabase
        .from('case_assistant_messages')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true })
    )
  },

  async askCaseAssistant(caseId, message) {
    return callApi('/api/case-assistant', { caseId, message })
  },

  // Tax settings "AI" tab — which Claude model each AI-backed feature uses
  // (see src/lib/aiModels.js's resolveModel: this beats the env var, which
  // beats the hardcoded default). A missing row for a key means "no
  // override", not an error.
  async listAiModelSettings() {
    return unwrap(await supabase.from('ai_model_settings').select('*'))
  },

  async saveAiModelSetting(key, model, updatedBy) {
    return unwrap(
      await supabase
        .from('ai_model_settings')
        .upsert({ key, model: model || null, updated_by: updatedBy || null }, { onConflict: 'key' })
        .select()
        .single()
    )
  },

  // "Personal details" (current_tax_sheet) -> registry sync — the
  // AI-extraction path (api/extract-document.js) triggers this on its own;
  // this call is for right after a specialist manually corrects a field on
  // such a document.
  async syncPersonalDetails(documentId) {
    return callApi('/api/sync-personal-details', { documentId })
  },

  async syncPropertySuggestion(documentId) {
    return callApi('/api/sync-property-suggestion', { documentId })
  },

  async syncChildSuggestions(clientId, taxYear) {
    return callApi('/api/sync-child-suggestions', { clientId, taxYear: Number(taxYear) })
  },

  async listFieldSuggestions(clientId) {
    return unwrap(
      await supabase
        .from('client_field_suggestions')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
    )
  },

  async resolveFieldSuggestion(suggestion, accept) {
    if (accept) {
      if (suggestion.target_table === 'clients') {
        unwrap(
          await supabase
            .from('clients')
            .update({ [suggestion.target_field]: suggestion.suggested_value })
            .eq('id', suggestion.client_id)
        )
      } else if (suggestion.target_table === 'client_persons') {
        const existing = unwrap(
          await supabase
            .from('client_persons')
            .select('id')
            .eq('client_id', suggestion.client_id)
            .eq('person_type', suggestion.target_person)
            .maybeSingle()
        )
        if (existing) {
          unwrap(
            await supabase
              .from('client_persons')
              .update({ [suggestion.target_field]: suggestion.suggested_value })
              .eq('id', existing.id)
          )
        } else {
          unwrap(
            await supabase.from('client_persons').insert({
              client_id: suggestion.client_id,
              person_type: suggestion.target_person,
              [suggestion.target_field]: suggestion.suggested_value
            })
          )
        }
      } else if (suggestion.target_table === 'client_properties') {
        // Deduplicated first by source document (this exact document
        // already linked from an earlier accepted suggestion), then by
        // normalized address — a DIFFERENT document (mortgage certificate,
        // rental statement, ...) naming the same real property, just
        // formatted differently — updated in place either way instead of
        // creating a duplicate row for the same property.
        const payload = JSON.parse(suggestion.suggested_value)
        const normalizedIncoming = normalizePropertyAddress(payload.address)
        const clientProperties = unwrap(
          await supabase
            .from('client_properties')
            .select('id, address, source_document_id')
            .eq('client_id', suggestion.client_id)
        )
        const existing =
          (clientProperties || []).find((p) => p.source_document_id === suggestion.document_id) ||
          (normalizedIncoming
            ? (clientProperties || []).find((p) => normalizePropertyAddress(p.address) === normalizedIncoming)
            : null) ||
          null
        if (existing) {
          unwrap(await supabase.from('client_properties').update(payload).eq('id', existing.id))
        } else {
          unwrap(
            await supabase
              .from('client_properties')
              .insert({ client_id: suggestion.client_id, source_document_id: suggestion.document_id, ...payload })
          )
        }
      } else if (suggestion.target_table === 'client_children') {
        // No document-link dedup column here — buildChildSuggestionCandidates
        // only ever proposes a name that doesn't already match an existing
        // child, so a plain insert is safe.
        const payload = JSON.parse(suggestion.suggested_value)
        unwrap(await supabase.from('client_children').insert({ client_id: suggestion.client_id, ...payload }))
      }
    }
    unwrap(await supabase.from('client_field_suggestions').delete().eq('id', suggestion.id))
    return true
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

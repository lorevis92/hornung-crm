// ---------------------------------------------------------------------------
// The app's data layer.
//
// The browser never talks to the database: every method below is one call to
// our own serverless functions — POST /api/data/<op> (api/data/[op].js +
// api/_dataOps.js) or one of the dedicated endpoints — which check the
// session cookie and apply the access rules (a client only ever reaches their
// own records) before touching anything. The filters here are for
// convenience, not for security.
// (File name kept from the Supabase days so nothing importing it changes.)
// ---------------------------------------------------------------------------

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || 'REQUEST_FAILED')
    err.code = json.code
    err.status = res.status
    err.details = json
    throw err
  }
  return json
}

// The dedicated endpoints (invites, status e-mail, extraction, ...).
function callApi(path, body) {
  return postJson(path, body)
}

// Extractions run on the server's queue (api/_extractionQueue.js): the
// endpoint answers with a job id at once, and this waits for the job the
// way the page used to wait for the request — so every caller still gets
// its result (or its error) from one await.
const JOB_POLL_MS = 2000
const JOB_TIMEOUT_MS = 20 * 60 * 1000

async function waitForExtractionJob(jobId) {
  const started = Date.now()
  for (;;) {
    const job = await data('getExtractionJob', { jobId })
    if (job.finished) return job
    if (Date.now() - started > JOB_TIMEOUT_MS) {
      const err = new Error('EXTRACTION_STILL_RUNNING')
      err.code = 'EXTRACTION_STILL_RUNNING'
      throw err
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS))
  }
}

// A one-document job -> nothing on success; its error as a thrown Error,
// as the synchronous endpoints did.
function throwIfDocumentFailed(job) {
  const failure = job.failures[0]
  if (!failure) return
  const already = failure.error === 'ALREADY_PROCESSING'
  const err = new Error(already ? 'This document was already being processed — nothing was re-extracted.' : failure.error)
  err.code = already ? 'NOT_RETRYABLE' : 'EXTRACTION_FAILED'
  throw err
}

// One database operation, run and authorized server-side.
async function data(op, args) {
  const json = await postJson(`/api/data/${op}`, args)
  return json.data
}

// The browser uploads the file itself (raw body) to a signed URL the server
// issued for a path inside this case's own folder (api/files.js streams it
// into R2) — no database or storage credential here.
async function putToSignedUrl(signedUrl, file) {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    const err = new Error(json.message || json.error || 'UPLOAD_FAILED')
    err.code = 'UPLOAD_FAILED'
    throw err
  }
}

export const supabaseApi = {
  async listDocumentTypes() {
    return data('listDocumentTypes')
  },

  async listPricing() {
    return data('listPricing')
  },

  // Staff-only price-list management (/pricing-settings) — includes
  // inactive (soft-deleted) rows so a specialist can see the full history,
  // not just what clients currently see.
  async listPricingItemsForStaff() {
    return data('listPricingItemsForStaff')
  },

  async createPricingItem(payload) {
    return data('createPricingItem', { payload })
  },

  async updatePricingItem(id, patch) {
    return data('updatePricingItem', { id, patch })
  },

  // Soft delete only (`active: false`) — see api/_dataOps.js.
  async deletePricingItem(id) {
    return data('deletePricingItem', { id })
  },

  // The signed-in client's own record; the server ignores whose profile id
  // is passed and always answers for the session's own.
  async getMyClient(profileId) {
    if (!profileId) return null
    return data('getMyClient')
  },

  async listClients(filters = {}) {
    return data('listClients', filters)
  },

  async getClient(id) {
    return data('getClient', { id })
  },

  // Creates the login (or links an existing one), the profile, the client
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
    return data('updateClient', { id, patch })
  },

  // Swaps who is "primary" and who is "spouse" — persons, documents already
  // attributed to them, pending suggestions and the display-order override,
  // all in one transaction (migrations 51/52; rules in src/lib/personSwap.js).
  async swapPrimaryAndSpouse(clientId) {
    return data('swapPrimaryAndSpouse', { clientId })
  },

  // Permanently removes the client, every row that hangs off it in THIS app,
  // its app_profiles row for hornung_crm, and — only if the same login isn't
  // also used by another app — the login itself (api/delete-client.js).
  async deleteClient(id) {
    return callApi('/api/delete-client', { clientId: id })
  },

  async getQuestionnaire(clientId) {
    return data('getQuestionnaire', { clientId })
  },

  // Also mirrors the primary person's name onto the client's own record
  // when the client saves it themselves (see api/_dataOps.js).
  async saveQuestionnaire(clientId, payload) {
    return data('saveQuestionnaire', { clientId, payload })
  },

  async listCases(clientId) {
    return data('listCases', { clientId })
  },

  async getCase(caseId) {
    return data('getCase', { caseId })
  },

  async createCase(clientId, taxYear) {
    return data('createCase', { clientId, taxYear: Number(taxYear) })
  },

  // The client's own "Add tax year" button (see selectableClientTaxYears/
  // validateClientCaseCreation in src/lib/caseCreation.js for the picker
  // range). The server enforces the same rule as the "cases: client insert
  // own" policy (migration 41): the client's own clientId, and no year in
  // the future.
  async createOwnCase(clientId, taxYear) {
    return data('createOwnCase', { clientId, taxYear: Number(taxYear) })
  },

  async updateCase(caseId, patch) {
    return data('updateCase', { caseId, patch })
  },

  async setCaseStatus(caseId, { status, client_message = null, notify = false }) {
    if (notify) {
      // the serverless function updates the row AND sends the e-mail
      return callApi('/api/case-status', { caseId, status, clientMessage: client_message, notify })
    }
    return data('setCaseStatus', { caseId, status, client_message })
  },

  async listDocuments(caseId) {
    return data('listDocuments', { caseId })
  },

  // Catalogue for the extraction module (db/migrations/20260101000007_tax_extraction_schema.sql).
  async listDocumentCategories() {
    return data('listDocumentCategories')
  },

  // Assigns/changes the category of the client_documents row mirrored from
  // this case_documents row (see 20260101000008_client_documents_mirror.sql).
  async setDocumentCategory(caseDocumentId, categoryCode) {
    return data('setDocumentCategory', { caseDocumentId, categoryCode })
  },

  // Tax settings — admin-editable dictionary of expected fields per document
  // category (writes: staff only).
  async listFieldDefinitions() {
    return data('listFieldDefinitions')
  },

  async createFieldDefinition(payload) {
    return data('createFieldDefinition', { payload })
  },

  async updateFieldDefinition(id, patch) {
    return data('updateFieldDefinition', { id, patch })
  },

  async deleteFieldDefinition(id) {
    return data('deleteFieldDefinition', { id })
  },

  // AI-extracted values, read-only (written only by api/extract-document.js).
  // Keyed by client_documents.id — Tax Summary has it directly.
  async listExtractedFieldsForDocument(documentId) {
    return data('listExtractedFieldsForDocument', { documentId })
  },

  // The same for many documents in ONE request (and one query server-side)
  // — Tax Summary loads a whole case this way instead of one request per
  // document.
  async listExtractedFieldsForDocuments(documentIds) {
    if (!documentIds?.length) return []
    return data('listExtractedFieldsForDocuments', { documentIds })
  },

  // "Other information found" — values a document holds that no whitelist
  // field covers (document_other_findings, migration 46). Read-only here.
  async listOtherFindingsForDocuments(documentIds) {
    if (!documentIds?.length) return []
    return data('listOtherFindingsForDocuments', { documentIds })
  },

  // The same values by case_documents.id — the case page only has that id.
  async listExtractedFields(caseDocumentId) {
    return data('listExtractedFields', { caseDocumentId })
  },

  // All of a client's documents for one tax year, across every case in that
  // year — the tax summary's raw material.
  async listClientDocuments(clientId, taxYear) {
    return data('listClientDocuments', { clientId, taxYear: Number(taxYear) })
  },

  // One document, for the full-page viewer (src/pages/DocumentViewer.jsx).
  async getClientDocument(documentId) {
    return data('getClientDocument', { documentId })
  },

  async retryExtraction(documentId) {
    const { jobId } = await callApi('/api/retry-extraction', { documentId })
    throwIfDocumentFailed(await waitForExtractionJob(jobId))
    return { ok: true }
  },

  // The "reload everything" safety net — re-extracts every document of a
  // client/year in one action instead of one at a time (see
  // api/reprocess-client-year.js).
  async reprocessClientYear(clientId, taxYear) {
    const { jobId } = await callApi('/api/reprocess-client-year', { clientId, taxYear: Number(taxYear) })
    const job = await waitForExtractionJob(jobId)
    return { processed: job.processed, failed: job.failed, failures: job.failures, mergedProperties: job.mergedProperties }
  },

  // Questionnaire "fill from a document/pasted text" action: routes through
  // the same upload + extraction pipeline as any other document (so the
  // result lands as client_field_suggestions to confirm, not a direct
  // write), but forces category_code so there's no classification ambiguity
  // and starts the extraction itself — not the automatic one — waiting for
  // its outcome (see api/extract-document-now.js).
  async fillQuestionnaireFromDocument(caseId, file, meta = {}) {
    const caseDoc = await this.uploadDocument(caseId, file, { ...meta, direction: 'client_upload', extract: false })
    const clientDocumentId = await data('getMirroredClientDocumentId', { caseDocumentId: caseDoc.id })
    if (!clientDocumentId) throw new Error('MIRROR_NOT_READY')
    const { jobId } = await callApi('/api/extract-document-now', { documentId: clientDocumentId, categoryCode: 'current_tax_sheet' })
    const job = await waitForExtractionJob(jobId)
    const failure = job.failures.find((f) => f.error !== 'ALREADY_PROCESSING')
    if (failure) throw new Error(failure.error)
    return { ok: true }
  },

  async fillQuestionnaireFromText(caseId, text, meta = {}) {
    const file = new File([text], `pasted-text-${Date.now()}.txt`, { type: 'text/plain' })
    return this.fillQuestionnaireFromDocument(caseId, file, meta)
  },

  // Tax Summary's "ask about this case" chat bubble — see
  // api/case-assistant.js. Staff only, and only the caller's own
  // conversation.
  async listCaseAssistantMessages(caseId) {
    return data('listCaseAssistantMessages', { caseId })
  },

  async askCaseAssistant(caseId, message) {
    return callApi('/api/case-assistant', { caseId, message })
  },

  // Tax settings "AI" tab — which Claude model each AI-backed feature uses
  // (see src/lib/aiModels.js's resolveModel). A missing row for a key means
  // "no override", not an error. updated_by is always the caller.
  async listAiModelSettings() {
    return data('listAiModelSettings')
  },

  async saveAiModelSetting(key, model) {
    return data('saveAiModelSetting', { key, model: model || null })
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
    return data('listFieldSuggestions', { clientId })
  },

  // Where the value goes is re-read server-side from the stored suggestion;
  // only the (possibly edited) value travels from here.
  async resolveFieldSuggestion(suggestion, accept) {
    return data('resolveFieldSuggestion', {
      suggestionId: suggestion.id,
      accept: Boolean(accept),
      suggestedValue: suggestion.suggested_value
    })
  },

  // Two steps: the server picks the storage path inside this case's folder
  // and hands back a signed upload URL; once the file is there, the server
  // records it (case_documents + case_events). clientId/taxYear/profileId in
  // `meta` are no longer needed — the server reads them from the case and
  // the session.
  async uploadDocument(caseId, file, meta = {}) {
    const direction = meta.direction || 'client_upload'
    const ticket = await data('createUploadUrl', { caseId, fileName: file.name, direction })
    await putToSignedUrl(ticket.signedUrl, file)
    return data('registerUploadedDocument', {
      caseId,
      path: ticket.path,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      documentTypeId: meta.document_type_id || null,
      note: meta.note || null,
      direction,
      extract: meta.extract !== false
    })
  },

  async deleteDocument(doc) {
    return data('deleteDocument', { id: doc.id })
  },

  async notifyLateUpload(payload) {
    return callApi('/api/notify-late-upload', payload)
  },

  // `doc` is a case_documents or client_documents row; the server looks the
  // file up by id and checks access before signing a 5-minute URL.
  async getDownloadUrl(doc, { download = true } = {}) {
    return data('getDownloadUrl', { id: doc.id, download })
  },

  async listRequested(caseId) {
    return data('listRequested', { caseId })
  },

  async setRequested(caseId, typeIds) {
    return data('setRequested', { caseId, typeIds })
  },

  async getStats(year) {
    return data('getStats', { year: Number(year) })
  },

  // Own name / canton / phone / language — what the update_my_contact() RPC
  // did. null = leave as it is.
  async updateMyContact(fields) {
    return data('updateMyContact', fields)
  }
}

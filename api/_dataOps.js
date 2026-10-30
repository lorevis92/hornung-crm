// Every read/write the browser used to send straight to Postgres with the
// anon key (src/lib/data/supabaseData.js), now run here, server-side, behind
// POST /api/data/<op> (api/data/[op].js).
//
// The service-role client used here bypasses RLS, so EVERY op starts with an
// explicit authorization check that reproduces the policy it replaces —
// supabase/migrations/20260101000003_hornung_rls.sql and later:
//   * staff (specialist/admin of hornung_crm)  -> everything in this app
//   * client                                   -> only their own clients row,
//     questionnaire, cases, documents, requested documents; may upload into
//     their own cases (client_upload only), delete their own uploads while the
//     case is still open, and add a past/current tax year for themselves
//   * extraction results, suggestions, settings, pricing management,
//     assistant chat                            -> staff only (assistant: only
//     the staff member's own conversation)
//   * catalogues (document types, categories, field dictionary, active
//     prices)                                   -> anyone signed in with a profile
// The RLS policies stay in place underneath as a second line of defence for
// anything still reaching PostgREST with a user JWT.
import { APP_ID, httpError } from './_lib.js'
import { safeFileName } from '../src/lib/format.js'
import { normalizePropertyAddress } from '../src/lib/personalDetails.js'

// Keep in sync with src/lib/config.js (Vite-only, can't be imported here).
export const STORAGE_BUCKET = 'client-documents'
export const STORAGE_ROOT = 'hornung'
// "documents: client delete own" -> case_is_open_for_client()
export const CLIENT_OPEN_CASE_STATUSES = ['opened', 'waiting_client', 'in_process']
const DIRECTIONS = ['client_upload', 'specialist_upload']
const SIGNED_URL_SECONDS = 300

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------
export function forbidden() {
  return httpError(403, 'FORBIDDEN', 'You do not have access to this record.')
}

function requireStaffActor(actor) {
  if (!actor.isStaff) throw httpError(403, 'NOT_STAFF', 'Only Hornung Consulting staff may perform this action.')
}

function requireId(value, name) {
  if (typeof value !== 'string' || !value) throw httpError(400, 'BAD_REQUEST', `${name} is required.`)
  return value
}

function dbError(error) {
  return httpError(error.status && error.status < 500 ? error.status : 400, error.code || 'DB_ERROR', error.message)
}

function unwrap({ data, error }) {
  if (error) throw dbError(error)
  return data
}

/** The clients row, if the actor may see it ("clients: staff all" /
 * "clients: read own"). */
export async function loadClientForActor(actor, clientId) {
  requireId(clientId, 'clientId')
  if (!actor.isStaff && actor.clientId !== clientId) throw forbidden()
  const client = unwrap(
    await actor.admin.from('clients').select('*').eq('id', clientId).eq('app_id', APP_ID).maybeSingle()
  )
  if (!client) throw actor.isStaff ? httpError(404, 'NOT_FOUND', 'Client not found.') : forbidden()
  return client
}

/** The tax_cases row, if the actor may see it ("cases: staff all" /
 * owns_case()). */
export async function loadCaseForActor(actor, caseId) {
  requireId(caseId, 'caseId')
  const row = unwrap(await actor.admin.from('tax_cases').select('*').eq('id', caseId).maybeSingle())
  if (!row) throw actor.isStaff ? httpError(404, 'NOT_FOUND', 'Case not found.') : forbidden()
  if (!actor.isStaff && (!actor.clientId || row.client_id !== actor.clientId)) throw forbidden()
  return row
}

function stripKeys(patch, keys) {
  const out = { ...(patch || {}) }
  for (const key of keys) delete out[key]
  return out
}

// The status trigger (log_case_status_change) records the actor through
// auth.uid(), which is null for the server — put the real one back.
async function attributeStatusChange(admin, caseId, profileId, sinceIso) {
  if (!profileId) return
  await admin
    .from('case_events')
    .update({ actor_id: profileId })
    .eq('case_id', caseId)
    .eq('event_type', 'status_change')
    .is('actor_id', null)
    .gte('created_at', sinceIso)
}

async function updateOwnContact(actor, { first_name = null, last_name = null, phone = null, language = null, canton = null }) {
  // Same semantics as the old update_my_contact() RPC: null = leave as is.
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const fn = clean(first_name)
  const ln = clean(last_name)
  const ph = clean(phone)
  const lang = ['en', 'de', 'fr', 'it'].includes(language) ? language : null
  const ct = clean(canton)

  if (actor.clientId) {
    const patch = {}
    if (fn) patch.first_name = fn
    if (ln) patch.last_name = ln
    if (ph) patch.phone = ph
    if (lang) patch.preferred_language = lang
    if (ct) patch.canton = ct
    if (Object.keys(patch).length) unwrap(await actor.admin.from('clients').update(patch).eq('id', actor.clientId))
  }
  const profilePatch = {}
  if (fn || ln) profilePatch.full_name = [fn, ln].filter(Boolean).join(' ')
  if (ph) profilePatch.phone = ph
  if (lang) profilePatch.locale = lang
  if (Object.keys(profilePatch).length) {
    unwrap(await actor.admin.from('app_profiles').update(profilePatch).eq('id', actor.profile.id))
  }
}

function storagePathPrefix(caseRow, direction) {
  return `${STORAGE_ROOT}/${caseRow.client_id}/${caseRow.tax_year}/${direction}/`
}

function assertUploadAllowed(actor, direction) {
  if (!DIRECTIONS.includes(direction)) throw httpError(400, 'BAD_DIRECTION', 'Unknown upload direction.')
  // "documents: client upload": direction = 'client_upload' only.
  if (!actor.isStaff && direction !== 'client_upload') throw forbidden()
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export const ops = {
  // ------------------------------------------------------------ catalogues --
  async listDocumentTypes(actor) {
    return unwrap(
      await actor.admin.from('document_types').select('*').eq('active', true).order('sort_order', { ascending: true })
    )
  },

  async listPricing(actor) {
    return unwrap(
      await actor.admin
        .from('pricing_items')
        .select('*')
        .eq('app_id', APP_ID)
        .eq('active', true)
        .order('sort_order', { ascending: true })
    )
  },

  async listDocumentCategories(actor) {
    return unwrap(
      await actor.admin.from('document_categories').select('*').eq('active', true).order('sort_order', { ascending: true })
    )
  },

  async listFieldDefinitions(actor) {
    return unwrap(
      await actor.admin
        .from('category_field_definitions')
        .select('*')
        .order('category_code', { ascending: true })
        .order('sort_order', { ascending: true })
    )
  },

  // --------------------------------------------------- pricing (staff) ----
  async listPricingItemsForStaff(actor) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin.from('pricing_items').select('*').eq('app_id', APP_ID).order('sort_order', { ascending: true })
    )
  },

  async createPricingItem(actor, { payload }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('pricing_items')
        .insert({ active: true, ...stripKeys(payload, ['id']), app_id: APP_ID })
        .select()
        .single()
    )
  },

  async updatePricingItem(actor, { id, patch }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('pricing_items')
        .update(stripKeys(patch, ['id', 'app_id']))
        .eq('id', requireId(id, 'id'))
        .eq('app_id', APP_ID)
        .select()
        .single()
    )
  },

  async deletePricingItem(actor, { id }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('pricing_items')
        .update({ active: false })
        .eq('id', requireId(id, 'id'))
        .eq('app_id', APP_ID)
        .select()
        .single()
    )
  },

  // ------------------------------------------------------------- clients --
  // The caller's own clients row — never someone else's, whatever profile id
  // the page passes.
  async getMyClient(actor) {
    if (!actor.clientId) return null
    return unwrap(await actor.admin.from('clients').select('*').eq('id', actor.clientId).maybeSingle())
  },

  async listClients(actor, { q = '', year = null, status = null, includeArchived = false } = {}) {
    requireStaffActor(actor)
    const admin = actor.admin
    let query = admin.from('clients').select('*').eq('app_id', APP_ID).order('last_name', { ascending: true })
    if (!includeArchived) query = query.neq('status', 'archived')
    let rows = unwrap(await query) || []

    if (q) {
      const needle = String(q).toLowerCase()
      rows = rows.filter((c) =>
        [c.first_name, c.last_name, c.email].some((v) => String(v || '').toLowerCase().includes(needle))
      )
    }

    const ids = rows.map((c) => c.id)
    const allCases = ids.length
      ? unwrap(await admin.from('tax_cases').select('id, client_id, tax_year, status, updated_at').in('client_id', ids)) || []
      : []

    rows = rows.map((c) => {
      const cases = allCases
        .filter((k) => k.client_id === c.id)
        .map(({ client_id, ...k }) => k)
        .sort((a, b) => b.tax_year - a.tax_year)
      return { ...c, tax_cases: cases, cases_count: cases.length, latest_case: cases[0] || null, cases }
    })

    if (year) rows = rows.filter((c) => c.cases.some((k) => k.tax_year === Number(year)))
    if (status) {
      rows = rows.filter((c) => c.cases.some((k) => k.status === status && (!year || k.tax_year === Number(year))))
    }
    return rows
  },

  async getClient(actor, { id }) {
    return loadClientForActor(actor, id)
  },

  // Clients have no UPDATE policy on `clients` — staff only.
  async updateClient(actor, { id, patch }) {
    requireStaffActor(actor)
    await loadClientForActor(actor, id)
    return unwrap(
      await actor.admin
        .from('clients')
        .update(stripKeys(patch, ['id', 'app_id']))
        .eq('id', id)
        .select()
        .single()
    )
  },

  async updateMyContact(actor, fields = {}) {
    await updateOwnContact(actor, fields)
    return true
  },

  async swapPrimaryAndSpouse(actor, { clientId }) {
    requireStaffActor(actor)
    await loadClientForActor(actor, clientId)
    unwrap(await actor.admin.rpc('swap_primary_and_spouse_server', { p_client_id: clientId }))
    return ops.getQuestionnaire(actor, { clientId })
  },

  // -------------------------------------------------------- questionnaire --
  async getQuestionnaire(actor, { clientId }) {
    await loadClientForActor(actor, clientId)
    const admin = actor.admin
    const [details, persons, children, vehicles, properties] = await Promise.all([
      admin.from('client_details').select('*').eq('client_id', clientId).maybeSingle(),
      admin.from('client_persons').select('*').eq('client_id', clientId),
      admin.from('client_children').select('*').eq('client_id', clientId).order('sort_order'),
      admin.from('client_vehicles').select('*').eq('client_id', clientId).order('sort_order'),
      admin.from('client_properties').select('*').eq('client_id', clientId).order('sort_order')
    ])
    // A failed read must not look like an empty questionnaire: saving that
    // form would then overwrite the real one with blanks.
    const failed = [details, persons, children, vehicles, properties].find((r) => r.error)
    if (failed) throw dbError(failed.error)
    return {
      details: details.data || { client_id: clientId },
      persons: persons.data || [],
      children: children.data || [],
      vehicles: vehicles.data || [],
      properties: properties.data || []
    }
  },

  async saveQuestionnaire(actor, { clientId, payload = {} }) {
    await loadClientForActor(actor, clientId)
    const admin = actor.admin
    const { details = {}, persons = [], children = [], vehicles = [], properties = [] } = payload
    if (![persons, children, vehicles, properties].every(Array.isArray)) {
      throw httpError(400, 'BAD_REQUEST', 'Malformed questionnaire.')
    }

    // client_id is always the one checked above; ids are never taken from
    // the browser (a foreign row id must not be reachable through an upsert).
    unwrap(
      await admin
        .from('client_details')
        .upsert({ ...stripKeys(details, ['id']), client_id: clientId }, { onConflict: 'client_id' })
    )

    if (persons.length) {
      unwrap(
        await admin.from('client_persons').upsert(
          persons.map((p) => ({ ...stripKeys(p, ['id']), client_id: clientId })),
          { onConflict: 'client_id,person_type' }
        )
      )
    }
    const keptTypes = persons.map((p) => p.person_type).filter((t) => /^[a-z_]+$/.test(String(t)))
    if (keptTypes.length) {
      await admin
        .from('client_persons')
        .delete()
        .eq('client_id', clientId)
        .not('person_type', 'in', `(${keptTypes.join(',')})`)
    }

    const replaceAll = async (table, rows) => {
      await admin.from(table).delete().eq('client_id', clientId)
      if (rows.length) {
        unwrap(
          await admin
            .from(table)
            .insert(rows.map(({ id, ...rest }, index) => ({ ...rest, client_id: clientId, sort_order: index })))
        )
      }
    }
    await replaceAll('client_children', children)
    await replaceAll('client_vehicles', vehicles)
    await replaceAll('client_properties', properties)

    // A self-registered client has no other way to put their name on file —
    // mirror the questionnaire's primary person onto their own clients row /
    // profile (what update_my_contact() did). Only for the client themselves:
    // that RPC was a no-op on `clients` for staff, and its profile half would
    // have renamed the specialist after the client.
    if (!actor.isStaff && actor.clientId === clientId) {
      const primary = persons.find((p) => p.person_type === 'primary')
      const first = primary?.first_name?.trim()
      const last = primary?.last_name?.trim()
      if (first || last) {
        try {
          await updateOwnContact(actor, { first_name: first || null, last_name: last || null })
        } catch (err) {
          console.error('[saveQuestionnaire] contact mirror failed', err)
        }
      }
    }

    return ops.getQuestionnaire(actor, { clientId })
  },

  // --------------------------------------------------------------- cases --
  async listCases(actor, { clientId }) {
    await loadClientForActor(actor, clientId)
    const admin = actor.admin
    const cases = unwrap(
      await admin.from('tax_cases').select('*').eq('client_id', clientId).order('tax_year', { ascending: false })
    )
    if (!cases?.length) return []
    const counts =
      unwrap(await admin.from('case_documents').select('case_id, direction').in('case_id', cases.map((c) => c.id))) || []
    return cases.map((c) => ({
      ...c,
      client_documents: counts.filter((d) => d.case_id === c.id && d.direction === 'client_upload').length,
      specialist_documents: counts.filter((d) => d.case_id === c.id && d.direction === 'specialist_upload').length
    }))
  },

  async getCase(actor, { caseId }) {
    const row = await loadCaseForActor(actor, caseId)
    const client = unwrap(await actor.admin.from('clients').select('*').eq('id', row.client_id).maybeSingle())
    return { ...row, client }
  },

  async createCase(actor, { clientId, taxYear }) {
    requireStaffActor(actor)
    await loadClientForActor(actor, clientId)
    const { data, error } = await actor.admin
      .from('tax_cases')
      .insert({ client_id: clientId, tax_year: Number(taxYear), status: 'opened' })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') throw httpError(409, 'YEAR_EXISTS', 'YEAR_EXISTS')
      throw dbError(error)
    }
    return data
  },

  // "cases: client insert own": the client's own client_id, and a tax year
  // not in the future (staff keep "cases: staff all").
  async createOwnCase(actor, { clientId, taxYear }) {
    await loadClientForActor(actor, clientId)
    const year = Number(taxYear)
    if (!Number.isInteger(year)) throw httpError(400, 'BAD_REQUEST', 'taxYear must be a year.')
    if (!actor.isStaff && year > new Date().getFullYear()) throw forbidden()
    const { data, error } = await actor.admin
      .from('tax_cases')
      .insert({ client_id: clientId, tax_year: year, status: 'opened', created_by_client: true })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') throw httpError(409, 'YEAR_EXISTS', 'YEAR_EXISTS')
      throw dbError(error)
    }
    return data
  },

  async updateCase(actor, { caseId, patch }) {
    requireStaffActor(actor)
    await loadCaseForActor(actor, caseId)
    const since = new Date(Date.now() - 1000).toISOString()
    const data = unwrap(
      await actor.admin.from('tax_cases').update(stripKeys(patch, ['id'])).eq('id', caseId).select().single()
    )
    if (patch && 'status' in patch) await attributeStatusChange(actor.admin, caseId, actor.profile?.id, since)
    return data
  },

  async setCaseStatus(actor, { caseId, status, client_message = null }) {
    requireStaffActor(actor)
    await loadCaseForActor(actor, caseId)
    const patch = { status }
    if (client_message !== null) patch.client_message = client_message
    const since = new Date(Date.now() - 1000).toISOString()
    const data = unwrap(await actor.admin.from('tax_cases').update(patch).eq('id', caseId).select().single())
    await attributeStatusChange(actor.admin, caseId, actor.profile?.id, since)
    return { case: data, emailSent: false }
  },

  async getStats(actor, { year }) {
    requireStaffActor(actor)
    const rows = unwrap(await actor.admin.from('tax_cases').select('status, tax_year').eq('tax_year', Number(year))) || []
    const clients = unwrap(await actor.admin.from('clients').select('id, status').eq('app_id', APP_ID)) || []
    return {
      open: rows.filter((c) => c.status !== 'finished').length,
      waiting: rows.filter((c) => c.status === 'waiting_client').length,
      inProcess: rows.filter((c) => c.status === 'in_process').length,
      finished: rows.filter((c) => c.status === 'finished').length,
      clients: clients.filter((c) => c.status !== 'archived').length
    }
  },

  // ---------------------------------------------------------- documents --
  async listDocuments(actor, { caseId }) {
    await loadCaseForActor(actor, caseId)
    const admin = actor.admin
    const rows =
      unwrap(
        await admin.from('case_documents').select('*').eq('case_id', caseId).order('created_at', { ascending: false })
      ) || []
    const mirrors = rows.length
      ? unwrap(
          await admin
            .from('client_documents')
            .select('source_case_document_id, category_code')
            .in('source_case_document_id', rows.map((r) => r.id))
        ) || []
      : []
    return rows.map((r) => {
      const mirror = mirrors.find((m) => m.source_case_document_id === r.id) || null
      return {
        ...r,
        client_documents: mirror ? { category_code: mirror.category_code } : null,
        category_code: mirror?.category_code ?? null
      }
    })
  },

  async setDocumentCategory(actor, { caseDocumentId, categoryCode }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('client_documents')
        .update({ category_code: categoryCode })
        .eq('source_case_document_id', requireId(caseDocumentId, 'caseDocumentId'))
        .select()
        .single()
    )
  },

  async listClientDocuments(actor, { clientId, taxYear }) {
    await loadClientForActor(actor, clientId)
    return unwrap(
      await actor.admin.from('client_documents').select('*').eq('client_id', clientId).eq('tax_year', Number(taxYear))
    )
  },

  // "client documents: read own" — client_id must be the caller's.
  async getClientDocument(actor, { documentId }) {
    const doc = unwrap(
      await actor.admin.from('client_documents').select('*').eq('id', requireId(documentId, 'documentId')).maybeSingle()
    )
    if (!doc) return null
    if (!actor.isStaff && doc.client_id !== actor.clientId) throw forbidden()
    return doc
  },

  async getMirroredClientDocumentId(actor, { caseDocumentId }) {
    const caseDoc = unwrap(
      await actor.admin
        .from('case_documents')
        .select('id, case_id')
        .eq('id', requireId(caseDocumentId, 'caseDocumentId'))
        .maybeSingle()
    )
    if (!caseDoc) throw actor.isStaff ? httpError(404, 'NOT_FOUND', 'Document not found.') : forbidden()
    await loadCaseForActor(actor, caseDoc.case_id)
    const mirror = unwrap(
      await actor.admin.from('client_documents').select('id').eq('source_case_document_id', caseDocumentId).maybeSingle()
    )
    return mirror?.id || null
  },

  // Step 1 of an upload: a short-lived signed URL for a path the SERVER
  // chooses inside the case's own folder. The browser PUTs the file there,
  // then calls registerUploadedDocument (step 2).
  async createUploadUrl(actor, { caseId, fileName, direction = 'client_upload' }) {
    assertUploadAllowed(actor, direction)
    const caseRow = await loadCaseForActor(actor, caseId)
    const path = `${storagePathPrefix(caseRow, direction)}${globalThis.crypto.randomUUID()}-${safeFileName(String(fileName || 'file'))}`
    const { data, error } = await actor.admin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path)
    if (error) throw dbError(error)
    return { path, signedUrl: data.signedUrl, token: data.token }
  },

  async registerUploadedDocument(
    actor,
    { caseId, path, fileName, fileSize = null, mimeType = null, documentTypeId = null, note = null, direction = 'client_upload' }
  ) {
    assertUploadAllowed(actor, direction)
    const caseRow = await loadCaseForActor(actor, caseId)
    const prefix = storagePathPrefix(caseRow, direction)
    // Directly inside this case's own folder: no sub-folder, no "." / ".."
    // segment (a ".." inside a file name like "scan..pdf" is harmless).
    const rest = typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : null
    if (!rest || rest.includes('/') || rest === '.' || rest === '..' || path.split('/').some((s) => s === '..' || s === '.')) {
      throw forbidden()
    }
    // The file must really be there (uploaded through the signed URL above).
    const name = path.slice(prefix.length)
    const { data: listed, error: listError } = await actor.admin.storage
      .from(STORAGE_BUCKET)
      .list(prefix.slice(0, -1), { search: name, limit: 10 })
    if (listError) throw dbError(listError)
    if (!(listed || []).some((o) => o.name === name)) throw httpError(400, 'UPLOAD_NOT_FOUND', 'The uploaded file was not found.')

    const admin = actor.admin
    const row = unwrap(
      await admin
        .from('case_documents')
        .insert({
          case_id: caseId,
          document_type_id: documentTypeId || null,
          direction,
          storage_path: path,
          file_name: String(fileName || name),
          file_size: Number.isFinite(Number(fileSize)) ? Number(fileSize) : null,
          mime_type: mimeType || null,
          note: note || null,
          uploaded_by: actor.profile.id
        })
        .select()
        .single()
    )
    await admin.from('case_events').insert({
      case_id: caseId,
      event_type: 'document_uploaded',
      note: String(fileName || name),
      actor_id: actor.profile.id
    })
    return row
  },

  // Staff: any document. Client: only their own upload ("client_upload"), and
  // only while the case is still open ("documents: client delete own").
  async deleteDocument(actor, { id }) {
    const doc = unwrap(
      await actor.admin.from('case_documents').select('*').eq('id', requireId(id, 'id')).maybeSingle()
    )
    if (!doc) throw actor.isStaff ? httpError(404, 'NOT_FOUND', 'Document not found.') : forbidden()
    const caseRow = await loadCaseForActor(actor, doc.case_id)
    if (!actor.isStaff && (doc.direction !== 'client_upload' || !CLIENT_OPEN_CASE_STATUSES.includes(caseRow.status))) {
      throw forbidden()
    }
    await actor.admin.storage.from(STORAGE_BUCKET).remove([doc.storage_path])
    unwrap(await actor.admin.from('case_documents').delete().eq('id', doc.id))
    return true
  },

  // A short-lived signed URL for a case_documents OR client_documents row —
  // the path is always read from the database, never taken from the browser.
  async getDownloadUrl(actor, { id, download = true }) {
    requireId(id, 'id')
    const admin = actor.admin
    let doc = unwrap(await admin.from('case_documents').select('id, case_id, storage_path, file_name').eq('id', id).maybeSingle())
    if (doc) {
      await loadCaseForActor(actor, doc.case_id)
    } else {
      doc = unwrap(
        await admin.from('client_documents').select('id, client_id, storage_path, file_name').eq('id', id).maybeSingle()
      )
      if (!doc) throw actor.isStaff ? httpError(404, 'NOT_FOUND', 'Document not found.') : forbidden()
      if (!actor.isStaff && doc.client_id !== actor.clientId) throw forbidden()
    }
    const { data, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, download ? { download: doc.file_name } : {})
    if (error) throw dbError(error)
    return data.signedUrl
  },

  async listRequested(actor, { caseId }) {
    await loadCaseForActor(actor, caseId)
    return unwrap(await actor.admin.from('case_requested_documents').select('*').eq('case_id', caseId))
  },

  async setRequested(actor, { caseId, typeIds = [] }) {
    requireStaffActor(actor)
    await loadCaseForActor(actor, caseId)
    await actor.admin.from('case_requested_documents').delete().eq('case_id', caseId)
    if (typeIds.length) {
      unwrap(
        await actor.admin
          .from('case_requested_documents')
          .insert(typeIds.map((id) => ({ case_id: caseId, document_type_id: id, required: true })))
      )
    }
    return ops.listRequested(actor, { caseId })
  },

  // ------------------------------------------- extraction (staff only) ----
  async createFieldDefinition(actor, { payload }) {
    requireStaffActor(actor)
    return unwrap(await actor.admin.from('category_field_definitions').insert(stripKeys(payload, ['id'])).select().single())
  },

  async updateFieldDefinition(actor, { id, patch }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('category_field_definitions')
        .update(stripKeys(patch, ['id']))
        .eq('id', requireId(id, 'id'))
        .select()
        .single()
    )
  },

  async deleteFieldDefinition(actor, { id }) {
    requireStaffActor(actor)
    unwrap(await actor.admin.from('category_field_definitions').delete().eq('id', requireId(id, 'id')))
    return true
  },

  async listExtractedFieldsForDocument(actor, { documentId }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin.from('extracted_document_fields').select('*').eq('document_id', requireId(documentId, 'documentId'))
    )
  },

  // ONE query for many documents — Tax Summary loads a whole case this way.
  async listExtractedFieldsForDocuments(actor, { documentIds = [] }) {
    requireStaffActor(actor)
    if (!documentIds.length) return []
    return unwrap(await actor.admin.from('extracted_document_fields').select('*').in('document_id', documentIds))
  },

  async listOtherFindingsForDocuments(actor, { documentIds = [] }) {
    requireStaffActor(actor)
    if (!documentIds.length) return []
    return unwrap(
      await actor.admin
        .from('document_other_findings')
        .select('*')
        .in('document_id', documentIds)
        .order('created_at', { ascending: true })
    )
  },

  async listExtractedFields(actor, { caseDocumentId }) {
    requireStaffActor(actor)
    const clientDoc = unwrap(
      await actor.admin
        .from('client_documents')
        .select('id')
        .eq('source_case_document_id', requireId(caseDocumentId, 'caseDocumentId'))
        .maybeSingle()
    )
    if (!clientDoc) return []
    return ops.listExtractedFieldsForDocument(actor, { documentId: clientDoc.id })
  },

  // "case assistant: own conversation only".
  async listCaseAssistantMessages(actor, { caseId }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('case_assistant_messages')
        .select('*')
        .eq('case_id', requireId(caseId, 'caseId'))
        .eq('created_by', actor.profile.id)
        .order('created_at', { ascending: true })
    )
  },

  async listAiModelSettings(actor) {
    requireStaffActor(actor)
    return unwrap(await actor.admin.from('ai_model_settings').select('*'))
  },

  async saveAiModelSetting(actor, { key, model }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('ai_model_settings')
        .upsert({ key: requireId(key, 'key'), model: model || null, updated_by: actor.profile.id }, { onConflict: 'key' })
        .select()
        .single()
    )
  },

  async listFieldSuggestions(actor, { clientId }) {
    requireStaffActor(actor)
    return unwrap(
      await actor.admin
        .from('client_field_suggestions')
        .select('*')
        .eq('client_id', requireId(clientId, 'clientId'))
        .order('created_at', { ascending: true })
    )
  },

  // The suggestion is re-read from the database: only its (possibly
  // staff-edited) suggested_value comes from the browser, never where it is
  // written to.
  async resolveFieldSuggestion(actor, { suggestionId, accept, suggestedValue }) {
    requireStaffActor(actor)
    const admin = actor.admin
    const suggestion = unwrap(
      await admin.from('client_field_suggestions').select('*').eq('id', requireId(suggestionId, 'suggestionId')).maybeSingle()
    )
    if (!suggestion) throw httpError(404, 'NOT_FOUND', 'Suggestion not found.')
    const value = suggestedValue === undefined ? suggestion.suggested_value : suggestedValue

    if (accept) {
      if (suggestion.target_table === 'clients') {
        unwrap(
          await admin
            .from('clients')
            .update({ [suggestion.target_field]: value })
            .eq('id', suggestion.client_id)
        )
      } else if (suggestion.target_table === 'client_persons') {
        const existing = unwrap(
          await admin
            .from('client_persons')
            .select('id')
            .eq('client_id', suggestion.client_id)
            .eq('person_type', suggestion.target_person)
            .maybeSingle()
        )
        if (existing) {
          unwrap(await admin.from('client_persons').update({ [suggestion.target_field]: value }).eq('id', existing.id))
        } else {
          unwrap(
            await admin.from('client_persons').insert({
              client_id: suggestion.client_id,
              person_type: suggestion.target_person,
              [suggestion.target_field]: value
            })
          )
        }
      } else if (suggestion.target_table === 'client_properties') {
        // Deduplicated first by source document, then by normalized address
        // (see the comment in the old browser implementation).
        const payload = stripKeys(JSON.parse(value), ['id', 'client_id'])
        const normalizedIncoming = normalizePropertyAddress(payload.address)
        const clientProperties = unwrap(
          await admin
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
          unwrap(await admin.from('client_properties').update(payload).eq('id', existing.id))
        } else {
          unwrap(
            await admin
              .from('client_properties')
              .insert({ client_id: suggestion.client_id, source_document_id: suggestion.document_id, ...payload })
          )
        }
      } else if (suggestion.target_table === 'client_children') {
        const payload = stripKeys(JSON.parse(value), ['id', 'client_id'])
        unwrap(await admin.from('client_children').insert({ client_id: suggestion.client_id, ...payload }))
      }
    }
    unwrap(await admin.from('client_field_suggestions').delete().eq('id', suggestion.id))
    return true
  }
}

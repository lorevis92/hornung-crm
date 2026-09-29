// POST /api/case-assistant
//   { caseId, message }
//
// The Tax Summary chat bubble — lets a specialist ask about the ONE case
// currently open (where a value came from, why it's excluded, which
// document to check, how a total was reached). Staff only (requireStaff),
// same as every other case-scoped endpoint in this app — there is no
// per-specialist case assignment here, so "authorized for this case" means
// "is Hornung staff at all", exactly like /api/calculate-aggregates,
// /api/save-field-decision, etc.
//
// The context is rebuilt from the database on EVERY call (never trusts
// anything the client sends beyond caseId/message) — see
// src/lib/caseAssistantContext.js for the pure formatting logic. This is
// what guarantees the assistant can never see another client's data: every
// query below is scoped to this one case's client_id/tax_year, and nothing
// else is ever fetched.
//
// The assistant only ever responds — no tool use, no function calling, no
// write access of any kind is wired to it, so it structurally cannot take
// an action on the case even if asked to.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'
import { buildCaseAssistantContext } from '../src/lib/caseAssistantContext.js'

// Configurable the same way as the extraction model (api/extract-document.js)
// — a plain env var with a sane default, so either can be pointed at a
// different Claude model without a code change.
const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || 'claude-sonnet-5'
const MAX_TOKENS = 1200

// Bounds both the cost and the context-window size of a long-running
// conversation: only the most recent turns are ever sent to the model — the
// case's own context (documents, calculation, decisions) is always rebuilt
// fresh on every call regardless, so truncating history never makes it
// stale, only shortens how far back the model can "remember" the chat
// itself. Full history still persists in case_assistant_messages for the
// specialist to scroll back through on screen.
const MAX_HISTORY_MESSAGES = 20

const SYSTEM_PROMPT_HEADER = `You are a tax-case assistant embedded in Tax Summary, a Swiss tax-declaration tool used by a professional consultant (never the client). The consultant asks you questions about the ONE case described in the context below, to understand where a figure comes from, who it belongs to, why something is excluded, which document to check, or how a total was reached.

Rules:
- Always answer in Italian, regardless of what language the question is asked in.
- Base every factual claim about THIS case strictly on the context below — never invent a number, a document, or a detail that isn't there. If something is asked about but isn't in the context, say so plainly instead of guessing.
- Whenever you refer to a specific source document, use the exact marker "[[doc:<id>|<file name>]]" exactly as it appears in the context (copy it verbatim) so the consultant can click through to verify it themselves. Never invent a marker for a document not listed in the context.
- A question about general Swiss tax law (not about this specific case) may be answered from your own general knowledge, but you must clearly say the answer is general and should be verified — never present it as a fact about this case.
- You can only answer questions. You have no ability to change any data, save a decision, or take any action — never claim otherwise.
- Be concise and concrete: point at the exact document/row/value, not a vague description.

=== CASE CONTEXT (rebuilt fresh from the database for this request) ===
`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { profile, admin } = await requireStaff(req)
    const body = readBody(req)
    const caseId = body.caseId
    const message = (body.message || '').trim()
    if (!caseId) throw httpError(400, 'CASE_ID_REQUIRED', 'A caseId is required.')
    if (!message) throw httpError(400, 'MESSAGE_REQUIRED', 'A message is required.')

    const { data: caseRow, error: caseError } = await admin
      .from('tax_cases')
      .select('*')
      .eq('id', caseId)
      .maybeSingle()
    if (caseError) throw caseError
    if (!caseRow) throw httpError(404, 'CASE_NOT_FOUND', 'No such case.')

    const { data: client, error: clientError } = await admin
      .from('clients')
      .select('*')
      .eq('id', caseRow.client_id)
      .maybeSingle()
    if (clientError) throw clientError

    const [personsRes, childrenRes, documentsRes] = await Promise.all([
      admin.from('client_persons').select('*').eq('client_id', caseRow.client_id),
      admin.from('client_children').select('*').eq('client_id', caseRow.client_id),
      admin
        .from('client_documents')
        .select('*')
        .eq('client_id', caseRow.client_id)
        .eq('tax_year', caseRow.tax_year)
        .not('category_code', 'is', null)
    ])
    if (personsRes.error) throw personsRes.error
    if (childrenRes.error) throw childrenRes.error
    if (documentsRes.error) throw documentsRes.error

    const primaryPerson = (personsRes.data || []).find((p) => p.person_type === 'primary') || null
    const spousePerson = (personsRes.data || []).find((p) => p.person_type === 'spouse') || null
    const documents = documentsRes.data || []
    const documentIds = documents.map((d) => d.id)

    const [extractedFieldsRes, categoriesRes, fieldDefsRes, aggregateRes, decisionsRes, manualRes] = await Promise.all([
      documentIds.length
        ? admin.from('extracted_document_fields').select('*').in('document_id', documentIds)
        : Promise.resolve({ data: [] }),
      admin.from('document_categories').select('code, group_key, label_en, label_de, label_fr, label_it'),
      admin.from('category_field_definitions').select('category_code, field_key, field_label'),
      admin
        .from('tax_aggregates')
        .select('*')
        .eq('client_id', caseRow.client_id)
        .eq('tax_year', caseRow.tax_year)
        .maybeSingle(),
      admin
        .from('tax_field_decisions')
        .select('*')
        .eq('client_id', caseRow.client_id)
        .eq('tax_year', caseRow.tax_year),
      admin
        .from('tax_manual_aggregate_entries')
        .select('*')
        .eq('client_id', caseRow.client_id)
        .eq('tax_year', caseRow.tax_year)
    ])
    if (extractedFieldsRes.error) throw extractedFieldsRes.error
    if (categoriesRes.error) throw categoriesRes.error
    if (fieldDefsRes.error) throw fieldDefsRes.error
    if (aggregateRes.error) throw aggregateRes.error
    if (decisionsRes.error) throw decisionsRes.error
    if (manualRes.error) throw manualRes.error

    let components = []
    if (aggregateRes.data) {
      const { data, error } = await admin
        .from('tax_aggregate_components')
        .select('*')
        .eq('aggregate_id', aggregateRes.data.id)
      if (error) throw error
      components = data || []
    }

    const context = buildCaseAssistantContext({
      client,
      caseRow,
      primaryPerson,
      spousePerson,
      children: childrenRes.data || [],
      documents,
      extractedFields: extractedFieldsRes.data || [],
      categories: categoriesRes.data || [],
      fieldDefs: fieldDefsRes.data || [],
      aggregate: aggregateRes.data || null,
      components,
      fieldDecisions: decisionsRes.data || [],
      manualEntries: manualRes.data || []
    })

    const { error: insertUserError } = await admin
      .from('case_assistant_messages')
      .insert({ case_id: caseId, role: 'user', content: message, created_by: profile.id })
    if (insertUserError) throw insertUserError

    const { data: historyRows, error: historyError } = await admin
      .from('case_assistant_messages')
      .select('role, content')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true })
    if (historyError) throw historyError

    const recentHistory = (historyRows || []).slice(-MAX_HISTORY_MESSAGES)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const completion = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `${SYSTEM_PROMPT_HEADER}${context}`,
      messages: recentHistory.map((m) => ({ role: m.role, content: m.content }))
    })
    const reply = (completion.content || []).find((block) => block.type === 'text')?.text || ''

    const { error: insertAssistantError } = await admin
      .from('case_assistant_messages')
      .insert({ case_id: caseId, role: 'assistant', content: reply })
    if (insertAssistantError) throw insertAssistantError

    return res.status(200).json({ reply })
  } catch (error) {
    console.error('[case-assistant]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

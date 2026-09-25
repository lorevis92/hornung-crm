// POST /api/extract-document
//   { documentId }  -- a client_documents.id
//
// Called automatically by a Postgres trigger (pg_net, see migrations
// 20260101000010_ai_extraction.sql and 20260101000011_ai_extraction_settings.sql)
// right after a row lands in client_documents with status = 'uploaded' —
// never called from the browser,
// and never carries a user session. Authenticated with a shared secret
// instead (same pattern as the existing CRON_SECRET check in
// api/open-tax-year.js).
//
// Two-phase pipeline against the Anthropic API:
//   1. Classification — pick one of the active document_categories.
//   2. Extraction — read the field dictionary for that category from
//      category_field_definitions (kept fresh at call time, since staff can
//      edit it from /tax-settings) and pull only the values actually present
//      in the document.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, serviceClient } from './_lib.js'

// src/lib/config.js can't be imported here (it's Vite-only, uses
// import.meta.env) — keep this in sync with that file.
const STORAGE_BUCKET = 'client-documents'

const MODEL = 'claude-sonnet-5'
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function requireWebhookSecret(req) {
  const secret = process.env.EXTRACTION_WEBHOOK_SECRET
  if (!secret) {
    throw httpError(500, 'MISSING_WEBHOOK_SECRET', 'EXTRACTION_WEBHOOK_SECRET is not configured on the server.')
  }
  const header = req.headers.authorization || ''
  if (header !== `Bearer ${secret}`) {
    throw httpError(401, 'UNAUTHORIZED', 'Invalid webhook secret.')
  }
}

// Claude sometimes wraps JSON in prose or a ```json fence despite instructions
// — pull out the first bracketed structure rather than requiring a clean
// response.
function parseJsonFromText(text) {
  const match = (text || '').match(/[[{][\s\S]*[\]}]/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function textOf(message) {
  return (message.content || []).find((block) => block.type === 'text')?.text || ''
}

async function runExtraction(admin, anthropic, documentId) {
  // Atomic claim: only proceed if this row is still 'uploaded'. Prevents a
  // duplicate webhook delivery (pg_net can retry) from processing it twice.
  const { data: claimed, error: claimError } = await admin
    .from('client_documents')
    .update({ status: 'extracting' })
    .eq('id', documentId)
    .eq('status', 'uploaded')
    .select()
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) {
    console.log(`[extract-document] ${documentId} is not 'uploaded' anymore — skipping`)
    return
  }

  const mimeType = claimed.mime_type || ''
  const isPdf = mimeType === 'application/pdf'
  const isImage = SUPPORTED_IMAGE_TYPES.has(mimeType)
  if (!isPdf && !isImage) {
    throw new Error(`Unsupported mime type for AI extraction: "${mimeType}"`)
  }

  const { data: fileBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(claimed.storage_path)
  if (downloadError) throw downloadError
  const base64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64')

  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }

  // ------------------------------------------------ Phase 1: classify ------
  const { data: categories, error: categoriesError } = await admin
    .from('document_categories')
    .select('code, label_en, label_de, label_fr, label_it')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (categoriesError) throw categoriesError
  if (!categories?.length) throw new Error('No active document_categories to classify against.')

  const categoryList = categories
    .map((c) => `- ${c.code}: ${c.label_en} / ${c.label_de} / ${c.label_fr} / ${c.label_it}`)
    .join('\n')

  const classifyMessage = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text:
              'This is a document uploaded for a Swiss tax declaration. Choose the single most ' +
              'likely category from the list below (the document may be in English, German, ' +
              `French or Italian):\n\n${categoryList}\n\n` +
              'Respond with ONLY a JSON object, no other text: {"category_code": "<one of the codes above>"}'
          }
        ]
      }
    ]
  })

  const validCodes = new Set(categories.map((c) => c.code))
  const categoryCode = parseJsonFromText(textOf(classifyMessage))?.category_code
  if (!categoryCode || !validCodes.has(categoryCode)) {
    throw new Error(`Classification did not return a known category_code (got: ${JSON.stringify(categoryCode)})`)
  }

  const { error: categoryUpdateError } = await admin
    .from('client_documents')
    .update({ category_code: categoryCode })
    .eq('id', documentId)
  if (categoryUpdateError) throw categoryUpdateError

  // ------------------------------------------ Phase 2: field extraction ----
  const { data: fieldDefs, error: fieldDefsError } = await admin
    .from('category_field_definitions')
    .select('field_key, field_label, value_type')
    .eq('category_code', categoryCode)
    .order('sort_order', { ascending: true })
  if (fieldDefsError) throw fieldDefsError

  if (fieldDefs?.length) {
    const fieldList = fieldDefs
      .map((f) => `- ${f.field_key} (${f.value_type}): ${f.field_label || f.field_key}`)
      .join('\n')

    const extractMessage = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            fileBlock,
            {
              type: 'text',
              text:
                'Extract the following fields from this document, if present. Only include a field ' +
                "when you actually find its value in the document — never invent, guess, or infer a " +
                'value that is not written there.\n\n' +
                `Fields:\n${fieldList}\n\n` +
                'Respond with ONLY a JSON array, no other text: ' +
                '[{"field_key": "<key>", "field_value": "<value as text>", "confidence": <0.0-1.0>}, ...] ' +
                '— omit any field you did not find.'
            }
          ]
        }
      ]
    })

    const extracted = parseJsonFromText(textOf(extractMessage))
    const validKeys = new Set(fieldDefs.map((f) => f.field_key))
    const rows = (Array.isArray(extracted) ? extracted : [])
      .filter((row) => row && validKeys.has(row.field_key) && row.field_value !== null && row.field_value !== '')
      .map((row) => ({
        document_id: documentId,
        field_key: row.field_key,
        field_value: String(row.field_value),
        confidence: typeof row.confidence === 'number' ? row.confidence : null,
        verified_by_specialist: false
      }))

    if (rows.length) {
      const { error: upsertError } = await admin
        .from('extracted_document_fields')
        .upsert(rows, { onConflict: 'document_id,field_key' })
      if (upsertError) throw upsertError
    }
  }

  const { error: finishError } = await admin
    .from('client_documents')
    .update({ status: 'extracted', processed_at: new Date().toISOString() })
    .eq('id', documentId)
  if (finishError) throw finishError
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  let documentId
  try {
    requireWebhookSecret(req)
    const body = readBody(req)
    documentId = body.documentId
    if (!documentId) throw httpError(400, 'DOCUMENT_ID_REQUIRED', 'A documentId is required.')
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }

  const admin = serviceClient()

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    await runExtraction(admin, anthropic, documentId)
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(`[extract-document] failed for document ${documentId}:`, error)
    try {
      await admin.from('client_documents').update({ status: 'extraction_failed' }).eq('id', documentId)
    } catch (updateError) {
      console.error(`[extract-document] could not mark ${documentId} as extraction_failed:`, updateError)
    }
    return res.status(500).json({ error: error.message || 'EXTRACTION_FAILED' })
  }
}

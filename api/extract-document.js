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
// Three-phase pipeline against the Anthropic API:
//   1. Classification — pick one of the active document_categories.
//   2. Extraction — read the field dictionary for that category from
//      category_field_definitions (kept fresh at call time, since staff can
//      edit it from /tax-settings) and pull only the values actually present
//      in the document. The same call also returns "other findings": values
//      worth a consultant's attention that no listed field covers.
//   3. Coverage check — ONE further call per document (never per field),
//      handed the document plus everything phase 2 produced, asked only
//      which amounts, names and dates in the text are not represented in
//      that output. Whatever it names joins the other findings, so a
//      document can no longer contain something useful that the whitelist
//      happened not to anticipate and nobody ever sees. Best-effort: a
//      failure here leaves the whitelist extraction (which succeeded)
//      alone.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, serviceClient } from './_lib.js'
import { syncRegistryForClientYear } from './_registrySync.js'
import { isRowBasedCategory, ROW_IDENTITY_FIELDS, ROW_KEY_DOCUMENT_LEVEL } from '../src/lib/rowBasedFields.js'
import { resolveModel } from '../src/lib/aiModels.js'
import {
  buildOtherFindingRows,
  capturedValuesOf,
  describeExtractionForCoverage
} from '../src/lib/otherFindings.js'

// src/lib/config.js can't be imported here (it's Vite-only, uses
// import.meta.env) — keep this in sync with that file.
const STORAGE_BUCKET = 'client-documents'

// A specialist's choice on the Tax settings "AI" tab (ai_model_settings,
// see migration 20260101000044) wins when present; ANTHROPIC_EXTRACTION_MODEL
// is the fallback for an install that never touches that screen — resolved
// fresh on every call (below, via `admin`), never cached at module load,
// since the database value can change without a redeploy.
const ENV_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL
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

export async function runExtraction(
  admin,
  anthropic,
  documentId,
  { fromStatuses = ['uploaded'], forcedCategoryCode = null, throwOnRegistrySyncError = false } = {}
) {
  // Atomic claim: only proceed if this row is still in one of the expected
  // starting states. Prevents a duplicate webhook delivery (pg_net can
  // retry) from processing it twice; api/retry-extraction.js passes
  // ['extraction_failed'] instead so a specialist can re-run a failed one.
  let claimQuery = admin.from('client_documents').update({ status: 'extracting' }).eq('id', documentId)
  claimQuery = fromStatuses.length === 1 ? claimQuery.eq('status', fromStatuses[0]) : claimQuery.in('status', fromStatuses)
  const { data: claimed, error: claimError } = await claimQuery.select().maybeSingle()
  if (claimError) throw claimError
  if (!claimed) {
    console.log(`[extract-document] ${documentId} is not in ${JSON.stringify(fromStatuses)} anymore — skipping`)
    // Reported, not swallowed: a caller that asked for a re-extraction and
    // got nothing back used to show the specialist a success toast for a
    // run that never happened.
    return { claimed: false, documentId }
  }

  try {
    return await extractClaimedDocument(admin, anthropic, documentId, claimed, {
      forcedCategoryCode,
      throwOnRegistrySyncError
    })
  } catch (error) {
    // The claim above already moved this document to 'extracting'. Only
    // api/extract-document.js's own HTTP handler used to undo that on
    // failure, so a run started by api/retry-extraction.js or
    // api/reprocess-client-year.js (which call runExtraction directly) left
    // the document stuck mid-pipeline forever: Tax Summary kept showing it
    // as "still processing", with no error anywhere for the specialist to
    // see. Recording the failure belongs to whoever claimed it.
    try {
      await admin
        .from('client_documents')
        .update({
          status: 'extraction_failed',
          extraction_error: (error.message || 'EXTRACTION_FAILED').slice(0, 2000)
        })
        .eq('id', documentId)
        .eq('status', 'extracting')
    } catch (markError) {
      console.error(`[extract-document] could not mark ${documentId} as extraction_failed:`, markError)
    }
    throw error
  }
}

async function extractClaimedDocument(admin, anthropic, documentId, claimed, {
  forcedCategoryCode = null,
  throwOnRegistrySyncError = false
} = {}) {

  const mimeType = claimed.mime_type || ''
  const isPdf = mimeType === 'application/pdf'
  const isImage = SUPPORTED_IMAGE_TYPES.has(mimeType)
  const isText = mimeType === 'text/plain'
  if (!isPdf && !isImage && !isText) {
    throw new Error(`Unsupported mime type for AI extraction: "${mimeType}"`)
  }

  const { data: modelSetting } = await admin
    .from('ai_model_settings')
    .select('model')
    .eq('key', 'extraction_model')
    .maybeSingle()
  const MODEL = resolveModel({ dbValue: modelSetting?.model, envValue: ENV_MODEL })

  const { data: fileBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(claimed.storage_path)
  if (downloadError) throw downloadError

  // Plain text (a specialist pasting a client's email into the
  // Questionnaire's "fill from pasted text" action — see
  // fillQuestionnaireFromText in src/lib/data/supabaseData.js and
  // api/extract-document-now.js) goes to Claude as a text block, not
  // base64 file data; there's no classification ambiguity for it either
  // (forcedCategoryCode is always set for this path), so fileBlock is
  // only ever built for the classification call below, which text never
  // reaches.
  const base64 = isText ? null : Buffer.from(await fileBlob.arrayBuffer()).toString('base64')
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : isImage
      ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
      : { type: 'text', text: await fileBlob.text() }

  let categoryCode = forcedCategoryCode
  if (!categoryCode) {
    // ---------------------------------------------- Phase 1: classify ------
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
    const classified = parseJsonFromText(textOf(classifyMessage))?.category_code
    if (!classified || !validCodes.has(classified)) {
      throw new Error(`Classification did not return a known category_code (got: ${JSON.stringify(classified)})`)
    }
    categoryCode = classified
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

  {
    const fieldList = (fieldDefs || [])
      .map((f) => `- ${f.field_key} (${f.value_type}): ${f.field_label || f.field_key}`)
      .join('\n')
    const rowBased = isRowBasedCategory(categoryCode)
    const identityFields = ROW_IDENTITY_FIELDS[categoryCode] || []
    // A row-based category (see src/lib/rowBasedFields.js) can have several
    // real-world rows on the SAME document — several bank accounts, several
    // insurance premiums, several securities positions — and every field
    // that belongs to the same row (its identity fields AND its value
    // fields) must come back tagged with the SAME row_key, assigned by the
    // model itself rather than inferred afterwards from list position. That
    // shared tag is exactly what used to be missing: independent per-field
    // lists with no way to tell which balance belonged to which institution.
    const rowInstruction = rowBased
      ? '\n\nThis document can have more than one row of the same kind — for example several bank ' +
        'accounts, several insurance premiums for different people, several securities positions, ' +
        'several mortgages. For EACH field you extract, also give a "row_key": a short string you ' +
        'choose (e.g. "row-1", "row-2", ...) that is the SAME for every field belonging to the same ' +
        'real-world row, and DIFFERENT for a different row. This applies to identity fields too — ' +
        (identityFields.length
          ? `${identityFields.join(', ')} — `
          : '') +
        'e.g. the account holder name, institution name, account type and IBAN of ONE account all ' +
        'share the same row_key, and a second account\'s own holder/institution/type/IBAN share a ' +
        'different row_key. A field that describes the document as a whole, not any one row (e.g. a ' +
        'single reporting currency for the whole statement), uses row_key "". Never combine two ' +
        'distinct rows into one, and never split one row across two row_keys.' +
        // The identity fields are what everything else depends on: a balance
        // nobody can attribute is not usable, and two statements can only be
        // recognised as describing the same account if both state what
        // identifies it (see src/lib/categoryEntities.js). The field list
        // above does not say which fields those are — this does.
        (identityFields.length
          ? '\n\nThe most important fields to get right are the ones that say WHOSE row it is or ' +
            `WHICH one it is: ${identityFields.join(', ')}. Extract them whenever the document states ` +
            'them anywhere that applies to the row — including when the same value applies to several ' +
            'rows, and including a value printed once in a header or a column title instead of being ' +
            'repeated on every line. Prefer the most specific one available: an IBAN, account number, ' +
            'policy number or contract number over a name, and a name over a generic type. Never ' +
            'invent one — a row whose identity the document does not state must come back without it, ' +
            'and will be flagged for a human to resolve.'
          : '')
      : ''

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
                (fieldList
                  ? 'Extract the following fields from this document, if present. Only include a field ' +
                    "when you actually find its value in the document — never invent, guess, or infer a " +
                    `value that is not written there.\n\nFields:\n${fieldList}`
                  : 'No specific fields are defined for this kind of document.') +
                rowInstruction +
                '\n\nFor each field you find, also copy its exact source text — verbatim, character-for-' +
                'character as printed in the document, never paraphrased, summarized or translated ' +
                '(it will be used afterwards to search for and highlight that exact text in the ' +
                'document). ' +
                (isPdf
                  ? 'Also give the page number (starting at 1) that quote appears on.'
                  : 'This has no page numbers — leave source_page null.') +
                ' If you cannot pin down an exact quote (or, for a PDF, its page) for a field, leave ' +
                'source_quote/source_page empty for that field rather than guessing — an empty value ' +
                'is fine, an invented one is not.' +
                // The safety net. The field list above stays exactly as
                // strict as it was — this is additive, and explicitly NOT a
                // place to restate a listed field, so a well-modelled
                // category (bank statements, health premiums, mortgages)
                // produces the same whitelist rows as before.
                '\n\nSeparately, list anything ELSE in this document that a Swiss tax consultant would ' +
                'want to know about and that none of the fields above covers — an unusual clause, a ' +
                'one-off charge or refund, a condition, a date or amount that matters but has no field ' +
                'of its own. Give each one a short descriptive label in the language of the document, ' +
                'its value, and the same kind of verbatim quote. Do NOT repeat anything you already ' +
                'returned as a field above, and do not pad the list: if the document holds nothing ' +
                'beyond the fields, return an empty list.\n\n' +
                'Respond with ONLY a JSON object, no other text:\n' +
                '{"fields": [{"field_key": "<key>", "field_value": "<value as text>", "confidence": <0.0-1.0>, ' +
                (rowBased ? '"row_key": "<row-1, row-2, ... or "" for a document-level field>", ' : '') +
                '"source_quote": "<exact verbatim text, or null>", "source_page": <page number, or null>}, ...], ' +
                '"other_findings": [{"label": "<short descriptive label>", "value": "<value as text>", ' +
                '"source_quote": "<exact verbatim text, or null>", "source_page": <page number, or null>}, ...]} ' +
                '— omit any field you did not find at all.'
            }
          ]
        }
      ]
    })

    const extracted = parseJsonFromText(textOf(extractMessage))
    // Tolerates the older bare-array shape as well as the object above: a
    // model occasionally answers with just the field list, and losing an
    // entire document's whitelist extraction over the wrapper would be a
    // far worse failure than losing its other findings.
    const extractedFieldItems = Array.isArray(extracted) ? extracted : extracted?.fields
    const extractedOtherItems = Array.isArray(extracted) ? [] : extracted?.other_findings
    const definedKeys = new Set((fieldDefs || []).map((f) => f.field_key))
    const parsedRows = (Array.isArray(extractedFieldItems) ? extractedFieldItems : [])
      .filter((row) => row && definedKeys.has(row.field_key) && row.field_value !== null && row.field_value !== '')
      .map((row) => {
        const page = Number(row.source_page)
        return {
          document_id: documentId,
          field_key: row.field_key,
          row_key: rowBased && typeof row.row_key === 'string' ? row.row_key : ROW_KEY_DOCUMENT_LEVEL,
          field_value: String(row.field_value),
          confidence: typeof row.confidence === 'number' ? row.confidence : null,
          source_quote: typeof row.source_quote === 'string' && row.source_quote.trim() ? row.source_quote : null,
          source_page: isPdf && Number.isInteger(page) ? page : null,
          verified_by_specialist: false
        }
      })
    // Deduped by (field_key, row_key), last one wins: the model occasionally
    // repeats the exact same field+row twice when it's unsure whether two
    // mentions are really distinct entries — two rows sharing a
    // (field_key, row_key) pair in one upsert statement is a Postgres error
    // (ON CONFLICT DO UPDATE cannot affect the same row twice in one
    // statement), not just a harmless overwrite. Different rows sharing a
    // field_key are legitimate now and both kept.
    const rows = Array.from(new Map(parsedRows.map((r) => [`${r.field_key}:${r.row_key}`, r])).values())

    if (rows.length) {
      const { error: upsertError } = await admin
        .from('extracted_document_fields')
        .upsert(rows, { onConflict: 'document_id,field_key,row_key' })
      if (upsertError) throw upsertError
    }

    // Everything this run did NOT produce has to go. The upsert above only
    // ever adds or overwrites, and row_key is chosen afresh by the model on
    // every run — so a document re-extracted after producing "row-1"/"row-2"
    // and now producing "row-a"/"row-b" would keep BOTH sets forever. The
    // specialist then sees the old rows sitting next to the new ones, which
    // reads exactly like "the re-extraction did nothing", and the quality
    // checks start reporting duplicates that exist only in the database.
    // (document_other_findings has always been replaced wholesale; this
    // brings the fields in line with it.)
    //
    // One exception, deliberately: a row a specialist edited or corrected by
    // hand is theirs, not the model's, and is never deleted just because
    // this run did not happen to produce it again.
    const keptKeys = new Set(rows.map((r) => `${r.field_key}:${r.row_key}`))
    const { data: existingRows, error: existingError } = await admin
      .from('extracted_document_fields')
      .select('id, field_key, row_key, verified_by_specialist')
      .eq('document_id', documentId)
    if (existingError) throw existingError
    const staleIds = (existingRows || [])
      .filter((r) => !r.verified_by_specialist)
      .filter((r) => !keptKeys.has(`${r.field_key}:${r.row_key || ROW_KEY_DOCUMENT_LEVEL}`))
      .map((r) => r.id)
    if (staleIds.length) {
      const { error: deleteError } = await admin
        .from('extracted_document_fields')
        .delete()
        .in('id', staleIds)
      if (deleteError) throw deleteError
      console.log(`[extract-document] ${documentId}: removed ${staleIds.length} row(s) left by a previous extraction`)
    }

    // ------------------------------- Phase 3: coverage check -------------
    // Everything from here on is best-effort. The whitelist extraction
    // above has already been written and is what the app is built on; a
    // failure to ALSO catch the long tail must never turn a successfully
    // extracted document into a failed one.
    try {
      let findingRows = buildOtherFindingRows({
        items: extractedOtherItems,
        documentId,
        origin: 'extraction',
        isPdf,
        alreadyCaptured: capturedValuesOf(rows)
      })

      const fieldLabelByKey = Object.fromEntries(
        (fieldDefs || []).map((f) => [f.field_key, f.field_label || f.field_key])
      )
      const coverageMessage = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              fileBlock,
              {
                type: 'text',
                text:
                  'This is everything that has been extracted from the document above:\n\n' +
                  describeExtractionForCoverage({ fieldRows: rows, findingRows, fieldLabelByKey }) +
                  '\n\nYour only job now is to check that nothing was missed. Read the document again ' +
                  'and name every amount, name, date or other concrete piece of information that ' +
                  'appears in it and is NOT represented anywhere in the list above. Ignore boilerplate, ' +
                  'page numbers, addresses of the issuing institution and legal footers — report what a ' +
                  'Swiss tax consultant would want to know. If everything is already represented, ' +
                  'return an empty list; do not invent gaps.\n\n' +
                  'If you find something but cannot say confidently what it is, still report it and set ' +
                  '"ambiguous": true with a short "note" — it will be flagged for a human rather than ' +
                  'presented as established.\n\n' +
                  'Quote the exact source text verbatim for each one. ' +
                  (isPdf
                    ? 'Also give the page number (starting at 1).'
                    : 'This has no page numbers — leave source_page null.') +
                  '\n\nRespond with ONLY a JSON array, no other text: ' +
                  '[{"label": "<short descriptive label>", "value": "<value as text>", ' +
                  '"source_quote": "<exact verbatim text>", "source_page": <page number, or null>, ' +
                  '"ambiguous": <true|false>, "note": "<why, only when ambiguous>"}, ...]'
              }
            ]
          }
        ]
      })

      findingRows = findingRows.concat(
        buildOtherFindingRows({
          items: parseJsonFromText(textOf(coverageMessage)),
          documentId,
          origin: 'coverage_check',
          isPdf,
          alreadyCaptured: capturedValuesOf(rows, findingRows)
        })
      )

      // Replaced wholesale, never accumulated: re-extracting a document
      // must leave it with exactly what this run found, the same way the
      // whitelist rows are upserted rather than appended to.
      const { error: clearError } = await admin
        .from('document_other_findings')
        .delete()
        .eq('document_id', documentId)
      if (clearError) throw clearError
      if (findingRows.length) {
        const { error: insertError } = await admin.from('document_other_findings').insert(findingRows)
        if (insertError) throw insertError
      }
    } catch (coverageError) {
      console.error(`[extract-document] coverage check failed for document ${documentId}:`, coverageError)
    }
  }

  const { error: finishError } = await admin
    .from('client_documents')
    .update({ status: 'extracted', processed_at: new Date().toISOString(), extraction_error: null })
    .eq('id', documentId)
  if (finishError) throw finishError

  // Push what this (and every other already-extracted) document says into
  // the client's own registry — personal details, properties, children —
  // so the Questionnaire reflects a fresh upload without anyone having to
  // open a specific page first. Best-effort by default: a failure here
  // must not mark the extraction itself (which did succeed) as failed.
  //
  // The synchronous "fill Questionnaire from a document/pasted text" action
  // (api/extract-document-now.js) passes throwOnRegistrySyncError instead:
  // that registry sync IS the whole point of that action (there's no
  // separate document to browse afterwards, only suggestions to review), so
  // a failure there must reach the specialist as a real error rather than a
  // silent 200 with nothing to show.
  try {
    await syncRegistryForClientYear(admin, claimed.client_id, claimed.tax_year)
  } catch (syncError) {
    console.error(`[extract-document] registry sync failed for document ${documentId}:`, syncError)
    if (throwOnRegistrySyncError) throw syncError
  }

  return { claimed: true, documentId }
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
      await admin
        .from('client_documents')
        .update({ status: 'extraction_failed', extraction_error: (error.message || 'EXTRACTION_FAILED').slice(0, 2000) })
        .eq('id', documentId)
    } catch (updateError) {
      console.error(`[extract-document] could not mark ${documentId} as extraction_failed:`, updateError)
    }
    return res.status(500).json({ error: error.message || 'EXTRACTION_FAILED' })
  }
}

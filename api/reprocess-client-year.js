// POST /api/reprocess-client-year
//   { clientId, taxYear }
//
// A one-click "reload everything from what's actually written in the
// documents" action for a whole client/year, instead of retrying documents
// one by one and hoping the derived data (Questionnaire, suggestions,
// calculation) catches up on its own. Re-runs full extraction
// (classification + fields) for EVERY document of this client/year,
// regardless of its current status — including already-'extracted' ones,
// since a document processed before a schema change (a new repeatable
// field, a new mortgage/rental field, ...) needs a fresh pass to actually
// pick it up, not just the ones currently stuck or failed.
//
// Nothing extra needed after the loop for personal details/children:
// api/extract-document.js's runExtraction() already re-runs the registry
// syncs and the tax recalculation as its own side effect for every
// document it processes. Properties are the one exception — the
// address-matching in api/_propertySuggestion.js only ever prevents a NEW
// duplicate going forward; a client whose duplicates were already
// accepted before that existed (one client_properties row per document
// that happened to mention the same real property) needs them merged
// too, so this also runs dedupeClientProperties() once at the end.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'
import { dedupeClientProperties } from './_propertySuggestion.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const clientId = body.clientId
    const taxYear = Number(body.taxYear)
    if (!clientId || !taxYear) {
      throw httpError(400, 'MISSING_PARAMS', 'clientId and taxYear are required.')
    }

    const { data: documents, error: docsError } = await admin
      .from('client_documents')
      .select('id, status')
      .eq('client_id', clientId)
      .eq('tax_year', taxYear)
    if (docsError) throw docsError

    let processed = 0
    let failures = []
    if (documents?.length) {
      // Dynamic, not static: see api/retry-extraction.js for why — a bad
      // import anywhere in this graph must surface as a JSON error here,
      // not a bare platform 500 with no message.
      const { runExtraction } = await import('./extract-document.js')
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

      const results = await Promise.allSettled(
        documents.map((doc) => runExtraction(admin, anthropic, doc.id, { fromStatuses: [doc.status] }))
      )
      failures = results.filter((r) => r.status === 'rejected')
      failures.forEach((r) => console.error('[reprocess-client-year]', r.reason))
      // A fulfilled run that skipped its document (its status changed under
      // it) is not a document that was reprocessed — counting it as one
      // reported "15 reprocessed" for a run that touched nothing.
      const skipped = results.filter((r) => r.status === 'fulfilled' && r.value?.claimed === false).length
      processed = documents.length - failures.length - skipped
    }

    let mergedProperties = 0
    try {
      mergedProperties = (await dedupeClientProperties(admin, clientId)).merged
    } catch (dedupError) {
      console.error('[reprocess-client-year] property dedup failed:', dedupError)
    }

    return res.status(200).json({
      processed,
      failed: failures.length,
      errors: failures.map((r) => r.reason?.message || 'UNEXPECTED_ERROR'),
      mergedProperties
    })
  } catch (error) {
    console.error('[reprocess-client-year]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

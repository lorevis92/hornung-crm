// POST /api/reprocess-client-year
//   { clientId, taxYear }
//
// "Estrai tutto": re-runs the full extraction (classification + fields +
// person) for EVERY document of this client/year, whatever its current
// status — including already-extracted ones, so a change to the field
// dictionary or to the prompt reaches documents processed before it.
//
// At most EXTRACTION_CONCURRENCY documents are extracted at the same time:
// firing them all at once made a large case hit the Anthropic rate limit
// and fail half its documents for no reason of their own. The answer says
// how many succeeded and, for each one that did not, which document and
// why — so the case page can show exactly what to retry.
//
// The registry syncs (personal details, children, properties) already run
// inside runExtraction for every document; properties additionally get one
// dedupeClientProperties() pass at the end, which merges duplicates accepted
// before the address matching in api/_propertySuggestion.js existed.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'
import { dedupeClientProperties } from './_propertySuggestion.js'
import { mapWithConcurrency } from '../src/lib/concurrency.js'

export const EXTRACTION_CONCURRENCY = 3

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
      .select('id, status, file_name')
      .eq('client_id', clientId)
      .eq('tax_year', taxYear)
    if (docsError) throw docsError

    const failures = []
    let processed = 0
    if (documents?.length) {
      // Dynamic, not static: a bad import anywhere in the extraction graph
      // must surface as a JSON error here, not a bare platform 500.
      const { runExtraction } = await import('./extract-document.js')
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

      const results = await mapWithConcurrency(documents, EXTRACTION_CONCURRENCY, (doc) =>
        runExtraction(admin, anthropic, doc.id, { fromStatuses: [doc.status] })
      )
      results.forEach((result, i) => {
        const doc = documents[i]
        if (result.status === 'rejected') {
          console.error('[reprocess-client-year]', doc.id, result.reason)
          failures.push({ documentId: doc.id, fileName: doc.file_name, error: result.reason?.message || 'UNEXPECTED_ERROR' })
        } else if (result.value?.claimed === false) {
          // Its status changed under us (someone else is extracting it):
          // not reprocessed, and not a failure of the document either.
          failures.push({ documentId: doc.id, fileName: doc.file_name, error: 'ALREADY_PROCESSING' })
        } else {
          processed++
        }
      })
    }

    let mergedProperties = 0
    try {
      mergedProperties = (await dedupeClientProperties(admin, clientId)).merged
    } catch (dedupError) {
      console.error('[reprocess-client-year] property dedup failed:', dedupError)
    }

    return res.status(200).json({ processed, failed: failures.length, failures, mergedProperties })
  } catch (error) {
    console.error('[reprocess-client-year]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

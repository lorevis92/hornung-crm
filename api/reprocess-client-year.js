// POST /api/reprocess-client-year
//   { clientId, taxYear }  ->  202 { jobId, total }
//
// "Estrai tutto": re-runs the full extraction (classification + fields +
// person) for EVERY document of this client/year, whatever its current
// status — including already-extracted ones, so a change to the field
// dictionary or to the prompt reaches documents processed before it.
//
// Queued, not run here (api/_extractionQueue.js): one queue message per
// document, at most EXTRACTION_CONCURRENCY extracted at the same time (the
// queue consumer's max_concurrency) — firing them all at once made a large
// case hit the Anthropic rate limit and fail half its documents for no
// reason of their own. The page polls the job, which ends with how many
// succeeded and, for each one that did not, which document and why — so
// the case page can show exactly what to retry.
//
// The registry syncs (personal details, children, properties) run inside
// runExtraction for every document; properties additionally get one
// dedupeClientProperties() pass once the last document is done, which
// merges duplicates accepted before the address matching in
// api/_propertySuggestion.js existed.
import { httpError, readBody, requireStaff } from './_lib.js'
import { EXTRACTION_CONCURRENCY, startExtractionJob } from './_extractionQueue.js'

export { EXTRACTION_CONCURRENCY }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin, profile } = await requireStaff(req)
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

    const job = await startExtractionJob(admin, {
      kind: 'reprocess',
      documents: documents || [],
      clientId,
      taxYear,
      requestedBy: profile.id
    })
    return res.status(202).json({ jobId: job.id, total: job.total })
  } catch (error) {
    console.error('[reprocess-client-year]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

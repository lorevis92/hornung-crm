// POST /api/retry-extraction
//   { documentId }  ->  202 { jobId }
//
// "Riprova estrazione" on one document in Tax Summary: re-runs the whole
// extraction (classification, fields, person). Queued, not run here (see
// api/_extractionQueue.js): the page polls the job until it is finished. Works from any status — a document never processed ('uploaded'),
// abandoned mid-run ('extracting', e.g. a platform timeout), failed
// ('extraction_failed') or already extracted — except 'rejected', which a
// specialist set on purpose. Staff only (requireStaff), unlike
// api/extract-document.js's webhook-secret auth.
import { httpError, readBody, requireStaff } from './_lib.js'
import { startExtractionJob } from './_extractionQueue.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin, profile } = await requireStaff(req)
    const body = readBody(req)
    const documentId = body.documentId
    if (!documentId) throw httpError(400, 'DOCUMENT_ID_REQUIRED', 'A documentId is required.')

    const { data: doc, error: docError } = await admin
      .from('client_documents')
      .select('id, status, file_name, client_id, tax_year')
      .eq('id', documentId)
      .maybeSingle()
    if (docError) throw docError
    if (!doc) throw httpError(404, 'DOCUMENT_NOT_FOUND', 'No such document.')
    if (doc.status === 'rejected') {
      throw httpError(409, 'NOT_RETRYABLE', 'This document was rejected — nothing to retry.')
    }

    // From whatever status it has now; if it changes before its turn (someone
    // else extracting it), the job reports ALREADY_PROCESSING for it.
    const job = await startExtractionJob(admin, {
      kind: 'retry',
      documents: [doc],
      clientId: doc.client_id,
      taxYear: doc.tax_year,
      requestedBy: profile.id
    })
    return res.status(202).json({ jobId: job.id })
  } catch (error) {
    console.error('[retry-extraction]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

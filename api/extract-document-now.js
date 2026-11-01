// POST /api/extract-document-now
//   { documentId, categoryCode? }  ->  202 { jobId }
//
// Staff-triggered extraction for a document that's still 'uploaded' — the
// Questionnaire's "fill from a file/pasted text" action, which needs the
// specialist to see the resulting suggestions right away: the page uploads
// the file without the automatic extraction, calls this, and polls the job
// (api/_extractionQueue.js) until it is finished. categoryCode, when given, skips
// AI classification entirely — the specialist already knows this is a
// personal-details document (current_tax_sheet), there's no ambiguity to
// resolve, and classifying it anyway risks the AI picking something else
// for an email-pasted snippet or an unusual file.
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

    // The registry sync (suggestions/autoFill) is the only visible outcome
    // of this action, so the job runs with throwOnRegistrySyncError: a
    // failure there is a failure of the job (see api/_extractionQueue.js).
    const job = await startExtractionJob(admin, {
      kind: 'now',
      documents: [doc],
      clientId: doc.client_id,
      taxYear: doc.tax_year,
      requestedBy: profile.id,
      forcedCategoryCode: body.categoryCode || null
    })
    return res.status(202).json({ jobId: job.id })
  } catch (error) {
    console.error('[extract-document-now]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

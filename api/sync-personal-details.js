// POST /api/sync-personal-details
//   { documentId }
//
// Re-runs the "Personal details" (current_tax_sheet) -> registry sync for
// one document — called by the browser right after a specialist manually
// saves a field on such a document (the AI-extraction path calls
// api/_personalDetails.js directly instead, see api/extract-document.js).
// Staff only, same service-role pattern as api/calculate-aggregates.js —
// the actual logic lives in api/_personalDetails.js so nothing is
// duplicated between the two trigger points.
import { httpError, readBody, requireStaff } from './_lib.js'
import { syncPersonalDetails } from './_personalDetails.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const documentId = body.documentId
    if (!documentId) throw httpError(400, 'MISSING_PARAMS', 'documentId is required.')

    const result = await syncPersonalDetails(admin, documentId)
    return res.status(200).json(result)
  } catch (error) {
    console.error('[sync-personal-details]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

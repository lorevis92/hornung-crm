// POST /api/sync-property-suggestion
//   { documentId }
//
// Re-runs the "property_tax_value" -> client_properties suggestion for one
// document — called by the browser right after a specialist manually saves
// a field on such a document (the AI-extraction path calls
// api/_propertySuggestion.js directly instead, see api/extract-document.js).
// Staff only, same service-role pattern as api/sync-personal-details.js.
import { httpError, readBody, requireStaff } from './_lib.js'
import { syncPropertySuggestion } from './_propertySuggestion.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const documentId = body.documentId
    if (!documentId) throw httpError(400, 'MISSING_PARAMS', 'documentId is required.')

    const result = await syncPropertySuggestion(admin, documentId)
    return res.status(200).json(result)
  } catch (error) {
    console.error('[sync-property-suggestion]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

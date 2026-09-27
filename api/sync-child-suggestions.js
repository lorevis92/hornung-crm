// POST /api/sync-child-suggestions
//   { clientId, taxYear }
//
// Re-runs the child-name/child-count cross-reference for a client/year —
// called by the browser right after a specialist manually saves a
// children_count or child_name field (the AI-extraction path calls
// api/_childSuggestion.js directly instead, see api/extract-document.js).
// Staff only, same service-role pattern as api/sync-personal-details.js.
import { httpError, readBody, requireStaff } from './_lib.js'
import { syncChildSuggestions } from './_childSuggestion.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const clientId = body.clientId
    const taxYear = Number(body.taxYear)
    if (!clientId || !taxYear) throw httpError(400, 'MISSING_PARAMS', 'clientId and taxYear are required.')

    const result = await syncChildSuggestions(admin, clientId, taxYear)
    return res.status(200).json(result)
  } catch (error) {
    console.error('[sync-child-suggestions]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

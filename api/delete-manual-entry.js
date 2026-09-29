// POST /api/delete-manual-entry
//   { id }
import { httpError, readBody, requireStaff } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    if (!body.id) throw httpError(400, 'MISSING_PARAMS', 'id is required.')

    const { error } = await admin.from('tax_manual_aggregate_entries').delete().eq('id', body.id)
    if (error) throw error

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[delete-manual-entry]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

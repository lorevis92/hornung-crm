// POST /api/calculate-aggregates
//   { clientId, taxYear, lang }
//
// Computes taxable income/wealth for a client + tax year from extracted
// fields, using field_calculation_rules and tax_parameters, and persists
// the result to tax_aggregates / tax_aggregate_components. Staff only
// (requireStaff), same service-role pattern as api/extract-document.js —
// no calculation logic runs in the browser. The actual math lives in
// src/lib/taxCalculation.js; the read-compute-persist steps here are
// shared with api/extract-document.js (a fresh extraction recalculates
// too) via api/_recalc.js, so nothing is duplicated between the two.
import { httpError, readBody, requireStaff } from './_lib.js'
import { recalculateAndPersist } from './_recalc.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const clientId = body.clientId
    const taxYear = Number(body.taxYear)
    const lang = ['en', 'de', 'fr', 'it'].includes(body.lang) ? body.lang : 'en'
    if (!clientId || !taxYear) {
      throw httpError(400, 'MISSING_PARAMS', 'clientId and taxYear are required.')
    }

    const result = await recalculateAndPersist(admin, clientId, taxYear, lang)
    return res.status(200).json(result)
  } catch (error) {
    console.error('[calculate-aggregates]', error)
    if (error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'CLIENT_NOT_FOUND', code: 'CLIENT_NOT_FOUND' })
    }
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

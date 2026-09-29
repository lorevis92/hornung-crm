// POST /api/save-manual-entry
//   { id?, clientId, taxYear, componentType, description, amount, currencyCode?, originalAmount?, note? }
//
// Creates (no id) or updates (with id) a manual "how this was calculated"
// row — a specialist-typed entry with no underlying extracted document at
// all, e.g. an amount known some other way. Always counts, going through
// the same section/rounding logic as every other component
// (src/lib/taxCalculation.js), and survives recalculations because it's
// read fresh from tax_manual_aggregate_entries on every one (unlike
// tax_aggregate_components, wiped and rebuilt each time). `amount` is
// always the final CHF figure; currencyCode/originalAmount are kept only
// for display when the specialist entered a non-CHF original. Staff only.
import { httpError, readBody, requireStaff } from './_lib.js'

const VALID_COMPONENT_TYPES = ['income', 'deduction', 'wealth', 'debt']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { profile, admin } = await requireStaff(req)
    const body = readBody(req)
    const { id, clientId, componentType, description } = body
    const taxYear = Number(body.taxYear)
    const amount = Number(body.amount)
    const originalAmount = body.originalAmount == null ? null : Number(body.originalAmount)

    if (!clientId || !taxYear || !description?.trim() || !Number.isFinite(amount)) {
      throw httpError(400, 'MISSING_PARAMS', 'clientId, taxYear, description and a numeric amount are required.')
    }
    if (!VALID_COMPONENT_TYPES.includes(componentType)) {
      throw httpError(400, 'INVALID_COMPONENT_TYPE', 'componentType must be one of income, deduction, wealth, debt.')
    }

    const payload = {
      client_id: clientId,
      tax_year: taxYear,
      component_type: componentType,
      description: description.trim(),
      amount,
      currency_code: body.currencyCode || null,
      original_amount: Number.isFinite(originalAmount) ? originalAmount : null,
      note: body.note || null
    }

    if (id) {
      const { data, error } = await admin
        .from('tax_manual_aggregate_entries')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.status(200).json(data)
    }

    const { data, error } = await admin
      .from('tax_manual_aggregate_entries')
      .insert({ ...payload, created_by: profile.id })
      .select()
      .single()
    if (error) throw error
    return res.status(200).json(data)
  } catch (error) {
    console.error('[save-manual-entry]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

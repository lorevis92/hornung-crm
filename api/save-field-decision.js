// POST /api/save-field-decision
//   { clientId, taxYear, documentId, fieldKey, rowKey, decision, decidedAmount, note }
//
// A specialist's explicit "include" or "exclude" call on one extracted
// field the tax calculation flagged as needing verification (foreign
// currency not yet converted, a possible double deduction, a donation with
// a consideration, a mutually-exclusive duplicate, ...). Persisted to
// tax_field_decisions independently of tax_aggregate_components (which is
// wiped and rebuilt on every recalculation — see api/_recalc.js), keyed by
// (document_id, field_key, row_key) so a later decision replaces the first
// instead of piling up, and a decision on one row of a repeated field
// (one bank account, one insurance premium) never leaks onto another row
// sharing the same field_key — rowKey is '' for a document-level field.
// decidedAmount snapshots the field's raw extracted amount at decision
// time; src/lib/taxCalculation.js ignores the decision once that no longer
// matches (the document was re-extracted/corrected since), so the field
// reverts to needing verification rather than silently keeping a stale
// human call. Staff only — this is a specialist judgment call on the
// client's own tax figures.
import { httpError, readBody, requireStaff } from './_lib.js'

const VALID_DECISIONS = ['include', 'exclude']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { profile, admin } = await requireStaff(req)
    const body = readBody(req)
    const { clientId, documentId, fieldKey } = body
    const rowKey = body.rowKey || ''
    const taxYear = Number(body.taxYear)
    const decision = body.decision
    const decidedAmount = body.decidedAmount == null ? null : Number(body.decidedAmount)

    if (!clientId || !taxYear || !documentId || !fieldKey) {
      throw httpError(400, 'MISSING_PARAMS', 'clientId, taxYear, documentId and fieldKey are required.')
    }
    if (!VALID_DECISIONS.includes(decision)) {
      throw httpError(400, 'INVALID_DECISION', 'decision must be "include" or "exclude".')
    }

    const { data, error } = await admin
      .from('tax_field_decisions')
      .upsert(
        {
          client_id: clientId,
          tax_year: taxYear,
          document_id: documentId,
          field_key: fieldKey,
          row_key: rowKey,
          decision,
          decided_amount: Number.isFinite(decidedAmount) ? decidedAmount : null,
          note: body.note || null,
          decided_by: profile.id,
          decided_at: new Date().toISOString()
        },
        { onConflict: 'document_id,field_key,row_key' }
      )
      .select()
      .single()
    if (error) throw error

    return res.status(200).json(data)
  } catch (error) {
    console.error('[save-field-decision]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

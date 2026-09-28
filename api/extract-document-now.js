// POST /api/extract-document-now
//   { documentId, categoryCode? }
//
// Staff-triggered, synchronous extraction for a document that's still
// 'uploaded' — like api/retry-extraction.js, but for the normal case
// where nothing has failed yet, just where waiting for the async pg_net
// webhook (see api/extract-document.js's own header comment) isn't good
// enough: the Questionnaire's "fill from a file/pasted text" action needs
// the specialist to see the resulting suggestions right away, not
// whenever the webhook happens to fire. categoryCode, when given, skips
// AI classification entirely — the specialist already knows this is a
// personal-details document (current_tax_sheet), there's no ambiguity to
// resolve, and classifying it anyway risks the AI picking something else
// for an email-pasted snippet or an unusual file.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const documentId = body.documentId
    if (!documentId) throw httpError(400, 'DOCUMENT_ID_REQUIRED', 'A documentId is required.')

    const { data: doc, error: docError } = await admin
      .from('client_documents')
      .select('id, status')
      .eq('id', documentId)
      .maybeSingle()
    if (docError) throw docError
    if (!doc) throw httpError(404, 'DOCUMENT_NOT_FOUND', 'No such document.')

    // Dynamic, not static: see api/retry-extraction.js for why — a bad
    // import anywhere in this graph must surface as a JSON error here,
    // not a bare platform 500 with no message.
    const { runExtraction } = await import('./extract-document.js')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    await runExtraction(admin, anthropic, documentId, {
      fromStatuses: [doc.status],
      forcedCategoryCode: body.categoryCode || null
    })
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[extract-document-now]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

// POST /api/retry-extraction
//   { documentId }
//
// "Riprova estrazione" on one document in Tax Summary: re-runs the whole
// extraction (classification, fields, person) synchronously and waits for
// it. Works from any status — a document never processed ('uploaded'),
// abandoned mid-run ('extracting', e.g. a platform timeout), failed
// ('extraction_failed') or already extracted — except 'rejected', which a
// specialist set on purpose. Staff only (requireStaff), unlike
// api/extract-document.js's webhook-secret auth.
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
    if (doc.status === 'rejected') {
      throw httpError(409, 'NOT_RETRYABLE', 'This document was rejected — nothing to retry.')
    }

    // Dynamic, not a static top-level import: a bad import anywhere in the
    // extraction graph fails module resolution, which a try/catch around a
    // static import can never catch (a bare platform 500 with no JSON body).
    // A failed dynamic import is just a rejected promise, caught below.
    const { runExtraction } = await import('./extract-document.js')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const result = await runExtraction(admin, anthropic, documentId, { fromStatuses: [doc.status] })
    // runExtraction skips a document whose status changed between the read
    // above and its own atomic claim — say so instead of a false success.
    if (result && result.claimed === false) {
      throw httpError(409, 'NOT_RETRYABLE', 'This document was already being processed — nothing was re-extracted.')
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[retry-extraction]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

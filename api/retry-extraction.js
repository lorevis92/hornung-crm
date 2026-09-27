// POST /api/retry-extraction
//   { documentId }
//
// Lets a specialist manually re-run AI extraction on a document stuck at
// status = 'extraction_failed' — until now there was no way to recover one
// short of editing the database directly, so a failed document just stayed
// broken forever. Staff-triggered (requireStaff), unlike
// api/extract-document.js's webhook-secret auth — this one runs
// synchronously and waits for the Anthropic call, same UX as the existing
// "Recalculate" button.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'
import { runExtraction } from './extract-document.js'

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
    if (doc.status !== 'extraction_failed') {
      throw httpError(409, 'NOT_FAILED', `Document is "${doc.status}", not "extraction_failed" — nothing to retry.`)
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    await runExtraction(admin, anthropic, documentId, { fromStatuses: ['extraction_failed'] })
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[retry-extraction]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

// POST /api/retry-extraction
//   { documentId }
//
// Lets a specialist manually re-run AI extraction on a document that never
// reached status = 'extracted' — until now this only accepted
// 'extraction_failed', so a document stuck at 'extracting' forever (the
// webhook invocation crashed or was killed by a platform timeout — see
// export const config below — somewhere after claiming it, before either
// finishing or reaching its own catch block) had no recovery path at all
// short of editing the database directly. Now retryable from any
// non-terminal status: 'uploaded' (the webhook never fired, or never even
// reached the atomic claim), 'extracting' (claimed but abandoned) or
// 'extraction_failed' (ran and threw). Staff-triggered (requireStaff),
// unlike api/extract-document.js's webhook-secret auth — this one runs
// synchronously and waits for the Anthropic call, same UX as the existing
// "Recalculate" button.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'
import { runExtraction } from './extract-document.js'

const RETRYABLE_STATUSES = ['uploaded', 'extracting', 'extraction_failed']

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
    if (!RETRYABLE_STATUSES.includes(doc.status)) {
      throw httpError(409, 'NOT_RETRYABLE', `Document is "${doc.status}" — nothing to retry.`)
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    await runExtraction(admin, anthropic, documentId, { fromStatuses: [doc.status] })
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[retry-extraction]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

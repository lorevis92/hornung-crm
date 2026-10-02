// POST /api/retry-extraction
//   { documentId, force }
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
//
// force: true additionally allows re-extracting a document already at
// 'extracted' — used by the "re-extract this document" action on a row
// flagged as extracted under the old suffix-based field model (see
// src/lib/rowBasedFields.js), which needs a fresh extraction to assign
// row_key to each row even though the document already "succeeded" once.
import Anthropic from '@anthropic-ai/sdk'
import { httpError, readBody, requireStaff } from './_lib.js'

const RETRYABLE_STATUSES = ['uploaded', 'extracting', 'extraction_failed']
const FORCE_RETRYABLE_STATUSES = [...RETRYABLE_STATUSES, 'extracted']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const documentId = body.documentId
    const force = body.force === true
    if (!documentId) throw httpError(400, 'DOCUMENT_ID_REQUIRED', 'A documentId is required.')

    const { data: doc, error: docError } = await admin
      .from('client_documents')
      .select('id, status')
      .eq('id', documentId)
      .maybeSingle()
    if (docError) throw docError
    if (!doc) throw httpError(404, 'DOCUMENT_NOT_FOUND', 'No such document.')
    const allowedStatuses = force ? FORCE_RETRYABLE_STATUSES : RETRYABLE_STATUSES
    if (!allowedStatuses.includes(doc.status)) {
      throw httpError(409, 'NOT_RETRYABLE', `Document is "${doc.status}" — nothing to retry.`)
    }

    // Dynamic, not a static top-level import: extract-document.js pulls in
    // the calculation/registry-sync modules, which change often — a bad
    // import anywhere in that graph fails module *resolution*, which a
    // try/catch around a static import can never catch (it happens before
    // this function's own code runs at all, surfacing as a bare platform
    // 500 with no JSON body). A failed dynamic import is just a rejected
    // promise, caught below like any other error.
    const { runExtraction } = await import('./extract-document.js')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const result = await runExtraction(admin, anthropic, documentId, { fromStatuses: [doc.status] })
    // runExtraction skips a document whose status changed between the read
    // above and its own atomic claim. That used to return a bare 200, so the
    // specialist got a success toast for an extraction that never ran and
    // then wondered why Tax Summary looked unchanged.
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

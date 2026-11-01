// Document extraction through a Cloudflare Queue (see
// db/migrations/20260101000054_extraction_jobs.sql for the job tables).
//
// On Vercel an extraction ran inside the HTTP request that asked for it
// (up to 5 minutes, maxDuration 300). On Workers a request's CPU time and
// its waitUntil (30 s) are limited, so instead:
//
//   request (upload / "Riprova" / "Estrai tutto" / "fill from document")
//     -> startExtractionJob(): one extraction_jobs row, one item and one
//        queue message per document, answer { jobId } at once
//   queue consumer (worker/index.js `queue` handler, max_concurrency = 3,
//   one message per invocation — wrangler.toml)
//     -> handleExtractionMessage(): claims the item, runs runExtraction()
//        exactly as before, records the outcome on the item
//   the page that asked
//     -> polls the data op getExtractionJob until finished_at is set
//        (src/lib/data/supabaseData.js waitForExtractionJob)
//
// At most EXTRACTION_CONCURRENCY extractions run at the same time across
// the whole app — the same limit "Estrai tutto" used to apply to itself,
// so a large case still doesn't hit the AI rate limit.
import Anthropic from '@anthropic-ai/sdk'
import { httpError } from './_lib.js'
import { runtimeBinding } from './_runtime.js'

export const EXTRACTION_QUEUE_BINDING = 'EXTRACTION_QUEUE'
// Must match [[queues.consumers]] max_concurrency in wrangler.toml
// (test/extraction-queue.test.js checks it does).
export const EXTRACTION_CONCURRENCY = 3
// A delivery that finds its item still being run by someone else comes back
// later: if that run died (isolate killed), the claim goes stale after 15
// minutes (claim_extraction_job_item) and the next delivery takes over.
export const BUSY_RETRY_SECONDS = 10 * 60
const SEND_BATCH_MAX = 100

function queueBinding() {
  const queue = runtimeBinding(EXTRACTION_QUEUE_BINDING)
  if (!queue) {
    throw httpError(500, 'MISSING_EXTRACTION_QUEUE', 'The EXTRACTION_QUEUE binding is not configured — see wrangler.toml.')
  }
  return queue
}

function unwrap({ data, error }, code = 'EXTRACTION_JOB_FAILED') {
  if (error) throw httpError(500, code, error.message)
  return data
}

/**
 * documents: [{ id, status, file_name }] (client_documents rows).
 * fromStatuses per document: the status it must still be in when its turn
 * comes (default: the status it has now) — the same atomic-claim rule
 * runExtraction always applied.
 */
export async function startExtractionJob(admin, {
  kind,
  documents,
  clientId = null,
  taxYear = null,
  requestedBy = null,
  forcedCategoryCode = null,
  fromStatuses = null
}) {
  const queue = queueBinding()
  const job = unwrap(
    await admin
      .from('extraction_jobs')
      .insert({
        kind,
        client_id: clientId,
        tax_year: taxYear,
        requested_by: requestedBy,
        forced_category_code: forcedCategoryCode,
        total: documents.length,
        // Nothing to do is done at once (e.g. "Estrai tutto" on an empty year).
        ...(documents.length ? {} : { finished_at: new Date().toISOString(), result: {} })
      })
      .select()
      .single()
  )
  if (!documents.length) return job

  unwrap(
    await admin.from('extraction_job_items').insert(
      documents.map((doc) => ({
        job_id: job.id,
        document_id: doc.id,
        file_name: doc.file_name || null,
        from_statuses: fromStatuses || [doc.status]
      }))
    )
  )
  const messages = documents.map((doc) => ({ body: { jobId: job.id, documentId: doc.id } }))
  for (let i = 0; i < messages.length; i += SEND_BATCH_MAX) {
    await queue.sendBatch(messages.slice(i, i + SEND_BATCH_MAX))
  }
  return job
}

/** The automatic extraction after an upload (what the pg_net trigger did).
 * Never fails the upload: without a queue the document simply stays
 * 'uploaded' and "Riprova estrazione" picks it up — as before when the
 * webhook was not configured. */
export async function queueUploadedDocument(admin, clientDocument) {
  if (!clientDocument || clientDocument.status !== 'uploaded') return null
  try {
    return await startExtractionJob(admin, {
      kind: 'upload',
      documents: [clientDocument],
      clientId: clientDocument.client_id,
      taxYear: clientDocument.tax_year,
      fromStatuses: ['uploaded']
    })
  } catch (error) {
    console.error(`[extraction-queue] could not queue the extraction of ${clientDocument.id} — it stays "uploaded":`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

/**
 * One queue message -> one document extracted. Returns what to do with the
 * message: 'ack' (done, failed for good, or a duplicate) or 'retry' (the
 * item is being run by someone else right now, or the database could not
 * be reached before the run started).
 */
export async function handleExtractionMessage(admin, body, { anthropic, runExtraction, dedupeClientProperties } = {}) {
  const { jobId, documentId } = body || {}
  if (!jobId || !documentId) return { action: 'ack', outcome: 'malformed' }

  const { data: claimedRows, error: claimError } = await admin.rpc('claim_extraction_job_item', {
    p_job_id: jobId,
    p_document_id: documentId
  })
  if (claimError) return { action: 'retry', outcome: 'claim_failed', error: claimError.message }
  const item = claimedRows?.[0]
  if (!item) {
    const { data: current } = await admin
      .from('extraction_job_items')
      .select('state')
      .eq('job_id', jobId)
      .eq('document_id', documentId)
      .maybeSingle()
    // Being run right now by another delivery: look again later.
    if (current?.state === 'running') return { action: 'retry', outcome: 'busy', delaySeconds: BUSY_RETRY_SECONDS }
    return { action: 'ack', outcome: 'duplicate' }
  }

  const { data: job } = await admin.from('extraction_jobs').select('*').eq('id', jobId).maybeSingle()
  const run = runExtraction || (await import('./extract-document.js')).runExtraction
  const ai = anthropic || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  // Taking over a run that died half-way: the document was left at
  // 'extracting' by it.
  const fromStatuses = item.reclaimed ? [...new Set([...item.from_statuses, 'extracting'])] : item.from_statuses

  let state = 'done'
  let errorMessage = null
  try {
    const result = await run(admin, ai, documentId, {
      fromStatuses,
      forcedCategoryCode: job?.forced_category_code || null,
      // The Questionnaire's "fill from a document": the registry sync IS the
      // result (see api/extract-document-now.js).
      throwOnRegistrySyncError: job?.kind === 'now'
    })
    if (result && result.claimed === false) {
      state = 'skipped'
      errorMessage = 'ALREADY_PROCESSING'
    }
  } catch (error) {
    // runExtraction has already marked the document extraction_failed with
    // this message; a retry would only find it in another status.
    state = 'failed'
    errorMessage = error?.message || 'EXTRACTION_FAILED'
    console.error(`[extraction-queue] document ${documentId} failed:`, error)
  }

  const { data: progress, error: finishError } = await admin.rpc('finish_extraction_job_item', {
    p_job_id: jobId,
    p_document_id: documentId,
    p_state: state,
    p_error: errorMessage
  })
  if (finishError) console.error(`[extraction-queue] could not record the outcome of ${documentId}:`, finishError)

  if (progress === 'finalize') await finalizeReprocessJob(admin, job, { dedupeClientProperties })
  return { action: 'ack', outcome: state, progress }
}

// "Estrai tutto" ended with one dedupeClientProperties() pass over the
// client's properties (see api/reprocess-client-year.js); it runs once,
// after the last document.
async function finalizeReprocessJob(admin, job, { dedupeClientProperties } = {}) {
  let mergedProperties = 0
  try {
    const dedupe = dedupeClientProperties || (await import('./_propertySuggestion.js')).dedupeClientProperties
    mergedProperties = (await dedupe(admin, job.client_id)).merged
  } catch (error) {
    console.error('[extraction-queue] property dedup failed:', error)
  }
  await admin
    .from('extraction_jobs')
    .update({ result: { mergedProperties }, finished_at: new Date().toISOString() })
    .eq('id', job.id)
}

/** The shape the pages used to get from the synchronous endpoints. */
export function summarizeJob(job, items) {
  const failures = items
    .filter((item) => item.state === 'failed' || item.state === 'skipped')
    .map((item) => ({ documentId: item.document_id, fileName: item.file_name, error: item.error || 'UNEXPECTED_ERROR' }))
  return {
    id: job.id,
    kind: job.kind,
    finished: Boolean(job.finished_at),
    total: job.total,
    pending: items.filter((item) => item.state === 'queued' || item.state === 'running').length,
    processed: items.filter((item) => item.state === 'done').length,
    failed: failures.length,
    failures,
    mergedProperties: job.result?.mergedProperties ?? 0
  }
}

/** worker/index.js `queue` handler: one invocation, one batch. */
export async function consumeExtractionBatch(batch, { serviceClient }) {
  for (const message of batch.messages) {
    let decision
    try {
      decision = await handleExtractionMessage(serviceClient(), message.body)
    } catch (error) {
      console.error('[extraction-queue] unexpected error, retrying later:', error)
      decision = { action: 'retry' }
    }
    if (decision.action === 'retry') message.retry(decision.delaySeconds ? { delaySeconds: decision.delaySeconds } : undefined)
    else message.ack()
  }
}

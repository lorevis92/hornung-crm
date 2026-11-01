// The extraction no longer runs inside the HTTP request that asks for it
// (api/_extractionQueue.js): a job + one queue message per document, run by
// the queue consumer, polled by the page. Against a real Postgres (PGlite,
// every migration) with the AI part (runExtraction) replaced by a timed fake.
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPgliteDb } from './helpers/pgliteDb.js'
import { setRuntime } from '../api/_runtime.js'
import {
  EXTRACTION_CONCURRENCY,
  consumeExtractionBatch,
  handleExtractionMessage,
  queueUploadedDocument,
  startExtractionJob,
  summarizeJob
} from '../api/_extractionQueue.js'

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let db
let query
let sent
let seq = 0

beforeAll(async () => {
  ;({ db, query } = await createPgliteDb())
}, 120000)

beforeEach(() => {
  sent = []
  setRuntime({ env: { EXTRACTION_QUEUE: { sendBatch: async (messages) => sent.push(...messages) } } })
})

// A client with `n` documents (case_documents -> mirrored client_documents).
async function seedDocuments(n, status = 'extracted') {
  seq++
  const { data: client } = await db
    .from('clients')
    .insert({ app_id: 'hornung_crm', first_name: 'Eva', last_name: `Q${seq}`, email: `eva${seq}@q.test`, status: 'active' })
    .select()
    .single()
  const { data: taxCase } = await db.from('tax_cases').insert({ client_id: client.id, tax_year: 2025, status: 'in_process' }).select().single()
  const documents = []
  for (let i = 0; i < n; i++) {
    const { data: caseDoc } = await db
      .from('case_documents')
      .insert({ case_id: taxCase.id, direction: 'client_upload', storage_path: `p/${seq}/doc-${i}.pdf`, file_name: `doc-${i}.pdf` })
      .select()
      .single()
    const { data: doc } = await db
      .from('client_documents')
      .update({ status })
      .eq('source_case_document_id', caseDoc.id)
      .select('id, status, file_name, client_id, tax_year')
      .single()
    documents.push(doc)
  }
  return { client, documents }
}

// What the queue consumer does with max_concurrency = `limit`: never more
// than `limit` messages in flight.
async function drainQueue(runExtraction, { limit = EXTRACTION_CONCURRENCY, dedupeClientProperties } = {}) {
  const queue = [...sent]
  sent = []
  let inFlight = 0
  let peak = 0
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const message = queue.shift()
      inFlight++
      peak = Math.max(peak, inFlight)
      await handleExtractionMessage(db, message.body, { anthropic: {}, runExtraction, dedupeClientProperties })
      inFlight--
    }
  })
  await Promise.all(workers)
  return { peak }
}

async function jobSummary(jobId) {
  const { data: job } = await db.from('extraction_jobs').select('*').eq('id', jobId).single()
  const { data: items } = await db.from('extraction_job_items').select('document_id, file_name, state, error').eq('job_id', jobId)
  return summarizeJob(job, items)
}

describe('"Estrai tutto" through the queue', () => {
  it('one message per document; never more than 3 extractions at the same time', async () => {
    const { client, documents } = await seedDocuments(12)
    const job = await startExtractionJob(db, { kind: 'reprocess', documents, clientId: client.id, taxYear: 2025 })
    expect(sent).toHaveLength(12)
    expect(new Set(sent.map((m) => m.body.documentId))).toEqual(new Set(documents.map((d) => d.id)))

    let inFlight = 0
    let peak = 0
    const runExtraction = async (_admin, _ai, documentId) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick(5)
      inFlight--
      return { claimed: true, documentId }
    }
    let deduped = 0
    await drainQueue(runExtraction, { dedupeClientProperties: async () => ({ merged: ++deduped && 2 }) })

    expect(EXTRACTION_CONCURRENCY).toBeGreaterThanOrEqual(2)
    expect(EXTRACTION_CONCURRENCY).toBeLessThanOrEqual(3)
    expect(peak).toBeLessThanOrEqual(EXTRACTION_CONCURRENCY)
    expect(peak).toBeGreaterThan(1) // still in parallel, just bounded
    const summary = await jobSummary(job.id)
    expect(summary).toMatchObject({ finished: true, total: 12, pending: 0, processed: 12, failed: 0, failures: [], mergedProperties: 2 })
    expect(deduped).toBe(1) // the final property pass runs once, after the last document
  })

  it('reports how many succeeded and which failed, with the reason — the shape the case page shows', async () => {
    const { client, documents } = await seedDocuments(12)
    const job = await startExtractionJob(db, { kind: 'reprocess', documents, clientId: client.id, taxYear: 2025 })
    const failing = documents[3].id
    const busy = documents[8].id
    await drainQueue(async (_admin, _ai, documentId) => {
      if (documentId === failing) throw new Error('rate limited')
      if (documentId === busy) return { claimed: false, documentId }
      return { claimed: true, documentId }
    }, { dedupeClientProperties: async () => ({ merged: 0 }) })

    const summary = await jobSummary(job.id)
    expect(summary.processed).toBe(10)
    expect(summary.failed).toBe(2)
    expect(summary.failures).toEqual(
      expect.arrayContaining([
        { documentId: failing, fileName: 'doc-3.pdf', error: 'rate limited' },
        { documentId: busy, fileName: 'doc-8.pdf', error: 'ALREADY_PROCESSING' }
      ])
    )
  })

  it('an empty year is a job that is finished at once', async () => {
    const { client } = await seedDocuments(0)
    const job = await startExtractionJob(db, { kind: 'reprocess', documents: [], clientId: client.id, taxYear: 2025 })
    expect(sent).toHaveLength(0)
    expect((await jobSummary(job.id)).finished).toBe(true)
  })
})

describe('at-least-once delivery', () => {
  it('a duplicate message after the run is acknowledged and changes nothing', async () => {
    const { documents } = await seedDocuments(1)
    const job = await startExtractionJob(db, { kind: 'retry', documents })
    const message = sent[0]
    let runs = 0
    const run = async (_a, _b, documentId) => {
      runs++
      return { claimed: true, documentId }
    }
    expect((await handleExtractionMessage(db, message.body, { anthropic: {}, runExtraction: run })).outcome).toBe('done')
    expect(await handleExtractionMessage(db, message.body, { anthropic: {}, runExtraction: run })).toEqual({ action: 'ack', outcome: 'duplicate' })
    expect(runs).toBe(1)
    expect(await jobSummary(job.id)).toMatchObject({ finished: true, processed: 1 })
  })

  it('a message for an item being run right now comes back later instead of running twice', async () => {
    const { documents } = await seedDocuments(1)
    await startExtractionJob(db, { kind: 'retry', documents })
    const message = sent[0]
    let release
    const slow = () => new Promise((resolve) => (release = resolve))
    const first = handleExtractionMessage(db, message.body, { anthropic: {}, runExtraction: slow })
    await tick(50)
    const second = await handleExtractionMessage(db, message.body, { anthropic: {}, runExtraction: async () => ({ claimed: true }) })
    expect(second).toMatchObject({ action: 'retry', outcome: 'busy' })
    release({ claimed: true })
    expect((await first).outcome).toBe('done')
  })

  it('a run that died half-way (stale claim) is taken over, also from "extracting"', async () => {
    const { documents } = await seedDocuments(1, 'uploaded')
    const job = await startExtractionJob(db, { kind: 'upload', documents, fromStatuses: ['uploaded'] })
    // The first delivery claimed it, moved the document to 'extracting' and
    // its isolate was killed 20 minutes ago.
    await query("update extraction_job_items set state = 'running', updated_at = now() - interval '20 minutes' where job_id = $1", [job.id])
    await db.from('client_documents').update({ status: 'extracting' }).eq('id', documents[0].id)
    let seen
    const outcome = await handleExtractionMessage(db, sent[0].body, {
      anthropic: {},
      runExtraction: async (_a, _b, documentId, options) => {
        seen = options.fromStatuses
        return { claimed: true, documentId }
      }
    })
    expect(outcome.outcome).toBe('done')
    expect(seen).toEqual(['uploaded', 'extracting'])
  })

  it('the consumer acks what is done and retries what could not start', async () => {
    const acked = []
    const retried = []
    const message = (body) => ({ body, ack: () => acked.push(body), retry: () => retried.push(body) })
    await consumeExtractionBatch(
      { messages: [message({ jobId: null }), message({ jobId: '00000000-0000-0000-0000-000000000000', documentId: '00000000-0000-0000-0000-000000000000' })] },
      { serviceClient: () => db }
    )
    expect(acked).toHaveLength(2) // malformed, and an item that does not exist
    expect(retried).toHaveLength(0)
    await consumeExtractionBatch({ messages: [message({ jobId: 'x', documentId: 'y' })] }, {
      serviceClient: () => {
        throw new Error('database unreachable')
      }
    })
    expect(retried).toHaveLength(1)
  })
})

describe('the automatic extraction after an upload', () => {
  it('is queued for an "uploaded" document, from "uploaded" only', async () => {
    const { documents } = await seedDocuments(1, 'uploaded')
    const job = await queueUploadedDocument(db, documents[0])
    expect(job.kind).toBe('upload')
    expect(sent).toEqual([{ body: { jobId: job.id, documentId: documents[0].id } }])
    const { data: item } = await db.from('extraction_job_items').select('from_statuses').eq('job_id', job.id).single()
    expect(item.from_statuses).toEqual(['uploaded'])
  })

  it('never fails the upload when the queue is missing — the document just stays "uploaded"', async () => {
    setRuntime({ env: {} })
    const { documents } = await seedDocuments(1, 'uploaded')
    expect(await queueUploadedDocument(db, documents[0])).toBeNull()
  })
})

describe('wrangler.toml', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
  it('the consumer runs one message at a time, at most EXTRACTION_CONCURRENCY in parallel', () => {
    expect(toml).toMatch(new RegExp(`max_concurrency = ${EXTRACTION_CONCURRENCY}\\b`))
    expect(toml).toMatch(/max_batch_size = 1\b/)
  })
  it('the monthly cron of vercel.json is a Cron Trigger', () => {
    expect(toml).toMatch(/crons = \["0 6 1 \* \*"\]/)
  })
})

// "Ricarica tutto dai documenti" (api/reprocess-client-year.js) used to fire
// every extraction of a case at once, which made a large case hit the AI rate
// limit and fail documents for no reason of their own. Now at most
// EXTRACTION_CONCURRENCY run at the same time, and the answer says how many
// succeeded and, for each one that did not, which document and why.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mapWithConcurrency } from '../src/lib/concurrency.js'

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('mapWithConcurrency', () => {
  it('never has more than `limit` calls in flight, and still runs them all', async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick(5 + (n % 3) * 3)
      inFlight--
      return n * 2
    })
    expect(peak).toBe(3)
    expect(results.map((r) => r.value)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
  })

  it('keeps going after a failure and reports it in place', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c'], 2, async (x) => {
      if (x === 'b') throw new Error('boom')
      return x
    })
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(results[1].reason.message).toBe('boom')
  })
})

// ---------------------------------------------------------------------------
// The endpoint itself, with the extraction replaced by a timed fake.
// ---------------------------------------------------------------------------
const requireStaffMock = vi.fn()
const readBodyMock = vi.fn()
const runExtractionMock = vi.fn()

vi.mock('../api/_lib.js', () => ({
  httpError: (status, code, message) => Object.assign(new Error(message || code), { status, code }),
  readBody: (...args) => readBodyMock(...args),
  requireStaff: (...args) => requireStaffMock(...args)
}))
vi.mock('../api/_propertySuggestion.js', () => ({ dedupeClientProperties: async () => ({ merged: 0 }) }))
vi.mock('../api/extract-document.js', () => ({ runExtraction: (...args) => runExtractionMock(...args) }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }))

function adminWith(documents) {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve, reject) => Promise.resolve({ data: documents, error: null }).then(resolve, reject)
  }
  return { from: () => query }
}

function makeRes() {
  const res = {}
  res.status = (code) => Object.assign(res, { statusCode: code })
  res.json = (body) => Object.assign(res, { body })
  return res
}

let handler
let EXTRACTION_CONCURRENCY

beforeEach(async () => {
  vi.resetModules()
  runExtractionMock.mockReset()
  ;({ default: handler, EXTRACTION_CONCURRENCY } = await import('../api/reprocess-client-year.js'))
})

describe('api/reprocess-client-year', () => {
  const documents = Array.from({ length: 12 }, (_, i) => ({ id: `doc-${i}`, status: 'extracted', file_name: `doc-${i}.pdf` }))

  it('extracts every document, never more than 3 at the same time', async () => {
    let inFlight = 0
    let peak = 0
    runExtractionMock.mockImplementation(async (_admin, _anthropic, documentId) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick(5)
      inFlight--
      return { claimed: true, documentId }
    })
    requireStaffMock.mockResolvedValue({ admin: adminWith(documents) })
    readBodyMock.mockReturnValue({ clientId: 'client-1', taxYear: 2025 })

    const res = makeRes()
    await handler({ method: 'POST', headers: {} }, res)

    expect(EXTRACTION_CONCURRENCY).toBeGreaterThanOrEqual(2)
    expect(EXTRACTION_CONCURRENCY).toBeLessThanOrEqual(3)
    expect(peak).toBeLessThanOrEqual(EXTRACTION_CONCURRENCY)
    expect(peak).toBeGreaterThan(1) // still in parallel, just bounded
    expect(runExtractionMock).toHaveBeenCalledTimes(12)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ processed: 12, failed: 0, failures: [] })
  })

  it('reports how many succeeded and which failed, with the reason', async () => {
    runExtractionMock.mockImplementation(async (_admin, _anthropic, documentId) => {
      if (documentId === 'doc-3') throw new Error('rate limited')
      if (documentId === 'doc-8') return { claimed: false, documentId }
      return { claimed: true, documentId }
    })
    requireStaffMock.mockResolvedValue({ admin: adminWith(documents) })
    readBodyMock.mockReturnValue({ clientId: 'client-1', taxYear: 2025 })

    const res = makeRes()
    await handler({ method: 'POST', headers: {} }, res)

    expect(res.body.processed).toBe(10)
    expect(res.body.failed).toBe(2)
    expect(res.body.failures).toEqual([
      { documentId: 'doc-3', fileName: 'doc-3.pdf', error: 'rate limited' },
      { documentId: 'doc-8', fileName: 'doc-8.pdf', error: 'ALREADY_PROCESSING' }
    ])
  })
})

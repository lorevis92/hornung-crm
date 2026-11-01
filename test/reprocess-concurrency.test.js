// mapWithConcurrency (src/lib/concurrency.js), the bounded-parallelism helper
// "Estrai tutto" used while it ran inside its HTTP request. The extraction
// now runs from the queue, whose consumer concurrency bounds it instead —
// see test/extraction-queue.test.js for that, and for the per-document
// outcome report.
import { describe, expect, it } from 'vitest'
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

// Infrastructure regressions: date-of-birth and canton normalization (a
// Swiss "18.06.1987" or a canton name like "Vallese" must never reach the
// database in a form that fails the upsert or breaks a parameter lookup —
// see src/lib/personalDetails.js), and the primary-person upsert must be
// idempotent even under concurrent calls (see api/_personalDetails.js).
import { describe, expect, it } from 'vitest'
import { computePersonalDetailsSync } from '../src/lib/personalDetails.js'
import { syncPersonalDetails } from '../api/_personalDetails.js'

function autoFillValue(autoFill, field) {
  return autoFill.find((a) => a.field === field)?.value
}

describe('computePersonalDetailsSync — date and canton normalization', () => {
  it('normalizes a Swiss-format date (18.06.1987) to ISO for date_of_birth', () => {
    const { autoFill } = computePersonalDetailsSync({
      extractedFields: [{ field_key: 'date_of_birth', field_value: '18.06.1987', confidence: 0.9 }],
      canton: null,
      primary: null,
      spouse: null
    })
    expect(autoFillValue(autoFill, 'date_of_birth')).toBe('1987-06-18')
  })

  it('drops an impossible calendar date instead of writing it and breaking the upsert', () => {
    const { autoFill, suggestions } = computePersonalDetailsSync({
      extractedFields: [{ field_key: 'date_of_birth', field_value: '31.02.1987', confidence: 0.9 }],
      canton: null,
      primary: null,
      spouse: null
    })
    expect(autoFillValue(autoFill, 'date_of_birth')).toBeUndefined()
    expect(suggestions.some((s) => s.field === 'date_of_birth')).toBe(false)
  })

  it('normalizes a canton name ("Vallese") to its short code (VS)', () => {
    const { autoFill } = computePersonalDetailsSync({
      extractedFields: [{ field_key: 'canton', field_value: 'Vallese' }],
      canton: null,
      primary: null,
      spouse: null
    })
    expect(autoFillValue(autoFill, 'canton')).toBe('VS')
  })

  it('leaves an already-valid canton code unchanged', () => {
    const { autoFill } = computePersonalDetailsSync({
      extractedFields: [{ field_key: 'canton', field_value: 'GE' }],
      canton: null,
      primary: null,
      spouse: null
    })
    expect(autoFillValue(autoFill, 'canton')).toBe('GE')
  })
})

// A minimal in-memory stand-in for the handful of Supabase query-builder
// chains syncPersonalDetails actually uses (from().select().eq().maybeSingle(),
// a bare select().eq() awaited directly, update().eq(), upsert(), and
// delete().eq()...) — enough to run the real function against, with no
// live database.
function createFakeAdmin(initialTables = {}) {
  const tables = Object.fromEntries(Object.entries(initialTables).map(([k, v]) => [k, [...v]]))
  const table = (name) => tables[name] || (tables[name] = [])
  const matchesAll = (row, filters) => filters.every(([col, val]) => row[col] === val)

  function from(name) {
    const rows = table(name)
    return {
      select() {
        const filters = []
        const chain = {
          eq(col, val) {
            filters.push([col, val])
            return chain
          },
          maybeSingle() {
            return Promise.resolve({ data: rows.find((r) => matchesAll(r, filters)) || null, error: null })
          },
          then(resolve, reject) {
            return Promise.resolve({ data: rows.filter((r) => matchesAll(r, filters)), error: null }).then(resolve, reject)
          }
        }
        return chain
      },
      update(patch) {
        return {
          eq(col, val) {
            for (const row of rows) {
              if (row[col] === val) Object.assign(row, patch)
            }
            return Promise.resolve({ error: null })
          }
        }
      },
      upsert(payload, opts = {}) {
        const conflictCols = (opts.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean)
        const idx = conflictCols.length ? rows.findIndex((r) => conflictCols.every((c) => r[c] === payload[c])) : -1
        if (idx === -1) rows.push({ ...payload })
        else rows[idx] = { ...rows[idx], ...payload }
        return Promise.resolve({ data: null, error: null })
      },
      delete() {
        const filters = []
        const chain = {
          eq(col, val) {
            filters.push([col, val])
            return chain
          },
          then(resolve, reject) {
            for (let i = rows.length - 1; i >= 0; i--) {
              if (matchesAll(rows[i], filters)) rows.splice(i, 1)
            }
            return Promise.resolve({ error: null }).then(resolve, reject)
          }
        }
        return chain
      }
    }
  }

  return { from, tables }
}

describe('syncPersonalDetails — primary-person upsert idempotency', () => {
  it('converges to exactly one primary row when called concurrently, with no unique-constraint race', async () => {
    const documentId = 'doc-1'
    const clientId = 'client-1'
    const admin = createFakeAdmin({
      client_documents: [{ id: documentId, client_id: clientId, category_code: 'current_tax_sheet' }],
      extracted_document_fields: [
        { document_id: documentId, field_key: 'full_name', field_value: 'Giulia Weber', confidence: 0.95 },
        { document_id: documentId, field_key: 'date_of_birth', field_value: '18.06.1987', confidence: 0.95 },
        { document_id: documentId, field_key: 'canton', field_value: 'Vallese', confidence: 0.95 }
      ],
      clients: [{ id: clientId, canton: null }],
      client_persons: []
    })

    // Two "simultaneous" runs — the same scenario as reprocessing every
    // document of a client concurrently, each independently re-syncing the
    // registry (see the comment above the upsert call in
    // api/_personalDetails.js).
    await Promise.all([syncPersonalDetails(admin, documentId), syncPersonalDetails(admin, documentId)])

    const primaryRows = admin.tables.client_persons.filter((p) => p.client_id === clientId && p.person_type === 'primary')
    expect(primaryRows).toHaveLength(1)
    expect(primaryRows[0].first_name).toBe('Giulia')
    expect(primaryRows[0].last_name).toBe('Weber')
    expect(primaryRows[0].date_of_birth).toBe('1987-06-18')

    const clientRow = admin.tables.clients.find((c) => c.id === clientId)
    expect(clientRow.canton).toBe('VS')
  })
})

// Swapping who is "primary" and who is "spouse" (Questionnaire action;
// src/lib/personSwap.js, migration 51, demo mirror in src/lib/data/demo.js).
//
// What it must do: each person's own data follows the person, the couple's
// data (marital status, addresses) stays put, every document already
// extracted keeps pointing at the right person — without a new extraction —
// and the husband-first order on screen does not change.
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { COUPLE_FIELDS, PERSONAL_FIELDS, flipOrderOverride, swapPersonRows, swapRoleRef, swapSuggestionPerson } from '../src/lib/personSwap.js'
import { describeDocumentPerson } from '../src/lib/documentPerson.js'
import { resolvePersonDisplayOrder } from '../src/lib/personOrder.js'
import { householdOf } from '../src/lib/taxSummaryData.js'
import { currentTaxYear } from '../src/lib/config.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const sara = {
  id: 'row-primary',
  client_id: 'c1',
  person_type: 'primary',
  first_name: 'Sara',
  last_name: 'Bianchi',
  date_of_birth: '1987-06-18',
  gender: 'female',
  religious_denomination: 'roman catholic',
  email: 'sara@example.ch',
  mobile_phone: '+41 79 111 11 11',
  profession: 'Architect',
  employer: 'Studio A',
  employer_address: 'Lugano',
  work_address: 'Lugano',
  work_percentage: 80,
  public_transport_costs: 900,
  car_km_home_to_work: 0,
  other_work_costs: 'CAS',
  is_self_employed: false,
  qualifying_shareholdings: 0,
  asset_statement_count: 3,
  marital_status: 'married',
  current_address: 'Via Roma 1, 6900 Lugano',
  address_dec31: 'Via Roma 1, 6900 Lugano'
}
const luca = {
  id: 'row-spouse',
  client_id: 'c1',
  person_type: 'spouse',
  first_name: 'Luca',
  last_name: 'Bianchi',
  date_of_birth: '1985-02-01',
  gender: 'male',
  religious_denomination: null,
  email: 'luca@example.ch',
  mobile_phone: null,
  profession: 'Engineer',
  employer: 'Ferrovie',
  employer_address: 'Bellinzona',
  work_address: 'Bellinzona',
  work_percentage: 100,
  public_transport_costs: 1200,
  car_km_home_to_work: 12,
  other_work_costs: '',
  is_self_employed: true,
  qualifying_shareholdings: 1,
  asset_statement_count: 5,
  marital_status: null,
  current_address: null,
  address_dec31: null
}

describe('swapPersonRows', () => {
  const { primary, spouse } = swapPersonRows(sara, luca)

  it("moves each person's own data with the person", () => {
    for (const field of PERSONAL_FIELDS) {
      expect(primary[field], field).toEqual(luca[field])
      expect(spouse[field], field).toEqual(sara[field])
    }
    expect(primary.first_name).toBe('Luca')
    expect(spouse.first_name).toBe('Sara')
  })

  it('leaves marital status and the addresses where they are', () => {
    for (const field of COUPLE_FIELDS) {
      expect(primary[field], field).toEqual(sara[field])
      expect(spouse[field], field).toEqual(luca[field])
    }
    expect(primary.marital_status).toBe('married')
    expect(primary.current_address).toBe('Via Roma 1, 6900 Lugano')
  })

  it('keeps each row its own id and role: only the data moves', () => {
    expect([primary.id, primary.person_type]).toEqual(['row-primary', 'primary'])
    expect([spouse.id, spouse.person_type]).toEqual(['row-spouse', 'spouse'])
  })

  it('swaps back to the start when done twice', () => {
    const twice = swapPersonRows(primary, spouse)
    expect(twice.primary).toEqual(sara)
    expect(twice.spouse).toEqual(luca)
  })
})

describe('everything that names a row follows the person', () => {
  it('a document attributed to a role', () => {
    expect(swapRoleRef('taxpayer')).toBe('spouse')
    expect(swapRoleRef('spouse')).toBe('taxpayer')
    for (const ref of ['both_spouses', 'household', 'unknown', 'child:c-1', null]) expect(swapRoleRef(ref)).toBe(ref)
  })

  it("a pending suggestion for one person's own field, but not for a couple field", () => {
    const s = (target_person, target_field, target_table = 'client_persons') => ({ target_person, target_field, target_table })
    expect(swapSuggestionPerson(s('primary', 'date_of_birth'))).toBe('spouse')
    expect(swapSuggestionPerson(s('spouse', 'gender'))).toBe('primary')
    expect(swapSuggestionPerson(s('primary', 'marital_status'))).toBe('primary')
    expect(swapSuggestionPerson(s('primary', 'current_address'))).toBe('primary')
    expect(swapSuggestionPerson(s('none', 'canton', 'clients'))).toBe('none')
  })

  it('the display-order override, so the same people stay in the same order', () => {
    expect(flipOrderOverride('primary_first')).toBe('spouse_first')
    expect(flipOrderOverride('spouse_first')).toBe('primary_first')
    expect(flipOrderOverride(null)).toBeNull()
  })
})

describe('the field lists cover the whole table, and match the SQL function', () => {
  const schema = read('supabase/migrations/20260101000002_hornung_schema.sql')
  const table = schema.slice(schema.indexOf('create table if not exists public.client_persons'))
  const body = table.slice(0, table.indexOf(');'))
  const columns = [...body.matchAll(/^\s{2}([a-z_0-9]+)\s+(?:uuid|text|date|integer|numeric|boolean|timestamptz)/gm)].map((m) => m[1])
  // Columns added by later migrations.
  for (const m of read('supabase/migrations/20260101000039_person_gender_and_order.sql').matchAll(
    /alter table public\.client_persons\s+add column if not exists ([a-z_]+)/g
  )) {
    columns.push(m[1])
  }
  const technical = ['id', 'client_id', 'person_type', 'created_at', 'updated_at']

  it('every column of client_persons is either personal or of the couple — none forgotten', () => {
    const classified = new Set([...PERSONAL_FIELDS, ...COUPLE_FIELDS, ...technical])
    expect(columns.filter((c) => !classified.has(c))).toEqual([])
    expect([...PERSONAL_FIELDS, ...COUPLE_FIELDS].filter((c) => !columns.includes(c))).toEqual([])
  })

  it('the SQL function swaps exactly the personal fields and keeps the couple fields out', () => {
    const sql = read('supabase/migrations/20260101000051_swap_primary_and_spouse.sql')
    const swapped = [...sql.matchAll(/^\s+(?:set\s+)?([a-z_]+)\s+= o\.\1,?$/gm)].map((m) => m[1])
    expect(swapped.sort()).toEqual([...PERSONAL_FIELDS].sort())
    expect(sql).toContain("target_field not in ('marital_status', 'current_address', 'address_dec31')")
    expect(sql).toContain("when 'taxpayer' then 'spouse' else 'taxpayer'")
  })
})

describe('in the demo data layer: a document already extracted stays with the right person', () => {
  let demoApi
  beforeAll(async () => {
    const memory = new Map()
    globalThis.localStorage = {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k)
    }
    ;({ demoApi } = await import('../src/lib/data/demo.js'))
  })

  it('swaps the persons and keeps the salary statement on Marco, without re-extracting it', async () => {
    const clientId = 'client-1'
    const year = currentTaxYear() // the demo case with the extracted salary statement
    const salary = (await demoApi.listClientDocuments(clientId, year)).find((d) => d.person_ref === 'taxpayer')
    const before = await demoApi.getQuestionnaire(clientId)
    expect(describeDocumentPerson(salary, householdOf(before)).name).toBe('Marco Bianchi')
    await demoApi.updateClient(clientId, { person_order_override: 'primary_first' })
    const orderBefore = resolvePersonDisplayOrder({
      primaryPerson: householdOf(before).primary,
      spousePerson: householdOf(before).spouse,
      overrideOrder: 'primary_first'
    }).ordered.map((o) => o.person.first_name)

    const after = await demoApi.swapPrimaryAndSpouse(clientId)
    const household = householdOf(after)

    // The persons moved...
    expect(household.primary.first_name).toBe('Elena')
    expect(household.spouse.first_name).toBe('Marco')
    // ...the couple's data did not.
    expect(household.primary.marital_status).toBe(householdOf(before).primary.marital_status)
    expect(household.primary.current_address).toBe(householdOf(before).primary.current_address)

    // The same document, as it is now stored, still names Marco.
    const salaryAfter = (await demoApi.listClientDocuments(clientId, year)).find((d) => d.id === salary.id)
    expect(salaryAfter.person_ref).toBe('spouse')
    expect(describeDocumentPerson(salaryAfter, household)).toEqual({ kind: 'spouse', name: 'Marco Bianchi' })
    // Its extracted values were not touched.
    expect(await demoApi.listExtractedFieldsForDocument(salary.id)).toHaveLength(3)

    // And the order on screen is the same two people in the same order.
    const client = await demoApi.getClient(clientId)
    expect(client.person_order_override).toBe('spouse_first')
    const orderAfter = resolvePersonDisplayOrder({
      primaryPerson: household.primary,
      spousePerson: household.spouse,
      overrideOrder: client.person_order_override
    }).ordered.map((o) => o.person.first_name)
    expect(orderAfter).toEqual(orderBefore)
  })
})

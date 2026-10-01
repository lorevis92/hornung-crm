// ---------------------------------------------------------------------------
// DEMO data layer — runs entirely in the browser (localStorage), so the whole
// interface can be reviewed before Supabase is connected.
// The method signatures are identical to those of the Supabase layer.
// ---------------------------------------------------------------------------
import { currentTaxYear } from '../config'
import {
  CATEGORY_FIELD_DEFINITIONS, DOCUMENT_CATEGORIES, DOCUMENT_TYPES,
  PRICING_ITEMS, TAX_PARAMETERS
} from '../demoSeed'
import {
  computePersonalDetailsSync, buildPropertySuggestionPayload, buildChildSuggestionCandidates,
  normalizePropertyAddress
} from '../personalDetails'
import { validateClientCaseCreation } from '../caseCreation'

const KEY = 'hornung.demo.v2'
const blobs = new Map() // document id -> object URL (this session only)

const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 10)}`
const iso = (d) => new Date(d).toISOString()
const daysAgo = (n) => iso(Date.now() - n * 864e5)

function seed() {
  const year = currentTaxYear()
  const prev = year - 1
  const prev2 = year - 2

  const specialist = {
    id: 'profile-specialist',
    app_id: 'hornung_crm',
    role: 'specialist',
    full_name: 'Hornung Consulting',
    email: 'hornungconsulting@gmail.com',
    locale: 'en'
  }
  const clientProfile = {
    id: 'profile-client-1',
    app_id: 'hornung_crm',
    role: 'client',
    full_name: 'Marco Bianchi',
    email: 'marco.bianchi@example.ch',
    locale: 'it'
  }

  const c1 = {
    id: 'client-1',
    app_id: 'hornung_crm',
    profile_id: clientProfile.id,
    email: 'marco.bianchi@example.ch',
    first_name: 'Marco',
    last_name: 'Bianchi',
    phone: '+41 79 123 45 67',
    preferred_language: 'it',
    canton: 'ZG',
    status: 'active',
    internal_notes: 'Client since 2022. Always sends documents late — remind in March.',
    invited_at: daysAgo(420),
    activated_at: daysAgo(418),
    created_at: daysAgo(420),
    updated_at: daysAgo(12)
  }
  const c2 = {
    id: 'client-2',
    app_id: 'hornung_crm',
    profile_id: 'profile-client-2',
    email: 'sophie.mueller@example.ch',
    first_name: 'Sophie',
    last_name: 'Müller',
    phone: '+41 78 987 65 43',
    preferred_language: 'de',
    canton: 'ZH',
    status: 'active',
    internal_notes: '',
    invited_at: daysAgo(40),
    activated_at: daysAgo(39),
    created_at: daysAgo(40),
    updated_at: daysAgo(3)
  }
  const c3 = {
    id: 'client-3',
    app_id: 'hornung_crm',
    profile_id: null,
    email: 'jean.rossier@example.ch',
    first_name: 'Jean',
    last_name: 'Rossier',
    phone: '',
    preferred_language: 'fr',
    canton: 'VS',
    status: 'invited',
    internal_notes: 'Referred by M. Bianchi.',
    invited_at: daysAgo(2),
    activated_at: null,
    created_at: daysAgo(2),
    updated_at: daysAgo(2)
  }

  const details = {
    'client-1': {
      client_id: 'client-1',
      in_ch_since: '2016',
      age_on_arrival: '27',
      permit_type: 'C',
      nationality: 'Italian',
      has_crypto_or_shares: true,
      due_date: `${year + 1}-03-31`,
      comments: 'Moved apartment in August — new address from 01.09.',
      updated_at: daysAgo(12)
    },
    'client-2': {
      client_id: 'client-2',
      in_ch_since: '2009',
      age_on_arrival: '19',
      permit_type: 'CH',
      nationality: 'Swiss',
      has_crypto_or_shares: false,
      due_date: `${year + 1}-03-31`,
      comments: '',
      updated_at: daysAgo(3)
    }
  }

  const persons = [
    {
      id: uid('person'), client_id: 'client-1', person_type: 'primary',
      first_name: 'Marco', last_name: 'Bianchi', mobile_phone: '+41 79 123 45 67',
      email: 'marco.bianchi@example.ch', marital_status: 'married', date_of_birth: '1989-04-12',
      religious_denomination: 'none', current_address: 'Bahnhofstrasse 12, 6300 Zug',
      address_dec31: 'Bahnhofstrasse 12, 6300 Zug', profession: 'Process engineer',
      employer: 'Novalis Pharma AG', employer_address: 'Baar (ZG)', work_percentage: 100,
      public_transport_costs: 780, car_km_home_to_work: 0, work_address: 'Baar (ZG)',
      other_work_costs: 'CAS in Quality Management (CHF 4’800)',
      is_self_employed: false, qualifying_shareholdings: 0, asset_statement_count: 12
    },
    {
      id: uid('person'), client_id: 'client-1', person_type: 'spouse',
      first_name: 'Elena', last_name: 'Bianchi', mobile_phone: '+41 79 222 33 44',
      email: 'elena.bianchi@example.ch', marital_status: 'married', date_of_birth: '1991-09-03',
      religious_denomination: 'roman catholic', current_address: 'Bahnhofstrasse 12, 6300 Zug',
      address_dec31: 'Bahnhofstrasse 12, 6300 Zug', profession: 'Graphic designer',
      employer: 'Self-employed', employer_address: 'Zug', work_percentage: 60,
      public_transport_costs: 0, car_km_home_to_work: 8, work_address: 'Zug',
      other_work_costs: '', is_self_employed: true, qualifying_shareholdings: 1,
      asset_statement_count: 3
    },
    {
      id: uid('person'), client_id: 'client-2', person_type: 'primary',
      first_name: 'Sophie', last_name: 'Müller', mobile_phone: '+41 78 987 65 43',
      email: 'sophie.mueller@example.ch', marital_status: 'single', date_of_birth: '1990-01-22',
      religious_denomination: 'protestant', current_address: 'Seefeldstrasse 4, 8008 Zürich',
      address_dec31: 'Seefeldstrasse 4, 8008 Zürich', profession: 'Product manager',
      employer: 'Helvetia Digital AG', employer_address: 'Zürich', work_percentage: 100,
      public_transport_costs: 2300, car_km_home_to_work: 0, work_address: 'Zürich',
      other_work_costs: '', is_self_employed: false, qualifying_shareholdings: 0,
      asset_statement_count: 4
    }
  ]

  const children = [
    { id: uid('child'), client_id: 'client-1', full_name: 'Bianchi Luca', date_of_birth: '2018-06-15', school_education: 'Primarschule Zug', religious: 'roman catholic', until_when: '2030', custody: '—', sort_order: 0 }
  ]

  const vehicles = [
    { id: uid('veh'), client_id: 'client-1', brand: 'Škoda', model: 'Octavia', year_of_issue: 2020, purchase_price: 28500, purchase_year: 2021, leasing: false, license_plate: 'ZG 123456', sort_order: 0 }
  ]

  const properties = [
    { id: uid('prop'), client_id: 'client-1', address: 'Via Roma 8, Como (IT)', country: 'IT', purchase_year: 2019, year_of_building: 1978, purchase_price: 240000, rental_income: 9600, number_of_rooms: 3.5, sort_order: 0 }
  ]

  const cases = [
    { id: 'case-1', client_id: 'client-1', tax_year: year, status: 'in_process', status_updated_at: daysAgo(5), client_message: '', specialist_notes: 'Waiting for the Italian property valuation. Check double-taxation treaty.', due_date: `${year + 1}-03-31`, delivery_by_post: false, express: false, created_at: daysAgo(30), updated_at: daysAgo(5) },
    { id: 'case-2', client_id: 'client-1', tax_year: prev, status: 'finished', status_updated_at: daysAgo(300), client_message: '', specialist_notes: '', due_date: `${year}-03-31`, delivery_by_post: true, express: false, finished_at: daysAgo(300), created_at: daysAgo(400), updated_at: daysAgo(300) },
    { id: 'case-3', client_id: 'client-1', tax_year: prev2, status: 'finished', status_updated_at: daysAgo(660), client_message: '', specialist_notes: '', due_date: `${prev}-03-31`, delivery_by_post: false, express: false, finished_at: daysAgo(660), created_at: daysAgo(760), updated_at: daysAgo(660) },
    { id: 'case-4', client_id: 'client-2', tax_year: year, status: 'waiting_client', status_updated_at: daysAgo(3), client_message: 'We still need your pillar 3a certificate and the year-end statement of your Revolut account.', specialist_notes: '', due_date: `${year + 1}-03-31`, delivery_by_post: false, express: true, created_at: daysAgo(25), updated_at: daysAgo(3) },
    { id: 'case-5', client_id: 'client-3', tax_year: year, status: 'opened', status_updated_at: daysAgo(2), client_message: '', specialist_notes: '', due_date: `${year + 1}-03-31`, delivery_by_post: false, express: false, created_at: daysAgo(2), updated_at: daysAgo(2) }
  ]

  const salaryDoc = { id: uid('doc'), case_id: 'case-1', document_type_id: 'salary_statement', direction: 'client_upload', storage_path: 'demo/salary.pdf', file_name: 'Lohnausweis_2025.pdf', file_size: 184320, mime_type: 'application/pdf', uploaded_by: clientProfile.id, created_at: daysAgo(20), category_code: 'salary_statement' }

  const documents = [
    salaryDoc,
    { id: uid('doc'), case_id: 'case-1', document_type_id: 'pillar_3a', direction: 'client_upload', storage_path: 'demo/3a.pdf', file_name: 'Pilastro_3a_UBS.pdf', file_size: 96000, mime_type: 'application/pdf', uploaded_by: clientProfile.id, created_at: daysAgo(19) },
    { id: uid('doc'), case_id: 'case-1', document_type_id: 'bank_statements', direction: 'client_upload', storage_path: 'demo/bank.pdf', file_name: 'Estratti_conti_31122025.pdf', file_size: 512000, mime_type: 'application/pdf', uploaded_by: clientProfile.id, created_at: daysAgo(14) },
    { id: uid('doc'), case_id: 'case-2', document_type_id: null, direction: 'specialist_upload', storage_path: 'demo/decl.pdf', file_name: `Dichiarazione_${prev}_Bianchi.pdf`, file_size: 742000, mime_type: 'application/pdf', uploaded_by: specialist.id, created_at: daysAgo(300), note: 'Final declaration, submitted to the tax office.' },
    { id: uid('doc'), case_id: 'case-2', document_type_id: null, direction: 'specialist_upload', storage_path: 'demo/receipt.pdf', file_name: `Ricevuta_invio_${prev}.pdf`, file_size: 68000, mime_type: 'application/pdf', uploaded_by: specialist.id, created_at: daysAgo(300) },
    { id: uid('doc'), case_id: 'case-3', document_type_id: null, direction: 'specialist_upload', storage_path: 'demo/decl2.pdf', file_name: `Dichiarazione_${prev2}_Bianchi.pdf`, file_size: 690000, mime_type: 'application/pdf', uploaded_by: specialist.id, created_at: daysAgo(660) }
  ]

  // Sample AI-extracted values for salaryDoc, so the verification panel has
  // something to show in demo mode (the salary_statement field dictionary
  // has 9 fields — only some come pre-filled, mirroring a real partial
  // extraction; the rest stay empty for the specialist to fill in by hand).
  const extractedDocumentFields = [
    { id: uid('exf'), document_id: salaryDoc.id, field_key: 'employer_name', field_value: 'Acme Logistics SA', confidence: 0.95, source_quote: 'Arbeitgeber: Acme Logistics SA', source_page: 1, verified_by_specialist: false, verified_at: null, verified_by: null },
    { id: uid('exf'), document_id: salaryDoc.id, field_key: 'gross_salary', field_value: "112'400", confidence: 0.98, source_quote: "Bruttolohn total 112'400", source_page: 1, verified_by_specialist: false, verified_at: null, verified_by: null },
    { id: uid('exf'), document_id: salaryDoc.id, field_key: 'withholding_tax', field_value: "1'204", confidence: 0.87, source_quote: 'Quellensteuer 1’204.00', source_page: 1, verified_by_specialist: false, verified_at: null, verified_by: null }
  ]

  // One sample "other information found" row (document_other_findings,
  // migration 46): a real value the salary_statement whitelist has no field
  // for, so demo mode shows the section the same way production does.
  const documentOtherFindings = [
    {
      id: uid('dof'),
      document_id: salaryDoc.id,
      label: 'Jubiläumsgeschenk (25 Jahre)',
      finding_value: "2'500",
      source_quote: "Jubilaumsgeschenk 25 Jahre: CHF 2'500.00",
      source_page: 1,
      origin: 'coverage_check',
      confidence: 0.9,
      needs_review: false,
      review_note: null,
      created_at: daysAgo(5)
    }
  ]

  const requested = [
    ...['salary_statement', 'pillar_3a', 'bank_statements', 'health_insurance', 'property_tax_value'].map((t) => ({ id: uid('req'), case_id: 'case-1', document_type_id: t, required: true })),
    ...['salary_statement', 'pillar_3a', 'bank_statements'].map((t) => ({ id: uid('req'), case_id: 'case-4', document_type_id: t, required: true }))
  ]

  const events = [
    { id: uid('ev'), case_id: 'case-1', event_type: 'status_change', from_status: 'opened', to_status: 'waiting_client', created_at: daysAgo(22), actor_id: specialist.id },
    { id: uid('ev'), case_id: 'case-1', event_type: 'status_change', from_status: 'waiting_client', to_status: 'in_process', created_at: daysAgo(5), actor_id: specialist.id }
  ]

  const extracted = [
    { id: uid('ex'), case_id: 'case-1', group_key: 'income', field_key: 'gross_salary', field_label: 'Gross salary', field_value: "112'400", value_numeric: 112400, currency: 'CHF', confidence: 0.98, source_page: 1, source_snippet: 'Bruttolohn total 112’400', document_name: 'Lohnausweis_2025.pdf', status: 'pending' },
    { id: uid('ex'), case_id: 'case-1', group_key: 'deductions', field_key: 'pillar_3a', field_label: 'Pillar 3a contributions', field_value: "7'056", value_numeric: 7056, currency: 'CHF', confidence: 0.99, source_page: 1, source_snippet: 'Einzahlungen 2025: CHF 7’056.00', document_name: 'Pilastro_3a_UBS.pdf', status: 'pending' },
    { id: uid('ex'), case_id: 'case-1', group_key: 'assets', field_key: 'bank_balance_total', field_label: 'Total bank balances 31.12', field_value: "48'920", value_numeric: 48920, currency: 'CHF', confidence: 0.94, source_page: 3, source_snippet: 'Saldo totale al 31.12: CHF 48’920.15', document_name: 'Estratti_conti_31122025.pdf', status: 'pending' },
    { id: uid('ex'), case_id: 'case-1', group_key: 'income', field_key: 'withholding_tax', field_label: 'Withholding tax deducted', field_value: "1'204", value_numeric: 1204, currency: 'CHF', confidence: 0.87, source_page: 2, source_snippet: 'Verrechnungssteuer 1’204.00', document_name: 'Estratti_conti_31122025.pdf', status: 'pending' }
  ]

  return {
    profiles: [specialist, clientProfile, { id: 'profile-client-2', app_id: 'hornung_crm', role: 'client', full_name: 'Sophie Müller', email: c2.email, locale: 'de' }],
    clients: [c1, c2, c3],
    details,
    persons,
    children,
    vehicles,
    properties,
    cases,
    documents,
    requested,
    events,
    extracted,
    fieldDefinitions: JSON.parse(JSON.stringify(CATEGORY_FIELD_DEFINITIONS)),
    extractedDocumentFields,
    documentOtherFindings,
    taxParameters: JSON.parse(JSON.stringify(TAX_PARAMETERS)),
    fieldSuggestions: [],
    pricingItems: JSON.parse(JSON.stringify(PRICING_ITEMS)),
    caseAssistantMessages: [],
    aiModelSettings: []
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // Sessions started before the "Tax settings" field-definitions screen
      // won't have this key in their saved state yet.
      parsed.fieldDefinitions ||= JSON.parse(JSON.stringify(CATEGORY_FIELD_DEFINITIONS))
      // Same for sessions started before the document-verification panel —
      // no sample values to backfill here, an empty list just means the
      // specialist starts from a blank sheet for already-existing documents.
      parsed.extractedDocumentFields ||= []
      // Same for sessions started before "other information found" existed
      // (migration 46) — an empty list simply means nothing beyond the
      // whitelist was recorded for those documents.
      parsed.documentOtherFindings ||= []
      // Same for sessions started before "Tax parameters" existed.
      parsed.taxParameters ||= JSON.parse(JSON.stringify(TAX_PARAMETERS))
      // Same for sessions started before the personal-details auto-fill
      // feature existed.
      parsed.fieldSuggestions ||= []
      // Same for sessions started before the price list became editable.
      parsed.pricingItems ||= JSON.parse(JSON.stringify(PRICING_ITEMS))
      // Same for sessions started before the case assistant existed.
      parsed.caseAssistantMessages ||= []
      // Same for sessions started before the AI model choice was editable.
      parsed.aiModelSettings ||= []
      return parsed
    }
  } catch {
    /* ignore */
  }
  const fresh = seed()
  save(fresh)
  return fresh
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore — private browsing */
  }
}

let db = null
const store = () => (db ||= load())
const commit = () => save(db)
const clone = (value) => JSON.parse(JSON.stringify(value))
const wait = (value) => new Promise((resolve) => setTimeout(() => resolve(clone(value)), 120))

function withCounts(c) {
  const s = store()
  const cases = s.cases.filter((x) => x.client_id === c.id)
  return {
    ...c,
    cases_count: cases.length,
    latest_case: cases.sort((a, b) => b.tax_year - a.tax_year)[0] || null
  }
}

export function resetDemo() {
  db = seed()
  commit()
}

export const demoApi = {
  isDemo: true,

  async listDocumentTypes() {
    return wait([...DOCUMENT_TYPES].sort((a, b) => a.sort_order - b.sort_order))
  },

  async listPricing() {
    const s = store()
    return wait(
      [...s.pricingItems].filter((p) => p.active).sort((a, b) => a.sort_order - b.sort_order)
    )
  },

  async listPricingItemsForStaff() {
    const s = store()
    return wait([...s.pricingItems].sort((a, b) => a.sort_order - b.sort_order))
  },

  async createPricingItem(payload) {
    const s = store()
    const row = { id: uid('price'), app_id: 'hornung_crm', active: true, ...payload }
    s.pricingItems.push(row)
    commit()
    return wait(row)
  },

  async updatePricingItem(id, patch) {
    const s = store()
    const row = s.pricingItems.find((p) => p.id === id)
    if (!row) throw new Error('Pricing item not found.')
    Object.assign(row, patch)
    commit()
    return wait(row)
  },

  async deletePricingItem(id) {
    const s = store()
    const row = s.pricingItems.find((p) => p.id === id)
    if (!row) throw new Error('Pricing item not found.')
    row.active = false
    commit()
    return wait(row)
  },

  async getMyClient(profileId) {
    const s = store()
    return wait(s.clients.find((c) => c.profile_id === profileId) || null)
  },

  async listClients({ q = '', year = null, status = null, includeArchived = false } = {}) {
    const s = store()
    let rows = s.clients.map(withCounts)
    if (!includeArchived) {
      rows = rows.filter((c) => c.status !== 'archived')
    }
    if (q) {
      const needle = q.toLowerCase()
      rows = rows.filter((c) =>
        [c.first_name, c.last_name, c.email].filter(Boolean).join(' ').toLowerCase().includes(needle)
      )
    }
    if (year) {
      rows = rows.filter((c) => s.cases.some((k) => k.client_id === c.id && k.tax_year === Number(year)))
    }
    if (status) {
      rows = rows.filter((c) =>
        s.cases.some(
          (k) => k.client_id === c.id && k.status === status && (!year || k.tax_year === Number(year))
        )
      )
    }
    rows.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))
    return wait(rows)
  },

  async getClient(id) {
    const s = store()
    const c = s.clients.find((x) => x.id === id)
    return wait(c ? withCounts(c) : null)
  },

  async createClient(payload) {
    const s = store()
    const exists = s.clients.some((c) => c.email.toLowerCase() === payload.email.toLowerCase())
    if (exists) throw new Error('CLIENT_EXISTS')
    const client = {
      id: uid('client'),
      app_id: 'hornung_crm',
      profile_id: null,
      status: 'invited',
      internal_notes: '',
      invited_at: iso(Date.now()),
      activated_at: null,
      created_at: iso(Date.now()),
      updated_at: iso(Date.now()),
      preferred_language: 'en',
      ...payload
    }
    s.clients.push(client)
    commit()
    return wait({ client, emailSent: false, demo: true })
  },

  async updateClient(id, patch) {
    const s = store()
    const c = s.clients.find((x) => x.id === id)
    if (!c) throw new Error('NOT_FOUND')
    Object.assign(c, patch, { updated_at: iso(Date.now()) })
    commit()
    return wait(c)
  },

  // Mirrors the real cascade (clients -> questionnaire tables / tax_cases ->
  // case_documents / case_events / case_requested_documents / extracted_fields)
  // so demo mode behaves the same way. Never touches `profiles` — that's the
  // demo stand-in for auth.users/app_profiles, which a real client deletion
  // must not affect either.
  async deleteClient(id) {
    const s = store()
    const caseIds = s.cases.filter((c) => c.client_id === id).map((c) => c.id)

    s.documents
      .filter((d) => caseIds.includes(d.case_id))
      .forEach((d) => blobs.delete(d.id))

    delete s.details[id]
    s.persons = s.persons.filter((p) => p.client_id !== id)
    s.children = s.children.filter((p) => p.client_id !== id)
    s.vehicles = s.vehicles.filter((p) => p.client_id !== id)
    s.properties = s.properties.filter((p) => p.client_id !== id)
    s.documents = s.documents.filter((d) => !caseIds.includes(d.case_id))
    s.requested = s.requested.filter((r) => !caseIds.includes(r.case_id))
    s.events = s.events.filter((e) => !caseIds.includes(e.case_id))
    s.extracted = s.extracted.filter((e) => !caseIds.includes(e.case_id))
    s.cases = s.cases.filter((c) => c.client_id !== id)
    s.clients = s.clients.filter((c) => c.id !== id)

    commit()
    return wait(true)
  },

  // Demo mode has no backend to send a real invite — the UI shows a notice
  // instead of calling this, but it's kept so callers behave consistently.
  async inviteStaff(payload) {
    return wait({ profile: { role: 'specialist', ...payload }, emailSent: false, demo: true })
  },

  async getQuestionnaire(clientId) {
    const s = store()
    return wait({
      details: s.details[clientId] || { client_id: clientId },
      persons: s.persons.filter((p) => p.client_id === clientId),
      children: s.children.filter((p) => p.client_id === clientId),
      vehicles: s.vehicles.filter((p) => p.client_id === clientId),
      properties: s.properties.filter((p) => p.client_id === clientId)
    })
  },

  async saveQuestionnaire(clientId, payload) {
    const s = store()
    s.details[clientId] = { ...payload.details, client_id: clientId, updated_at: iso(Date.now()) }
    const replace = (key, rows) => {
      s[key] = s[key].filter((r) => r.client_id !== clientId)
      rows.forEach((r) => s[key].push({ ...r, id: r.id || uid(key), client_id: clientId }))
    }
    replace('persons', payload.persons || [])
    replace('children', payload.children || [])
    replace('vehicles', payload.vehicles || [])
    replace('properties', payload.properties || [])

    // Mirrors the supabase layer: the questionnaire's "primary" person is the
    // only place a self-registered client can put their name, so reflect it
    // onto the client record too (see saveQuestionnaire in supabaseData.js).
    const primary = (payload.persons || []).find((p) => p.person_type === 'primary')
    const primaryFirstName = primary?.first_name?.trim()
    const primaryLastName = primary?.last_name?.trim()
    if (primaryFirstName || primaryLastName) {
      const c = s.clients.find((x) => x.id === clientId)
      if (c) {
        if (primaryFirstName) c.first_name = primaryFirstName
        if (primaryLastName) c.last_name = primaryLastName
        c.updated_at = iso(Date.now())
      }
    }

    commit()
    return this.getQuestionnaire(clientId)
  },

  async listCases(clientId) {
    const s = store()
    const rows = s.cases
      .filter((c) => c.client_id === clientId)
      .map((c) => ({
        ...c,
        client_documents: s.documents.filter((d) => d.case_id === c.id && d.direction === 'client_upload').length,
        specialist_documents: s.documents.filter((d) => d.case_id === c.id && d.direction === 'specialist_upload').length
      }))
      .sort((a, b) => b.tax_year - a.tax_year)
    return wait(rows)
  },

  async getCase(caseId) {
    const s = store()
    const c = s.cases.find((x) => x.id === caseId)
    if (!c) return wait(null)
    const client = s.clients.find((x) => x.id === c.client_id)
    return wait({ ...c, client })
  },

  async createCase(clientId, taxYear) {
    const s = store()
    if (s.cases.some((c) => c.client_id === clientId && c.tax_year === Number(taxYear))) {
      throw new Error('YEAR_EXISTS')
    }
    const row = {
      id: uid('case'),
      client_id: clientId,
      tax_year: Number(taxYear),
      status: 'opened',
      status_updated_at: iso(Date.now()),
      client_message: '',
      specialist_notes: '',
      due_date: null,
      delivery_by_post: false,
      express: false,
      created_at: iso(Date.now()),
      updated_at: iso(Date.now())
    }
    s.cases.push(row)
    commit()
    return wait(row)
  },

  // Demo mirror of createOwnCase (see supabaseData.js) — demo mode has no
  // real RLS, so validateClientCaseCreation (src/lib/caseCreation.js)
  // enforces the exact same rule here that the "cases: client insert own"
  // policy enforces for real: no future year, no duplicate. requestedClientId
  // and sessionClientId are always the same value here (demo has no
  // separate notion of "the caller's own client_id" to compare against —
  // the frontend already only ever passes the signed-in client's own id).
  async createOwnCase(clientId, taxYear) {
    const s = store()
    const existingYears = s.cases.filter((c) => c.client_id === clientId).map((c) => c.tax_year)
    const validation = validateClientCaseCreation({
      requestedClientId: clientId,
      sessionClientId: clientId,
      taxYear,
      existingYears
    })
    if (!validation.ok) throw new Error(validation.reason)
    const row = {
      id: uid('case'),
      client_id: clientId,
      tax_year: Number(taxYear),
      status: 'opened',
      status_updated_at: iso(Date.now()),
      client_message: '',
      specialist_notes: '',
      due_date: null,
      delivery_by_post: false,
      express: false,
      created_by_client: true,
      created_at: iso(Date.now()),
      updated_at: iso(Date.now())
    }
    s.cases.push(row)
    commit()
    return wait(row)
  },

  async updateCase(caseId, patch) {
    const s = store()
    const c = s.cases.find((x) => x.id === caseId)
    if (!c) throw new Error('NOT_FOUND')
    Object.assign(c, patch, { updated_at: iso(Date.now()) })
    commit()
    return wait(c)
  },

  async setCaseStatus(caseId, { status, client_message = null, notify = false, actorId = null }) {
    const s = store()
    const c = s.cases.find((x) => x.id === caseId)
    if (!c) throw new Error('NOT_FOUND')
    const from = c.status
    c.status = status
    c.status_updated_at = iso(Date.now())
    c.updated_at = iso(Date.now())
    if (client_message !== null) c.client_message = client_message
    if (status === 'finished') c.finished_at = iso(Date.now())
    s.events.unshift({
      id: uid('ev'),
      case_id: caseId,
      event_type: 'status_change',
      from_status: from,
      to_status: status,
      actor_id: actorId,
      created_at: iso(Date.now())
    })
    commit()
    return wait({ case: c, emailSent: notify, demo: true })
  },

  async listDocuments(caseId) {
    const s = store()
    return wait(
      s.documents
        .filter((d) => d.case_id === caseId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    )
  },

  async uploadDocument(caseId, file, meta = {}) {
    const s = store()
    const doc = {
      id: uid('doc'),
      case_id: caseId,
      document_type_id: meta.document_type_id || null,
      direction: meta.direction || 'client_upload',
      storage_path: `demo/${file.name}`,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      note: meta.note || null,
      uploaded_by: meta.profileId || null,
      category_code: null,
      created_at: iso(Date.now())
    }
    try {
      blobs.set(doc.id, URL.createObjectURL(file))
    } catch {
      /* ignore */
    }
    s.documents.push(doc)
    s.events.unshift({
      id: uid('ev'),
      case_id: caseId,
      event_type: 'document_uploaded',
      note: file.name,
      actor_id: meta.profileId || null,
      created_at: iso(Date.now())
    })
    commit()
    return wait(doc)
  },

  // Demo mode has no real AI to read a document or pasted email text with —
  // unlike the other demo extraction shortcuts above, there are no
  // pre-seeded fields to fall back on here, since this is meant to be a
  // brand-new upload. So this honestly does the only truthful thing it can:
  // files the document under current_tax_sheet and marks it 'extracted'
  // with zero fields, which is a known, visible demo-mode limitation rather
  // than a silent one (syncPersonalDetails below is a no-op without fields).
  async fillQuestionnaireFromDocument(caseId, file, meta = {}) {
    const doc = await this.uploadDocument(caseId, file, { ...meta, direction: 'client_upload' })
    const s = store()
    const stored = s.documents.find((d) => d.id === doc.id)
    if (stored) {
      stored.category_code = 'current_tax_sheet'
      stored.status = 'extracted'
      stored.processed_at = iso(Date.now())
    }
    commit()
    await this.syncPersonalDetails(doc.id)
    return wait({ ok: true })
  },

  async fillQuestionnaireFromText(caseId, text, meta = {}) {
    const file = new File([text], `pasted-text-${Date.now()}.txt`, { type: 'text/plain' })
    return this.fillQuestionnaireFromDocument(caseId, file, meta)
  },

  async deleteDocument(doc) {
    const s = store()
    s.documents = s.documents.filter((d) => d.id !== doc.id)
    blobs.delete(doc.id)
    commit()
    return wait(true)
  },

  async listDocumentCategories() {
    return wait([...DOCUMENT_CATEGORIES].sort((a, b) => a.sort_order - b.sort_order))
  },

  async setDocumentCategory(caseDocumentId, categoryCode) {
    const s = store()
    const doc = s.documents.find((d) => d.id === caseDocumentId)
    if (doc) doc.category_code = categoryCode
    commit()
    return wait(doc || null)
  },

  // Demo has no separate client_documents table — documents.id doubles as
  // the "document_id" extracted_document_fields would otherwise reference.
  // Demo has no separate client_documents table — documents.id doubles as
  // "document_id", so these are already the direct primitives; the
  // case-document-indirected names are plain aliases.
  async listExtractedFieldsForDocument(documentId) {
    const s = store()
    return wait(s.extractedDocumentFields.filter((f) => f.document_id === documentId))
  },

  async saveExtractedFieldForDocument(documentId, payload) {
    const s = store()
    const rowKey = payload.row_key || ''
    const existing = s.extractedDocumentFields.find(
      (f) => f.document_id === documentId && f.field_key === payload.field_key && (f.row_key || '') === rowKey
    )
    let row
    if (existing) {
      Object.assign(existing, payload, { row_key: rowKey })
      row = existing
    } else {
      row = { id: uid('exf'), document_id: documentId, ...payload, row_key: rowKey }
      s.extractedDocumentFields.push(row)
    }
    commit()
    return wait(row)
  },

  async listExtractedFields(caseDocumentId) {
    return this.listExtractedFieldsForDocument(caseDocumentId)
  },

  // Read-only, as in supabaseData: only api/extract-document.js writes
  // these, and demo mode has no extraction pipeline to run.
  async listOtherFindingsForDocuments(documentIds) {
    if (!documentIds?.length) return []
    const s = store()
    const wanted = new Set(documentIds)
    return wait(s.documentOtherFindings.filter((f) => wanted.has(f.document_id)))
  },

  async listOtherFindingsForDocument(documentId) {
    return this.listOtherFindingsForDocuments([documentId])
  },

  async saveExtractedField(caseDocumentId, payload) {
    return this.saveExtractedFieldForDocument(caseDocumentId, payload)
  },

  // "Personal details" (current_tax_sheet) -> registry sync. In demo mode
  // there's no extraction webhook to call this automatically, so the client
  // call sites (after a manual field save) are the only trigger — see
  // api/_personalDetails.js for the real-backend equivalent this mirrors.
  async syncPersonalDetails(documentId) {
    const s = store()
    const doc = s.documents.find((d) => d.id === documentId)
    if (!doc || doc.category_code !== 'current_tax_sheet') {
      return wait({ autoFilled: [], suggestions: [] })
    }
    const caseRow = s.cases.find((c) => c.id === doc.case_id)
    const clientId = caseRow?.client_id
    if (!clientId) return wait({ autoFilled: [], suggestions: [] })

    const client = s.clients.find((c) => c.id === clientId)
    const fields = s.extractedDocumentFields.filter((f) => f.document_id === documentId)
    const primary = s.persons.find((p) => p.client_id === clientId && p.person_type === 'primary') || null
    const spouse = s.persons.find((p) => p.client_id === clientId && p.person_type === 'spouse') || null

    const { autoFill, suggestions, resolved } = computePersonalDetailsSync({
      extractedFields: fields,
      canton: client?.canton,
      primary,
      spouse
    })

    const clientPatch = {}
    const primaryPatch = {}
    const spousePatch = {}
    for (const item of autoFill) {
      if (item.table === 'clients') clientPatch[item.field] = item.value
      else if (item.person === 'primary') primaryPatch[item.field] = item.value
      else if (item.person === 'spouse') spousePatch[item.field] = item.value
    }
    if (Object.keys(clientPatch).length && client) {
      Object.assign(client, clientPatch, { updated_at: iso(Date.now()) })
    }
    if (Object.keys(primaryPatch).length) {
      if (primary) Object.assign(primary, primaryPatch, { updated_at: iso(Date.now()) })
      else s.persons.push({ id: uid('person'), client_id: clientId, person_type: 'primary', ...primaryPatch })
    }
    if (Object.keys(spousePatch).length) {
      if (spouse) Object.assign(spouse, spousePatch, { updated_at: iso(Date.now()) })
      else s.persons.push({ id: uid('person'), client_id: clientId, person_type: 'spouse', ...spousePatch })
    }

    for (const sug of suggestions) {
      const existing = s.fieldSuggestions.find(
        (row) =>
          row.client_id === clientId &&
          row.target_table === sug.table &&
          row.target_person === sug.person &&
          row.target_field === sug.field
      )
      if (existing) {
        Object.assign(existing, {
          document_id: documentId,
          field_label: sug.fieldLabel,
          current_value: sug.currentValue,
          suggested_value: sug.suggestedValue,
          created_at: iso(Date.now())
        })
      } else {
        s.fieldSuggestions.push({
          id: uid('sug'),
          client_id: clientId,
          document_id: documentId,
          target_table: sug.table,
          target_person: sug.person,
          target_field: sug.field,
          field_label: sug.fieldLabel,
          current_value: sug.currentValue,
          suggested_value: sug.suggestedValue,
          created_at: iso(Date.now())
        })
      }
    }
    for (const r of resolved) {
      s.fieldSuggestions = s.fieldSuggestions.filter(
        (row) =>
          !(
            row.client_id === clientId &&
            row.target_table === r.table &&
            row.target_person === r.person &&
            row.target_field === r.field
          )
      )
    }

    commit()
    return wait({ autoFilled: autoFill, suggestions })
  },

  // "property_tax_value" -> client_properties suggestion, mirrors
  // api/_propertySuggestion.js. Deduplicated per source document via the
  // upsert below — re-running this on the same document updates the
  // pending proposal instead of adding a second one.
  async syncPropertySuggestion(documentId) {
    const s = store()
    const doc = s.documents.find((d) => d.id === documentId)
    if (!doc || doc.category_code !== 'property_tax_value') return wait({ suggested: false })
    const caseRow = s.cases.find((c) => c.id === doc.case_id)
    const clientId = caseRow?.client_id
    if (!clientId) return wait({ suggested: false })

    const fields = s.extractedDocumentFields.filter((f) => f.document_id === documentId)
    // Matched by document first, then by normalized address — a DIFFERENT
    // document naming the same real property (mortgage certificate,
    // rental statement, ...) — see api/_propertySuggestion.js.
    const addressField = fields.find((f) => f.field_key === 'property_address')
    const normalizedIncoming = normalizePropertyAddress(addressField?.field_value)
    const clientPropertiesForClient = s.properties.filter((p) => p.client_id === clientId)
    const existingProperty =
      clientPropertiesForClient.find((p) => p.source_document_id === documentId) ||
      (normalizedIncoming
        ? clientPropertiesForClient.find((p) => normalizePropertyAddress(p.address) === normalizedIncoming)
        : null) ||
      null
    const proposal = buildPropertySuggestionPayload({ extractedFields: fields, existingProperty })
    if (!proposal) return wait({ suggested: false })

    const targetField = `property:${documentId}`
    const existingSuggestion = s.fieldSuggestions.find(
      (row) => row.client_id === clientId && row.target_table === 'client_properties' && row.target_field === targetField
    )
    const row = {
      client_id: clientId,
      document_id: documentId,
      target_table: 'client_properties',
      target_person: 'none',
      target_field: targetField,
      field_label: 'Property',
      current_value: existingProperty ? existingProperty.address : null,
      suggested_value: JSON.stringify(proposal.payload),
      created_at: iso(Date.now())
    }
    if (existingSuggestion) Object.assign(existingSuggestion, row)
    else s.fieldSuggestions.push({ id: uid('sug'), ...row })
    commit()
    return wait({ suggested: true })
  },

  // Child-name/child-count cross-reference, mirrors api/_childSuggestion.js.
  async syncChildSuggestions(clientId, taxYear) {
    const s = store()
    const year = Number(taxYear)
    const caseIds = new Set(
      s.cases.filter((c) => c.client_id === clientId && c.tax_year === year).map((c) => c.id)
    )
    const docs = s.documents.filter(
      (d) => caseIds.has(d.case_id) && ['current_tax_sheet', 'childcare_costs'].includes(d.category_code)
    )
    if (!docs.length) return wait({ suggested: 0 })

    const sheetDocIds = new Set(docs.filter((d) => d.category_code === 'current_tax_sheet').map((d) => d.id))
    const careDocIds = new Set(docs.filter((d) => d.category_code === 'childcare_costs').map((d) => d.id))
    const childrenCount = s.extractedDocumentFields
      .filter((f) => sheetDocIds.has(f.document_id) && f.field_key === 'children_count')
      .map((f) => parseInt(f.field_value, 10))
      .find((n) => Number.isFinite(n))
    // The personal-details letter often states the child's date of birth
    // itself (see migration 35) — only ever a single value, since
    // current_tax_sheet has no per-child name field to attribute it to.
    const sheetDateOfBirth = s.extractedDocumentFields
      .filter((f) => sheetDocIds.has(f.document_id) && f.field_key === 'child_date_of_birth')
      .map((f) => f.field_value)
      .find(Boolean)
    const dobByDocId = Object.fromEntries(
      s.extractedDocumentFields
        .filter((f) => careDocIds.has(f.document_id) && f.field_key === 'child_date_of_birth')
        .map((f) => [f.document_id, f.field_value])
    )
    const nameCandidates = s.extractedDocumentFields
      .filter((f) => careDocIds.has(f.document_id) && f.field_key === 'child_name' && f.field_value)
      .map((f) => ({ name: f.field_value, dateOfBirth: dobByDocId[f.document_id] || null }))
    const existingChildren = s.children.filter((c) => c.client_id === clientId)

    const candidates = buildChildSuggestionCandidates({
      childrenCount,
      candidates: nameCandidates,
      existingChildren,
      fallbackDateOfBirth: sheetDateOfBirth || null
    })
    if (!candidates.length) return wait({ suggested: 0 })

    for (const c of candidates) {
      const slug = c.key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const targetField = `child:${slug}`
      const existing = s.fieldSuggestions.find(
        (row) => row.client_id === clientId && row.target_table === 'client_children' && row.target_field === targetField
      )
      const row = {
        client_id: clientId,
        document_id: null,
        target_table: 'client_children',
        target_person: 'none',
        target_field: targetField,
        field_label: 'Child',
        current_value: null,
        suggested_value: JSON.stringify(
          c.date_of_birth ? { full_name: c.full_name, date_of_birth: c.date_of_birth } : { full_name: c.full_name }
        ),
        created_at: iso(Date.now())
      }
      if (existing) Object.assign(existing, row)
      else s.fieldSuggestions.push({ id: uid('sug'), ...row })
    }
    commit()
    return wait({ suggested: candidates.length })
  },

  async listFieldSuggestions(clientId) {
    const s = store()
    return wait(s.fieldSuggestions.filter((row) => row.client_id === clientId))
  },

  async resolveFieldSuggestion(suggestion, accept) {
    const s = store()
    if (accept) {
      if (suggestion.target_table === 'clients') {
        const client = s.clients.find((c) => c.id === suggestion.client_id)
        if (client) {
          Object.assign(client, { [suggestion.target_field]: suggestion.suggested_value, updated_at: iso(Date.now()) })
        }
      } else if (suggestion.target_table === 'client_persons') {
        const existing = s.persons.find(
          (p) => p.client_id === suggestion.client_id && p.person_type === suggestion.target_person
        )
        if (existing) {
          Object.assign(existing, { [suggestion.target_field]: suggestion.suggested_value, updated_at: iso(Date.now()) })
        } else {
          s.persons.push({
            id: uid('person'),
            client_id: suggestion.client_id,
            person_type: suggestion.target_person,
            [suggestion.target_field]: suggestion.suggested_value
          })
        }
      } else if (suggestion.target_table === 'client_properties') {
        // Deduplicated first by source document, then by normalized
        // address — see api/_propertySuggestion.js and
        // supabaseData.js's resolveFieldSuggestion for the same logic.
        const payload = JSON.parse(suggestion.suggested_value)
        const normalizedIncoming = normalizePropertyAddress(payload.address)
        const clientProperties = s.properties.filter((p) => p.client_id === suggestion.client_id)
        const existing =
          clientProperties.find((p) => p.source_document_id === suggestion.document_id) ||
          (normalizedIncoming
            ? clientProperties.find((p) => normalizePropertyAddress(p.address) === normalizedIncoming)
            : null) ||
          null
        if (existing) {
          Object.assign(existing, payload)
        } else {
          s.properties.push({
            id: uid('property'),
            client_id: suggestion.client_id,
            source_document_id: suggestion.document_id,
            ...payload
          })
        }
      } else if (suggestion.target_table === 'client_children') {
        const payload = JSON.parse(suggestion.suggested_value)
        s.children.push({ id: uid('child'), client_id: suggestion.client_id, sort_order: s.children.length, ...payload })
      }
    }
    s.fieldSuggestions = s.fieldSuggestions.filter((row) => row.id !== suggestion.id)
    commit()
    return wait(true)
  },

  // All of a client's documents for one tax year, across every case in that
  // year — the tax summary's raw material.
  async listClientDocuments(clientId, taxYear) {
    const s = store()
    const caseIds = new Set(
      s.cases.filter((c) => c.client_id === clientId && c.tax_year === Number(taxYear)).map((c) => c.id)
    )
    return wait(s.documents.filter((d) => caseIds.has(d.case_id)))
  },

  async listTaxParameters() {
    const s = store()
    return wait(
      [...s.taxParameters].sort(
        (a, b) =>
          a.scope.localeCompare(b.scope) ||
          (a.canton_code || '').localeCompare(b.canton_code || '') ||
          b.tax_year - a.tax_year
      )
    )
  },

  async createTaxParameter(payload) {
    const s = store()
    const row = { id: uid('param'), ...payload }
    s.taxParameters.push(row)
    commit()
    return wait(row)
  },

  async updateTaxParameter(id, patch) {
    const s = store()
    const row = s.taxParameters.find((p) => p.id === id)
    if (!row) throw new Error('NOT_FOUND')
    Object.assign(row, patch)
    commit()
    return wait(row)
  },

  async deleteTaxParameter(id) {
    const s = store()
    s.taxParameters = s.taxParameters.filter((p) => p.id !== id)
    commit()
    return wait(true)
  },

  // Demo mode has no real AI extraction to retry — simulates the same
  // outcome a real retry has when it succeeds (status flips back to
  // 'extracted', the error clears) so the completeness banner's "Retry"
  // action is testable end to end without a live Anthropic call.
  async retryExtraction(documentId, { force = false } = {}) {
    void force
    const s = store()
    const doc = s.documents.find((d) => d.id === documentId)
    if (!doc) throw new Error('Document not found.')
    doc.status = 'extracted'
    doc.extraction_error = null
    doc.processed_at = iso(Date.now())
    commit()
    return wait({ ok: true })
  },

  async updateClientDocumentStatus(documentId, status) {
    const s = store()
    const doc = s.documents.find((d) => d.id === documentId)
    if (!doc) throw new Error('Document not found.')
    doc.status = status
    commit()
    return wait(doc)
  },

  // The "reload everything" safety net (see api/reprocess-client-year.js
  // for the real-backend equivalent) — no actual AI call in demo mode
  // (documents are pre-seeded with their extracted fields already), so
  // this just re-runs the same side effect a fresh extraction would: marks
  // every document 'extracted', then re-syncs the client registry from all
  // of them, in one action instead of one at a time.
  async reprocessClientYear(clientId, taxYear) {
    const s = store()
    const year = Number(taxYear)
    const caseIds = new Set(
      s.cases.filter((c) => c.client_id === clientId && c.tax_year === year).map((c) => c.id)
    )
    const docs = s.documents.filter((d) => caseIds.has(d.case_id))
    const now = iso(Date.now())
    for (const doc of docs) {
      doc.status = 'extracted'
      doc.extraction_error = null
      doc.processed_at = now
    }
    commit()

    for (const doc of docs.filter((d) => d.category_code === 'current_tax_sheet')) {
      await this.syncPersonalDetails(doc.id)
    }
    for (const doc of docs.filter((d) => d.category_code === 'property_tax_value')) {
      await this.syncPropertySuggestion(doc.id)
    }
    if (docs.some((d) => d.category_code === 'current_tax_sheet' || d.category_code === 'childcare_costs')) {
      await this.syncChildSuggestions(clientId, year)
    }
    const { merged } = await this.dedupeClientProperties(clientId)
    return wait({ processed: docs.length, failed: 0, errors: [], mergedProperties: merged })
  },

  // Merges existing duplicate client_properties rows for a client — see
  // api/_propertySuggestion.js's dedupeClientProperties for the reasoning
  // (the address-matching in syncPropertySuggestion only prevents a NEW
  // duplicate going forward, not ones already accepted before it existed).
  async dedupeClientProperties(clientId) {
    const s = store()
    const properties = s.properties.filter((p) => p.client_id === clientId)
    const groups = new Map()
    for (const property of properties) {
      const key = normalizePropertyAddress(property.address)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(property)
    }
    let merged = 0
    const idsToRemove = new Set()
    const filledCount = (p) => Object.values(p).filter((v) => v != null && v !== '').length
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const [survivor, ...duplicates] = [...group].sort((a, b) => filledCount(b) - filledCount(a))
      for (const dup of duplicates) {
        for (const [key, value] of Object.entries(dup)) {
          if (['id', 'client_id', 'created_at'].includes(key)) continue
          if ((survivor[key] == null || survivor[key] === '') && value != null && value !== '') {
            survivor[key] = value
          }
        }
        idsToRemove.add(dup.id)
      }
      merged += duplicates.length
    }
    if (idsToRemove.size) {
      s.properties = s.properties.filter((p) => !idsToRemove.has(p.id))
      commit()
    }
    return wait({ merged })
  },

  // Demo mirror of listCaseAssistantMessages/askCaseAssistant (see
  // supabaseData.js and api/case-assistant.js) — demo mode has no server to
  // hold an Anthropic key, so this can't make a real call; it still
  // exercises the same persisted-history shape (case_assistant_messages),
  // just with a fixed explanatory reply instead of a real answer.
  //
  // created_by is still set and filtered on here (even though the demo
  // dataset only ever seeds one specialist profile, so there is no second
  // user to isolate from in practice) purely to keep the row shape and the
  // read path identical to the real backend's per-user scoping (migration
  // 20260101000043) — a demo session should never look more permissive
  // than production.
  async listCaseAssistantMessages(caseId) {
    const s = store()
    const specialist = s.profiles.find((p) => p.role === 'specialist')
    return wait(
      s.caseAssistantMessages
        .filter((m) => m.case_id === caseId && m.created_by === specialist?.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    )
  },

  async askCaseAssistant(caseId, message) {
    const s = store()
    const specialist = s.profiles.find((p) => p.role === 'specialist')
    const now = Date.now()
    const userRow = {
      id: uid('assistant-msg'),
      case_id: caseId,
      role: 'user',
      content: message,
      created_by: specialist?.id || null,
      created_at: iso(now)
    }
    const reply =
      "L'assistente AI richiede il backend reale (chiave Anthropic lato server) — non disponibile in modalità demo. " +
      'In produzione risponde usando i dati effettivi di questo caso (documenti, calcolo, decisioni).'
    const assistantRow = {
      id: uid('assistant-msg'),
      case_id: caseId,
      role: 'assistant',
      content: reply,
      created_by: specialist?.id || null,
      created_at: iso(now + 1)
    }
    s.caseAssistantMessages.push(userRow, assistantRow)
    commit()
    return wait({ reply })
  },

  // Demo mirror of listAiModelSettings/saveAiModelSetting (see
  // supabaseData.js) — same shape, kept in the store so a choice made on
  // the Tax settings "AI" tab persists across a demo session like every
  // other setting there.
  async listAiModelSettings() {
    const s = store()
    return wait([...s.aiModelSettings])
  },

  async saveAiModelSetting(key, model) {
    const s = store()
    let row = s.aiModelSettings.find((r) => r.key === key)
    if (row) {
      row.model = model || null
      row.updated_at = iso(Date.now())
    } else {
      row = { key, model: model || null, updated_at: iso(Date.now()), updated_by: null }
      s.aiModelSettings.push(row)
    }
    commit()
    return wait(row)
  },

  async listFieldDefinitions() {
    const s = store()
    return wait(
      [...s.fieldDefinitions].sort(
        (a, b) => a.category_code.localeCompare(b.category_code) || a.sort_order - b.sort_order
      )
    )
  },

  async createFieldDefinition(payload) {
    const s = store()
    const row = { id: uid('field'), required: false, sort_order: 0, ...payload }
    s.fieldDefinitions.push(row)
    commit()
    return wait(row)
  },

  async updateFieldDefinition(id, patch) {
    const s = store()
    const row = s.fieldDefinitions.find((f) => f.id === id)
    if (!row) throw new Error('NOT_FOUND')
    Object.assign(row, patch)
    commit()
    return wait(row)
  },

  async deleteFieldDefinition(id) {
    const s = store()
    s.fieldDefinitions = s.fieldDefinitions.filter((f) => f.id !== id)
    commit()
    return wait(true)
  },

  // Demo mode has no backend to send a real e-mail from.
  async notifyLateUpload() {
    return wait({ notified: false, demo: true })
  },

  async getDownloadUrl(doc, { download = true } = {}) {
    return blobs.get(doc.id) || null
  },

  async listRequested(caseId) {
    const s = store()
    return wait(s.requested.filter((r) => r.case_id === caseId))
  },

  async setRequested(caseId, typeIds) {
    const s = store()
    s.requested = s.requested.filter((r) => r.case_id !== caseId)
    typeIds.forEach((id) =>
      s.requested.push({ id: uid('req'), case_id: caseId, document_type_id: id, required: true })
    )
    commit()
    return wait(s.requested.filter((r) => r.case_id === caseId))
  },

  async listEvents(caseId) {
    const s = store()
    return wait(
      s.events
        .filter((e) => e.case_id === caseId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    )
  },

  async listExtracted(caseId) {
    const s = store()
    return wait(s.extracted.filter((e) => e.case_id === caseId))
  },

  async getStats(year) {
    const s = store()
    const rows = s.cases.filter((c) => c.tax_year === Number(year))
    return wait({
      open: rows.filter((c) => c.status !== 'finished').length,
      waiting: rows.filter((c) => c.status === 'waiting_client').length,
      inProcess: rows.filter((c) => c.status === 'in_process').length,
      finished: rows.filter((c) => c.status === 'finished').length,
      clients: s.clients.filter((c) => c.status !== 'archived').length
    })
  }
}

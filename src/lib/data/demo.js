// ---------------------------------------------------------------------------
// DEMO data layer — runs entirely in the browser (localStorage), so the whole
// interface can be reviewed before Supabase is connected.
// The method signatures are identical to those of the Supabase layer.
// ---------------------------------------------------------------------------
import { currentTaxYear } from '../config'
import { DOCUMENT_TYPES, PRICING_ITEMS } from '../demoSeed'

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

  const documents = [
    { id: uid('doc'), case_id: 'case-1', document_type_id: 'salary_statement', direction: 'client_upload', storage_path: 'demo/salary.pdf', file_name: 'Lohnausweis_2025.pdf', file_size: 184320, mime_type: 'application/pdf', uploaded_by: clientProfile.id, created_at: daysAgo(20) },
    { id: uid('doc'), case_id: 'case-1', document_type_id: 'pillar_3a', direction: 'client_upload', storage_path: 'demo/3a.pdf', file_name: 'Pilastro_3a_UBS.pdf', file_size: 96000, mime_type: 'application/pdf', uploaded_by: clientProfile.id, created_at: daysAgo(19) },
    { id: uid('doc'), case_id: 'case-1', document_type_id: 'bank_statements', direction: 'client_upload', storage_path: 'demo/bank.pdf', file_name: 'Estratti_conti_31122025.pdf', file_size: 512000, mime_type: 'application/pdf', uploaded_by: clientProfile.id, created_at: daysAgo(14) },
    { id: uid('doc'), case_id: 'case-2', document_type_id: null, direction: 'specialist_upload', storage_path: 'demo/decl.pdf', file_name: `Dichiarazione_${prev}_Bianchi.pdf`, file_size: 742000, mime_type: 'application/pdf', uploaded_by: specialist.id, created_at: daysAgo(300), note: 'Final declaration, submitted to the tax office.' },
    { id: uid('doc'), case_id: 'case-2', document_type_id: null, direction: 'specialist_upload', storage_path: 'demo/receipt.pdf', file_name: `Ricevuta_invio_${prev}.pdf`, file_size: 68000, mime_type: 'application/pdf', uploaded_by: specialist.id, created_at: daysAgo(300) },
    { id: uid('doc'), case_id: 'case-3', document_type_id: null, direction: 'specialist_upload', storage_path: 'demo/decl2.pdf', file_name: `Dichiarazione_${prev2}_Bianchi.pdf`, file_size: 690000, mime_type: 'application/pdf', uploaded_by: specialist.id, created_at: daysAgo(660) }
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
    extracted
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
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
    return wait(PRICING_ITEMS)
  },

  async getMyClient(profileId) {
    const s = store()
    return wait(s.clients.find((c) => c.profile_id === profileId) || null)
  },

  async listClients({ q = '', year = null, status = null } = {}) {
    const s = store()
    let rows = s.clients.map(withCounts)
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

  async deleteDocument(doc) {
    const s = store()
    s.documents = s.documents.filter((d) => d.id !== doc.id)
    blobs.delete(doc.id)
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

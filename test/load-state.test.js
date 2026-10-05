// A page load always ends. Tax Summary used to set loading=true and await
// its queries with no try/catch: one failing query (a table missing because
// a migration was never run) left the spinner on screen forever. Now every
// page loads through src/lib/useLoad.js, whose rule lives in runLoad: the
// state moves from 'loading' to 'ready' or 'error', and an error shows a
// plain message with "Riprova" — plus, for staff, what the database said.
//
// No jsdom here: the logic is tested directly, the error screen is rendered
// to static HTML with react-dom/server.
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describeLoadError, runLoad } from '../src/lib/loadState.js'
import { loadTaxSummary } from '../src/lib/taxSummaryData.js'

beforeAll(() => {
  // The interface language is read from localStorage; render in Italian.
  globalThis.localStorage = { getItem: () => 'it', setItem: () => {} }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const missingTable = Object.assign(new Error('relation "public.document_other_findings" does not exist'), {
  code: '42P01'
})

// A data layer where every query works except one.
function fakeApi({ failing } = {}) {
  const ok = {
    getCase: async () => ({ id: 'case-1', client_id: 'client-1', tax_year: 2025, client: {} }),
    listClientDocuments: async () => [{ id: 'doc-1', file_name: 'a.pdf', category_code: 'salary_statement' }],
    listDocumentCategories: async () => [],
    listFieldDefinitions: async () => [],
    getQuestionnaire: async () => ({ persons: [], children: [], properties: [] }),
    listExtractedFieldsForDocument: async () => [],
    listOtherFindingsForDocuments: async () => []
  }
  if (failing) ok[failing] = async () => { throw missingTable }
  return ok
}

async function statesOf(loader) {
  const states = []
  await runLoad(loader, (s) => states.push(s))
  return states
}

describe('loading a page', () => {
  it('ends in "error" — never stays on "loading" — when a Tax Summary query fails', async () => {
    const states = await statesOf(() => loadTaxSummary(fakeApi({ failing: 'listOtherFindingsForDocuments' }), 'case-1'))
    expect(states.map((s) => s.status)).toEqual(['loading', 'error'])
    expect(states.at(-1).error).toBe(missingTable)
  })

  it('ends in "error" whichever query fails, including the very first one', async () => {
    for (const failing of ['getCase', 'listClientDocuments', 'getQuestionnaire', 'listExtractedFieldsForDocument']) {
      const states = await statesOf(() => loadTaxSummary(fakeApi({ failing }), 'case-1'))
      expect(states.at(-1).status, failing).toBe('error')
    }
  })

  it('ends in "ready" when everything works', async () => {
    const states = await statesOf(() => loadTaxSummary(fakeApi(), 'case-1'))
    expect(states.map((s) => s.status)).toEqual(['loading', 'ready'])
  })

  it('turns what the database said into a readable technical detail', () => {
    expect(describeLoadError(missingTable)).toBe('relation "public.document_other_findings" does not exist (42P01)')
    expect(describeLoadError({ message: 'permission denied', code: '42501', hint: 'Check the RLS policy' })).toBe(
      'permission denied (42501) — Check the RLS policy'
    )
  })
})

describe('the error screen', () => {
  async function render(props) {
    const { I18nProvider } = await import('../src/i18n/index.jsx')
    const { LoadError } = await import('../src/components/LoadState.jsx')
    return renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(LoadError, { error: missingTable, onRetry: () => {}, ...props }))
    )
  }

  it('says it in plain words and offers "Riprova"', async () => {
    const html = await render({ showDetail: true })
    expect(html).toContain('Non è stato possibile caricare questa pagina.')
    expect(html).toMatch(/<button[^>]*>.*Riprova<\/button>/)
  })

  it('shows staff the technical detail', async () => {
    const html = await render({ showDetail: true })
    expect(html).toContain('Dettaglio tecnico')
    expect(html).toContain('document_other_findings')
  })

  it('never shows it to a client', async () => {
    const html = await render({ showDetail: false })
    expect(html).toContain('Riprova')
    expect(html).not.toContain('document_other_findings')
  })
})

describe('every page goes through the same loader', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const pages = [
    'src/pages/TaxSummary.jsx',
    'src/pages/CasePage.jsx',
    'src/pages/SpecialistClient.jsx',
    'src/pages/SpecialistHome.jsx',
    'src/pages/ClientHome.jsx',
    'src/pages/Pricing.jsx',
    'src/pages/TaxSettings.jsx',
    'src/components/QuestionnaireForm.jsx'
  ]

  it('uses useLoad and LoadGate, and no hand-made loading flag that could get stuck', () => {
    for (const page of pages) {
      const source = read(page)
      expect(source, page).toMatch(/useLoad\(/)
      expect(source, page).toMatch(/<LoadGate/)
      expect(source, page).not.toMatch(/setLoading\(/)
    }
  })
})

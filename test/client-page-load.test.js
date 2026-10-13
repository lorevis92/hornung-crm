// The client page (src/pages/SpecialistClient.jsx) used to await the
// registry catch-up — one sync call per eligible document of every tax year
// — before it counted as loaded, so nothing appeared until all of them were
// done. Now it shows what is on file at once (src/lib/clientPageData.js) and
// the catch-up runs truly in the background, refreshing the suggestions and
// the Questionnaire when it finishes — only if the specialist is still there.
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadClientPage } from '../src/lib/clientPageData.js'
import { runLoad } from '../src/lib/loadState.js'

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const api = {
  getClient: async () => ({ id: 'client-1', first_name: 'Sara', internal_notes: 'note' }),
  listCases: async () => [{ id: 'case-1', tax_year: 2025 }, { id: 'case-2', tax_year: 2024 }],
  listFieldSuggestions: async () => [{ id: 's-1' }]
}

// A catch-up we finish by hand, to see what happens before and after.
function controllableCatchUp() {
  let finish
  let fail
  const fn = vi.fn(() => new Promise((resolve, reject) => {
    finish = resolve
    fail = reject
  }))
  return { fn, finish: () => finish(), fail: (e) => fail(e) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('opening a client', () => {
  it('counts as loaded while the catch-up is still running', async () => {
    const catchUp = controllableCatchUp()
    const states = []
    let data
    await runLoad(async () => {
      data = await loadClientPage({ api, clientId: 'client-1', catchUp: catchUp.fn })
    }, (s) => states.push(s.status))

    expect(states).toEqual(['loading', 'ready'])
    expect(data.client.first_name).toBe('Sara')
    expect(data.cases).toHaveLength(2)
    expect(data.suggestions).toEqual([{ id: 's-1' }])
    // Started, with the cases it needs — but not finished.
    expect(catchUp.fn).toHaveBeenCalledWith('client-1', data.cases)
  })

  it('refreshes the view when the catch-up finishes, if the specialist is still on the page', async () => {
    const catchUp = controllableCatchUp()
    const onCatchUpDone = vi.fn()
    await loadClientPage({ api, clientId: 'client-1', catchUp: catchUp.fn, isCurrent: () => true, onCatchUpDone })
    await flush()
    expect(onCatchUpDone).not.toHaveBeenCalled()

    catchUp.finish()
    await flush()
    expect(onCatchUpDone).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the specialist has already left the page', async () => {
    const catchUp = controllableCatchUp()
    const onCatchUpDone = vi.fn()
    let onPage = true
    await loadClientPage({ api, clientId: 'client-1', catchUp: catchUp.fn, isCurrent: () => onPage, onCatchUpDone })
    onPage = false
    catchUp.finish()
    await flush()
    expect(onCatchUpDone).not.toHaveBeenCalled()
  })

  it('a failing catch-up never breaks the page that is already shown', async () => {
    const catchUp = controllableCatchUp()
    const onCatchUpDone = vi.fn()
    const data = await loadClientPage({ api, clientId: 'client-1', catchUp: catchUp.fn, onCatchUpDone })
    catchUp.fail(new Error('network'))
    await flush()
    expect(data.client.id).toBe('client-1')
    expect(onCatchUpDone).not.toHaveBeenCalled()
  })
})

describe('the client page and its Questionnaire', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

  it('no longer awaits the catch-up before showing itself', () => {
    const page = read('src/pages/SpecialistClient.jsx')
    expect(page).not.toMatch(/await\s+catchUpRegistrySyncInBackground/)
    expect(page).toMatch(/loadClientPage\(\{/)
    expect(page).toMatch(/refreshToken=\{catchUpToken\}/)
  })

  it('the Questionnaire refreshes in place only when it has no unsaved edits', async () => {
    const { formSnapshot, shouldRefreshFromServer } = await import('../src/components/QuestionnaireForm.jsx')
    const form = { details: {}, primary: { first_name: 'Sara' }, spouse: null, children: [], vehicles: [], properties: [] }
    const saved = formSnapshot(form)
    expect(shouldRefreshFromServer(saved, formSnapshot({ ...form }))).toBe(true)
    expect(shouldRefreshFromServer(saved, formSnapshot({ ...form, primary: { first_name: 'Sarah' } }))).toBe(false)
    // Not loaded yet: nothing to compare, nothing to refresh.
    expect(shouldRefreshFromServer(null, saved)).toBe(false)
  })
})

// Husband first, and what happens when it cannot be decided.
//  - The extraction may read a person's gender from an unambiguous title or
//    form of address in the document ("Signora", "Herr", "Madame", "Mr."),
//    never from a first name alone (api/extract-document.js).
//  - The household box in Tax Summary says so when the order is only a
//    fallback (src/components/summary/HouseholdCard.jsx), as a note and not
//    as an action: the fix stays in the Questionnaire.
import { describe, expect, it, beforeAll, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { computePersonalDetailsSync } from '../src/lib/personalDetails.js'
import { resolvePersonDisplayOrder } from '../src/lib/personOrder.js'

beforeAll(() => {
  globalThis.localStorage = { getItem: () => 'it', setItem: () => {} }
})

describe('the extraction prompt for gender', () => {
  let genderInstruction
  beforeAll(async () => {
    vi.resetModules()
    ;({ genderInstruction } = await import('../api/extract-document.js'))
  })

  const sheetDefs = [
    { field_key: 'full_name' },
    { field_key: 'gender' },
    { field_key: 'partner_full_name' },
    { field_key: 'partner_gender' }
  ]

  it('lets the model read the gender from a title or form of address, for the gender fields only', () => {
    const text = genderInstruction(sheetDefs)
    expect(text).toContain('gender and partner_gender only')
    for (const title of ['Signor/Signora', 'Herr/Frau', 'Monsieur/Madame', 'Mr./Mrs.']) expect(text).toContain(title)
    // ... still with the exact sentence as the source, like every field.
    expect(text).toMatch(/copy that exact text/)
    expect(text).toMatch(/applies to no other field/)
  })

  it('still forbids deducing it from a first name, or guessing without any title', () => {
    const text = genderInstruction(sheetDefs)
    expect(text).toMatch(/Never deduce it from a first name alone/)
    expect(text).toMatch(/never guess/)
  })

  it('adds nothing for a document type without gender fields', () => {
    expect(genderInstruction([{ field_key: 'gross_salary' }, { field_key: 'employer_name' }])).toBe('')
  })

  it('is part of the extraction prompt, right after the field list', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../api/extract-document.js', import.meta.url), 'utf8')
    expect(source).toMatch(/: 'No specific fields are defined for this kind of document\.'\) \+\s+genderInstruction\(fieldDefs\) \+/)
  })
})

describe('a gender read from a title reaches the Questionnaire', () => {
  const sync = (fields, primary = null, spouse = null) =>
    computePersonalDetailsSync({ extractedFields: fields, canton: null, primary, spouse })

  it('fills an empty gender from "Signora Sara Bianchi"', () => {
    const { autoFill } = sync([
      { field_key: 'gender', field_value: 'female', source_quote: 'Signora Sara Bianchi', confidence: 0.9 }
    ])
    expect(autoFill.find((a) => a.field === 'gender')?.value).toBe('female')
  })

  it('understands the title itself when the model returns it as the value', () => {
    const cases = { Signora: 'female', Herr: 'male', Madame: 'female', 'Mr.': 'male', 'Mrs.': 'female', Signor: 'male', Frau: 'female', Monsieur: 'male' }
    for (const [value, expected] of Object.entries(cases)) {
      const { autoFill } = sync([{ field_key: 'gender', field_value: value }])
      expect(autoFill.find((a) => a.field === 'gender')?.value, value).toBe(expected)
    }
  })

  it('never takes a bare first name as a gender', () => {
    const { autoFill, suggestions } = sync([{ field_key: 'gender', field_value: 'Andrea' }])
    expect(autoFill.some((a) => a.field === 'gender')).toBe(false)
    expect(suggestions.some((s) => s.field === 'gender')).toBe(false)
  })

  it('reads the partner\'s title too, as a suggestion like every spouse field', () => {
    const { suggestions } = sync([{ field_key: 'partner_gender', field_value: 'Herr' }], null, { first_name: 'Luca' })
    expect(suggestions.find((s) => s.field === 'gender' && s.person === 'spouse')?.suggestedValue).toBe('male')
  })
})

describe('the household box when the order cannot be decided', () => {
  const primary = { person_type: 'primary', first_name: 'Sara', last_name: 'Bianchi' }
  const spouse = { person_type: 'spouse', first_name: 'Luca', last_name: 'Bianchi' }

  async function render(household) {
    const { I18nProvider } = await import('../src/i18n/index.jsx')
    const { default: HouseholdCard } = await import('../src/components/summary/HouseholdCard.jsx')
    const personOrder = resolvePersonDisplayOrder({ primaryPerson: household.primary, spousePerson: household.spouse })
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          I18nProvider,
          null,
          createElement(HouseholdCard, { clientId: 'client-1', household: { children: [], ...household }, personOrder })
        )
      )
    )
  }

  it('shows the note when the gender is missing', async () => {
    const html = await render({ primary, spouse })
    expect(html).toContain('Ordine di presentazione non determinabile automaticamente')
  })

  it('shows the note when the gender is the same on both sides', async () => {
    const html = await render({ primary: { ...primary, gender: 'female' }, spouse: { ...spouse, gender: 'female' } })
    expect(html).toContain('Ordine di presentazione non determinabile automaticamente')
  })

  it('does not show it when the order is decided', async () => {
    const html = await render({ primary: { ...primary, gender: 'female' }, spouse: { ...spouse, gender: 'male' } })
    expect(html).not.toContain('Ordine di presentazione non determinabile')
    // Husband first: Luca before Sara.
    expect(html.indexOf('Luca Bianchi')).toBeLessThan(html.indexOf('Sara Bianchi'))
  })

  it('does not show it for a single taxpayer', async () => {
    const html = await render({ primary, spouse: null })
    expect(html).not.toContain('Ordine di presentazione non determinabile')
  })

  it('is a note, not an action: the only control is the link to the Questionnaire', async () => {
    const html = await render({ primary, spouse })
    expect(html).not.toMatch(/<button/)
    expect(html).toMatch(/<a[^>]*href="\/clients\/client-1\?tab=questionnaire"/)
  })
})

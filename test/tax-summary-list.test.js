// Tax Summary's document list (src/lib/taxSummaryData.js +
// src/components/summary/*): every document of the case, one by one, each
// saying first whom it refers to, with its data grouped by row and nothing
// to edit, approve or exclude.
import { describe, expect, it, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildDocumentList } from '../src/lib/taxSummaryData.js'
import { describeDocumentPerson } from '../src/lib/documentPerson.js'
import { formatFieldValue } from '../src/lib/fieldFormat.js'

beforeAll(() => {
  globalThis.localStorage = { getItem: () => 'it', setItem: () => {} }
})

const household = {
  primary: { person_type: 'primary', first_name: 'Mario', last_name: 'Rossi', gender: 'male' },
  spouse: { person_type: 'spouse', first_name: 'Anna', last_name: 'Rossi', gender: 'female' },
  children: [{ id: 'c1', full_name: 'Luca Rossi' }]
}

const categories = [
  { code: 'current_tax_sheet', group_key: 'base', sort_order: 1, label_it: 'Dati personali' },
  { code: 'salary_statement', group_key: 'income', sort_order: 10, label_it: 'Certificato di salario' },
  { code: 'pillar_3a_certificate', group_key: 'deductions', sort_order: 20, label_it: 'Pilastro 3a' },
  { code: 'health_insurance_policy', group_key: 'deductions', sort_order: 30, label_it: 'Cassa malati' },
  { code: 'childcare_costs', group_key: 'deductions', sort_order: 40, label_it: 'Custodia figli' },
  { code: 'bank_securities_crypto_statement', group_key: 'assets', sort_order: 50, label_it: 'Conti bancari' }
]

const fieldDefs = [
  { category_code: 'health_insurance_policy', field_key: 'insured_person_name', field_label: 'Persona assicurata', value_type: 'text', sort_order: 10 },
  { category_code: 'health_insurance_policy', field_key: 'insurer_name', field_label: 'Assicuratore', value_type: 'text', sort_order: 20 },
  { category_code: 'health_insurance_policy', field_key: 'annual_premium', field_label: 'Premio annuo', value_type: 'numeric', sort_order: 30 },
  { category_code: 'salary_statement', field_key: 'gross_salary', field_label: 'Salario lordo', value_type: 'numeric', sort_order: 10 }
]

const doc = (id, category_code, extra = {}) => ({
  id,
  file_name: `${id}.pdf`,
  category_code,
  status: 'extracted',
  mime_type: 'application/pdf',
  ...extra
})

const documents = [
  doc('health', 'health_insurance_policy', { person_ref: 'household' }),
  doc('salary-anna', 'salary_statement', { person_ref: 'spouse', person_name: 'Anna Rossi' }),
  doc('pillar-mario', 'pillar_3a_certificate', { person_ref: 'taxpayer' }),
  doc('salary-mario', 'salary_statement', { person_ref: 'taxpayer', person_quote: 'Dipendente: Mario Rossi', person_page: 1 }),
  doc('sheet-mario', 'current_tax_sheet', { person_ref: 'taxpayer' }),
  doc('bank', 'bank_securities_crypto_statement', { person_ref: 'unknown' }),
  doc('failed', 'salary_statement', { status: 'extraction_failed', extraction_error: 'rate limited' }),
  doc('childcare', 'childcare_costs', { person_ref: 'child:c1' })
]

const extractedFields = [
  // Two premiums for two different persons on ONE document.
  { document_id: 'health', row_key: 'row-1', row_label: 'LAMal – Mario Rossi', field_key: 'insured_person_name', field_value: 'Mario Rossi', source_quote: 'Assicurato: Mario Rossi', source_page: 1 },
  { document_id: 'health', row_key: 'row-1', field_key: 'annual_premium', field_value: '4800', source_quote: 'Premio annuo 4800.00', source_page: 1 },
  { document_id: 'health', row_key: 'row-2', row_label: 'LAMal – Anna Rossi', field_key: 'insured_person_name', field_value: 'Anna Rossi', source_quote: 'Assicurata: Anna Rossi', source_page: 2 },
  { document_id: 'health', row_key: 'row-2', field_key: 'annual_premium', field_value: "5'120.50", source_quote: 'Premio annuo 5120.50', source_page: 2 },
  { document_id: 'health', row_key: '', field_key: 'insurer_name', field_value: 'Cassa Helvetica', source_quote: 'Cassa Helvetica', source_page: 1 },
  { document_id: 'salary-mario', row_key: '', field_key: 'gross_salary', field_value: '95000', source_quote: 'Salario lordo 95000', source_page: 1 }
]

const list = buildDocumentList({ documents, categories, fieldDefs, extractedFields, otherFindings: [], household })
const item = (id) => list.find((i) => i.doc.id === id)

describe('the order of the list', () => {
  it('goes by person — husband, wife, child, household, undetermined, not yet extracted', () => {
    expect(list.map((i) => i.doc.id)).toEqual([
      'sheet-mario',
      'salary-mario',
      'pillar-mario',
      'salary-anna',
      'childcare',
      'health',
      'bank',
      'failed'
    ])
  })

  it('then by type, in the order a tax return reads: personal data, income, deductions', () => {
    const mario = list.filter((i) => i.doc.person_ref === 'taxpayer').map((i) => i.category.group_key)
    expect(mario).toEqual(['base', 'income', 'deductions'])
  })

  it('puts the wife first when she is the registered taxpayer — husband first, always', () => {
    const swapped = {
      ...household,
      primary: { ...household.spouse, person_type: 'primary' },
      spouse: { ...household.primary, person_type: 'spouse' }
    }
    const ids = buildDocumentList({ documents, categories, fieldDefs, extractedFields, household: swapped })
      .map((i) => i.doc.id)
      .slice(0, 4)
    expect(ids).toEqual(['salary-anna', 'sheet-mario', 'salary-mario', 'pillar-mario'])
  })
})

describe('whom each document refers to', () => {
  it('names the person from the Questionnaire, with its role', () => {
    expect(item('salary-mario').person).toEqual({ kind: 'taxpayer', name: 'Mario Rossi' })
    expect(item('salary-anna').person).toEqual({ kind: 'spouse', name: 'Anna Rossi' })
    expect(item('childcare').person).toEqual({ kind: 'child', name: 'Luca Rossi' })
    expect(item('health').person).toEqual({ kind: 'household', name: '' })
  })

  it('says "cannot be determined" as such, and "not yet" for a document never extracted', () => {
    expect(item('bank').person.kind).toBe('unknown')
    expect(item('failed').person.kind).toBe('pending')
  })

  it('keeps the name saved at extraction time if the child is no longer in the Questionnaire', () => {
    expect(describeDocumentPerson({ person_ref: 'child:gone', person_name: 'Sofia Rossi' }, household)).toEqual({
      kind: 'child',
      name: 'Sofia Rossi'
    })
  })
})

describe('the data of one document', () => {
  it('groups a household document by row, each row with its own label and its own person', () => {
    const rows = item('health').rows
    expect(rows.map((r) => r.label)).toEqual([null, 'LAMal – Mario Rossi', 'LAMal – Anna Rossi'])
    expect(rows.map((r) => r.person)).toEqual([null, 'Mario Rossi', 'Anna Rossi'])
    expect(rows[1].fields.map((f) => [f.field_key, f.value])).toEqual([
      ['insured_person_name', 'Mario Rossi'],
      ['annual_premium', '4800']
    ])
  })

  it('formats amounts and dates for reading, leaving anything unparseable as written', () => {
    expect(formatFieldValue({ value: "5'120.50", valueType: 'numeric', fieldKey: 'annual_premium' }, 'it')).toMatch(/^CHF\s5.120\.50$/)
    expect(formatFieldValue({ value: '1240 USD', valueType: 'numeric', fieldKey: 'account_balance_31_12' }, 'it')).toMatch(/USD/)
    expect(formatFieldValue({ value: '2', valueType: 'numeric', fieldKey: 'children_count' }, 'it')).toBe('2')
    expect(formatFieldValue({ value: '2025', valueType: 'numeric', fieldKey: 'tax_year' }, 'it')).toBe('2025')
    expect(formatFieldValue({ value: '31.12.2025', valueType: 'date' }, 'it')).toBe('31 dicembre 2025')
    expect(formatFieldValue({ value: 'fine anno', valueType: 'date' }, 'it')).toBe('fine anno')
  })

  it('marks a failed extraction as something to look at', () => {
    expect(item('failed').needsReview).toBe(true)
    expect(item('salary-mario').needsReview).toBe(false)
  })
})

describe('the document row on screen', () => {
  async function render(target, { open = true } = {}) {
    const { I18nProvider } = await import('../src/i18n/index.jsx')
    const { default: SummaryDocument } = await import('../src/components/summary/SummaryDocument.jsx')
    return renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(SummaryDocument, {
          item: target,
          open,
          onToggle: () => {},
          onViewSource: () => {},
          onRetry: () => {},
          retrying: false
        })
      )
    )
  }

  it('closed, shows the person first, then the file name, the type and the status', async () => {
    const html = await render(item('salary-mario'), { open: false })
    const order = ['Mario Rossi · Contribuente', 'salary-mario.pdf', 'Certificato di salario', 'Estratto'].map((t) =>
      html.indexOf(t)
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // Closed means closed: no data yet.
    expect(html).not.toContain('Salario lordo')
  })

  it('opened, shows every row with its label and person, values formatted', async () => {
    const html = await render(item('health'))
    expect(html).toContain('Nucleo familiare')
    expect(html).toContain('LAMal – Mario Rossi')
    expect(html).toContain('LAMal – Anna Rossi')
    expect(html).toContain('Persona: Anna Rossi')
    // The Swiss thousands separator, as React escapes it in HTML.
    expect(html).toMatch(/CHF\s4(&#x27;|')800/)
    expect(html).toContain('Cassa Helvetica')
  })

  it('is read-only: no inputs, nothing to approve or exclude — only source links and "Riprova estrazione"', async () => {
    const html = await render(item('health'))
    expect(html).not.toMatch(/<input|<textarea|<select/)
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    const actions = buttons.slice(1) // the first is the row header that opens/closes it
    expect(new Set(actions)).toEqual(new Set(['Vedi nel documento', 'Apri il documento', 'Riprova estrazione']))
  })

  it('shows why the person was chosen, linked to the sentence in the document', async () => {
    const html = await render(item('salary-mario'))
    expect(html).toContain('Dal documento:')
    expect(html).toContain('«Dipendente: Mario Rossi»')
  })

  it('keeps a failed document visible with its reason and "Riprova estrazione"', async () => {
    const html = await render(item('failed'))
    expect(html).toContain('Estrazione non riuscita.')
    expect(html).toContain('rate limited')
    expect(html).toContain('Riprova estrazione')
    expect(html).toContain('Persona non ancora indicata')
  })
})

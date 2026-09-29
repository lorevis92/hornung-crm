// Regression test for the "What each document says" section on Tax Summary
// (src/pages/TaxSummary.jsx) — the document's file name is shown as a
// clickable link back to the source document (Lorenzo: it didn't look
// clickable and wasn't). verifiedFieldsByDocument (src/lib/extraction.js)
// must keep documentId/fileName as their OWN fields, separate from the
// plain-text `heading` string, so the UI can render just the file name as
// a link (and route it to the right document) without also making the
// category label or a row identifier clickable.
import { describe, expect, it } from 'vitest'
import { verifiedFieldsByDocument } from '../src/lib/extraction.js'

describe('verifiedFieldsByDocument — the file name is its own field, tied to the right document', () => {
  it('a plain (non-row-based) document exposes documentId + fileName separately from the heading', () => {
    const section = {
      categories: [
        {
          category: { code: 'salary_statement', label_en: 'Salary statement' },
          documents: [
            {
              documentId: 'doc-1',
              fileName: '02_certificato_salario.pdf',
              fields: [{ field_label: 'Gross salary', field_value: '112400', row_key: '', row_label: null }]
            }
          ]
        }
      ]
    }
    const groups = verifiedFieldsByDocument(section, 'en')
    expect(groups).toHaveLength(1)
    expect(groups[0].documentId).toBe('doc-1')
    expect(groups[0].fileName).toBe('02_certificato_salario.pdf')
    expect(groups[0].categoryLabel).toBe('Salary statement')
    expect(groups[0].heading).toContain('02_certificato_salario.pdf')
  })

  it('two documents of the same category each keep their OWN documentId/fileName pair — never mixed up', () => {
    const section = {
      categories: [
        {
          category: { code: 'salary_statement', label_en: 'Salary statement' },
          documents: [
            {
              documentId: 'doc-1',
              fileName: '02_certificato_salario_marito.pdf',
              fields: [{ field_label: 'Gross salary', field_value: '112400', row_key: '', row_label: null }]
            },
            {
              documentId: 'doc-2',
              fileName: '02_certificato_salario_moglie.pdf',
              fields: [{ field_label: 'Gross salary', field_value: '95000', row_key: '', row_label: null }]
            }
          ]
        }
      ]
    }
    const groups = verifiedFieldsByDocument(section, 'en')
    expect(groups).toHaveLength(2)
    const byId = Object.fromEntries(groups.map((g) => [g.documentId, g.fileName]))
    expect(byId['doc-1']).toBe('02_certificato_salario_marito.pdf')
    expect(byId['doc-2']).toBe('02_certificato_salario_moglie.pdf')
  })

  it('a row-based document (see rowBasedFields.js) still keeps ONE fileName/documentId per row group, each pointing back to the same source document', () => {
    const section = {
      categories: [
        {
          category: { code: 'bank_securities_crypto_statement', label_en: 'Bank statement' },
          documents: [
            {
              documentId: 'doc-bank',
              fileName: '07_conti_bancari.pdf',
              fields: [
                { field_label: 'Account balance', field_value: '10000', row_key: 'row-1', row_label: 'Sara Bianchi — Banque des Alpes' },
                { field_label: 'Account balance', field_value: '8200', row_key: 'row-2', row_label: 'Sara Bianchi — Banque du Léman' }
              ]
            }
          ]
        }
      ]
    }
    const groups = verifiedFieldsByDocument(section, 'en')
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.documentId === 'doc-bank')).toBe(true)
    expect(groups.every((g) => g.fileName === '07_conti_bancari.pdf')).toBe(true)
    expect(groups[0].rowLabel).toBe('Sara Bianchi — Banque des Alpes')
    expect(groups[1].rowLabel).toBe('Sara Bianchi — Banque du Léman')
  })
})

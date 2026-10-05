// What the case page is and is no longer made of.
//
// This repo's test suite is pure logic — no jsdom, no React Testing Library
// — so "this section is gone from the page" and "both pages mount the same
// chat on the same case" are asserted against the source files themselves.
// That is weaker than rendering, and it is not nothing: it catches the
// regressions that actually happen here — a removed section creeping back,
// its i18n keys surviving as dead weight, or the second chat being given
// its own scope and quietly becoming a second conversation.
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import en from '../src/i18n/en.js'
import de from '../src/i18n/de.js'
import fr from '../src/i18n/fr.js'
import itLocale from '../src/i18n/it.js'

const LOCALES = { en, de, fr, it: itLocale }
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const casePage = read('src/pages/CasePage.jsx')
const taxSummary = read('src/pages/TaxSummary.jsx')
const caseAssistant = read('src/components/CaseAssistant.jsx')
const summaryDocument = read('src/components/summary/SummaryDocument.jsx')

describe('the case page no longer carries the History section', () => {
  it('does not render it, and the component it used is gone with it', () => {
    expect(casePage).not.toMatch(/CaseTimeline/)
    expect(existsSync(new URL('../src/components/CaseTimeline.jsx', import.meta.url))).toBe(false)
  })

  it('left no dead translation behind, in any language', () => {
    for (const [lang, dict] of Object.entries(LOCALES)) {
      expect(dict.case.timeline, lang).toBeUndefined()
    }
  })
})

describe('the case page no longer carries the document extraction status list', () => {
  it('does not render the section or its per-document status badges', () => {
    expect(casePage).not.toMatch(/extractionStatus/)
    expect(casePage).not.toMatch(/EXTRACTION_STATUS_LABEL_KEY|EXTRACTION_STATUS_TONE/)
    // It stopped loading the data that only fed that list, too.
    expect(casePage).not.toMatch(/clientDocuments/)
  })

  it('left no dead translation behind, in any language', () => {
    for (const [lang, dict] of Object.entries(LOCALES)) {
      expect(dict.case.extractionStatusTitle, lang).toBeUndefined()
      expect(dict.case.extractionStatusHelp, lang).toBeUndefined()
      expect(dict.case.extractionStatusEmpty, lang).toBeUndefined()
    }
  })

  it('still exists where it belongs — inside Tax Summary', () => {
    // The status was not deleted from the product, only from the case page:
    // every document row of Tax Summary shows it.
    expect(taxSummary).toMatch(/<SummaryDocument/)
    expect(summaryDocument).toMatch(/STATUS_LABEL_KEY/)
    expect(en.extraction.statusExtracted).toBeTruthy()
  })
})

describe('the assistant opened from the case page is the same conversation as the one in Tax Summary', () => {
  it('is the same component, mounted on the same case id, with no page-specific scope', () => {
    const mountIn = (source) => source.match(/<CaseAssistant[\s\S]*?\/>/)?.[0]
    const onCasePage = mountIn(casePage)
    const inTaxSummary = mountIn(taxSummary)

    expect(onCasePage).toBeTruthy()
    expect(inTaxSummary).toBeTruthy()
    // Same identity on both: the case, and nothing else that could split
    // the history in two (a surface/scope/storage-key prop).
    expect(onCasePage).toMatch(/caseId=\{caseId\}/)
    expect(inTaxSummary).toMatch(/caseId=\{caseId\}/)
    for (const mount of [onCasePage, inTaxSummary]) {
      expect(mount).not.toMatch(/\b(surface|scope|storageKey|conversationId|threadId)=/)
    }
  })

  it('reads its history from the case alone — nothing about which page it was opened from', () => {
    expect(caseAssistant).toMatch(/api\s*\n?\s*\.listCaseAssistantMessages\(caseId\)|listCaseAssistantMessages\(caseId\)/)
    expect(caseAssistant).toMatch(/askCaseAssistant\(caseId,/)
    // No local persistence that could diverge between the two pages.
    expect(caseAssistant).not.toMatch(/localStorage|sessionStorage/)
  })

  it('still lets a document reference be opened from the case page, which has no viewer of its own', () => {
    // It hands off to Tax Summary with that document already open
    // (?doc=<id>, plus the page and sentence when it points at a value)
    // rather than rendering a dead badge.
    expect(casePage).toMatch(/summaryLinkFor\(caseId/)
    expect(taxSummary).toMatch(/searchParams\.get\('doc'\)/)
    expect(taxSummary).toMatch(/searchParams\.get\('page'\)/)
    expect(taxSummary).toMatch(/searchParams\.get\('quote'\)/)
  })
})

describe('the rest of the case page is untouched', () => {
  it('still has the Tax Summary button, the fee estimate and the staff area', () => {
    expect(casePage).toMatch(/case\.taxSummary/)
    expect(casePage).toMatch(/<FeeEstimatePanel/)
    expect(casePage).toMatch(/case\.staffArea/)
    expect(casePage).toMatch(/case\.internalNotes/)
  })
})

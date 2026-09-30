// The case pages are one page seen by two people. Headings and status
// sentences written from the client's point of view ("I tuoi documenti",
// "La tua dichiarazione è in preparazione") were also shown to the
// specialist consulting someone else's file. src/lib/viewerCopy.js maps
// the viewer's role to the i18n key to use; this test pins both sides of
// that mapping and — more importantly — that both sides actually exist,
// in all four languages. A staff key added to en.js only would otherwise
// show a German-speaking specialist the raw key name, which no build step
// catches.
import { describe, expect, it } from 'vitest'
import { CLIENT_COPY, STAFF_COPY, VIEWER_COPY_SLOTS, viewerCopy } from '../src/lib/viewerCopy.js'
import { CASE_STATUSES } from '../src/lib/constants.js'
import en from '../src/i18n/en.js'
import de from '../src/i18n/de.js'
import fr from '../src/i18n/fr.js'
// Aliased: a bare `it` would shadow vitest's own `it`.
import itLocale from '../src/i18n/it.js'

const LOCALES = { en, de, fr, it: itLocale }

// Same dotted lookup the i18n provider does, minus the interpolation.
function lookup(dict, path) {
  return path.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict)
}

describe('viewerCopy', () => {
  it('gives the client the "your documents" heading and the specialist the "client documents" one', () => {
    expect(viewerCopy(false).caseDocumentsTitle).toBe('case.yourDocuments')
    expect(viewerCopy(true).caseDocumentsTitle).toBe('case.clientDocuments')

    // The actual wording Lorenzo asked for, in the app's primary language.
    expect(lookup(itLocale, viewerCopy(false).caseDocumentsTitle)).toBe('I tuoi documenti')
    expect(lookup(itLocale, viewerCopy(true).caseDocumentsTitle)).toBe('I documenti del cliente')
  })

  it('never speaks to the specialist as if the file were their own, for any status', () => {
    for (const status of CASE_STATUSES) {
      const clientText = lookup(en, `${viewerCopy(false).statusDescPrefix}.${status}`)
      const staffText = lookup(en, `${viewerCopy(true).statusDescPrefix}.${status}`)
      expect(clientText, status).toBeTruthy()
      expect(staffText, status).toBeTruthy()
      expect(staffText, status).not.toBe(clientText)
      expect(staffText.toLowerCase(), status).not.toMatch(/\byour\b/)
    }
  })

  it('resolves every role-dependent slot in every language, on both sides', () => {
    const missing = []
    for (const [lang, dict] of Object.entries(LOCALES)) {
      for (const slot of VIEWER_COPY_SLOTS) {
        for (const [role, table] of [['client', CLIENT_COPY], ['staff', STAFF_COPY]]) {
          const path = table[slot]
          // statusDescPrefix is a prefix, not a key of its own.
          const paths = slot === 'statusDescPrefix'
            ? CASE_STATUSES.map((s) => `${path}.${s}`)
            : [path]
          for (const p of paths) {
            if (typeof lookup(dict, p) !== 'string') missing.push(`${lang}: ${p} (${role})`)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps the two tables parallel — a slot added on one side only would silently fall back to the client wording', () => {
    expect(Object.keys(STAFF_COPY).sort()).toEqual(Object.keys(CLIENT_COPY).sort())
    for (const slot of VIEWER_COPY_SLOTS) {
      expect(STAFF_COPY[slot], slot).not.toBe(CLIENT_COPY[slot])
    }
  })

  it('actually says something different to the two roles in every language — not a copy-pasted key', () => {
    for (const [lang, dict] of Object.entries(LOCALES)) {
      for (const slot of VIEWER_COPY_SLOTS) {
        if (slot === 'statusDescPrefix') continue
        expect(
          lookup(dict, STAFF_COPY[slot]),
          `${lang}.${slot}`
        ).not.toBe(lookup(dict, CLIENT_COPY[slot]))
      }
    }
  })
})

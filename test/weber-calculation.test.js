// Regression suite for the tax calculation engine, built directly on the
// Weber client's real, specialist-reviewed data (see
// test/fixtures/weber-2025.json and scripts/export-weber-fixture.mjs) — no
// live database, no AI call. Every assertion here is something a
// professional reviewer has already confirmed correct about this exact
// case; a change that breaks one of these either broke something real, or
// the fixture is stale and needs re-exporting — never "fix" a failure here
// by loosening the assertion to match new code output.
import { describe, expect, it } from 'vitest'
import { computeTaxAggregate, resolveAggregateStatus } from '../src/lib/taxCalculation.js'
import fixture from './fixtures/weber-2025.json' with { type: 'json' }

// computeTaxAggregate's components carry a documentId and fieldKey, but not
// the category code itself (that's only on the input documents) — so tests
// resolve "which document" through the fixture's own document list, by
// category or by a distinctive part of the file name.
function docByCategory(categoryCode) {
  return fixture.documents.find((d) => d.category_code === categoryCode)
}
function docByFilePart(part) {
  return fixture.documents.find((d) => d.file_name.toLowerCase().includes(part.toLowerCase()))
}
function componentsFor(components, doc) {
  return components.filter((c) => c.documentId === doc?.id)
}
function componentFor(components, doc, fieldKey) {
  return components.find((c) => c.documentId === doc?.id && c.fieldKey === fieldKey)
}

function runWeber(overrides = {}) {
  return computeTaxAggregate({
    canton: fixture.client.canton,
    documents: fixture.documents,
    extractedFields: fixture.extractedFields,
    rules: fixture.rules,
    fieldDefs: fixture.fieldDefs,
    categories: fixture.categories,
    parameters: fixture.parameters,
    taxYear: fixture.taxYear,
    primaryPerson: fixture.primaryPerson,
    spousePerson: fixture.spousePerson,
    children: fixture.children,
    lang: 'en',
    ...overrides
  })
}

describe('Weber 2025 — golden case', () => {
  const result = runWeber()
  const { components } = result

  it('childcare (custodia) is deducted exactly once, at CHF 8\'400 net of the subsidy, under the cap', () => {
    const doc = docByCategory('childcare_costs')
    const childcareEntries = componentsFor(components, doc)
    // The invoice's raw annual_amount (10'200) nets against subsidy_amount
    // (1'800) to 8'400; a second, redundant "annual_amount_2" occurrence on
    // the same document (childcare_costs.annual_amount is deliberately NOT
    // a repeatable field, precisely to prevent this) must never turn into a
    // second deduction.
    expect(childcareEntries).toHaveLength(1)
    const [entry] = childcareEntries
    expect(entry.fieldKey).toBe('annual_amount')
    expect(entry.amount).toBe(8400)
    expect(entry.needsVerification).toBe(false)
  })

  it('the pure donation (CHF 420, Fondazione Aiuto Alpino) is included; the membership fee with a consideration (CHF 150, Associazione culturale Art et Valais) is excluded', () => {
    const doc = docByCategory('donation_certificate')
    const pure = componentFor(components, doc, 'annual_amount')
    const withConsideration = componentFor(components, doc, 'annual_amount_2')

    expect(pure).toBeTruthy()
    expect(pure.amount).toBe(420)
    expect(pure.needsVerification).toBe(false)
    expect(pure.sourceLabel).toContain('Fondazione Aiuto Alpino')

    expect(withConsideration).toBeTruthy()
    expect(withConsideration.needsVerification).toBe(true)
    expect(withConsideration.sourceLabel).toContain('Associazione culturale Art et Valais')
  })

  it('the LPP buy-in (CHF 5\'240) is flagged "needs verification" (possible double deduction) and not applied', () => {
    const doc = docByCategory('pension_buyback')
    const buyback = componentFor(components, doc, 'annual_amount')
    expect(buyback).toBeTruthy()
    expect(buyback.needsVerification).toBe(true)
    expect(buyback.amount).toBe(5240) // the raw amount it WOULD contribute, shown for review — not counted in totals
  })

  it('both mortgages are present (Sion 435\'000/7\'490, Martigny 265\'000/4\'590); amortization is never deducted', () => {
    const doc = docByCategory('debt_certificate')
    const sionBalance = componentFor(components, doc, 'debt_balance')
    const sionInterest = componentFor(components, doc, 'annual_interest_paid')
    const martignyBalance = componentFor(components, doc, 'debt_balance_2')
    const martignyInterest = componentFor(components, doc, 'annual_interest_paid_2')

    expect(sionBalance?.amount).toBe(435000)
    expect(sionInterest?.amount).toBe(7490)
    expect(martignyBalance?.amount).toBe(265000)
    expect(martignyInterest?.amount).toBe(4590)

    const amortizationEntries = componentsFor(components, doc).filter((c) => c.fieldKey?.startsWith('annual_amortization'))
    expect(amortizationEntries).toHaveLength(0)
  })

  it('the wealth exemption is CHF 90\'000 (married, VS) — never a silent 45\'000, and never missing while marital status is known', () => {
    const exemption = components.find((c) => c.fieldLabel?.includes('Net wealth exempt amount'))
    expect(exemption).toBeTruthy()
    expect(exemption.amount).toBe(90000)
    expect(exemption.needsVerification).toBeFalsy()
    expect(components.some((c) => c.amount === 45000 && c.fieldLabel?.includes('exempt'))).toBe(false)
  })

  it('two 3a payments, two dividends, and three USD account balances are all captured as separate components, and the foreign-currency ones are excluded pending conversion', () => {
    const pillar3aDoc = docByCategory('pillar_3a_certificate')
    const pillar3a = componentsFor(components, pillar3aDoc).filter((c) => c.fieldKey?.startsWith('annual_contribution'))
    expect(pillar3a).toHaveLength(2)
    expect(pillar3a.map((c) => c.amount).sort((a, b) => a - b)).toEqual([6000, 7258])

    const usdDocId = fixture.extractedFields.find((f) => f.field_key === 'currency' && f.field_value === 'USD')?.document_id
    expect(usdDocId).toBeTruthy()

    const dividends = components.filter((c) => c.documentId === usdDocId && c.fieldKey?.startsWith('dividend_income'))
    expect(dividends).toHaveLength(2)
    expect(dividends.every((c) => c.needsVerification && c.currencyCode === 'USD')).toBe(true)

    const usdBalances = components.filter((c) => c.documentId === usdDocId && c.fieldKey?.startsWith('account_balance_31_12'))
    expect(usdBalances).toHaveLength(3)
    expect(usdBalances.every((c) => c.needsVerification && c.currencyCode === 'USD')).toBe(true)
  })

  it('the aggregate is NOT ready_for_simulation while the USD components above are still unresolved', () => {
    const status = resolveAggregateStatus({ documentsStillProcessing: false, components })
    expect(status).toBe('draft')
  })

  it('administration and maintenance costs for Martigny are never both summed — same CHF 600 flagged on both, not double-counted', () => {
    const martignyDoc = docByFilePart('martigny')
    const otherMaintenanceDoc = docByFilePart('fatture_manutenzione')

    const admin = componentFor(components, martignyDoc, 'administration_costs')
    const martignyMaintenance = componentFor(components, martignyDoc, 'maintenance_costs')
    expect(admin).toBeTruthy()
    expect(admin.needsVerification).toBe(true)
    expect(martignyMaintenance).toBeTruthy()
    expect(martignyMaintenance.needsVerification).toBe(true)

    // A genuinely distinct maintenance_costs on a DIFFERENT document (CHF
    // 4'550, no administration_costs sibling on that same document) must
    // NOT be caught by the same guard.
    const otherMaintenance = componentFor(components, otherMaintenanceDoc, 'maintenance_costs')
    expect(otherMaintenance).toBeTruthy()
    expect(otherMaintenance.amount).toBe(4550)
    expect(otherMaintenance.needsVerification).toBe(false)
  })

  it('Martigny rental income includes the ancillary income (16\'800 + 1\'440)', () => {
    const martignyDoc = docByFilePart('martigny')
    const rent = componentFor(components, martignyDoc, 'annual_rental_income')
    const ancillary = componentFor(components, martignyDoc, 'annual_ancillary_income')
    expect(rent?.amount).toBe(16800)
    expect(ancillary?.amount).toBe(1440)
  })

  it('bonus: Lina\'s own bank account/interest (CHF 5\'980.20 / CHF 18.20) is captured distinctly from the joint account', () => {
    const chfDoc = docByFilePart('attestazione_banca_conti')
    const balances = componentsFor(components, chfDoc).filter((c) => c.fieldKey?.startsWith('account_balance_31_12') && !c.needsVerification)
    const interests = componentsFor(components, chfDoc).filter((c) => c.fieldKey?.startsWith('interest_income'))
    expect(balances.some((c) => c.amount === 5980)).toBe(true) // rounded to whole CHF
    expect(interests.some((c) => c.amount === 18)).toBe(true)
  })
})

describe('Weber 2025 — wealth exemption edge cases', () => {
  it('flags "needs verification" (never silently 45\'000) when the primary person is entirely missing', () => {
    const result = runWeber({ primaryPerson: null })
    const exemption = result.components.find((c) => c.fieldLabel?.includes('exempt'))
    expect(exemption).toBeTruthy()
    expect(exemption.needsVerification).toBe(true)
    expect(exemption.amount).toBe(0)
  })
})

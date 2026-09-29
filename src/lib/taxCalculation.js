// The tax calculation engine — a pure function with no I/O, shared between
// api/calculate-aggregates.js (real Supabase data, server-side) and the demo
// data layer (in-memory data, browser), so the actual math is never
// duplicated between the two. No import.meta.env / Vite-only syntax here —
// this file is imported directly from a plain Node ESM serverless function.
import { baseFieldKey, fieldSuffix } from './repeatableFields.js'

const CONTRIBUTION_TO_COMPONENT = {
  income_plus: 'income',
  income_minus: 'deduction',
  wealth_plus: 'wealth',
  wealth_minus: 'debt'
}

// The one family whose cap isn't a plain ceiling — it's the client's
// wealth-derived income for the year, plus the parameter's own amount.
const DEBT_INTEREST_FAMILY = 'debt_interest_extra_allowance'
// The one percentage-type family that's a floor (only the excess over the
// threshold is deductible), not a ceiling. Every other percentage-type
// family is treated as a plain cap at that percentage.
const MEDICAL_THRESHOLD_FAMILY = 'medical_costs_threshold_pct'
const DONATION_CAP_FAMILY = 'donation_cap_pct'
const DONATION_MIN_FAMILY = 'donation_min_amount'
// Not a real tax_parameters family on its own — a marker the pooling
// pre-pass recognizes; the actual cap is resolved dynamically from marital
// status + qualifying-children count (see resolveInsurancePremiumCap).
const INSURANCE_POOL_FAMILY = 'insurance_premium_pool'
// Not a real tax_parameters family on its own — a marker the pillar-3a
// pre-pass recognizes; the actual federal cap depends on whether the
// person has an occupational pension fund (2nd pillar) tied to their
// employment, resolved dynamically below (see the pre-pass right after
// insurance pooling), the same reasoning as INSURANCE_POOL_FAMILY.
const PILLAR_3A_FAMILY = 'pillar_3a_dynamic'

// A handful of fields need to look at a sibling field on the SAME document
// before they can be turned into a plain amount — same "special-cased by
// name" style as the family constants above, kept as small explicit maps
// rather than new generic schema for what only a few fields need.

// Deductible cost = the field's own amount minus the paired field (e.g.
// medical costs net of the insurance reimbursement) — never negative.
const NETS_AGAINST = {
  'medical_costs:total_amount': 'insurance_reimbursement',
  'childcare_costs:annual_amount': 'subsidy_amount'
}

// The field is excluded (not a real deduction) when the paired field is
// affirmative — e.g. a "membership fee" isn't a pure donation once the
// document indicates a consideration/benefit was received in exchange, and
// a commute deduction doesn't apply when the employer already provides free
// transport (Lohnausweis code F).
const VOID_IF_TRUTHY = {
  'donation_certificate:annual_amount': {
    siblingKey: 'has_consideration',
    note: 'not deductible — the document indicates a consideration/benefit was received, not a pure donation'
  },
  'salary_statement:annual_commute_cost': {
    siblingKey: 'code_f_present',
    note: 'not deductible — the employer already provides free commute (Lohnausweis code F)'
  }
}
const AFFIRMATIVE_VALUES = new Set(['yes', 'sì', 'si', 'ja', 'oui', 'true', '1', 'x'])

// The field's cap is halved when the paired field is affirmative — extra
// meal costs are only deductible at half the usual rate once the employer
// already subsidizes meals (Lohnausweis code G).
const HALVE_CAP_IF_TRUTHY = {
  'salary_statement:annual_meal_costs': 'code_g_present'
}

// Alimony is only deductible (payer) / taxable (recipient) while the
// beneficiary is a minor child — an ex-spouse has no such cutoff.
const ALIMONY_CHILD_CUTOFF_KEYS = new Set(['alimony_paid:annual_amount', 'alimony_received:annual_amount'])
const CHILD_BENEFICIARY_VALUES = new Set(['child', 'children', 'figlio', 'figli', 'kind', 'kinder', 'enfant', 'enfants'])

// A document that itemizes both fields legitimately can still leave the
// extraction unsure which one a single line item actually belongs to
// (nothing about the document forces a choice) — the same amount landing
// under BOTH is the tell that one real expense was read twice, not that two
// real deductions exist. Neither field is trusted to be "the right one"
// automatically: both are flagged for the specialist to resolve by picking
// the one the document actually supports, rather than silently
// double-counting or silently guessing which single field to keep.
const MUTUALLY_EXCLUSIVE_IF_EQUAL = {
  'property_tax_value:maintenance_costs': 'administration_costs',
  'property_tax_value:administration_costs': 'maintenance_costs'
}

// See step 7 in the main loop below — a voluntary pension buy-in flagged
// for manual double-deduction verification against the salary statement.
const PENSION_BUYBACK_RULE_KEY = 'pension_buyback:annual_amount'

// Categories whose amount is always shown, but never counted in the ordinary
// calculation — either because Swiss law taxes it separately (pension
// capital withdrawals, inheritances/gifts, real-estate sale gains) or
// because this app has no reliable way to compute the figure it would need
// (a vehicle's cantonally-depreciated value).
const ALWAYS_FLAGGED_CATEGORIES = {
  pension_capital_withdrawal: 'separately taxed — not included in the ordinary income/wealth calculation',
  inheritance_gift_lpp_payment: 'separately taxed — not included in the ordinary income/wealth calculation',
  property_sale: 'separately taxed — not included in the ordinary income/wealth calculation',
  private_vehicle: 'purchase price shown for reference only — no cantonal depreciation schedule implemented, verify the current value manually'
}

// Categories whose monetary fields are only trustworthy in CHF — a sibling
// "currency" field that says otherwise excludes every numeric field on that
// document rather than silently summing a foreign-currency figure as if it
// were francs.
const CURRENCY_FIELD_BY_CATEGORY = {
  bank_securities_crypto_statement: 'currency'
}
const CHF_ALIASES = new Set(['CHF', 'SFR'])

const MARRIED_STATUSES = new Set(['married', 'registered_partnership'])

function isAffirmative(value) {
  return AFFIRMATIVE_VALUES.has(String(value || '').trim().toLowerCase())
}

function isChfOrUnspecified(value) {
  const v = String(value || '').trim().toUpperCase()
  return !v || CHF_ALIASES.has(v)
}

// The AI extraction is inconsistent about whether a currency amount field
// comes back as a bare number ("15000.00") or with the currency written
// into the same string ("CHF 15 000.00", "15'000.00 CHF", ...) — the
// original Weber/Sara test cases show both forms for the same kind of
// field on different documents. Letters are stripped wherever they fall in
// the string (prefix or suffix) rather than assuming one position, so a
// real amount is never silently dropped (and dropped without any visible
// trace — see `warnings` below) just because a currency code was inlined.
function parseAmount(value) {
  if (value == null) return null
  const cleaned = String(value)
    .trim()
    .replace(/[a-zA-Z]+/g, '')
    .replace(/['’\s]/g, '')
    .replace(/,/g, '')
    .trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function categoryLabel(category, lang) {
  if (!category) return ''
  return category[`label_${lang}`] || category.label_en || category.code
}

// Which "how this was calculated" section a component belongs to — driven
// by what the field actually contributes to, NOT by the document category
// it happens to come from. A debt certificate's balance (wealth_minus)
// belongs in Wealth even though the debt_certificate category itself is
// filed under the Deductions group on screen (its annual_interest_paid
// field IS an income deduction); a property's imputed rental value/
// maintenance costs (income_plus/income_minus) belong in Income/Deductions
// even though property_tax_value is filed under the Wealth group. Mixing
// these up is exactly what breaks traceability between the totals above
// and the rows listed below.
const CONTRIBUTION_TO_SECTION = {
  income_plus: 'income',
  income_minus: 'deductions',
  wealth_plus: 'wealth',
  wealth_minus: 'wealth'
}

function findParam(parameters, family, cantonCode) {
  if (!family) return null
  if (cantonCode) {
    const cantonal = parameters.find(
      (p) => p.parameter_family === family && p.scope === 'cantonal' && p.canton_code === cantonCode
    )
    if (cantonal) return cantonal
  }
  return parameters.find((p) => p.parameter_family === family && p.scope === 'federal') || null
}

export function isMarriedHousehold(primaryPerson, spousePerson) {
  const hasSpouse = Boolean(
    spousePerson && (spousePerson.first_name || spousePerson.last_name || spousePerson.date_of_birth)
  )
  return MARRIED_STATUSES.has(primaryPerson?.marital_status) || hasSpouse
}

// A child's age as of 31.12 of the tax year, and which VS deduction bracket
// (0-6 / 6-16 / 16+ in training) that puts them in. A child past 16 only
// still counts if `until_when` (free text from the questionnaire, e.g. an
// expected graduation year) indicates they're still in education during the
// tax year — parsed leniently for a 4-digit year; if that can't be
// determined at all, the child is still surfaced (flagged) rather than
// silently dropped, since a real deduction may well still apply.
function resolveChild(child, taxYear) {
  if (!child?.date_of_birth) return null
  const birthYear = new Date(child.date_of_birth).getFullYear()
  if (!Number.isFinite(birthYear)) return null
  const age = taxYear - birthYear
  if (age < 0) return null

  if (age <= 6) return { bracket: '0_6', uncertain: false }
  if (age <= 16) return { bracket: '6_16', uncertain: false }

  const yearMatch = String(child.until_when || '').match(/\b(20\d{2})\b/)
  if (yearMatch) {
    const untilYear = Number(yearMatch[1])
    return untilYear >= taxYear ? { bracket: '16_plus', uncertain: false } : null
  }
  // Over 16 with no parseable "until when" — can't confirm training status.
  return { bracket: '16_plus', uncertain: true }
}

// Cantons where a deduction this app models everywhere else is actually a
// tax CREDIT (applied to the final tax bill, not the taxable base) — never
// added as an income_minus entry there; a warning is pushed instead, same
// treatment for each such canton/deduction pair.
const CHILD_CREDIT_NOT_DEDUCTION_CANTONS = new Set(['BL'])
const MARRIED_CREDIT_NOT_DEDUCTION_CANTONS = new Set(['VS'])
// Confirmed (not just "no cantonal override found") to have no such
// deduction at all — the generic advisory entry is skipped outright rather
// than shown as if it might still apply.
const NO_TWO_INCOME_DEDUCTION_CANTONS = new Set(['TG'])

const CHILD_BRACKET_FAMILY = {
  '0_6': 'child_deduction_0_6',
  '6_16': 'child_deduction_6_16',
  '16_plus': 'child_deduction_16_plus'
}

// A parameter row flagged uncertain by an earlier round's "da confermare"
// convention — free text on tax_parameters.notes, not a dedicated column.
// Reused here rather than adding a second, parallel uncertainty flag.
const UNCERTAIN_PARAM_PATTERN = /da confermare/i

function resolveInsurancePremiumCap(isMarried, qualifyingChildCount, useParam) {
  const baseParam = useParam(isMarried ? 'insurance_premium_cap_married' : 'insurance_premium_cap_single')
  if (!baseParam) return null
  const incrementParam = qualifyingChildCount > 0 ? useParam('insurance_premium_child_increment') : null
  const cap = (baseParam.value_numeric || 0) + qualifyingChildCount * (incrementParam?.value_numeric || 0)
  return { cap, baseParam }
}

function makeSyntheticEntry({
  contributionType, rawAmount, categoryLabel, fieldLabel, note, needsVerification, groupKey, documentId, fileName
}) {
  return {
    documentId: documentId || null,
    fileName: fileName || null,
    categoryCode: null,
    categoryLabel,
    groupKey: groupKey || null,
    fieldKey: null,
    fieldLabel,
    contributionType,
    capFamily: null,
    verifiedBySpecialist: false,
    rawAmount,
    effective: needsVerification ? 0 : rawAmount,
    note: note || null,
    needsVerification: Boolean(needsVerification),
    decision: null,
    currencyCode: null,
    deferred: false,
    isManual: false,
    manualEntryId: null
  }
}

// A manual "how this was calculated" row a specialist typed in directly —
// no underlying extracted field at all. Always counts (subject to the same
// rounding as everything else), independent of any recalculation — loaded
// fresh from tax_manual_aggregate_entries every time, never recreated or
// guessed at, since these are the specialist's own numbers, not derived
// from a document.
const MANUAL_CONTRIBUTION_BY_COMPONENT_TYPE = {
  income: 'income_plus',
  deduction: 'income_minus',
  wealth: 'wealth_plus',
  debt: 'wealth_minus'
}

function makeManualEntry(row) {
  const contributionType = MANUAL_CONTRIBUTION_BY_COMPONENT_TYPE[row.component_type]
  if (!contributionType) return null
  const amount = Number(row.amount)
  if (!Number.isFinite(amount)) return null
  return {
    documentId: null,
    fileName: null,
    categoryCode: null,
    categoryLabel: null,
    groupKey: CONTRIBUTION_TO_SECTION[contributionType] || null,
    fieldKey: null,
    fieldLabel: row.description,
    contributionType,
    capFamily: null,
    verifiedBySpecialist: true,
    rawAmount: amount,
    effective: amount,
    note: row.note || null,
    needsVerification: false,
    decision: null,
    currencyCode: null,
    deferred: false,
    isManual: true,
    manualEntryId: row.id
  }
}


// documents: client_documents rows (id, category_code, file_name), already
//   scoped to one client/tax_year and to only the categorized ones.
// extractedFields: extracted_document_fields rows for those documents.
// rules: the full field_calculation_rules table.
// fieldDefs: the full category_field_definitions table (for field_label).
// categories: the full document_categories table (for group_key + labels).
// parameters: tax_parameters rows already filtered to the target tax_year.
// canton: the resolved canton code, or null if genuinely unknown.
// taxYear: the tax year being computed (needed to age children as of 31.12).
// primaryPerson/spousePerson: client_persons rows (or null/undefined).
// children: client_children rows for this client (or empty/undefined).
// fieldDecisions: tax_field_decisions rows for this client/tax_year (or
//   empty/undefined) — a specialist's explicit include/exclude call on a
//   flagged field, applied only while its decided_amount still matches.
// manualEntries: tax_manual_aggregate_entries rows for this client/tax_year
//   (or empty/undefined) — specialist-added rows with no underlying
//   extracted field, always counted.
export function computeTaxAggregate({
  canton,
  documents,
  extractedFields,
  rules,
  fieldDefs,
  categories,
  parameters,
  taxYear,
  primaryPerson,
  spousePerson,
  children,
  fieldDecisions,
  manualEntries,
  lang = 'en'
}) {
  const categoryByCode = Object.fromEntries((categories || []).map((c) => [c.code, c]))
  const documentById = Object.fromEntries((documents || []).map((d) => [d.id, d]))
  const ruleByKey = Object.fromEntries((rules || []).map((r) => [`${r.category_code}:${r.field_key}`, r]))
  const fieldLabelByKey = Object.fromEntries(
    (fieldDefs || []).map((f) => [`${f.category_code}:${f.field_key}`, f.field_label])
  )
  // A specialist's explicit include/exclude call on one field (see
  // tax_field_decisions) — ignored if `decided_amount` no longer matches
  // the field's current raw amount (the document changed since the
  // decision was made), so a stale human call never silently keeps
  // overriding a figure that isn't the one it was actually made about.
  const decisionByKey = Object.fromEntries(
    (fieldDecisions || []).map((d) => [`${d.document_id}:${d.field_key}`, d])
  )

  // Two occurrences of the SAME repeatable field on the SAME document,
  // with IDENTICAL source text, are the AI reading one line twice under
  // two different occurrence suffixes — not two real entries (see the
  // "Account balance (31.12)" duplicate this caught in the Weber case:
  // occurrences 1 and 3 both quoted "Cash USD at 31 Dec USD 1 240.00").
  // Flagged (both), never silently summed as if they were distinct;
  // resolved the same way as any other needs-verification field, via a
  // decision.
  const duplicateSourceFieldKeys = new Set()
  {
    const bySignatureGroup = new Map()
    for (const field of extractedFields || []) {
      if (field.included_in_calculation === false) continue
      const doc = documentById[field.document_id]
      if (!doc || !doc.category_code) continue
      const quote = (field.source_quote || '').trim().toLowerCase()
      if (!quote) continue
      const groupKey = `${doc.id}:${baseFieldKey(doc.category_code, field.field_key)}:${quote}`
      if (!bySignatureGroup.has(groupKey)) bySignatureGroup.set(groupKey, [])
      bySignatureGroup.get(groupKey).push(field)
    }
    for (const group of bySignatureGroup.values()) {
      if (group.length < 2) continue
      for (const field of group) duplicateSourceFieldKeys.add(`${field.document_id}:${field.field_key}`)
    }
  }

  // An imputed rental value (owner-occupied) and an actual rental income
  // (rented out) are mutually exclusive ways of taxing the SAME property —
  // Swiss tax law taxes the real rent once a property is rented, never the
  // imputed value on top of it. Documents for the same client/year don't
  // reliably state which property they're each about (a rental statement
  // may carry no address at all), so this can't be resolved by matching
  // addresses across documents — flagged whenever a client/year has ANY
  // nonzero imputed_rental_value AND ANY nonzero annual_rental_income among
  // their property_tax_value documents, for the specialist to confirm
  // rather than silently taxing both.
  const hasNonzeroPropertyField = (fieldKey) =>
    (extractedFields || []).some((f) => {
      if (f.included_in_calculation === false) return false
      const doc = documentById[f.document_id]
      if (!doc || doc.category_code !== 'property_tax_value') return false
      if (baseFieldKey('property_tax_value', f.field_key) !== fieldKey) return false
      const amount = parseAmount(f.field_value)
      return amount != null && amount !== 0
    })
  const imputedVsActualRentalConflict =
    hasNonzeroPropertyField('imputed_rental_value') && hasNonzeroPropertyField('annual_rental_income')

  // A document's "identifier" for readable labels — the first
  // *_name/*_organization field found for it (e.g. an employer or
  // institution name), falling back to the file name. Generic on purpose:
  // no per-category hardcoding of which field is the "interesting" one.
  //
  // Keyed by occurrence suffix too, not just document id: a repeatable
  // document (several donations, each with its own recipient_organization/
  // recipient_organization_2/...) has a DIFFERENT identifier per entry —
  // using whichever name field happened to be found first for the whole
  // document, regardless of which donation it actually named, is exactly
  // what mismatched a donation's amount to another donation's organization
  // the first time repeated entries shipped.
  const identifierByDocId = {}
  for (const doc of documents || []) {
    const nameFields = (extractedFields || []).filter(
      (f) =>
        f.document_id === doc.id &&
        f.included_in_calculation !== false &&
        /_(name|organization)$/.test(baseFieldKey(doc.category_code, f.field_key)) &&
        f.field_value
    )
    const bySuffix = {}
    for (const nf of nameFields) {
      const key = fieldSuffix(doc.category_code, nf.field_key)
      if (!(key in bySuffix)) bySuffix[key] = nf.field_value
    }
    identifierByDocId[doc.id] = bySuffix
  }

  // For the sibling-field lookups below (net-of-reimbursement, voided-by,
  // currency, F/G codes) — keyed the same way regardless of whether the
  // companion field itself has a contribution_type (most don't; they're
  // purely informational on their own).
  const fieldByDocAndKey = Object.fromEntries(
    (extractedFields || []).map((f) => [`${f.document_id}:${f.field_key}`, f.field_value])
  )
  const siblingValue = (documentId, fieldKey) => fieldByDocAndKey[`${documentId}:${fieldKey}`]

  const warnings = []
  const entries = []

  // Every tax_parameters row actually used to resolve this calculation,
  // deduped by id — read at the end to surface the ones flagged "da
  // confermare", for the proactive "things to verify" popup. canton is
  // always the resolved outer value here, never a different one, so the
  // wrapper only needs the family name.
  const uncertainParamsById = new Map()
  const useParam = (family) => {
    const param = findParam(parameters, family, canton)
    if (param && UNCERTAIN_PARAM_PATTERN.test(param.notes || '')) {
      uncertainParamsById.set(param.id, param)
    }
    return param
  }

  // Extracted values feed the calculation as soon as they exist — there is
  // no "confirmed by the specialist" gate. The specialist can still
  // exclude a field (included_in_calculation) or correct/add a value at
  // any time; verified_by_specialist is only read for the missing-cap-
  // parameter override below.
  for (const field of extractedFields || []) {
    if (field.included_in_calculation === false) continue
    if (!field.field_value || !field.field_value.trim()) continue
    const doc = documentById[field.document_id]
    if (!doc || !doc.category_code) continue
    // A repeated occurrence ("annual_amount_2") shares its base field's
    // rule/label — never has one of its own — and its own sibling fields
    // (e.g. donation #2's own has_consideration, not donation #1's) carry
    // the same suffix, looked up via siblingValueFor() below instead of
    // siblingValue() directly wherever a sibling lookup depends on which
    // occurrence this is.
    const baseKey = baseFieldKey(doc.category_code, field.field_key)
    const suffix = fieldSuffix(doc.category_code, field.field_key)
    const siblingValueFor = (fieldKey) => siblingValue(doc.id, fieldKey + suffix)
    const rule = ruleByKey[`${doc.category_code}:${baseKey}`]
    if (!rule || rule.contribution_type === 'none') continue

    let rawAmount = parseAmount(field.field_value)
    if (rawAmount == null) {
      warnings.push(`"${field.field_key}" in "${doc.file_name}" is not a number and was skipped.`)
      continue
    }

    // Snapshotted BEFORE netting (below) — the plain number as extracted,
    // which is what a specialist making a decision actually looked at.
    const initialRawAmount = rawAmount
    const decisionRow = decisionByKey[`${field.document_id}:${field.field_key}`]
    const decisionFresh =
      decisionRow && Number.isFinite(Number(decisionRow.decided_amount)) &&
      Math.abs(Number(decisionRow.decided_amount) - initialRawAmount) < 0.005
    // A decision whose snapshot no longer matches (the document was
    // re-extracted/corrected with a materially different amount since it
    // was made) is ignored outright — the field reverts to ordinary
    // needs-verification logic below, exactly as if no decision existed.
    const excludeDecision = decisionFresh && decisionRow.decision === 'exclude'
    // Never lets a blanket "include" bypass the foreign-currency check
    // (5) below — only actual conversion, or excluding the field, resolves
    // that one; every other judgment-call check (1, 3, 4, 6, 7, 8, the
    // duplicate-source check) can be overridden by an "include" decision.
    const includeOverride = decisionFresh && decisionRow.decision === 'include'

    const ruleKey = `${doc.category_code}:${baseKey}`
    let needsVerification = false
    let note = null
    let decision = null
    let currencyCode = null

    if (excludeDecision) {
      decision = 'exclude'
      note = decisionRow.note || 'excluded — specialist decision'
    } else {
      // 1. Categories that are always shown but never counted (separate
      // taxation, or a figure this app can't reliably compute) — a
      // structural/legal reason, not a judgment call, so unlike the checks
      // below an "include" decision can never bypass this one (an
      // "exclude" decision is still fine — it's a no-op either way, since
      // neither state ever counts these in the total).
      if (ALWAYS_FLAGGED_CATEGORIES[doc.category_code]) {
        needsVerification = true
        note = ALWAYS_FLAGGED_CATEGORIES[doc.category_code]
      }

      // 2. Net against a sibling field (e.g. medical costs net of
      // reimbursement) — computed regardless, it's part of the raw amount.
      const netsAgainstKey = NETS_AGAINST[ruleKey]
      if (netsAgainstKey) {
        const reimbursement = parseAmount(siblingValueFor(netsAgainstKey)) || 0
        rawAmount = Math.max(0, rawAmount - reimbursement)
      }

      // 3. Voided by a sibling flag (donation with consideration, commute
      // with employer-provided free transport).
      if (!needsVerification && !includeOverride) {
        const voidRule = VOID_IF_TRUTHY[ruleKey]
        if (voidRule && isAffirmative(siblingValueFor(voidRule.siblingKey))) {
          needsVerification = true
          note = voidRule.note
        }
      }

      // 4. Alimony — no longer deductible/taxable once the child beneficiary
      // is no longer a minor.
      if (!needsVerification && !includeOverride && ALIMONY_CHILD_CUTOFF_KEYS.has(ruleKey)) {
        const beneficiaryType = String(siblingValueFor('beneficiary_type') || '').trim().toLowerCase()
        const minorValue = siblingValueFor('beneficiary_is_minor')
        if (CHILD_BENEFICIARY_VALUES.has(beneficiaryType)) {
          if (minorValue && !isAffirmative(minorValue)) {
            needsVerification = true
            note = 'not deductible/taxable — the child beneficiary is no longer a minor'
          } else if (!minorValue) {
            // A child beneficiary's taxability hinges on this exact fact
            // (minors: taxable to the custodial parent; no longer minor:
            // not taxable) — the document not stating it at all is a real
            // gap, not a safe default to assume either way.
            needsVerification = true
            note = 'whether the child beneficiary is still a minor is not stated — confirm before including as taxable income'
          }
        }
      }

      // 5. Foreign currency — never summed as if it were CHF. A whole-document
      // flag (one "currency" field), not per-occurrence — a broker statement
      // has one reporting currency for everything on it. A specialist who
      // has specifically edited/confirmed THIS field is trusted to have
      // entered its already-converted CHF value — the shared currency field
      // itself is deliberately left untouched by that (see the "things to
      // verify" popup), so every other not-yet-converted field on the same
      // document still correctly gets flagged. Deliberately NOT overridable
      // by includeOverride — see above.
      const currencyFieldKey = CURRENCY_FIELD_BY_CATEGORY[doc.category_code]
      const currencyValue = currencyFieldKey ? siblingValue(doc.id, currencyFieldKey) : null
      if (!needsVerification && currencyValue && !isChfOrUnspecified(currencyValue) && !field.verified_by_specialist) {
        needsVerification = true
        currencyCode = currencyValue.trim().toUpperCase()
        note = `in foreign currency (${currencyCode}), not converted — manual verification needed`
      }

      // 6. Donations below the statutory minimum aren't deductible at all.
      if (!needsVerification && !includeOverride && rule.cap_parameter_family === DONATION_CAP_FAMILY) {
        const minParam = useParam(DONATION_MIN_FAMILY)
        if (minParam && rawAmount < (minParam.value_numeric || 0)) {
          needsVerification = true
          note = `below the CHF ${minParam.value_numeric} minimum for a deductible donation`
        }
      }

      // 7. A voluntary pension buy-in (Einkauf) might already be reflected in
      // the salary certificate's own "pension fund contributions" figure
      // (net salary is computed after it) — the buy-in document itself
      // rarely states whether it's additional to that or the same payment
      // counted twice. Never decide that silently: flag it for a specialist
      // to confirm, unless one already has (editing/confirming the field via
      // the normal Tax Summary review sets verified_by_specialist, same
      // override used for the missing-cap-parameter case above).
      if (!needsVerification && !includeOverride && ruleKey === PENSION_BUYBACK_RULE_KEY && !field.verified_by_specialist) {
        const hasSalaryPensionContribution = (extractedFields || []).some(
          (f) =>
            documentById[f.document_id]?.category_code === 'salary_statement' &&
            baseFieldKey('salary_statement', f.field_key) === 'pension_fund_contributions' &&
            f.field_value &&
            f.included_in_calculation !== false
        )
        if (hasSalaryPensionContribution) {
          needsVerification = true
          note =
            'possible double deduction — the salary certificate already shows pension fund contributions ' +
            'that may include this buy-in; confirm the field once checked against the two documents'
        }
      }

      // 8. The same amount also sitting under a mutually exclusive sibling
      // field on this document (e.g. maintenance_costs and
      // administration_costs both reading the same figure) — almost
      // certainly one real expense captured twice, not two real deductions.
      if (!needsVerification && !includeOverride) {
        const exclusiveSiblingKey = MUTUALLY_EXCLUSIVE_IF_EQUAL[ruleKey]
        if (exclusiveSiblingKey) {
          const siblingRaw = parseAmount(siblingValueFor(exclusiveSiblingKey))
          if (siblingRaw != null && siblingRaw === rawAmount) {
            needsVerification = true
            note = 'same amount also appears under a mutually exclusive field on this document — confirm which one actually applies'
          }
        }
      }

      // 9. Same source text as another occurrence of this field on this
      // document — the AI reading one line twice, not two real entries.
      if (!needsVerification && !includeOverride && duplicateSourceFieldKeys.has(`${field.document_id}:${field.field_key}`)) {
        needsVerification = true
        note =
          'identical source text as another occurrence of this field on this document — likely the same line ' +
          'read twice; confirm before including both'
      }

      // 10. Imputed rental value AND actual rental income both present
      // somewhere in this client/year's property documents — mutually
      // exclusive ways of taxing the same property (owner-occupied vs.
      // rented out). Never silently taxed as if both applied.
      if (
        !needsVerification &&
        !includeOverride &&
        imputedVsActualRentalConflict &&
        (ruleKey === 'property_tax_value:imputed_rental_value' || ruleKey === 'property_tax_value:annual_rental_income')
      ) {
        needsVerification = true
        note =
          'both an imputed rental value and an actual rental income appear across this client\'s property documents — ' +
          'a rented property is normally taxed on the real rent, not the imputed value; confirm which applies'
      }

      if (includeOverride) {
        // The include decision only actually took effect if nothing above
        // still needed verification despite it (currency (5) is never
        // overridable) — otherwise this is a stale/inapplicable decision
        // and the field stays a genuine open question.
        decision = needsVerification ? null : 'include'
      }
    }

    const category = categoryByCode[doc.category_code]
    entries.push({
      documentId: doc.id,
      fileName: doc.file_name,
      categoryCode: doc.category_code,
      categoryLabel: categoryLabel(category, lang),
      groupKey: category?.group_key || null,
      fieldKey: field.field_key,
      // A repeated field's later occurrences get a "#2"/"#3" marker so two
      // rows sharing the same underlying field (two donations, two
      // dividend distributions, ...) stay distinguishable in the
      // breakdown — the first occurrence is unmarked, exactly as it read
      // before this field could ever repeat.
      fieldLabel:
        (fieldLabelByKey[`${doc.category_code}:${baseKey}`] || field.field_key) +
        (suffix ? ` #${suffix.slice(1)}` : ''),
      contributionType: rule.contribution_type,
      capFamily: rule.cap_parameter_family || null,
      // Only read for the "cap parameter missing" case below — an explicit
      // signal that a specialist has looked at this specific field (either
      // edited/confirmed its value, or toggled its inclusion), as opposed
      // to it sitting untouched at the AI-extraction default.
      verifiedBySpecialist: field.verified_by_specialist === true,
      rawAmount,
      effective: rawAmount,
      note,
      needsVerification,
      decision,
      currencyCode,
      deferred: false,
      isManual: false,
      manualEntryId: null
    })
  }

  for (const row of manualEntries || []) {
    const entry = makeManualEntry(row)
    if (entry) entries.push(entry)
  }

  // Entries already excluded at creation time (voided donation, foreign
  // currency, separate taxation, a specialist's own "exclude" decision, ...)
  // contribute nothing from here on — zeroed immediately, not just at the
  // final rounding pass, so every intermediate figure below (wealth-derived
  // income, provisional income for percentage thresholds) is correct too,
  // not just the final total.
  const isExcluded = (entry) => entry.needsVerification || entry.decision === 'exclude'
  for (const entry of entries) {
    if (isExcluded(entry)) entry.effective = 0
  }

  // Wealth-derived income — needed for the debt-interest allowance, defined
  // generically as income_plus contributions from asset/property documents
  // (interest, dividends, imputed rental value), not by field name.
  const wealthDerivedIncome = entries
    .filter((e) => e.contributionType === 'income_plus' && (e.groupKey === 'assets' || e.groupKey === 'property') && !isExcluded(e))
    .reduce((sum, e) => sum + e.rawAmount, 0)

  const isMarried = isMarriedHousehold(primaryPerson, spousePerson)

  // Qualifying children (age/bracket resolved once, reused for both the
  // insurance-premium per-child increment and the per-child social
  // deduction added right before the final total).
  const resolvedYear = Number(taxYear)
  const qualifyingChildren = Number.isFinite(resolvedYear)
    ? (children || [])
        .map((child) => ({ child, resolved: resolveChild(child, resolvedYear) }))
        .filter((c) => c.resolved)
    : []

  // Pool health + life insurance premiums under one shared cap (base amount
  // by marital status, plus a per-child increment) before the generic
  // per-entry cap loop runs — a plain per-entry cap would let each premium
  // independently use the full allowance instead of sharing one.
  const insuranceEntries = entries.filter((e) => !isExcluded(e) && e.capFamily === INSURANCE_POOL_FAMILY)
  if (insuranceEntries.length) {
    const resolved = resolveInsurancePremiumCap(isMarried, qualifyingChildren.length, useParam)
    if (!resolved) {
      for (const entry of insuranceEntries) {
        if (entry.verifiedBySpecialist) {
          entry.note = 'tax parameter not found — included by the specialist despite the missing cap'
        } else {
          entry.needsVerification = true
          entry.effective = 0
          entry.note = 'not verified — missing tax parameter, excluded from calculation'
        }
      }
    } else {
      const rawSum = insuranceEntries.reduce((sum, e) => sum + e.rawAmount, 0)
      if (rawSum > resolved.cap) {
        const scale = resolved.cap / rawSum
        for (const entry of insuranceEntries) {
          entry.effective = entry.rawAmount * scale
          entry.note = 'cap applied (pooled with other insurance premiums)'
        }
      }
    }
    for (const entry of insuranceEntries) entry.capFamily = null // resolved — skip the generic loop below
  }

  // Pillar 3a contributions — the federal deduction ceiling is one of two
  // fixed figures depending on whether the person has an occupational
  // pension fund (2nd pillar / LPP) through their employer: a much lower
  // cap for someone who already builds retirement savings that way, a much
  // higher one (a percentage-of-income ceiling, itself capped) for someone
  // who doesn't (typically the purely self-employed). Same signal already
  // used for the pension-buy-in double-deduction check below: a
  // salary_statement document showing pension_fund_contributions.
  const pillar3aEntries = entries.filter((e) => !isExcluded(e) && e.capFamily === PILLAR_3A_FAMILY)
  if (pillar3aEntries.length) {
    const hasSalaryPensionContribution = (extractedFields || []).some(
      (f) =>
        documentById[f.document_id]?.category_code === 'salary_statement' &&
        baseFieldKey('salary_statement', f.field_key) === 'pension_fund_contributions' &&
        f.field_value &&
        f.included_in_calculation !== false
    )
    const param = hasSalaryPensionContribution ? useParam('pillar_3a_with_lpp') : useParam('pillar_3a_without_lpp')
    if (!param) {
      for (const entry of pillar3aEntries) {
        if (entry.verifiedBySpecialist) {
          entry.note = 'tax parameter not found — included by the specialist despite the missing cap'
        } else {
          entry.needsVerification = true
          entry.effective = 0
          entry.note = 'not verified — missing tax parameter, excluded from calculation'
        }
      }
    } else {
      let cap = param.value_numeric || 0
      // The "without LPP" ceiling is a percentage-of-income cap in Swiss
      // law (20% of net self-employment income), not a flat amount —
      // value_numeric here is only the federal upper bound on that
      // percentage, so it's tightened further when actual self-employment
      // income is on file for this same client/year.
      if (!hasSalaryPensionContribution && param.value_type === 'formula') {
        const selfEmployedIncome = entries
          .filter((e) => e.categoryCode === 'self_employed_income_statement' && e.fieldKey === 'net_profit' && !isExcluded(e))
          .reduce((sum, e) => sum + e.rawAmount, 0)
        cap = Math.min(cap, selfEmployedIncome * 0.2)
      }
      for (const entry of pillar3aEntries) {
        entry.effective = Math.min(entry.rawAmount, cap)
        if (entry.effective < entry.rawAmount) entry.note = 'cap applied'
      }
    }
    for (const entry of pillar3aEntries) entry.capFamily = null // resolved — skip the generic loop below
  }

  // Resolve every capped entry except percentage-type ones, which depend on
  // a provisional income figure computed further down.
  for (const entry of entries) {
    // Already excluded above (voided donation, foreign currency, separate
    // taxation, a specialist's own "exclude" decision, ...) — nothing left
    // to resolve, and the cap/param logic below would only overwrite that
    // reason with an unrelated one.
    if (isExcluded(entry)) continue
    if (!entry.capFamily) continue
    const param = useParam(entry.capFamily)
    if (!param) {
      // No tax parameter to check this amount against — an unverified
      // figure can't count in the total as if it had been. Excluded by
      // default (effective set to 0 further down); a specialist who has
      // specifically looked at this field (edited/confirmed it, or
      // toggled its inclusion) is trusted to have made that call
      // deliberately, so it's included uncapped instead.
      if (entry.verifiedBySpecialist) {
        entry.note = 'tax parameter not found — included by the specialist despite the missing cap'
      } else {
        entry.needsVerification = true
        entry.note = 'not verified — missing tax parameter, excluded from calculation'
      }
      continue
    }
    if (param.value_type === 'percentage') {
      entry.deferred = true
      entry.param = param
      continue
    }
    let cap
    if (entry.capFamily === DEBT_INTEREST_FAMILY) {
      cap = wealthDerivedIncome + (param.value_numeric || 0)
    } else {
      cap = param.value_type === 'no_cap' ? Infinity : (param.value_numeric ?? entry.rawAmount)
      const halveKey = `${entry.categoryCode}:${entry.fieldKey}`
      if (Number.isFinite(cap) && HALVE_CAP_IF_TRUTHY[halveKey] && isAffirmative(siblingValue(entry.documentId, HALVE_CAP_IF_TRUTHY[halveKey]))) {
        cap = cap / 2
      }
    }
    entry.effective = Math.min(entry.rawAmount, cap)
    if (entry.effective < entry.rawAmount) entry.note = 'cap applied'
  }

  // Flat-rate professional expenses (3% of net salary, min/max clamped) —
  // an INDIVIDUAL deduction in Swiss tax law: each working person computes
  // their own forfait on their own net salary, with their own min/max, and
  // the results are summed — never 3% of the household's combined salary.
  // Documents aren't attributed to a specific spouse in this app, but each
  // salary_statement document already represents one employment
  // relationship, which is the best available proxy for "one person" — so
  // the forfait is computed per net_salary entry, not pooled first. Added
  // before provisional income is computed, so it counts as an "organic"
  // deduction like every other one above.
  const netSalaryEntries = entries.filter(
    (e) => e.categoryCode === 'salary_statement' && e.fieldKey === 'net_salary' && !isExcluded(e)
  )
  if (netSalaryEntries.length) {
    const pctParam = useParam('professional_expenses_pct')
    if (pctParam) {
      const minParam = useParam('professional_expenses_min')
      const maxParam = useParam('professional_expenses_max')
      for (const salaryEntry of netSalaryEntries) {
        let amount = (salaryEntry.rawAmount * (pctParam.value_numeric || 0)) / 100
        if (minParam) amount = Math.max(amount, minParam.value_numeric || 0)
        if (maxParam) amount = Math.min(amount, maxParam.value_numeric || 0)
        entries.push(
          makeSyntheticEntry({
            contributionType: 'income_minus',
            rawAmount: amount,
            categoryLabel: 'Professional expenses (flat-rate)',
            fieldLabel: 'Flat-rate professional expenses (3% of net salary, min/max applied)',
            groupKey: 'deductions',
            documentId: salaryEntry.documentId,
            fileName: salaryEntry.fileName
          })
        )
      }
    }
  }

  const provisionalIncome =
    entries.filter((e) => e.contributionType === 'income_plus').reduce((sum, e) => sum + e.effective, 0) -
    entries
      .filter((e) => e.contributionType === 'income_minus' && !e.deferred)
      .reduce((sum, e) => sum + e.effective, 0)

  // Percentage-capped deductions are resolved in two sequential stages, not
  // together: donations (and any other general %-of-income cap) first,
  // against the plain provisional income: medical costs LAST, against
  // income already reduced by every deduction above INCLUDING donations —
  // "solo l'eccedenza sul reddito netto già ridotto dalle altre deduzioni".
  const deferredEntries = entries.filter((e) => e.deferred)
  const generalDeferred = deferredEntries.filter((e) => e.capFamily !== MEDICAL_THRESHOLD_FAMILY)
  const medicalDeferred = deferredEntries.filter((e) => e.capFamily === MEDICAL_THRESHOLD_FAMILY)

  // A negative income base (heavy deductions, or a synthetic test case with
  // little/no income) must never turn into a negative percentage cap/
  // threshold — that would let a cap "add" to the raw amount instead of
  // limiting it, or push a threshold below zero and inflate the medical
  // floor beyond the actual net expense. Floored at zero before either
  // percentage is computed.
  const donationBaseIncome = Math.max(0, provisionalIncome)

  for (const entry of generalDeferred) {
    const pct = entry.param.value_numeric || 0
    const cap = donationBaseIncome * (pct / 100)
    // Structural floor/ceiling, independent of how cap ended up computed:
    // a capped deduction can never be negative, and never exceeds the raw
    // amount that generated it.
    entry.effective = Math.max(0, Math.min(entry.rawAmount, cap))
    if (entry.effective < entry.rawAmount) entry.note = 'cap applied'
  }

  const incomeAfterGeneralDeductions = Math.max(
    0,
    provisionalIncome - generalDeferred.reduce((sum, e) => sum + e.effective, 0)
  )

  for (const entry of medicalDeferred) {
    const pct = entry.param.value_numeric || 0
    const threshold = incomeAfterGeneralDeductions * (pct / 100)
    // Structural ceiling: whatever the threshold computes to, the
    // deductible amount can never exceed the net expense that generated it
    // (deduction = min(net expense above threshold, net expense)).
    entry.effective = Math.min(entry.rawAmount, Math.max(0, entry.rawAmount - threshold))
    entry.note = 'only the amount exceeding the threshold is deductible'
  }

  const incomeAfterMedical = incomeAfterGeneralDeductions - medicalDeferred.reduce((sum, e) => sum + e.effective, 0)

  // Social deductions — added last, against income already reduced by
  // everything above. Fixed amounts, so they never affect any threshold
  // computed earlier; only their presence in the final total matters.
  if (qualifyingChildren.length && CHILD_CREDIT_NOT_DEDUCTION_CANTONS.has(canton)) {
    warnings.push(
      'Basilea Campagna: la deduzione per figli è un credito d\'imposta di CHF 750/figlio applicato sull\'imposta finale, non una deduzione sulla base imponibile — non calcolato da questa app.'
    )
  } else {
    for (const { child, resolved } of qualifyingChildren) {
      const family = CHILD_BRACKET_FAMILY[resolved.bracket]
      let param = useParam(family)
      if (!param) param = useParam('child_deduction_flat')
      if (!param) continue
      entries.push(
        makeSyntheticEntry({
          contributionType: 'income_minus',
          rawAmount: param.value_numeric || 0,
          categoryLabel: 'Social deductions',
          fieldLabel: `Child deduction — ${child.full_name || 'child'}`,
          note: resolved.uncertain
            ? 'child over 16 — training/education status not confirmed from the questionnaire, verify manually'
            : null,
          needsVerification: resolved.uncertain,
          groupKey: 'deductions'
        })
      )
    }
  }

  if (isMarried) {
    if (MARRIED_CREDIT_NOT_DEDUCTION_CANTONS.has(canton)) {
      warnings.push(
        'Vallese: la deduzione per coniugati è uno sconto d\'imposta del 35% (max CHF 4\'900) applicato sull\'imposta finale, non una deduzione sulla base imponibile — non calcolato da questa app.'
      )
    } else {
      const marriedParam = useParam('married_deduction_flat')
      if (marriedParam) {
        entries.push(
          makeSyntheticEntry({
            contributionType: 'income_minus',
            rawAmount: marriedParam.value_numeric || 0,
            categoryLabel: 'Social deductions',
            fieldLabel: 'Married/partnered deduction',
            groupKey: 'deductions'
          })
        )
      }
    }
  }

  // "Doppio reddito" (both spouses employed) — flagged for manual review
  // only. The deduction is 50% of the LOWER spouse's income, but documents
  // aren't attributed to a specific person, so this app can't attribute
  // salary income per spouse and compute it automatically.
  const spouseAppearsEmployed = Boolean(spousePerson) && (spousePerson.work_percentage == null || spousePerson.work_percentage > 0)
  const primaryAppearsEmployed = !primaryPerson || primaryPerson.work_percentage == null || primaryPerson.work_percentage > 0
  if (isMarried && spouseAppearsEmployed && primaryAppearsEmployed && !NO_TWO_INCOME_DEDUCTION_CANTONS.has(canton)) {
    const minParam = findParam(parameters, 'two_income_deduction_min', canton)
    const cantonalParam = findParam(parameters, 'two_income_deduction_cantonal_amount', canton)
    const indicative = (cantonalParam?.value_numeric ?? minParam?.value_numeric) || 0
    entries.push(
      makeSyntheticEntry({
        contributionType: 'income_minus',
        rawAmount: indicative,
        categoryLabel: 'Social deductions',
        fieldLabel: 'Possible two-income deduction ("doppio reddito")',
        note: 'both spouses appear employed — this deduction requires manually attributing income per spouse, which this app cannot do from uploaded documents',
        needsVerification: true,
        groupKey: 'deductions'
      })
    )
  }

  // Wealth exempt amount (cantonal only — no federal wealth tax exists) —
  // base amount by marital status, plus a per-child increment for the
  // cantons that have one, using the same qualifying-children list as the
  // income-side child deduction above. Only applies against actual wealth:
  // with no wealth_plus entry at all (e.g. every document was deleted), the
  // client has nothing for this exemption to exempt, so skip it rather than
  // manufacture a negative taxable wealth out of a deduction with no base.
  const hasWealthData = entries.some((e) => e.contributionType === 'wealth_plus')
  if (hasWealthData) {
    // Married vs. single picks between CHF 45'000 and CHF 90'000 (Weber's
    // exact case) — a real difference, not a rounding nuance. primaryPerson
    // being entirely absent (no client_persons row at all, e.g. the
    // registry sync never having reached this client yet — see
    // api/_recalc.js) means marital status is genuinely UNKNOWN, not
    // "known to be single". isMarriedHousehold() can't tell those apart
    // (it just sees a falsy marital_status either way), so that
    // distinction has to be made here instead of silently defaulting to
    // the single amount.
    if (!primaryPerson) {
      entries.push(
        makeSyntheticEntry({
          contributionType: 'wealth_minus',
          rawAmount: 0,
          categoryLabel: 'Wealth exemption',
          fieldLabel: 'Net wealth exempt amount — marital status unknown',
          note:
            'no registry data for this client yet (client_persons is empty) — marital status unknown, ' +
            'exemption not applied; sync the client\'s personal details and recalculate',
          needsVerification: true,
          groupKey: 'wealth'
        })
      )
    } else {
      const wealthExemptParam = useParam(isMarried ? 'wealth_exempt_married' : 'wealth_exempt_single')
      const wealthExemptChildParam = qualifyingChildren.length ? useParam('wealth_exempt_child') : null
      const wealthExemptChildTotal = (wealthExemptChildParam?.value_numeric || 0) * qualifyingChildren.length
      const wealthExemptTotal = (wealthExemptParam?.value_numeric || 0) + wealthExemptChildTotal
      if (wealthExemptTotal) {
        entries.push(
          makeSyntheticEntry({
            contributionType: 'wealth_minus',
            rawAmount: wealthExemptTotal,
            categoryLabel: 'Wealth exemption',
            fieldLabel: isMarried ? 'Net wealth exempt amount (married)' : 'Net wealth exempt amount (single)',
            note: wealthExemptChildTotal ? `includes CHF ${wealthExemptChildTotal.toLocaleString('de-CH')} for ${qualifyingChildren.length} child(ren)` : null,
            groupKey: 'wealth'
          })
        )
      }
    }
  }

  // Round every contributing amount to whole CHF now, once — capping/
  // threshold logic above needed the unrounded figures for precision, but
  // from here on every total is built by summing THESE same rounded
  // numbers, which are also exactly what the "how this was calculated" rows
  // show. That guarantees the totals above are always exactly the sum of
  // the rows below, rather than summing unrounded amounts and rounding only
  // the final total (which can drift by a franc or two once several
  // fractional components are involved).
  for (const entry of entries) {
    entry.effective = entry.needsVerification ? 0 : Math.round(entry.effective)
  }

  // Structural floor at zero: taxable income/wealth is never negative in
  // Swiss tax law (a loss carries forward, it doesn't produce a negative
  // bill), regardless of how the deductions/exemptions above combined —
  // the same backstop already applied per-deduction to the medical and
  // donation caps. This can make the headline total not equal the sum of
  // the rows in `components` in the pathological case (deductions alone
  // exceeding a near-empty base, e.g. right after every document was
  // deleted); that's an intentional last resort, not the normal path.
  const taxableIncomeCantonal = Math.max(
    0,
    entries.filter((e) => e.contributionType === 'income_plus').reduce((sum, e) => sum + e.effective, 0) -
      entries.filter((e) => e.contributionType === 'income_minus').reduce((sum, e) => sum + e.effective, 0)
  )

  const wealthPlus = entries
    .filter((e) => e.contributionType === 'wealth_plus')
    .reduce((sum, e) => sum + e.effective, 0)
  const wealthMinus = entries
    .filter((e) => e.contributionType === 'wealth_minus')
    .reduce((sum, e) => sum + e.effective, 0)
  const taxableWealthCantonal = Math.max(0, wealthPlus - wealthMinus)

  // Federal income isn't computed separately yet — treated as equal to the
  // cantonal figure until federal-specific rules are mapped. There is no
  // federal wealth tax in Switzerland, so no federal wealth figure exists.
  const taxableIncomeFederal = taxableIncomeCantonal

  const components = entries.map((entry) => {
    const entryOccurrence = fieldSuffix(entry.categoryCode, entry.fieldKey)
    const perDocIdentifiers = entry.documentId ? identifierByDocId[entry.documentId] : null
    const identifier = perDocIdentifiers ? perDocIdentifiers[entryOccurrence] ?? perDocIdentifiers[''] ?? null : null
    const suffix = identifier || entry.fileName || null
    const label = suffix
      ? `${entry.fieldLabel} — ${entry.categoryLabel} ${identifier ? identifier : `(${entry.fileName})`}${entry.note ? ` — ${entry.note}` : ''}`
      : `${entry.fieldLabel} — ${entry.categoryLabel}${entry.note ? ` — ${entry.note}` : ''}`
    return {
      documentId: entry.documentId,
      // The raw field_key this row came from (e.g. "dividend_income_2") —
      // lets the UI match a "needs verification" row back to the exact
      // extracted_document_fields row that produced it, to offer a direct
      // fix (entering a converted CHF amount, confirming despite a missing
      // cap parameter, ...) instead of only describing the problem.
      fieldKey: entry.fieldKey,
      componentType: CONTRIBUTION_TO_COMPONENT[entry.contributionType],
      sectionKey: CONTRIBUTION_TO_SECTION[entry.contributionType] || null,
      // A needs-verification row (or one a specialist decided to exclude)
      // shows the amount it WOULD contribute — effective is 0 for
      // total-summation purposes (see above), so this row is never part of
      // the "totals = sum of rows" reconciliation in the normal breakdown;
      // it's rendered as its own, clearly separate section instead.
      amount: entry.needsVerification || entry.decision === 'exclude' ? entry.rawAmount : entry.effective,
      needsVerification: entry.needsVerification,
      // null when never flagged, 'include'/'exclude' when a specialist has
      // explicitly resolved it — lets the UI show a final status (resolved
      // vs. still open) instead of every ever-flagged field looking
      // identically unresolved forever.
      decision: entry.decision || null,
      isManual: Boolean(entry.isManual),
      manualEntryId: entry.manualEntryId || null,
      // Set only for the foreign-currency exclusion reason — the display
      // layer uses this instead of formatting the (untouched, still in
      // that currency) amount as if it were CHF.
      currencyCode: entry.currencyCode || null,
      label,
      // The "how this was calculated" table has just two columns (item,
      // signed amount) — when several documents contribute to the same
      // section, the item text itself carries the document identifier
      // (e.g. "Gross salary — LONZA AG") so rows stay distinguishable
      // without a separate source column. Synthetic (computed) entries have
      // no document at all, so the suffix is dropped instead of showing
      // "(null)".
      fieldLabel: `${entry.fieldLabel}${entry.note ? ` (${entry.note})` : ''}${suffix ? ` — ${suffix}` : ''}`,
      sourceLabel: suffix ? `${entry.categoryLabel} — ${suffix}` : entry.categoryLabel
    }
  })

  // Ready-to-display lines for the proactive "things to verify" popup —
  // every tax_parameters row this calculation actually relied on that's
  // still flagged "da confermare" on its own notes.
  const uncertainParameterNotes = Array.from(uncertainParamsById.values()).map((param) => {
    const jurisdiction = param.scope === 'cantonal' ? param.canton_code : 'federale'
    return `${param.parameter_label || param.parameter_key} (${jurisdiction}): valore non confermato su fonte primaria`
  })

  return {
    taxableIncomeCantonal,
    taxableWealthCantonal,
    taxableIncomeFederal,
    components,
    warnings,
    uncertainParameterNotes,
    cantonMissing: !canton
  }
}

// Whether an aggregate can honestly be called "ready_for_simulation" —
// shared by api/_recalc.js (real backend) and the demo data layer, so the
// rule is defined exactly once instead of copied inline in both places
// (which is how it drifted out of sync with itself before: a document
// stuck 'uploaded'/'extracting' was checked, but a real, sized "needs
// verification" component — an unconverted USD balance, a missing cap
// parameter — was not, so the aggregate could claim to be final while a
// known, nonzero gap was still sitting there unresolved).
//
// documentsStillProcessing: true if any of this client/year's documents is
//   still 'uploaded' or 'extracting' — extraction not finished yet.
// components: the tax_aggregate_components rows (or the pure entries this
//   module's own `components` return value already shapes the same way) —
//   needs_verification/needsVerification and amount are read leniently
//   (either casing) so this works against both the DB row shape and the
//   camelCase shape computeTaxAggregate() itself returns.
export function resolveAggregateStatus({ documentsStillProcessing, components }) {
  const hasUnresolvedVerification = (components || []).some((c) => {
    const needsVerification = c.needs_verification ?? c.needsVerification
    return needsVerification && c.amount
  })
  return documentsStillProcessing || hasUnresolvedVerification ? 'draft' : 'ready_for_simulation'
}

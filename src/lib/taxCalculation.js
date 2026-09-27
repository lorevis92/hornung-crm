// The tax calculation engine — a pure function with no I/O, shared between
// api/calculate-aggregates.js (real Supabase data, server-side) and the demo
// data layer (in-memory data, browser), so the actual math is never
// duplicated between the two. No import.meta.env / Vite-only syntax here —
// this file is imported directly from a plain Node ESM serverless function.

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

// A handful of fields need to look at a sibling field on the SAME document
// before they can be turned into a plain amount — same "special-cased by
// name" style as the two family constants above, kept as small explicit
// maps rather than new generic schema for what only a few fields need.

// Deductible cost = the field's own amount minus the paired field (e.g.
// medical costs net of the insurance reimbursement) — never negative.
const NETS_AGAINST = {
  'medical_costs:total_amount': 'insurance_reimbursement'
}

// The field is excluded (not a real deduction) when the paired field is
// affirmative — e.g. a "membership fee" isn't a pure donation once the
// document indicates a consideration/benefit was received in exchange.
const VOID_IF_TRUTHY = {
  'donation_certificate:annual_amount': 'has_consideration'
}
const AFFIRMATIVE_VALUES = new Set(['yes', 'sì', 'si', 'ja', 'oui', 'true', '1', 'x'])

// Categories whose monetary fields are only trustworthy in CHF — a sibling
// "currency" field that says otherwise excludes every numeric field on that
// document rather than silently summing a foreign-currency figure as if it
// were francs.
const CURRENCY_FIELD_BY_CATEGORY = {
  bank_securities_crypto_statement: 'currency'
}
const CHF_ALIASES = new Set(['CHF', 'SFR'])

function isAffirmative(value) {
  return AFFIRMATIVE_VALUES.has(String(value || '').trim().toLowerCase())
}

function isChfOrUnspecified(value) {
  const v = String(value || '').trim().toUpperCase()
  return !v || CHF_ALIASES.has(v)
}

function parseAmount(value) {
  if (value == null) return null
  const cleaned = String(value).trim().replace(/['’\s]/g, '').replace(/,/g, '')
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

// documents: client_documents rows (id, category_code, file_name), already
//   scoped to one client/tax_year and to only the categorized ones.
// extractedFields: extracted_document_fields rows for those documents.
// rules: the full field_calculation_rules table.
// fieldDefs: the full category_field_definitions table (for field_label).
// categories: the full document_categories table (for group_key + labels).
// parameters: tax_parameters rows already filtered to the target tax_year.
// canton: the resolved canton code, or null if genuinely unknown.
export function computeTaxAggregate({
  canton,
  documents,
  extractedFields,
  rules,
  fieldDefs,
  categories,
  parameters,
  lang = 'en'
}) {
  const categoryByCode = Object.fromEntries((categories || []).map((c) => [c.code, c]))
  const documentById = Object.fromEntries((documents || []).map((d) => [d.id, d]))
  const ruleByKey = Object.fromEntries((rules || []).map((r) => [`${r.category_code}:${r.field_key}`, r]))
  const fieldLabelByKey = Object.fromEntries(
    (fieldDefs || []).map((f) => [`${f.category_code}:${f.field_key}`, f.field_label])
  )

  // A document's "identifier" for readable labels — the first
  // *_name/*_organization field found for it (e.g. an employer or
  // institution name), falling back to the file name. Generic on purpose:
  // no per-category hardcoding of which field is the "interesting" one.
  const identifierByDocId = {}
  for (const doc of documents || []) {
    const nameField = (extractedFields || []).find(
      (f) =>
        f.document_id === doc.id &&
        f.included_in_calculation !== false &&
        /_(name|organization)$/.test(f.field_key) &&
        f.field_value
    )
    identifierByDocId[doc.id] = nameField ? nameField.field_value : null
  }

  // For the sibling-field lookups below (net-of-reimbursement, voided-by,
  // currency) — keyed the same way regardless of whether the companion
  // field itself has a contribution_type (most don't; they're purely
  // informational on their own).
  const fieldByDocAndKey = Object.fromEntries(
    (extractedFields || []).map((f) => [`${f.document_id}:${f.field_key}`, f.field_value])
  )
  const siblingValue = (documentId, fieldKey) => fieldByDocAndKey[`${documentId}:${fieldKey}`]

  const warnings = []
  const entries = []

  // Extracted values feed the calculation as soon as they exist — there is
  // no "confirmed by the specialist" gate. The specialist can still
  // exclude a field (included_in_calculation) or correct/add a value at
  // any time; verified_by_specialist is no longer read here at all.
  for (const field of extractedFields || []) {
    if (field.included_in_calculation === false) continue
    if (!field.field_value || !field.field_value.trim()) continue
    const doc = documentById[field.document_id]
    if (!doc || !doc.category_code) continue
    const rule = ruleByKey[`${doc.category_code}:${field.field_key}`]
    if (!rule || rule.contribution_type === 'none') continue

    let rawAmount = parseAmount(field.field_value)
    if (rawAmount == null) {
      warnings.push(`"${field.field_key}" in "${doc.file_name}" is not a number and was skipped.`)
      continue
    }

    const ruleKey = `${doc.category_code}:${field.field_key}`
    let needsVerification = false
    let note = null

    const netsAgainstKey = NETS_AGAINST[ruleKey]
    if (netsAgainstKey) {
      const reimbursement = parseAmount(siblingValue(doc.id, netsAgainstKey)) || 0
      rawAmount = Math.max(0, rawAmount - reimbursement)
    }

    const voidIfKey = VOID_IF_TRUTHY[ruleKey]
    if (voidIfKey && isAffirmative(siblingValue(doc.id, voidIfKey))) {
      needsVerification = true
      note = 'not deductible — the document indicates a consideration/benefit was received, not a pure donation'
    }

    const currencyFieldKey = CURRENCY_FIELD_BY_CATEGORY[doc.category_code]
    const currencyValue = currencyFieldKey ? siblingValue(doc.id, currencyFieldKey) : null
    let currencyCode = null
    if (!needsVerification && currencyValue && !isChfOrUnspecified(currencyValue)) {
      needsVerification = true
      currencyCode = currencyValue.trim().toUpperCase()
      note = `in foreign currency (${currencyCode}), not converted — manual verification needed`
    }

    const category = categoryByCode[doc.category_code]
    entries.push({
      documentId: doc.id,
      fileName: doc.file_name,
      categoryCode: doc.category_code,
      categoryLabel: categoryLabel(category, lang),
      groupKey: category?.group_key || null,
      fieldKey: field.field_key,
      fieldLabel: fieldLabelByKey[`${doc.category_code}:${field.field_key}`] || field.field_key,
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
      currencyCode,
      deferred: false
    })
  }

  // Entries already excluded at creation time (voided donation, foreign
  // currency) contribute nothing from here on — zeroed immediately, not
  // just at the final rounding pass, so every intermediate figure below
  // (wealth-derived income, provisional income for percentage thresholds)
  // is correct too, not just the final total.
  for (const entry of entries) {
    if (entry.needsVerification) entry.effective = 0
  }

  // Wealth-derived income — needed for the debt-interest allowance, defined
  // generically as income_plus contributions from asset/property documents
  // (interest, dividends, imputed rental value), not by field name.
  const wealthDerivedIncome = entries
    .filter(
      (e) =>
        e.contributionType === 'income_plus' &&
        (e.groupKey === 'assets' || e.groupKey === 'property') &&
        !e.needsVerification
    )
    .reduce((sum, e) => sum + e.rawAmount, 0)

  // Resolve every capped entry except percentage-type ones, which depend on
  // a provisional income figure computed further down.
  for (const entry of entries) {
    // Already excluded above (voided donation, foreign currency) — nothing
    // left to resolve, and the cap/param logic below would only overwrite
    // that reason with an unrelated one.
    if (entry.needsVerification) continue
    if (!entry.capFamily) continue
    const param = findParam(parameters, entry.capFamily, canton)
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
    if (entry.capFamily === DEBT_INTEREST_FAMILY) {
      const cap = wealthDerivedIncome + (param.value_numeric || 0)
      entry.effective = Math.min(entry.rawAmount, cap)
    } else {
      const cap = param.value_numeric ?? entry.rawAmount
      entry.effective = Math.min(entry.rawAmount, cap)
    }
    if (entry.effective < entry.rawAmount) entry.note = 'cap applied'
  }

  const provisionalIncome =
    entries.filter((e) => e.contributionType === 'income_plus').reduce((sum, e) => sum + e.effective, 0) -
    entries
      .filter((e) => e.contributionType === 'income_minus' && !e.deferred)
      .reduce((sum, e) => sum + e.effective, 0)

  for (const entry of entries.filter((e) => e.deferred)) {
    const pct = entry.param.value_numeric || 0
    const thresholdOrCap = provisionalIncome * (pct / 100)
    if (entry.capFamily === MEDICAL_THRESHOLD_FAMILY) {
      entry.effective = Math.max(0, entry.rawAmount - thresholdOrCap)
      entry.note = 'only the amount exceeding the threshold is deductible'
    } else {
      entry.effective = Math.min(entry.rawAmount, thresholdOrCap)
      if (entry.effective < entry.rawAmount) entry.note = 'cap applied'
    }
  }

  // Round every contributing amount to whole CHF now, once — capping/
  // threshold logic above needed the unrounded figures for precision, but
  // from here on every total is built by summing THESE same rounded
  // numbers, which are also exactly what the "how this was calculated"
  // rows show. That guarantees the totals above are always exactly the sum
  // of the rows below, rather than summing unrounded amounts and rounding
  // only the final total (which can drift by a franc or two once several
  // fractional components are involved).
  for (const entry of entries) {
    entry.effective = entry.needsVerification ? 0 : Math.round(entry.effective)
  }

  const taxableIncomeCantonal =
    entries.filter((e) => e.contributionType === 'income_plus').reduce((sum, e) => sum + e.effective, 0) -
    entries.filter((e) => e.contributionType === 'income_minus').reduce((sum, e) => sum + e.effective, 0)

  const wealthPlus = entries
    .filter((e) => e.contributionType === 'wealth_plus')
    .reduce((sum, e) => sum + e.effective, 0)
  const wealthMinus = entries
    .filter((e) => e.contributionType === 'wealth_minus')
    .reduce((sum, e) => sum + e.effective, 0)
  const taxableWealthCantonal = wealthPlus - wealthMinus

  // Federal income isn't computed separately yet — treated as equal to the
  // cantonal figure until federal-specific rules are mapped. There is no
  // federal wealth tax in Switzerland, so no federal wealth figure exists.
  const taxableIncomeFederal = taxableIncomeCantonal

  const components = entries.map((entry) => {
    const identifier = identifierByDocId[entry.documentId]
    const suffix = identifier ? identifier : entry.fileName
    const label = `${entry.fieldLabel} — ${entry.categoryLabel} ${identifier ? identifier : `(${entry.fileName})`}${entry.note ? ` — ${entry.note}` : ''}`
    return {
      documentId: entry.documentId,
      componentType: CONTRIBUTION_TO_COMPONENT[entry.contributionType],
      sectionKey: CONTRIBUTION_TO_SECTION[entry.contributionType] || null,
      // A needs-verification row shows the amount it WOULD contribute —
      // effective is 0 for total-summation purposes (see above), so this
      // row is never part of the "totals = sum of rows" reconciliation in
      // the normal breakdown; it's rendered as its own, clearly separate
      // section instead.
      amount: entry.needsVerification ? entry.rawAmount : entry.effective,
      needsVerification: entry.needsVerification,
      // Set only for the foreign-currency exclusion reason — the display
      // layer uses this instead of formatting the (untouched, still in
      // that currency) amount as if it were CHF.
      currencyCode: entry.currencyCode || null,
      label,
      // The "how this was calculated" table has just two columns (item,
      // signed amount) — when several documents contribute to the same
      // section, the item text itself carries the document identifier
      // (e.g. "Gross salary — LONZA AG") so rows stay distinguishable
      // without a separate source column.
      fieldLabel: `${entry.fieldLabel}${entry.note ? ` (${entry.note})` : ''} — ${suffix}`,
      sourceLabel: `${entry.categoryLabel} — ${suffix}`
    }
  })

  return {
    taxableIncomeCantonal,
    taxableWealthCantonal,
    taxableIncomeFederal,
    components,
    warnings,
    cantonMissing: !canton
  }
}

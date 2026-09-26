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

  // A document's "identifier" for readable labels — the first verified
  // *_name/*_organization field found for it (e.g. an employer or
  // institution name), falling back to the file name. Generic on purpose:
  // no per-category hardcoding of which field is the "interesting" one.
  const identifierByDocId = {}
  for (const doc of documents || []) {
    const nameField = (extractedFields || []).find(
      (f) =>
        f.document_id === doc.id &&
        f.verified_by_specialist &&
        f.included_in_calculation !== false &&
        /_(name|organization)$/.test(f.field_key) &&
        f.field_value
    )
    identifierByDocId[doc.id] = nameField ? nameField.field_value : null
  }

  const warnings = []
  const entries = []

  for (const field of extractedFields || []) {
    if (!field.verified_by_specialist || field.included_in_calculation === false) continue
    const doc = documentById[field.document_id]
    if (!doc || !doc.category_code) continue
    const rule = ruleByKey[`${doc.category_code}:${field.field_key}`]
    if (!rule || rule.contribution_type === 'none') continue

    const rawAmount = parseAmount(field.field_value)
    if (rawAmount == null) {
      warnings.push(`"${field.field_key}" in "${doc.file_name}" is not a number and was skipped.`)
      continue
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
      rawAmount,
      effective: rawAmount,
      note: null,
      deferred: false
    })
  }

  // Wealth-derived income — needed for the debt-interest allowance, defined
  // generically as income_plus contributions from asset/property documents
  // (interest, dividends, imputed rental value), not by field name.
  const wealthDerivedIncome = entries
    .filter((e) => e.contributionType === 'income_plus' && (e.groupKey === 'assets' || e.groupKey === 'property'))
    .reduce((sum, e) => sum + e.rawAmount, 0)

  // Resolve every capped entry except percentage-type ones, which depend on
  // a provisional income figure computed further down.
  for (const entry of entries) {
    if (!entry.capFamily) continue
    const param = findParam(parameters, entry.capFamily, canton)
    if (!param) {
      entry.note = 'no matching tax parameter found — applied uncapped'
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

  const finalDeferredIncomeMinus = entries
    .filter((e) => e.deferred)
    .reduce((sum, e) => sum + e.effective, 0)

  const taxableIncomeCantonal = Math.round(provisionalIncome - finalDeferredIncomeMinus)

  const wealthPlus = entries
    .filter((e) => e.contributionType === 'wealth_plus')
    .reduce((sum, e) => sum + e.effective, 0)
  const wealthMinus = entries
    .filter((e) => e.contributionType === 'wealth_minus')
    .reduce((sum, e) => sum + e.effective, 0)
  const taxableWealthCantonal = Math.round(wealthPlus - wealthMinus)

  // Federal income isn't computed separately yet — treated as equal to the
  // cantonal figure until federal-specific rules are mapped. There is no
  // federal wealth tax in Switzerland, so no federal wealth figure exists.
  const taxableIncomeFederal = taxableIncomeCantonal

  const components = entries.map((entry) => {
    const identifier = identifierByDocId[entry.documentId]
    const suffix = identifier ? identifier : `(${entry.fileName})`
    const label = `${entry.fieldLabel} — ${entry.categoryLabel} ${suffix}${entry.note ? ` — ${entry.note}` : ''}`
    return {
      documentId: entry.documentId,
      componentType: CONTRIBUTION_TO_COMPONENT[entry.contributionType],
      amount: entry.effective,
      label
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

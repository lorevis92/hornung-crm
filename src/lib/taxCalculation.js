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
const DONATION_CAP_FAMILY = 'donation_cap_pct'
const DONATION_MIN_FAMILY = 'donation_min_amount'
// Not a real tax_parameters family on its own — a marker the pooling
// pre-pass recognizes; the actual cap is resolved dynamically from marital
// status + qualifying-children count (see resolveInsurancePremiumCap).
const INSURANCE_POOL_FAMILY = 'insurance_premium_pool'

// A handful of fields need to look at a sibling field on the SAME document
// before they can be turned into a plain amount — same "special-cased by
// name" style as the family constants above, kept as small explicit maps
// rather than new generic schema for what only a few fields need.

// Deductible cost = the field's own amount minus the paired field (e.g.
// medical costs net of the insurance reimbursement) — never negative.
const NETS_AGAINST = {
  'medical_costs:total_amount': 'insurance_reimbursement'
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

function isMarriedHousehold(primaryPerson, spousePerson) {
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

function makeSyntheticEntry({ contributionType, rawAmount, categoryLabel, fieldLabel, note, needsVerification, groupKey }) {
  return {
    documentId: null,
    fileName: null,
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
    currencyCode: null,
    deferred: false
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

    // 1. Categories that are always shown but never counted (separate
    // taxation, or a figure this app can't reliably compute).
    if (ALWAYS_FLAGGED_CATEGORIES[doc.category_code]) {
      needsVerification = true
      note = ALWAYS_FLAGGED_CATEGORIES[doc.category_code]
    }

    // 2. Net against a sibling field (e.g. medical costs net of
    // reimbursement) — computed regardless, it's part of the raw amount.
    const netsAgainstKey = NETS_AGAINST[ruleKey]
    if (netsAgainstKey) {
      const reimbursement = parseAmount(siblingValue(doc.id, netsAgainstKey)) || 0
      rawAmount = Math.max(0, rawAmount - reimbursement)
    }

    // 3. Voided by a sibling flag (donation with consideration, commute
    // with employer-provided free transport).
    if (!needsVerification) {
      const voidRule = VOID_IF_TRUTHY[ruleKey]
      if (voidRule && isAffirmative(siblingValue(doc.id, voidRule.siblingKey))) {
        needsVerification = true
        note = voidRule.note
      }
    }

    // 4. Alimony — no longer deductible/taxable once the child beneficiary
    // is no longer a minor.
    if (!needsVerification && ALIMONY_CHILD_CUTOFF_KEYS.has(ruleKey)) {
      const beneficiaryType = String(siblingValue(doc.id, 'beneficiary_type') || '').trim().toLowerCase()
      const minorValue = siblingValue(doc.id, 'beneficiary_is_minor')
      if (CHILD_BENEFICIARY_VALUES.has(beneficiaryType) && minorValue && !isAffirmative(minorValue)) {
        needsVerification = true
        note = 'not deductible/taxable — the child beneficiary is no longer a minor'
      }
    }

    // 5. Foreign currency — never summed as if it were CHF.
    const currencyFieldKey = CURRENCY_FIELD_BY_CATEGORY[doc.category_code]
    const currencyValue = currencyFieldKey ? siblingValue(doc.id, currencyFieldKey) : null
    let currencyCode = null
    if (!needsVerification && currencyValue && !isChfOrUnspecified(currencyValue)) {
      needsVerification = true
      currencyCode = currencyValue.trim().toUpperCase()
      note = `in foreign currency (${currencyCode}), not converted — manual verification needed`
    }

    // 6. Donations below the statutory minimum aren't deductible at all.
    if (!needsVerification && rule.cap_parameter_family === DONATION_CAP_FAMILY) {
      const minParam = useParam(DONATION_MIN_FAMILY)
      if (minParam && rawAmount < (minParam.value_numeric || 0)) {
        needsVerification = true
        note = `below the CHF ${minParam.value_numeric} minimum for a deductible donation`
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
  // currency, separate taxation, ...) contribute nothing from here on —
  // zeroed immediately, not just at the final rounding pass, so every
  // intermediate figure below (wealth-derived income, provisional income
  // for percentage thresholds) is correct too, not just the final total.
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
  const insuranceEntries = entries.filter((e) => !e.needsVerification && e.capFamily === INSURANCE_POOL_FAMILY)
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

  // Resolve every capped entry except percentage-type ones, which depend on
  // a provisional income figure computed further down.
  for (const entry of entries) {
    // Already excluded above (voided donation, foreign currency, separate
    // taxation, ...) — nothing left to resolve, and the cap/param logic
    // below would only overwrite that reason with an unrelated one.
    if (entry.needsVerification) continue
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
  // computed once across every salary_statement document combined, since
  // documents aren't attributed to a specific spouse. Added before
  // provisional income is computed, so it counts as an "organic" deduction
  // like every other one above.
  const netSalaryEntries = entries.filter(
    (e) => e.categoryCode === 'salary_statement' && e.fieldKey === 'net_salary' && !e.needsVerification
  )
  if (netSalaryEntries.length) {
    const pctParam = useParam('professional_expenses_pct')
    if (pctParam) {
      const totalNetSalary = netSalaryEntries.reduce((sum, e) => sum + e.rawAmount, 0)
      const minParam = useParam('professional_expenses_min')
      const maxParam = useParam('professional_expenses_max')
      let amount = (totalNetSalary * (pctParam.value_numeric || 0)) / 100
      if (minParam) amount = Math.max(amount, minParam.value_numeric || 0)
      if (maxParam) amount = Math.min(amount, maxParam.value_numeric || 0)
      entries.push(
        makeSyntheticEntry({
          contributionType: 'income_minus',
          rawAmount: amount,
          categoryLabel: 'Professional expenses (flat-rate)',
          fieldLabel:
            netSalaryEntries.length > 1
              ? 'Flat-rate professional expenses (3% of combined net salary, min/max applied)'
              : 'Flat-rate professional expenses (3% of net salary, min/max applied)',
          groupKey: 'deductions'
        })
      )
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

  for (const entry of generalDeferred) {
    const pct = entry.param.value_numeric || 0
    const cap = provisionalIncome * (pct / 100)
    entry.effective = Math.min(entry.rawAmount, cap)
    if (entry.effective < entry.rawAmount) entry.note = 'cap applied'
  }

  const incomeAfterGeneralDeductions = provisionalIncome - generalDeferred.reduce((sum, e) => sum + e.effective, 0)

  for (const entry of medicalDeferred) {
    const pct = entry.param.value_numeric || 0
    const threshold = incomeAfterGeneralDeductions * (pct / 100)
    entry.effective = Math.max(0, entry.rawAmount - threshold)
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
  // income-side child deduction above.
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
    const identifier = entry.documentId ? identifierByDocId[entry.documentId] : null
    const suffix = identifier || entry.fileName || null
    const label = suffix
      ? `${entry.fieldLabel} — ${entry.categoryLabel} ${identifier ? identifier : `(${entry.fileName})`}${entry.note ? ` — ${entry.note}` : ''}`
      : `${entry.fieldLabel} — ${entry.categoryLabel}${entry.note ? ` — ${entry.note}` : ''}`
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

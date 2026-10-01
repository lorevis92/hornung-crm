// Fee estimator — turns the questionnaire + the price list into an estimate.
// It is an ESTIMATE shown to the specialist (and, optionally, to the client);
// the final invoice always stays a human decision.

const MARRIED_STATUSES = ['married', 'registered_partnership']

function priceOf(items, code) {
  const item = items.find((i) => i.code === code)
  return item ? Number(item.price) : 0
}

function labelOf(items, code, lang = 'en') {
  const item = items.find((i) => i.code === code)
  if (!item) return code
  return item[`label_${lang}`] || item.label_en || code
}

function itemOf(items, code) {
  return items.find((i) => i.code === code) || null
}

/**
 * @param {Array}  pricingItems rows from pricing_items
 * @param {Object} input
 *   { persons, properties, deliveryByPost, express,
 *     excludedCodes, extraCodes, totalOverride }
 *
 *   The last three are the consultant's own edits (migration 47) and are all
 *   optional — omitting them gives exactly the automatic estimate this
 *   function has always produced:
 *     excludedCodes — derived lines switched OFF. Still derived, still
 *       listed (so the consultant can see what was waived), not counted.
 *     extraCodes    — lines added by hand, including the "further services"
 *       that have never fed the automatic estimate and still do not unless
 *       explicitly added here.
 *     totalOverride — a total typed by hand. Wins over the sum; null/''
 *       means "use the sum", which is what every case does by default.
 * @param {string} lang
 *
 * Returns { lines, computedTotal, total, isOverridden, ... }. `computedTotal`
 * is always the sum of the selected lines, kept alongside `total` so the
 * interface can show both when they differ — an override that hid the number
 * it replaced would be worse than no override at all.
 */
export function estimateFee(pricingItems = [], input = {}, lang = 'en') {
  const persons = input.persons || []
  const properties = input.properties || []
  const excludedCodes = new Set(input.excludedCodes || [])
  const primary = persons.find((p) => p.person_type === 'primary') || {}
  const spouse = persons.find((p) => p.person_type === 'spouse')

  const hasSpouse = Boolean(
    spouse && (spouse.first_name || spouse.last_name || spouse.date_of_birth)
  )
  const isMarried = MARRIED_STATUSES.includes(primary.marital_status) || hasSpouse

  const lines = []
  const push = (code, qty, unitPrice) => {
    const amount = Number((qty * unitPrice).toFixed(2))
    if (!qty || !unitPrice) return
    lines.push({
      code,
      label: labelOf(pricingItems, code, lang),
      qty,
      unitPrice,
      amount,
      source: 'auto',
      // Switched off for this case: shown, struck through, not counted.
      excluded: excludedCodes.has(code),
      onRequest: false
    })
  }

  // 1. Base fee
  const baseCode = isMarried ? 'base_married' : 'base_single'
  push(baseCode, 1, priceOf(pricingItems, baseCode))

  // 2. Properties (CH + abroad)
  const propertyCount = properties.filter((p) => p.address || p.purchase_price).length
  push('property', propertyCount, priceOf(pricingItems, 'property'))

  // 3. Asset statements — tiered
  const assetUnits = persons.reduce((sum, p) => sum + (Number(p.asset_statement_count) || 0), 0)
  if (assetUnits >= 20) push('assets_20', 1, priceOf(pricingItems, 'assets_20'))
  else if (assetUnits >= 10) push('assets_10', 1, priceOf(pricingItems, 'assets_10'))

  // 4. Self-employment
  const selfEmployed = persons.filter((p) => p.is_self_employed).length
  push('self_employed', selfEmployed, priceOf(pricingItems, 'self_employed'))

  // 5. Qualifying shareholdings
  const shareholdings = persons.reduce(
    (sum, p) => sum + (Number(p.qualifying_shareholdings) || 0),
    0
  )
  push('shareholding', shareholdings, priceOf(pricingItems, 'shareholding'))

  // 6. Surcharges
  if (input.deliveryByPost) push('postal_delivery', 1, priceOf(pricingItems, 'postal_delivery'))
  if (input.express) push('express', 1, priceOf(pricingItems, 'express'))

  // 7. Anything the consultant added by hand. A "further service" has no
  //    price (price on request), so it joins the list at 0 and is marked
  //    onRequest — it has to be visible on the estimate without silently
  //    pretending to be worth nothing.
  const autoCodes = new Set(lines.map((l) => l.code))
  for (const code of input.extraCodes || []) {
    if (autoCodes.has(code)) continue
    const item = itemOf(pricingItems, code)
    if (!item) continue
    const unitPrice = Number(item.price) || 0
    lines.push({
      code,
      label: labelOf(pricingItems, code, lang),
      qty: 1,
      unitPrice,
      amount: unitPrice,
      source: 'extra',
      excluded: excludedCodes.has(code),
      onRequest: Boolean(item.on_request) || unitPrice === 0
    })
  }

  const computedTotal = Number(
    lines.reduce((sum, l) => sum + (l.excluded ? 0 : l.amount), 0).toFixed(2)
  )

  const rawOverride = input.totalOverride
  const override =
    rawOverride === null || rawOverride === undefined || rawOverride === '' ? null : Number(rawOverride)
  const isOverridden = override !== null && Number.isFinite(override)

  return {
    lines,
    computedTotal,
    total: isOverridden ? Number(override.toFixed(2)) : computedTotal,
    isOverridden,
    assetUnits,
    propertyCount,
    isMarried
  }
}

export function pricingLabel(item, lang = 'en') {
  if (!item) return ''
  return item[`label_${lang}`] || item.label_en || item.code
}

export function pricingDescription(item, lang = 'en') {
  if (!item) return ''
  return item[`description_${lang}`] || item.description_en || ''
}

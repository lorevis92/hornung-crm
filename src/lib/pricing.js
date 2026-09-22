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

/**
 * @param {Array}  pricingItems rows from pricing_items
 * @param {Object} input
 *   { persons: [...], properties: [...], deliveryByPost: bool, express: bool }
 * @param {string} lang
 */
export function estimateFee(pricingItems = [], input = {}, lang = 'en') {
  const persons = input.persons || []
  const properties = input.properties || []
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
    lines.push({ code, label: labelOf(pricingItems, code, lang), qty, unitPrice, amount })
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

  const total = Number(lines.reduce((sum, l) => sum + l.amount, 0).toFixed(2))

  return { lines, total, assetUnits, propertyCount, isMarried }
}

export function pricingLabel(item, lang = 'en') {
  if (!item) return ''
  return item[`label_${lang}`] || item.label_en || item.code
}

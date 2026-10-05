import { ROW_KEY_DOCUMENT_LEVEL, ROW_PERSON_FIELDS } from './rowBasedFields.js'
import { buildRowIdentityLabel } from './rowIdentity.js'

// One document's extracted fields, arranged the way Tax Summary shows them:
// grouped into rows (one account, one premium, one property — see
// rowBasedFields.js), the document-level row first, each field in the
// order of the category's field dictionary and carrying its source.
//
// ONLY fields that actually have a value come back: a defined field the
// document says nothing about is simply absent, never an empty line.
//
// fieldDefs: category_field_definitions rows for the document's category.
// extractedFields: extracted_document_fields rows for the document.
//
// Returns [{ rowKey, label, person, currency, fields: [{ field_key, label,
//   value, value_type, source_quote, source_page }] }]. A row's label is the
// readable name the extraction gave it (row_label), else one built from its
// identity fields, else null; `person` is whose row it is, from the row's
// own person field (account holder, insured person, ...) when it has one.
export function groupDocumentRows(fieldDefs, extractedFields, categoryCode) {
  const defs = [...(fieldDefs || [])].sort((a, b) => a.sort_order - b.sort_order)
  const defByKey = new Map(defs.map((d) => [d.field_key, d]))
  const order = new Map(defs.map((d, i) => [d.field_key, i]))

  const byRow = new Map()
  for (const field of extractedFields || []) {
    if (!defByKey.has(field.field_key)) continue
    if (!String(field.field_value ?? '').trim()) continue
    const rowKey = field.row_key || ROW_KEY_DOCUMENT_LEVEL
    if (!byRow.has(rowKey)) byRow.set(rowKey, [])
    byRow.get(rowKey).push(field)
  }

  const documentCurrency = byRow.get(ROW_KEY_DOCUMENT_LEVEL)?.find((f) => f.field_key === 'currency')?.field_value || null
  const rowKeys = [...byRow.keys()].sort((a, b) =>
    a === ROW_KEY_DOCUMENT_LEVEL ? -1 : b === ROW_KEY_DOCUMENT_LEVEL ? 1 : 0
  )

  return rowKeys.map((rowKey) => {
    const fields = byRow.get(rowKey).sort((a, b) => order.get(a.field_key) - order.get(b.field_key))
    const valueOf = (key) => fields.find((f) => f.field_key === key)?.field_value
    const isRow = rowKey !== ROW_KEY_DOCUMENT_LEVEL
    const personField = (ROW_PERSON_FIELDS[categoryCode] || []).find((key) => valueOf(key))
    return {
      rowKey,
      label: isRow
        ? fields.find((f) => f.row_label)?.row_label || buildRowIdentityLabel({ categoryCode, fieldAt: valueOf })
        : null,
      person: isRow && personField ? valueOf(personField) : null,
      currency: valueOf('currency') || documentCurrency,
      fields: fields.map((f) => ({
        field_key: f.field_key,
        label: defByKey.get(f.field_key).field_label || f.field_key,
        value: f.field_value,
        value_type: defByKey.get(f.field_key).value_type || 'text',
        source_quote: f.source_quote || null,
        source_page: f.source_page || null
      }))
    }
  })
}

// Shared by api/extract-document.js (a fresh "property_tax_value" extraction
// proposes a client_properties row automatically) and any future manual
// re-run — reads the extraction + the property already linked to this
// document (if any), runs the pure buildPropertySuggestionPayload(), and
// writes a single pending client_field_suggestions row. Never writes to
// client_properties directly — accepting is always a specialist action
// (src/lib/data/supabaseData.js's resolveFieldSuggestion).
import { buildPropertySuggestionPayload, normalizePropertyAddress } from '../src/lib/personalDetails.js'

export async function syncPropertySuggestion(admin, documentId) {
  const { data: doc, error: docError } = await admin
    .from('client_documents')
    .select('id, client_id, category_code')
    .eq('id', documentId)
    .maybeSingle()
  if (docError) throw docError
  if (!doc || doc.category_code !== 'property_tax_value') return { suggested: false }

  const [{ data: fields, error: fieldsError }, { data: clientProperties, error: propError }] = await Promise.all([
    admin.from('extracted_document_fields').select('field_key, field_value').eq('document_id', documentId),
    admin.from('client_properties').select('*').eq('client_id', doc.client_id)
  ])
  if (fieldsError) throw fieldsError
  if (propError) throw propError

  // The same real property can already exist from a DIFFERENT document
  // (a tax-value statement, a mortgage certificate, a rental statement,
  // ...) — matched by document first (this exact document re-extracted),
  // then by normalized address (a different document naming the same
  // property), so accepting this proposal updates that one row instead of
  // creating a duplicate.
  const addressField = (fields || []).find((f) => f.field_key === 'property_address')
  const normalizedIncoming = normalizePropertyAddress(addressField?.field_value)
  const existingProperty =
    (clientProperties || []).find((p) => p.source_document_id === documentId) ||
    (normalizedIncoming
      ? (clientProperties || []).find((p) => normalizePropertyAddress(p.address) === normalizedIncoming)
      : null) ||
    null

  const proposal = buildPropertySuggestionPayload({ extractedFields: fields || [], existingProperty })
  if (!proposal) return { suggested: false }

  const { error } = await admin.from('client_field_suggestions').upsert(
    {
      client_id: doc.client_id,
      document_id: documentId,
      target_table: 'client_properties',
      target_person: 'none',
      target_field: `property:${documentId}`,
      field_label: 'Property',
      current_value: existingProperty ? existingProperty.address : null,
      suggested_value: JSON.stringify(proposal.payload),
      created_at: new Date().toISOString()
    },
    { onConflict: 'client_id,target_table,target_person,target_field' }
  )
  if (error) throw error
  return { suggested: true }
}

// Merges existing duplicate client_properties rows for a client — the
// address-matching above only ever prevents a NEW duplicate from being
// created; a client whose duplicates were already accepted before that
// fix existed (five rows for two real properties, one per document that
// happened to mention each one) needs them consolidated too. Called from
// api/reprocess-client-year.js ("Reload everything from the documents"),
// the existing mechanism for healing a client already in production.
// Keeps the row with the most fields already filled in as the survivor,
// merging in anything the others have that it doesn't, then deletes the
// rest — never drops a real value in favor of an emptier duplicate.
export async function dedupeClientProperties(admin, clientId) {
  const { data: properties, error } = await admin.from('client_properties').select('*').eq('client_id', clientId)
  if (error) throw error
  if (!properties?.length) return { merged: 0 }

  const groups = new Map()
  for (const property of properties) {
    const key = normalizePropertyAddress(property.address)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(property)
  }

  let merged = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const filledCount = (p) => Object.values(p).filter((v) => v != null && v !== '').length
    const [survivor, ...duplicates] = group.sort((a, b) => filledCount(b) - filledCount(a))
    const mergedPatch = {}
    for (const dup of duplicates) {
      for (const [key, value] of Object.entries(dup)) {
        if (['id', 'client_id', 'created_at'].includes(key)) continue
        if ((survivor[key] == null || survivor[key] === '') && value != null && value !== '') {
          mergedPatch[key] = value
        }
      }
    }
    if (Object.keys(mergedPatch).length) {
      const { error: updateError } = await admin.from('client_properties').update(mergedPatch).eq('id', survivor.id)
      if (updateError) throw updateError
    }
    const { error: deleteError } = await admin
      .from('client_properties')
      .delete()
      .in('id', duplicates.map((d) => d.id))
    if (deleteError) throw deleteError
    merged += duplicates.length
  }
  return { merged }
}

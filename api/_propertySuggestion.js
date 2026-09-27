// Shared by api/extract-document.js (a fresh "property_tax_value" extraction
// proposes a client_properties row automatically) and any future manual
// re-run — reads the extraction + the property already linked to this
// document (if any), runs the pure buildPropertySuggestionPayload(), and
// writes a single pending client_field_suggestions row. Never writes to
// client_properties directly — accepting is always a specialist action
// (src/lib/data/supabaseData.js's resolveFieldSuggestion).
import { buildPropertySuggestionPayload } from '../src/lib/personalDetails.js'

export async function syncPropertySuggestion(admin, documentId) {
  const { data: doc, error: docError } = await admin
    .from('client_documents')
    .select('id, client_id, category_code')
    .eq('id', documentId)
    .maybeSingle()
  if (docError) throw docError
  if (!doc || doc.category_code !== 'property_tax_value') return { suggested: false }

  const [{ data: fields, error: fieldsError }, { data: existingProperty, error: propError }] = await Promise.all([
    admin.from('extracted_document_fields').select('field_key, field_value').eq('document_id', documentId),
    admin.from('client_properties').select('*').eq('source_document_id', documentId).maybeSingle()
  ])
  if (fieldsError) throw fieldsError
  if (propError) throw propError

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

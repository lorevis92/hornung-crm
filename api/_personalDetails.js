// Shared by api/extract-document.js (a fresh "current_tax_sheet" extraction
// syncs the client's registry automatically) and api/sync-personal-details.js
// (re-run after a specialist manually corrects one of those fields) — reads
// the extraction + the client's current registry state, runs the pure
// computePersonalDetailsSync(), and applies the result: empty fields are
// filled in directly, fields that already hold a different value become a
// pending row in client_field_suggestions instead of being overwritten.
import { computePersonalDetailsSync } from '../src/lib/personalDetails.js'

const TABLE_BY_TARGET = { clients: 'clients', client_persons: 'client_persons' }

export async function syncPersonalDetails(admin, documentId) {
  const { data: doc, error: docError } = await admin
    .from('client_documents')
    .select('id, client_id, category_code')
    .eq('id', documentId)
    .maybeSingle()
  if (docError) throw docError
  if (!doc || doc.category_code !== 'current_tax_sheet') {
    return { autoFilled: [], suggestions: [] }
  }
  const clientId = doc.client_id

  const [{ data: fields, error: fieldsError }, { data: client, error: clientError }, { data: persons, error: personsError }] =
    await Promise.all([
      admin.from('extracted_document_fields').select('field_key, field_value, confidence').eq('document_id', documentId),
      admin.from('clients').select('id, canton').eq('id', clientId).maybeSingle(),
      admin.from('client_persons').select('*').eq('client_id', clientId)
    ])
  if (fieldsError) throw fieldsError
  if (clientError) throw clientError
  if (personsError) throw personsError
  if (!client) return { autoFilled: [], suggestions: [] }

  const primary = (persons || []).find((p) => p.person_type === 'primary') || null
  const spouse = (persons || []).find((p) => p.person_type === 'spouse') || null

  const { autoFill, suggestions, resolved } = computePersonalDetailsSync({
    extractedFields: fields || [],
    canton: client.canton,
    primary,
    spouse
  })

  // ------------------------------------------------------------ auto-fill --
  const clientPatch = {}
  const primaryPatch = {}
  const spousePatch = {}
  for (const item of autoFill) {
    if (item.table === 'clients') clientPatch[item.field] = item.value
    else if (item.person === 'primary') primaryPatch[item.field] = item.value
    else if (item.person === 'spouse') spousePatch[item.field] = item.value
  }

  if (Object.keys(clientPatch).length) {
    const { error } = await admin.from('clients').update(clientPatch).eq('id', clientId)
    if (error) throw error
  }
  if (Object.keys(primaryPatch).length) {
    const { error } = primary
      ? await admin.from('client_persons').update(primaryPatch).eq('id', primary.id)
      : await admin.from('client_persons').insert({ client_id: clientId, person_type: 'primary', ...primaryPatch })
    if (error) throw error
  }
  if (Object.keys(spousePatch).length) {
    const { error } = spouse
      ? await admin.from('client_persons').update(spousePatch).eq('id', spouse.id)
      : await admin.from('client_persons').insert({ client_id: clientId, person_type: 'spouse', ...spousePatch })
    if (error) throw error
  }

  // -------------------------------------------------------- conflicts -----
  for (const s of suggestions) {
    const { error } = await admin.from('client_field_suggestions').upsert(
      {
        client_id: clientId,
        document_id: documentId,
        target_table: TABLE_BY_TARGET[s.table],
        target_person: s.person,
        target_field: s.field,
        field_label: s.fieldLabel,
        current_value: s.currentValue,
        suggested_value: s.suggestedValue,
        created_at: new Date().toISOString()
      },
      { onConflict: 'client_id,target_table,target_person,target_field' }
    )
    if (error) throw error
  }

  // A field extracted here that now matches the registry exactly makes any
  // previous pending suggestion for it moot.
  for (const r of resolved) {
    const { error } = await admin
      .from('client_field_suggestions')
      .delete()
      .eq('client_id', clientId)
      .eq('target_table', TABLE_BY_TARGET[r.table])
      .eq('target_person', r.person)
      .eq('target_field', r.field)
    if (error) throw error
  }

  return { autoFilled: autoFill, suggestions }
}

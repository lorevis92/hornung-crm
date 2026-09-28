// Shared by api/extract-document.js — re-run whenever a "current_tax_sheet"
// (gives the child count) or "childcare_costs" (gives a child's name) document
// finishes extraction for a client/year, so whichever one lands second is the
// one that actually produces a useful suggestion. Cross-references both
// against the client's existing client_children rows via the pure
// buildChildSuggestionCandidates(), then writes one pending
// client_field_suggestions row per still-missing child, pre-filled with the
// name found — never writes to client_children directly, a date of birth
// still needs a specialist.
import { buildChildSuggestionCandidates } from '../src/lib/personalDetails.js'

function slugify(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function syncChildSuggestions(admin, clientId, taxYear) {
  const [{ data: documents, error: docsError }, { data: existingChildren, error: childrenError }] = await Promise.all([
    admin
      .from('client_documents')
      .select('id, category_code')
      .eq('client_id', clientId)
      .eq('tax_year', taxYear)
      .in('category_code', ['current_tax_sheet', 'childcare_costs']),
    admin.from('client_children').select('full_name').eq('client_id', clientId)
  ])
  if (docsError) throw docsError
  if (childrenError) throw childrenError
  if (!documents?.length) return { suggested: 0 }

  const sheetDocIds = documents.filter((d) => d.category_code === 'current_tax_sheet').map((d) => d.id)
  const careDocIds = documents.filter((d) => d.category_code === 'childcare_costs').map((d) => d.id)

  const [{ data: sheetFields, error: sheetError }, { data: careFields, error: careError }] = await Promise.all([
    sheetDocIds.length
      ? admin.from('extracted_document_fields').select('field_value').in('document_id', sheetDocIds).eq('field_key', 'children_count')
      : Promise.resolve({ data: [], error: null }),
    careDocIds.length
      ? admin.from('extracted_document_fields').select('field_value').in('document_id', careDocIds).eq('field_key', 'child_name')
      : Promise.resolve({ data: [], error: null })
  ])
  if (sheetError) throw sheetError
  if (careError) throw careError

  const childrenCount = (sheetFields || [])
    .map((f) => parseInt(f.field_value, 10))
    .find((n) => Number.isFinite(n))
  const candidateNames = (careFields || []).map((f) => f.field_value).filter(Boolean)

  const candidates = buildChildSuggestionCandidates({
    childrenCount,
    candidateNames,
    existingChildren: existingChildren || []
  })
  if (!candidates.length) return { suggested: 0 }

  const rows = candidates.map((c) => ({
    client_id: clientId,
    document_id: null,
    target_table: 'client_children',
    target_person: 'none',
    target_field: `child:${slugify(c.key)}`,
    field_label: 'Child',
    current_value: null,
    suggested_value: JSON.stringify({ full_name: c.full_name }),
    created_at: new Date().toISOString()
  }))
  const { error } = await admin
    .from('client_field_suggestions')
    .upsert(rows, { onConflict: 'client_id,target_table,target_person,target_field' })
  if (error) throw error
  return { suggested: rows.length }
}

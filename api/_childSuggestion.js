// Shared by api/extract-document.js — re-run whenever a "current_tax_sheet"
// (gives the child count) or "childcare_costs" (gives a child's name, and,
// when the same invoice states it, a date of birth) document finishes
// extraction for a client/year, so whichever one lands second is the one
// that actually produces a useful suggestion. Cross-references both
// against the client's existing client_children rows via the pure
// buildChildSuggestionCandidates(), then writes one pending
// client_field_suggestions row per still-missing child, pre-filled with
// whatever was found — never writes to client_children directly, the
// specialist still confirms by accepting the suggestion.
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

  const [
    { data: sheetCountFields, error: sheetCountError },
    { data: sheetDobFields, error: sheetDobError },
    { data: careNameFields, error: careNameError },
    { data: careDobFields, error: careDobError }
  ] = await Promise.all([
    sheetDocIds.length
      ? admin.from('extracted_document_fields').select('field_value').in('document_id', sheetDocIds).eq('field_key', 'children_count')
      : Promise.resolve({ data: [], error: null }),
    // The personal-details letter often states the child's date of birth
    // itself (see migration 35) — only ever a single value, since
    // current_tax_sheet has no per-child name field to attribute it to.
    sheetDocIds.length
      ? admin.from('extracted_document_fields').select('field_value').in('document_id', sheetDocIds).eq('field_key', 'child_date_of_birth')
      : Promise.resolve({ data: [], error: null }),
    careDocIds.length
      ? admin.from('extracted_document_fields').select('document_id, field_value').in('document_id', careDocIds).eq('field_key', 'child_name')
      : Promise.resolve({ data: [], error: null }),
    careDocIds.length
      ? admin
          .from('extracted_document_fields')
          .select('document_id, field_value')
          .in('document_id', careDocIds)
          .eq('field_key', 'child_date_of_birth')
      : Promise.resolve({ data: [], error: null })
  ])
  if (sheetCountError) throw sheetCountError
  if (sheetDobError) throw sheetDobError
  if (careNameError) throw careNameError
  if (careDobError) throw careDobError

  const childrenCount = (sheetCountFields || [])
    .map((f) => parseInt(f.field_value, 10))
    .find((n) => Number.isFinite(n))
  const sheetDateOfBirth = (sheetDobFields || []).map((f) => f.field_value).find(Boolean) || null
  // One child_name per childcare_costs document — its own
  // child_date_of_birth, if the same document states one, travels with it
  // by document_id rather than by position.
  const dobByDocId = Object.fromEntries((careDobFields || []).map((f) => [f.document_id, f.field_value]))
  const nameCandidates = (careNameFields || [])
    .filter((f) => f.field_value)
    .map((f) => ({ name: f.field_value, dateOfBirth: dobByDocId[f.document_id] || null }))

  const candidates = buildChildSuggestionCandidates({
    childrenCount,
    candidates: nameCandidates,
    existingChildren: existingChildren || [],
    fallbackDateOfBirth: sheetDateOfBirth
  })
  if (!candidates.length) return { suggested: 0 }

  // Deduped by target_field before the upsert: two distinct candidate keys
  // can still slugify to the identical string (e.g. "Anne-Sophie" and
  // "Anne Sophie" both collapse to "anne-sophie") — a single upsert
  // statement containing two rows for the same conflict key is a Postgres
  // error ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"), not just a silent overwrite, so this has to be prevented
  // before the row list is built rather than left to the database.
  const rowsByTargetField = new Map()
  for (const c of candidates) {
    const target_field = `child:${slugify(c.key)}`
    rowsByTargetField.set(target_field, {
      client_id: clientId,
      document_id: null,
      target_table: 'client_children',
      target_person: 'none',
      target_field,
      field_label: 'Child',
      current_value: null,
      suggested_value: JSON.stringify(c.date_of_birth ? { full_name: c.full_name, date_of_birth: c.date_of_birth } : { full_name: c.full_name }),
      created_at: new Date().toISOString()
    })
  }
  const rows = Array.from(rowsByTargetField.values())
  const { error } = await admin
    .from('client_field_suggestions')
    .upsert(rows, { onConflict: 'client_id,target_table,target_person,target_field' })
  if (error) throw error
  return { suggested: rows.length }
}

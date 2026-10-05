// Implementation behind scripts/export-weber-fixture.mjs — pulls one client's real,
// specialist-reviewed data out of production and writes it to a
// test/fixtures/*.json golden-case fixture, the same JSON shape the
// golden-case tests (test/weber-extraction.test.js) run the row model and
// the data-quality checks against directly, with no live
// database or AI call involved in the tests themselves. This is the ONLY
// place that talks to the real backend; re-run it (deliberately, not
// automatically) if a golden case is ever re-reviewed and its fixture needs
// refreshing.
//
// Reads every credential from the environment — never hardcode a URL, key,
// email or password here, and never commit a version of this file that does.
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

function must(label, { data, error }) {
  if (error) {
    console.error(`FAILED: ${label}`, error)
    process.exit(1)
  }
  return data
}

// clientEmail/taxYear/outFile: the one client/year this fixture is for.
export async function exportClientFixture({ clientEmail, taxYear, outFile }) {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const specialistEmail = process.env.SPECIALIST_EMAIL
  const specialistPassword = process.env.SPECIALIST_PASSWORD

  if (!url || !anonKey || !specialistEmail || !specialistPassword) {
    console.error('Missing one of SUPABASE_URL / SUPABASE_ANON_KEY / SPECIALIST_EMAIL / SPECIALIST_PASSWORD in the environment.')
    process.exit(1)
  }

  const supabase = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: specialistEmail,
    password: specialistPassword
  })
  if (signInError) {
    console.error('Sign-in failed:', signInError)
    process.exit(1)
  }

  const client = must(
    'lookup client',
    await supabase.from('clients').select('id, email, canton').eq('email', clientEmail).maybeSingle()
  )
  if (!client) throw new Error(`No client found for ${clientEmail}`)
  const clientId = client.id

  const persons = must(
    'client_persons',
    await supabase.from('client_persons').select('*').eq('client_id', clientId)
  )
  const children = must(
    'client_children',
    await supabase.from('client_children').select('*').eq('client_id', clientId).order('sort_order', { ascending: true })
  )
  const documents = must(
    'client_documents',
    await supabase
      .from('client_documents')
      .select('id, file_name, category_code, status, tax_year, mime_type, uploaded_at')
      .eq('client_id', clientId)
      .eq('tax_year', taxYear)
      .order('uploaded_at', { ascending: true })
  )
  // Excludes anything matching this app's own synthetic-artifact naming
  // conventions (see the last two cleanup rounds) — the golden case is the
  // client's REAL documents, not test/debug leftovers that happened to
  // still be present in production when this export ran.
  const ARTIFACT_NAME_RE = /^pasted-text-\d+\.txt$|-tax-summary(?: \(\d+\))?\.pdf$/i
  const realDocuments = documents.filter((d) => !ARTIFACT_NAME_RE.test(d.file_name || ''))
  const documentIds = realDocuments.map((d) => d.id)

  const extractedFields = documentIds.length
    ? must(
        'extracted_document_fields',
        await supabase
          .from('extracted_document_fields')
          .select('document_id, field_key, row_key, row_label, field_value, confidence, source_quote, source_page')
          .in('document_id', documentIds)
      )
    : []

  const categories = must('document_categories', await supabase.from('document_categories').select('*').eq('active', true))
  const fieldDefs = must('category_field_definitions', await supabase.from('category_field_definitions').select('*'))

  const fixture = {
    exportedAt: new Date().toISOString(),
    taxYear,
    client: { canton: client.canton },
    primaryPerson: persons.find((p) => p.person_type === 'primary') || null,
    spousePerson: persons.find((p) => p.person_type === 'spouse') || null,
    children,
    documents: realDocuments.map(({ id, file_name, category_code, status, mime_type, person_ref, person_name, person_quote, person_page }) => ({
      id,
      file_name,
      category_code,
      status,
      mime_type,
      person_ref,
      person_name,
      person_quote,
      person_page
    })),
    extractedFields,
    categories,
    fieldDefs
  }

  writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`Wrote ${outFile}`)
  console.log({
    documents: realDocuments.length,
    excludedArtifacts: documents.length - realDocuments.length,
    extractedFields: extractedFields.length,
    children: children.length,
    hasPrimary: Boolean(fixture.primaryPerson),
    hasSpouse: Boolean(fixture.spousePerson)
  })

  await supabase.auth.signOut()
}

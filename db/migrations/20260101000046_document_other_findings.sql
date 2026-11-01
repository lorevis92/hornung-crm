-- ---------------------------------------------------------------------------
-- 46 — "Other information found in this document"
--
-- Extraction has always worked off a fixed whitelist per category
-- (category_field_definitions: for a bank statement the holder, the IBAN,
-- the institution, the balance, ...). That whitelist is validated and works
-- well, and this migration does not change it. What it adds is the safety
-- net underneath it: anything in a document that a tax consultant would
-- care about but that no whitelist field covers — an unusual clause, a
-- one-off charge, a date nobody anticipated — had nowhere to go and was
-- simply dropped on the floor, silently.
--
-- Rows here are written by api/extract-document.js in two ways:
--   origin = 'extraction'     — the model volunteered it alongside the
--                               whitelist fields, in the same call.
--   origin = 'coverage_check' — a second pass that gets the document AND
--                               everything extracted from it so far, and is
--                               asked which amounts, names and dates in the
--                               text are not represented in that output.
--
-- needs_review marks an item the coverage pass itself was unsure about
-- (it found something, but could not say confidently what it is). Those
-- surface as an explicit open question in Tax Summary
-- (src/lib/extractionQuality.js, kind 'otherFindingNeedsReview') rather
-- than sitting quietly in the list — the rule being that nothing found is
-- ever discarded, but an uncertain reading is never presented as a fact.
--
-- Fully recomputed per document: api/extract-document.js deletes this
-- document's rows before writing the new ones, so re-extracting a document
-- replaces its findings rather than accumulating duplicates. Nothing here
-- is client-editable; it is read-only evidence pointing back at the source.
-- ---------------------------------------------------------------------------
create table if not exists public.document_other_findings (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.client_documents(id) on delete cascade,
  -- Free-form descriptive label chosen by the model ("Early repayment
  -- penalty", "Tassa di bollo") — deliberately NOT constrained to a
  -- dictionary: the whole point is to capture what the schema did not
  -- anticipate.
  label         text not null,
  finding_value text not null,
  -- Same contract as extracted_document_fields: verbatim text from the
  -- document, so the UI can open the source and highlight it.
  source_quote  text,
  source_page   integer,
  origin        text not null default 'extraction'
                check (origin in ('extraction', 'coverage_check')),
  confidence    numeric(4,3),
  needs_review  boolean not null default false,
  review_note   text,
  created_at    timestamptz not null default now()
);

create index if not exists document_other_findings_document_idx
  on public.document_other_findings (document_id);

alter table public.document_other_findings enable row level security;

-- Same audience as extracted_document_fields: staff only. The service-role
-- client used by api/extract-document.js bypasses RLS entirely.
drop policy if exists "document other findings: staff only" on public.document_other_findings;
create policy "document other findings: staff only" on public.document_other_findings for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

comment on table public.document_other_findings is
  'Values found in a document that no category_field_definitions whitelist field covers. Written by api/extract-document.js (see migration 46); replaced wholesale on re-extraction.';

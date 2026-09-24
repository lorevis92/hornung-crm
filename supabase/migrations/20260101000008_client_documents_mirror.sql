-- ===========================================================================
-- 08 — Mirror case_documents into client_documents
-- ---------------------------------------------------------------------------
-- The client-facing upload flow (CasePage.jsx -> case_documents) is
-- unchanged. This migration keeps the new extraction-module table
-- (client_documents, added in 20260101000007_tax_extraction_schema.sql) in
-- sync with it automatically, via a DB trigger rather than an application
-- hook, so it can never fall out of sync no matter which code path a
-- document is uploaded or deleted from (today's or a future one).
--
-- - INSERT into case_documents  -> mirrored into client_documents
--   (client_id/tax_year resolved from the case, category_code left null —
--   assigned later by the specialist).
-- - DELETE from case_documents  -> the mirrored client_documents row is
--   removed automatically, via the FK's `on delete cascade` below (no
--   trigger needed for this direction).
--
-- Existing case_documents rows (uploaded before this migration) are
-- backfilled once, so the specialist can assign a category to documents
-- that were already uploaded, not just future ones.
--
-- IMPORTANT: run this manually in the Supabase SQL editor, like every other
-- migration here — merging to GitHub does not apply it to the live database.
-- ===========================================================================

alter table public.client_documents
  add column if not exists source_case_document_id
    uuid unique references public.case_documents(id) on delete cascade;

-- Backfill: one client_documents row per pre-existing case_documents row.
insert into public.client_documents
  (client_id, tax_year, category_code, storage_path, file_name, file_size, mime_type,
   status, uploaded_by, uploaded_at, source_case_document_id)
select tc.client_id, tc.tax_year, null, cd.storage_path, cd.file_name, cd.file_size, cd.mime_type,
       'uploaded', cd.uploaded_by, cd.created_at, cd.id
from public.case_documents cd
join public.tax_cases tc on tc.id = cd.case_id
on conflict (source_case_document_id) do nothing;

-- Going forward: mirror every new case_documents row automatically.
create or replace function public.mirror_case_document_to_client_documents()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_tax_year  integer;
begin
  select tc.client_id, tc.tax_year into v_client_id, v_tax_year
  from public.tax_cases tc
  where tc.id = new.case_id;

  insert into public.client_documents
    (client_id, tax_year, category_code, storage_path, file_name, file_size, mime_type,
     status, uploaded_by, uploaded_at, source_case_document_id)
  values
    (v_client_id, v_tax_year, null, new.storage_path, new.file_name, new.file_size, new.mime_type,
     'uploaded', new.uploaded_by, new.created_at, new.id)
  on conflict (source_case_document_id) do nothing;

  return new;
end;
$$;

drop trigger if exists case_documents_mirror_to_client_documents on public.case_documents;
create trigger case_documents_mirror_to_client_documents
  after insert on public.case_documents
  for each row execute function public.mirror_case_document_to_client_documents();

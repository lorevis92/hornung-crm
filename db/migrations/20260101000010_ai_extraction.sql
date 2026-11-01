-- ===========================================================================
-- 10 — Automatic AI extraction pipeline
-- ---------------------------------------------------------------------------
-- Wires client_documents to /api/extract-document: as soon as a row lands
-- with status = 'uploaded' (via the mirror trigger in
-- 20260101000008_client_documents_mirror.sql, for every upload regardless of
-- which code path created it), a Postgres trigger fires an async HTTP call
-- (pg_net) to the serverless endpoint, which classifies the document against
-- document_categories and extracts the fields defined for that category in
-- category_field_definitions — read fresh at call time, so staff edits made
-- from /tax-settings are always picked up.
--
-- BUGFIX: 20260101000007_tax_extraction_schema.sql declared
-- client_documents.category_code as `not null`, but the whole point of this
-- pipeline (and of the mirror trigger already in production) is that it
-- starts unassigned and gets filled in by the classification phase. Relaxing
-- it here — this was never valid data, so nothing existing can violate it.
--
-- IMPORTANT — manual steps required (same as every migration here, run in
-- the Supabase SQL editor):
--   1. Run this file.
--   2. If `create extension pg_net` below fails with a permissions error,
--      enable it instead via Dashboard -> Database -> Extensions -> pg_net.
--   3. Set the webhook secret at the database level (NOT stored in this
--      file — never commit a real secret to git). Use the exact same value
--      you set for EXTRACTION_WEBHOOK_SECRET in Vercel's env vars:
--        alter database postgres set app.settings.extraction_webhook_secret = 'REPLACE_WITH_THE_SAME_SECRET';
--   4. Only if this project is NOT deployed at https://hornung-crm.vercel.app,
--      also override the target URL:
--        alter database postgres set app.settings.extraction_webhook_url = 'https://<your-domain>/api/extract-document';
--   5. In Vercel, set ANTHROPIC_API_KEY and EXTRACTION_WEBHOOK_SECRET
--      (see .env.example).
--   6. New Postgres connections pick up `alter database ... set` immediately;
--      existing pooled connections may need the pooler/project restarted.
-- Until step 3 is done, uploads still work exactly as before — the trigger
-- just logs a notice and skips the webhook call.
-- ===========================================================================

alter table public.client_documents alter column category_code drop not null;

alter table public.client_documents
  drop constraint if exists client_documents_status_check,
  add constraint client_documents_status_check
    check (status in ('uploaded','extracting','extracted','verified_by_specialist','rejected','extraction_failed'));

create extension if not exists pg_net;

create or replace function public.notify_document_uploaded()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url    text := coalesce(
    current_setting('app.settings.extraction_webhook_url', true),
    'https://hornung-crm.vercel.app/api/extract-document'
  );
  v_secret text := current_setting('app.settings.extraction_webhook_secret', true);
begin
  if v_secret is null or v_secret = '' then
    raise notice 'extract-document: webhook secret not configured, skipping automatic extraction for %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('documentId', new.id)
  );

  return new;
end;
$$;

drop trigger if exists client_documents_notify_uploaded on public.client_documents;
create trigger client_documents_notify_uploaded
  after insert on public.client_documents
  for each row
  when (new.status = 'uploaded')
  execute function public.notify_document_uploaded();

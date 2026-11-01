-- ===========================================================================
-- 11 — Fix: read the extraction webhook secret from a table, not a GUC
-- ---------------------------------------------------------------------------
-- 20260101000010_ai_extraction.sql read the secret via
-- `current_setting('app.settings.extraction_webhook_secret', true)`, meant to
-- be set with `alter database postgres set app.settings.xxx = '...'`. On
-- Supabase's hosted Postgres that command fails from the SQL editor with
-- "permission denied to set parameter" — it needs superuser, which isn't
-- available, and there is no "Custom Postgres config" dashboard section on
-- this project either. That approach cannot work here.
--
-- Fix: store it in a normal table instead, `public.app_settings`, locked down
-- so only the service role (used server-side, e.g. by serviceClient() in
-- api/_lib.js) can read or write it. RLS is enabled with NO policies at all —
-- for anon/authenticated that means every operation is denied by default;
-- service_role bypasses RLS entirely (same as every other serviceClient()
-- call in this codebase), so no policy is needed there.
--
-- This migration repeats the idempotent parts of 20260101000010 (nullable
-- fix, status check, pg_net, trigger function/trigger) in case that
-- migration's transaction rolled back entirely when the `alter database`
-- statement failed — running this file brings the database fully up to date
-- whether or not 20260101000010 partially applied. Nothing about the
-- case_documents -> client_documents mirror trigger (20260101000008) is
-- touched.
--
-- IMPORTANT — manual steps required (Supabase SQL editor, no special
-- permissions needed this time):
--   1. Run this file.
--   2. If `create extension pg_net` fails with a permissions error, enable
--      it instead via Dashboard -> Database -> Extensions -> pg_net.
--   3. Set the webhook secret (NOT stored in this file — never commit a real
--      secret to git). Use the exact same value you set for
--      EXTRACTION_WEBHOOK_SECRET in Vercel's env vars:
--        insert into public.app_settings (key, value)
--        values ('extraction_webhook_secret', 'REPLACE_WITH_THE_SAME_SECRET')
--        on conflict (key) do update set value = excluded.value;
--   4. Only if this project is NOT deployed at https://hornung-crm.vercel.app,
--      also override the target URL:
--        insert into public.app_settings (key, value)
--        values ('extraction_webhook_url', 'https://<your-domain>/api/extract-document')
--        on conflict (key) do update set value = excluded.value;
--   5. In Vercel, set ANTHROPIC_API_KEY and EXTRACTION_WEBHOOK_SECRET
--      (see .env.example).
-- Until step 3 is done, uploads still work exactly as before — the trigger
-- just logs a notice and skips the webhook call.
-- ===========================================================================

create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

alter table public.app_settings enable row level security;
-- Deliberately no policies: RLS with zero policies denies every operation to
-- anon/authenticated, and service_role bypasses RLS entirely — exactly the
-- "service-role only" access this secret store needs.

-- ---- repeat of the idempotent parts of 20260101000010, safe to re-run -----
alter table public.client_documents alter column category_code drop not null;

alter table public.client_documents
  drop constraint if exists client_documents_status_check,
  add constraint client_documents_status_check
    check (status in ('uploaded','extracting','extracted','verified_by_specialist','rejected','extraction_failed'));

create extension if not exists pg_net;

create or replace function public.notify_document_uploaded()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_secret from public.app_settings where key = 'extraction_webhook_secret';
  if v_secret is null or v_secret = '' then
    raise notice 'extract-document: webhook secret not configured, skipping automatic extraction for %', new.id;
    return new;
  end if;

  select value into v_url from public.app_settings where key = 'extraction_webhook_url';
  v_url := coalesce(v_url, 'https://hornung-crm.vercel.app/api/extract-document');

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

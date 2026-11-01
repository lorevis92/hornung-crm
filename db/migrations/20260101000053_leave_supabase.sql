-- ===========================================================================
-- 53 — LEAVING SUPABASE, step 2: a plain Postgres (Neon)
-- ---------------------------------------------------------------------------
-- From migration 52 / branch migrazione-infra on, nothing reaches the
-- database except the server code, as the database owner, and every
-- authorization decision is made there (api/_dataOps.js, api/_lib.js). What
-- Supabase needed on top of that goes:
--
--   1. the extraction webhook (a pg_net trigger calling /api/extract-document
--      after every upload) -> replaced by the Cloudflare Queue the server
--      fills when a document is registered (api/_extractionQueue.js);
--   2. the transition of migration 52 tied to Supabase Auth: the triggers
--      that mirrored auth.users into auth_accounts;
--   3. every RLS policy and RLS itself (redundant: no anon/authenticated
--      connection exists any more), plus the SQL helpers that only policies
--      and the browser-side RPCs used (they all read auth.uid());
--   4. the Supabase stand-ins of db/supabase-compat.sql (auth, storage, net
--      schemas; anon/authenticated/service_role roles).
--
-- Kept: auth_accounts / auth_sessions / auth_tokens (the login), every table
-- and its data, the triggers that keep data consistent (updated_at, the
-- case_documents -> client_documents mirror, the status log) and
-- swap_primary_and_spouse_server(), which the server calls.
--
-- For the Neon database only — refuses to run on Supabase, where `main` still
-- lives. Re-runnable.
-- ===========================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin')) then
    raise exception 'Migration 53 is for the Neon database only: this looks like Supabase (main still runs on it).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Extraction webhook -> queue
-- ---------------------------------------------------------------------------
drop trigger if exists client_documents_notify_uploaded on public.client_documents;
drop function if exists public.notify_document_uploaded();
-- The webhook's URL and shared secret; app_settings itself stays.
delete from public.app_settings where key in ('extraction_webhook_url', 'extraction_webhook_secret');

-- ---------------------------------------------------------------------------
-- 2. Migration 52's mirror of Supabase Auth
-- ---------------------------------------------------------------------------
drop trigger if exists app_profiles_mirror_auth_user on public.app_profiles;
drop function if exists public.mirror_auth_user_on_profile();
drop function if exists public.mirror_auth_user_update() cascade; -- + its trigger on auth.users

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and (c.relrowsecurity or c.relforcerowsecurity)
  loop
    execute format('alter table public.%I no force row level security, disable row level security', r.relname);
  end loop;
end $$;

-- The status log asked current_profile_id() — i.e. auth.uid(), always null
-- for the server — who changed the status. Same body, same (null) actor.
create or replace function public.log_case_status_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    new.status_updated_at := now();
    if new.status = 'finished' and old.status <> 'finished' then
      new.finished_at := now();
    end if;
    insert into public.case_events (case_id, event_type, from_status, to_status, actor_id)
    values (new.id, 'status_change', old.status, new.status, null);
  end if;
  return new;
end;
$$;

-- The setup step "promote the specialist" (README, SETUP-CHECKLIST) now
-- looks the login up in auth_accounts instead of auth.users.
create or replace function public.promote_to_specialist(p_email text)
returns text
language plpgsql set search_path = public
as $$
declare v_user_id uuid;
begin
  select id into v_user_id from public.auth_accounts where email = lower(trim(p_email));
  if v_user_id is null then
    return 'No account found for ' || p_email || ' — sign up first, then run this again.';
  end if;

  insert into public.app_profiles (user_id, app_id, role, email, full_name)
  values (v_user_id, 'hornung_crm', 'specialist', lower(trim(p_email)), split_part(p_email, '@', 1))
  on conflict (user_id, app_id) do update set role = 'specialist';

  return 'OK — ' || p_email || ' is now a specialist of hornung_crm.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The Supabase stand-ins
-- ---------------------------------------------------------------------------
-- Foreign keys from public tables into auth.users first, by name, so that
-- dropping the schema never takes anything of ours along by surprise.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.confrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f' and n.nspname in ('auth', 'storage')
       and c.conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

drop schema if exists auth cascade;
drop schema if exists storage cascade;
drop schema if exists net cascade;

-- Helpers of the policies (also used by the storage.objects policies just
-- dropped with their schema) and of the RPCs the browser used to call with
-- its Supabase JWT (now ops in api/_dataOps.js). All overloads.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'current_app_role', 'current_profile_id', 'is_hornung_staff', 'my_client_id', 'owns_case',
         'case_is_open_for_client', 'mark_client_active', 'update_my_contact', 'swap_primary_and_spouse',
         'auth_user_id_by_email'
       )
  loop
    execute format('drop function %s', r.signature);
  end loop;
end $$;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('drop owned by %I', role_name); -- their grants (they own nothing)
      execute format('drop role %I', role_name);
    end if;
  end loop;
end $$;

-- Timestamps leave the database in UTC (the server code compares them as
-- ISO strings, as PostgREST returned them).
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'UTC');
end $$;

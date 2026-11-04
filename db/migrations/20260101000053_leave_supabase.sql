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
--   4. the Supabase stand-ins of db/supabase-compat.sql (supabase_auth,
--      storage, net schemas; the roles it created) and every grant to the
--      Supabase roles — on Neon "authenticated" is Neon's Data API role,
--      which must not keep access once RLS is gone.
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
-- Only what db/supabase-compat.sql created: the supabase_auth schema (where
-- db/migrate.js puts Supabase's "auth"), storage and net — and only when they
-- are ours. Neon's own "auth" schema (Neon Auth / Data API) is never touched.
-- Foreign keys from public tables into them first, by name, so that
-- dropping a schema never takes anything of ours along by surprise.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.confrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f' and n.nspname in ('supabase_auth', 'storage')
       and c.conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
  for r in
    select nspname from pg_namespace
     where nspname in ('supabase_auth', 'storage', 'net')
       and pg_get_userbyid(nspowner) = current_user
  loop
    execute format('drop schema %I cascade', r.nspname);
  end loop;
end $$;

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

-- The Supabase roles. Every grant migrations 01–52 gave them on our objects
-- goes — this matters on Neon, where "authenticated" (and "anonymous") are
-- the roles of Neon's Data API: with RLS gone, a grant left behind would let
-- anyone holding a Neon Auth token read the tables through it. A role that
-- db/supabase-compat.sql created (marked with its comment) is then dropped;
-- one that is not ours stays, without access to anything of this app.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'anonymous'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on all tables in schema public from %I', role_name);
      execute format('revoke all on all sequences in schema public from %I', role_name);
      execute format('revoke all on all functions in schema public from %I', role_name);
      execute format('alter default privileges in schema public revoke all on tables from %I', role_name);
      execute format('alter default privileges in schema public revoke all on sequences from %I', role_name);
      execute format('alter default privileges in schema public revoke all on functions from %I', role_name);
      execute format('revoke all on schema public from %I', role_name);
      -- Not "drop owned by": Neon only allows it to members of the role.
      -- The stand-in owns nothing and, after the revokes, holds nothing; if
      -- something unexpected still depends on it, it stays (no login, no
      -- access) rather than failing the migration.
      if shobj_description((select oid from pg_roles where rolname = role_name), 'pg_authid') = 'hornung supabase-compat stand-in' then
        begin
          execute format('drop role %I', role_name);
        exception when dependent_objects_still_exist then
          raise notice 'role % kept (no privileges left): %', role_name, sqlerrm;
        end;
      end if;
    end if;
  end loop;
end $$;

-- Functions are executable by PUBLIC by default; the server-only ones are
-- not for anyone but the owner (the Data API's roles included).
revoke all on function public.swap_primary_and_spouse_server(uuid) from public;
revoke all on function public.promote_to_specialist(text) from public;

-- Timestamps leave the database in UTC (the server code compares them as
-- ISO strings, as PostgREST returned them).
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'UTC');
end $$;

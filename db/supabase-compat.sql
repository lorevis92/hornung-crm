-- ===========================================================================
-- Supabase stand-ins for a plain Postgres (Neon) — applied ONCE, before the
-- migrations, by scripts/db-migrate.mjs (and by the tests, on PGlite).
-- ---------------------------------------------------------------------------
-- Migrations 01–52 were written for Supabase: they create policies "to
-- authenticated", grant to service_role, read auth.users / auth.uid(),
-- create a bucket in storage.buckets with policies on storage.objects, and
-- call pg_net. None of that exists on Neon. Instead of editing 52 historical
-- files, the few objects they touch are created here, empty, so every file
-- applies exactly as it was written; migration 53 then removes all of it
-- (policies, the stand-in schemas and roles) once nothing depends on it.
--
-- Same thing for a database restored from a Supabase dump (pg_dump of the
-- public schema): apply this first, so the dump's policies and grants have
-- the roles they name, then migration 53.
--
-- Idempotent. Nothing here ever holds data in the new setup.
-- ===========================================================================

-- The three Supabase roles the migrations grant to. A role that already
-- exists is NOT ours (on Neon, "authenticated" belongs to Neon's Data API):
-- it is used as it is, and migration 53 only takes our grants away from it.
-- The ones created here are marked, so 53 knows it may drop them.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin', role_name);
      execute format('comment on role %I is %L', role_name, 'hornung supabase-compat stand-in');
    end if;
  end loop;
end $$;

-- Supabase's "auth" schema, under another name: db/migrate.js reads
-- auth.users / auth.uid() of migrations 01–52 as supabase_auth.* (on Neon,
-- "auth" is Neon's own schema).
create schema if not exists supabase_auth;

-- Only the columns the migrations read (52 copies existing logins from here
-- on Supabase; on a fresh Neon database there are none).
create table if not exists supabase_auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now()
);

-- No Supabase JWT ever reaches this database: no caller is "logged in" at
-- the SQL level (the server checks the session, api/_auth.js).
create or replace function supabase_auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;

-- pg_net: scripts/db-migrate.mjs skips the "create extension pg_net" lines
-- (Neon has no pg_net); the trigger functions that call it only need the
-- name to exist, and migration 53 drops them.
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                         headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$ select null::bigint $$;

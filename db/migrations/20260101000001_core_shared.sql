-- ===========================================================================
-- 01 — SHARED CORE (multi-app)
-- ---------------------------------------------------------------------------
-- This database is shared between several WisiApps products (e.g. WisiHealth
-- and the Hornung Consulting CRM).
--
-- Design decision (agreed): ONE identity per person (one row in auth.users per
-- e-mail, one password), but a SEPARATE PROFILE per app. Business records of
-- each app hang off `app_profiles`, never off `auth.users` directly, and every
-- RLS policy is scoped by `app_id`. A person registered in WisiHealth who is
-- later invited to the Hornung CRM keeps the same login but gets a brand new,
-- fully isolated profile and client record here.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- App registry
-- ---------------------------------------------------------------------------
create table if not exists public.apps (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

insert into public.apps (id, name) values
  ('hornung_crm', 'Hornung Consulting CRM')
on conflict (id) do nothing;

-- WisiHealth can register itself here when it migrates to this schema:
-- insert into public.apps (id, name) values ('wisihealth', 'WisiHealth');

-- ---------------------------------------------------------------------------
-- Profiles: one row per (user, app)
-- ---------------------------------------------------------------------------
create table if not exists public.app_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  app_id       text not null references public.apps(id) on delete cascade,
  role         text not null default 'client'
               check (role in ('client', 'specialist', 'admin')),
  full_name    text,
  email        text,
  phone        text,
  locale       text not null default 'en' check (locale in ('en', 'de', 'fr', 'it')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (user_id, app_id)
);

create index if not exists app_profiles_app_role_idx on public.app_profiles (app_id, role);
create index if not exists app_profiles_user_idx     on public.app_profiles (user_id);
create index if not exists app_profiles_email_idx    on public.app_profiles (app_id, lower(email));

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can be used inside RLS policies
-- without causing infinite recursion on app_profiles).
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_id(p_app_id text default 'hornung_crm')
returns uuid
language sql stable security definer set search_path = public
as $$
  select id
  from public.app_profiles
  where user_id = auth.uid() and app_id = p_app_id
  limit 1;
$$;

create or replace function public.current_app_role(p_app_id text default 'hornung_crm')
returns text
language sql stable security definer set search_path = public
as $$
  select role
  from public.app_profiles
  where user_id = auth.uid() and app_id = p_app_id
  limit 1;
$$;

-- "Staff" = the tax specialist and any admin of the Hornung CRM.
create or replace function public.is_hornung_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.app_profiles
    where user_id = auth.uid()
      and app_id = 'hornung_crm'
      and role in ('specialist', 'admin')
  );
$$;

-- Used by the serverless functions (service role only) to find an existing
-- auth user by e-mail without paginating through auth.admin.listUsers().
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS on profiles
-- ---------------------------------------------------------------------------
alter table public.apps          enable row level security;
alter table public.app_profiles  enable row level security;

drop policy if exists "apps are readable by authenticated users" on public.apps;
create policy "apps are readable by authenticated users"
  on public.apps for select to authenticated using (true);

drop policy if exists "profiles: read own" on public.app_profiles;
create policy "profiles: read own"
  on public.app_profiles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "profiles: staff read app profiles" on public.app_profiles;
create policy "profiles: staff read app profiles"
  on public.app_profiles for select to authenticated
  using (app_id = 'hornung_crm' and public.is_hornung_staff());

drop policy if exists "profiles: update own" on public.app_profiles;
create policy "profiles: update own"
  on public.app_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and role = public.current_app_role(app_id));

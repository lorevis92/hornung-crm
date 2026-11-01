-- ===========================================================================
-- 52 — OWN AUTHENTICATION (step 1 of leaving Supabase)
-- ---------------------------------------------------------------------------
-- Login, sessions and one-time links (invite / password reset / e-mail
-- confirmation) move out of Supabase Auth into three plain tables that only
-- the serverless functions can reach (service role; RLS on, no policies, so
-- the anon/authenticated roles see nothing):
--
--   auth_accounts  one row per login (e-mail + bcrypt hash)
--   auth_sessions  one row per signed-in browser; the cookie holds a random
--                  token, this table only its SHA-256 (a database leak does
--                  not hand out live sessions)
--   auth_tokens    single-use links sent by e-mail, also stored hashed
--
-- app_profiles.user_id keeps its meaning ("the login this profile belongs
-- to") but now points at auth_accounts.id. Existing logins keep their id
-- AND their password: Supabase stores bcrypt hashes, which api/_auth.js
-- verifies as-is.
--
-- Safe to run while `main` is still live on Supabase Auth, on the same
-- database:
--   * nothing existing is dropped or redefined except the FK
--     app_profiles.user_id -> auth.users (a profile created by the new login
--     has no auth.users row). main never relied on that cascade: its
--     delete-client removes the profile explicitly before the auth user.
--   * while both run, a login created or changed through main (sign-up,
--     invite, password set on main) is mirrored into auth_accounts by the two
--     triggers at the bottom, so it also works on the new login. Remove them
--     (and auth.users) in step 2.
--   * the RLS policies of every other table stay exactly as they are — a
--     fallback for anything that still talks to PostgREST with a Supabase JWT.
-- Re-runnable.
-- ===========================================================================

create table if not exists public.auth_accounts (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  password_hash       text,
  email_confirmed_at  timestamptz,
  password_changed_at timestamptz,
  failed_login_count  integer not null default 0,
  locked_until        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists auth_accounts_email_key on public.auth_accounts (lower(email));

drop trigger if exists auth_accounts_touch on public.auth_accounts;
create trigger auth_accounts_touch before update on public.auth_accounts
  for each row execute function public.touch_updated_at();

create table if not exists public.auth_sessions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.auth_accounts(id) on delete cascade,
  token_hash   text not null unique,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists auth_sessions_account_idx on public.auth_sessions (account_id);

create table if not exists public.auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.auth_accounts(id) on delete cascade,
  purpose     text not null check (purpose in ('invite', 'recovery', 'confirm_email')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists auth_tokens_account_idx on public.auth_tokens (account_id);

alter table public.auth_accounts enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.auth_tokens   enable row level security;
revoke all on public.auth_accounts, public.auth_sessions, public.auth_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- app_profiles.user_id no longer has to exist in auth.users
-- ---------------------------------------------------------------------------
alter table public.app_profiles drop constraint if exists app_profiles_user_id_fkey;

-- ---------------------------------------------------------------------------
-- Existing Hornung logins, same id, same password. Only people who have a
-- hornung_crm profile: the database is shared with WisiHealth, whose users'
-- password hashes have no business being copied here.
-- ---------------------------------------------------------------------------
insert into public.auth_accounts (id, email, password_hash, email_confirmed_at, created_at)
select u.id, lower(u.email), nullif(u.encrypted_password, ''), u.email_confirmed_at, u.created_at
from auth.users u
where u.email is not null
  and exists (select 1 from public.app_profiles p where p.user_id = u.id and p.app_id = 'hornung_crm')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Transition mirror: main (still on Supabase Auth) -> auth_accounts
-- ---------------------------------------------------------------------------
create or replace function public.mirror_auth_user_on_profile()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if new.app_id = 'hornung_crm' then
    insert into public.auth_accounts (id, email, password_hash, email_confirmed_at, created_at)
    select u.id, lower(u.email), nullif(u.encrypted_password, ''), u.email_confirmed_at, u.created_at
    from auth.users u
    where u.id = new.user_id and u.email is not null
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists app_profiles_mirror_auth_user on public.app_profiles;
create trigger app_profiles_mirror_auth_user after insert on public.app_profiles
  for each row execute function public.mirror_auth_user_on_profile();

create or replace function public.mirror_auth_user_update()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  update public.auth_accounts a
     set email               = coalesce(lower(new.email), a.email),
         password_hash       = coalesce(nullif(new.encrypted_password, ''), a.password_hash),
         email_confirmed_at  = coalesce(new.email_confirmed_at, a.email_confirmed_at)
   where a.id = new.id;
  return new;
end;
$$;

drop trigger if exists auth_users_mirror_update on auth.users;
create trigger auth_users_mirror_update
  after update of email, encrypted_password, email_confirmed_at on auth.users
  for each row execute function public.mirror_auth_user_update();

-- ---------------------------------------------------------------------------
-- swap_primary_and_spouse() checks is_hornung_staff(), which reads
-- auth.uid() — always null for the server. Same body, callable only by the
-- service role; api/_dataOps.js checks the caller is staff before calling it.
-- ---------------------------------------------------------------------------
create or replace function public.swap_primary_and_spouse_server(p_client_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if (select count(*) from public.client_persons where client_id = p_client_id) <> 2 then
    raise exception 'NO_SPOUSE';
  end if;

  update public.client_persons p
     set first_name               = o.first_name,
         last_name                = o.last_name,
         date_of_birth            = o.date_of_birth,
         gender                   = o.gender,
         religious_denomination   = o.religious_denomination,
         email                    = o.email,
         mobile_phone             = o.mobile_phone,
         profession               = o.profession,
         employer                 = o.employer,
         employer_address         = o.employer_address,
         work_address             = o.work_address,
         work_percentage          = o.work_percentage,
         public_transport_costs   = o.public_transport_costs,
         car_km_home_to_work      = o.car_km_home_to_work,
         other_work_costs         = o.other_work_costs,
         is_self_employed         = o.is_self_employed,
         qualifying_shareholdings = o.qualifying_shareholdings,
         asset_statement_count    = o.asset_statement_count
    from public.client_persons o
   where p.client_id = p_client_id
     and o.client_id = p_client_id
     and o.person_type <> p.person_type;

  update public.client_documents
     set person_ref = case person_ref when 'taxpayer' then 'spouse' else 'taxpayer' end
   where client_id = p_client_id
     and person_ref in ('taxpayer', 'spouse');

  update public.client_field_suggestions
     set target_person = 'none'
   where client_id = p_client_id and target_table = 'client_persons' and target_person = 'primary'
     and target_field not in ('marital_status', 'current_address', 'address_dec31');
  update public.client_field_suggestions
     set target_person = 'primary'
   where client_id = p_client_id and target_table = 'client_persons' and target_person = 'spouse'
     and target_field not in ('marital_status', 'current_address', 'address_dec31');
  update public.client_field_suggestions
     set target_person = 'spouse'
   where client_id = p_client_id and target_table = 'client_persons' and target_person = 'none';

  update public.clients
     set person_order_override = case person_order_override
                                   when 'primary_first' then 'spouse_first'
                                   when 'spouse_first' then 'primary_first'
                                 end
   where id = p_client_id
     and person_order_override is not null;
end;
$$;

revoke all on function public.swap_primary_and_spouse_server(uuid) from public, anon, authenticated;
grant execute on function public.swap_primary_and_spouse_server(uuid) to service_role;

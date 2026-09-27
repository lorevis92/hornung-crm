-- ===========================================================================
-- 18 — clients can set their own canton
-- ---------------------------------------------------------------------------
-- A client has no direct UPDATE policy on `clients` ("clients: staff all" /
-- "clients: read own" in 20260101000003_hornung_rls.sql), so the canton
-- field the questionnaire used to expose (removed in an earlier round,
-- since it wrote to the wrong table) has to go through the same narrow
-- SECURITY DEFINER RPC the client's own contact-info form already uses —
-- update_my_contact() — rather than a broad new RLS grant that would also
-- let a client touch status/internal_notes.
--
-- Signature change: adds p_canton as a new, defaulted trailing parameter.
-- Dropping and recreating (instead of a plain CREATE OR REPLACE) avoids
-- Postgres/PostgREST treating this as a second, ambiguous overload
-- alongside the existing 4-argument version.
--
-- Also fixes a latent bug the canton-only call would otherwise have hit:
-- the app_profiles.full_name update used to run unconditionally, so a call
-- that passes both p_first_name and p_last_name as null (as a canton-only
-- call does) would have blanked the profile's name. It's now only touched
-- when a name was actually part of the call, same net effect as before for
-- the two existing callers (saveQuestionnaire / updateProfileName), both of
-- which always pass at least one name part.
-- ===========================================================================

drop function if exists public.update_my_contact(text, text, text, text);

create function public.update_my_contact(
  p_first_name text, p_last_name text, p_phone text, p_language text, p_canton text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clients
     set first_name = coalesce(p_first_name, first_name),
         last_name  = coalesce(p_last_name, last_name),
         phone      = coalesce(p_phone, phone),
         preferred_language = coalesce(p_language, preferred_language),
         canton     = coalesce(p_canton, canton)
   where id = public.my_client_id();

  update public.app_profiles
     set full_name = case
           when p_first_name is not null or p_last_name is not null
             then trim(coalesce(p_first_name,'') || ' ' || coalesce(p_last_name,''))
           else full_name
         end,
         phone  = coalesce(p_phone, phone),
         locale = coalesce(p_language, locale)
   where id = public.current_profile_id('hornung_crm');
end;
$$;

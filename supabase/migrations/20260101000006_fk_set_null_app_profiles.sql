-- ===========================================================================
-- 06 — FIX: FKs to app_profiles(id) blocking user deletion
-- ---------------------------------------------------------------------------
-- Deleting a user from Supabase Auth cascades auth.users -> app_profiles
-- (that FK already has `on delete cascade`, see 20260101000001_core_shared.sql
-- and the app_profiles table definition in 20260101000001). But several
-- "who did this" columns reference app_profiles(id) with no delete rule at
-- all (the implicit default is `on delete no action`), so Postgres blocks
-- the whole deletion the moment it tries to remove an app_profiles row that
-- is still referenced from one of these:
--   - clients.created_by
--   - case_events.actor_id
--   - case_documents.uploaded_by
--   - extracted_fields.reviewed_by
--   - export_jobs.created_by
-- These are audit-trail columns ("who performed this action"), not
-- ownership — it's correct for them to go null instead of either blocking
-- the delete or cascading away historical records. This migration switches
-- all five to `on delete set null`.
--
-- 20260101000002_hornung_schema.sql has been updated to declare these
-- columns with `on delete set null` from the start, so a brand-new project
-- running migrations 1-6 in order never hits this — this file is only
-- needed to fix an already-provisioned database.
--
-- IMPORTANT: this file must be run manually in the Supabase SQL editor (same
-- as every other migration here) — pushing it to GitHub / merging the PR
-- does NOT apply it to the live database.
-- ===========================================================================

alter table public.clients
  drop constraint if exists clients_created_by_fkey,
  add constraint clients_created_by_fkey
    foreign key (created_by) references public.app_profiles(id) on delete set null;

alter table public.case_events
  drop constraint if exists case_events_actor_id_fkey,
  add constraint case_events_actor_id_fkey
    foreign key (actor_id) references public.app_profiles(id) on delete set null;

alter table public.case_documents
  drop constraint if exists case_documents_uploaded_by_fkey,
  add constraint case_documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.app_profiles(id) on delete set null;

alter table public.extracted_fields
  drop constraint if exists extracted_fields_reviewed_by_fkey,
  add constraint extracted_fields_reviewed_by_fkey
    foreign key (reviewed_by) references public.app_profiles(id) on delete set null;

alter table public.export_jobs
  drop constraint if exists export_jobs_created_by_fkey,
  add constraint export_jobs_created_by_fkey
    foreign key (created_by) references public.app_profiles(id) on delete set null;

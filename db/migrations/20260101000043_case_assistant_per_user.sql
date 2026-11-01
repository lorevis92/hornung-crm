-- ===========================================================================
-- 43 — Case assistant conversation scoped per staff user, not just per case
-- ---------------------------------------------------------------------------
-- case_assistant_messages.created_by already existed (migration 42) but was
-- only ever set on the specialist's OWN question, never on the assistant's
-- reply, and the RLS policy allowed any staff member to read/write any
-- row for any case. If a second specialist is ever given access to the
-- same client (this app has no per-case assignment — every specialist can
-- open every case), each must see and continue only their OWN
-- conversation with the assistant, never a colleague's.
--
-- created_by is app_profiles.id (public.current_profile_id('hornung_crm')),
-- the same "which staff member" identity every other *_by column in this
-- schema already uses (decided_by, verified_by, ...) — never the raw
-- Supabase auth.users id directly.
--
-- Backfill: an assistant reply's created_by was always implicitly "whoever
-- asked the question right before it" — recovered here from the nearest
-- preceding user message in the same case that already has one, since that
-- information wasn't lost, just never copied onto the reply's own row.
-- ===========================================================================

update public.case_assistant_messages a
set created_by = (
  select u.created_by
  from public.case_assistant_messages u
  where u.case_id = a.case_id
    and u.role = 'user'
    and u.created_by is not null
    and u.created_at <= a.created_at
  order by u.created_at desc
  limit 1
)
where a.role = 'assistant' and a.created_by is null;

drop policy if exists "case assistant: staff only" on public.case_assistant_messages;
create policy "case assistant: own conversation only" on public.case_assistant_messages for all to authenticated
  using (public.is_hornung_staff() and created_by = public.current_profile_id('hornung_crm'))
  with check (public.is_hornung_staff() and created_by = public.current_profile_id('hornung_crm'));

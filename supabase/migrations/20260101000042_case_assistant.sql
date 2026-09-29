-- ===========================================================================
-- 42 — Case assistant chat history
-- ---------------------------------------------------------------------------
-- The Tax Summary "ask about this case" chat bubble (api/case-assistant.js)
-- persists its conversation per case, so a specialist who leaves and comes
-- back later finds it again — same reasoning as tax_field_decisions
-- persisting across recalculations instead of living only in page state.
--
-- Staff only, both ways: a client must never see or write to this, even
-- their own case's — it's an internal tool for the specialist, not a
-- client-facing feature. No RLS exception for "read own" the way tax_cases
-- has one for clients.
-- ===========================================================================

create table if not exists public.case_assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.tax_cases(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_by  uuid references public.app_profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists case_assistant_messages_case_idx
  on public.case_assistant_messages (case_id, created_at);

alter table public.case_assistant_messages enable row level security;

drop policy if exists "case assistant: staff only" on public.case_assistant_messages;
create policy "case assistant: staff only" on public.case_assistant_messages for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

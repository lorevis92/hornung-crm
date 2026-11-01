-- ===========================================================================
-- 19 — client_field_suggestions
-- ---------------------------------------------------------------------------
-- Backs the "Personal details" (current_tax_sheet) -> registry auto-fill
-- feature: when an extracted field matches a client_persons/clients column
-- that's still empty, it's written straight in (no row needed here). When
-- the column already holds a DIFFERENT value, the conflict is recorded
-- here instead of being applied — one row per (client, target field),
-- always the latest conflict detected. A row's mere existence means
-- "pending"; accepting or dismissing it deletes the row (accepting also
-- writes suggested_value to the target field first) — mirrors the
-- recompute-from-scratch style already used for tax_aggregate_components
-- rather than a separate status/resolved_at trail.
-- ===========================================================================

create table if not exists public.client_field_suggestions (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  document_id      uuid references public.client_documents(id) on delete set null,
  target_table     text not null check (target_table in ('clients', 'client_persons')),
  -- 'none' (not null) rather than a nullable person, so the unique
  -- constraint below actually enforces one row per field — Postgres
  -- treats NULL as distinct from NULL in unique indexes.
  target_person    text not null default 'none' check (target_person in ('none', 'primary', 'spouse')),
  target_field     text not null,
  field_label      text,
  current_value    text,
  suggested_value  text not null,
  created_at       timestamptz not null default now(),
  unique (client_id, target_table, target_person, target_field)
);

create index if not exists client_field_suggestions_client_idx
  on public.client_field_suggestions (client_id);

alter table public.client_field_suggestions enable row level security;

drop policy if exists "client field suggestions: staff only" on public.client_field_suggestions;
create policy "client field suggestions: staff only" on public.client_field_suggestions for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

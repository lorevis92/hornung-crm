-- ===========================================================================
-- 36 — specialist decisions on "needs verification" fields + manual
--      "how this was calculated" entries
-- ---------------------------------------------------------------------------
-- Two new, independent tables. Both are read fresh by every recalculation
-- (api/_recalc.js) and merged into computeTaxAggregate()'s output — neither
-- lives inside tax_aggregate_components, which is wiped and rebuilt from
-- scratch on every recalculation, so anything meant to SURVIVE that has to
-- be its own persistent row, not a component.
--
-- tax_field_decisions — a specialist's explicit "include" or "exclude" call
-- on one extracted field that the calculation flagged as needing
-- verification (foreign currency not yet converted, a possible double
-- deduction, a donation with a consideration, a mutually-exclusive
-- duplicate, ...). decided_amount snapshots the raw extracted amount at
-- decision time; computeTaxAggregate() ignores a decision whose snapshot no
-- longer matches the field's current amount (the document was
-- re-extracted/corrected with a materially different value since) — the
-- field reverts to "needs verification" rather than silently keeping a
-- stale human call.
--
-- tax_manual_aggregate_entries — a specialist-added row with no underlying
-- extracted field at all (an amount known some other way). Always counts
-- (subject to the same rounding/section logic as everything else), and is
-- shown/edited/deleted directly, independent of any recalculation.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

create table if not exists public.tax_field_decisions (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  tax_year        integer not null check (tax_year between 2000 and 2100),
  document_id     uuid not null references public.client_documents(id) on delete cascade,
  field_key       text not null,
  decision        text not null check (decision in ('include', 'exclude')),
  decided_amount  numeric(14,2),
  note            text,
  decided_by      uuid references public.app_profiles(id) on delete set null,
  decided_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (document_id, field_key)
);

create index if not exists tax_field_decisions_client_year_idx
  on public.tax_field_decisions (client_id, tax_year);

drop trigger if exists tax_field_decisions_touch on public.tax_field_decisions;
create trigger tax_field_decisions_touch before update on public.tax_field_decisions
  for each row execute function public.touch_updated_at();

create table if not exists public.tax_manual_aggregate_entries (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  tax_year        integer not null check (tax_year between 2000 and 2100),
  component_type  text not null check (component_type in ('income', 'deduction', 'wealth', 'debt')),
  description     text not null,
  amount          numeric(14,2) not null,
  currency_code   text,
  original_amount numeric(14,2),
  note            text,
  created_by      uuid references public.app_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tax_manual_aggregate_entries_client_year_idx
  on public.tax_manual_aggregate_entries (client_id, tax_year);

drop trigger if exists tax_manual_aggregate_entries_touch on public.tax_manual_aggregate_entries;
create trigger tax_manual_aggregate_entries_touch before update on public.tax_manual_aggregate_entries
  for each row execute function public.touch_updated_at();

-- Lets the breakdown/PDF trace a component back to the manual entry it came
-- from (for edit/delete) or mark it as a specialist decision on an
-- otherwise-ordinary extracted field, instead of only being able to infer
-- either from its label text.
alter table public.tax_aggregate_components
  add column if not exists is_manual boolean not null default false,
  add column if not exists manual_entry_id uuid references public.tax_manual_aggregate_entries(id) on delete set null,
  add column if not exists decision text check (decision in ('include', 'exclude'));

alter table public.tax_field_decisions            enable row level security;
alter table public.tax_manual_aggregate_entries    enable row level security;

drop policy if exists "field decisions: staff only" on public.tax_field_decisions;
create policy "field decisions: staff only" on public.tax_field_decisions for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "manual aggregate entries: staff only" on public.tax_manual_aggregate_entries;
create policy "manual aggregate entries: staff only" on public.tax_manual_aggregate_entries for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());
-- ===========================================================================

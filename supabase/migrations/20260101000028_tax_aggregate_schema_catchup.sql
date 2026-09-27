-- ===========================================================================
-- 28 — tax_aggregate_components / tax_aggregates: schema catch-up
-- ---------------------------------------------------------------------------
-- Root cause of "Could not find the 'currency_code' column of
-- 'tax_aggregate_components' in the schema cache": the column was never
-- missing from the CODE or from a migration file — migration 22
-- (20260101000022_tax_aggregate_component_currency.sql) already adds it,
-- correctly, additively, idempotently. It was simply never RUN against the
-- live database — every migration in this folder requires a manual run in
-- the Supabase SQL editor, and this one (and possibly others after it) fell
-- through.
--
-- Rather than re-pointing at exactly one already-correct migration and
-- hoping it alone gets run, this file re-issues every `add column if not
-- exists` previously written for these two tables, in one place. Running
-- THIS single migration is enough to catch a database up to the current
-- code regardless of which of 16/17/20/22/27 were actually applied before —
-- every statement is a no-op if its column already exists.
--
-- tax_aggregate_components (api/_recalc.js's insert writes: aggregate_id,
-- document_id, component_type, section_key, amount, needs_verification,
-- currency_code, label, field_label, source_label — all of the below).
-- ---------------------------------------------------------------------------
alter table public.tax_aggregate_components
  add column if not exists field_label text,
  add column if not exists source_label text,
  add column if not exists section_key text,
  add column if not exists needs_verification boolean not null default false,
  add column if not exists currency_code text;

-- tax_aggregates.uncertain_parameters (migration 27) — same class of risk,
-- caught here preemptively since it's the most recent addition to the
-- sibling table this same insert/upsert flow writes to.
alter table public.tax_aggregates
  add column if not exists uncertain_parameters jsonb not null default '[]'::jsonb;

-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database. If a similar "column not found" error appears for a
-- different table, the same root cause (a migration written but never run)
-- is the first thing to check — run the full backlog in
-- supabase/migrations/, in filename order, not just this one.
-- ===========================================================================

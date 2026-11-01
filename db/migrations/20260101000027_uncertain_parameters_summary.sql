-- ===========================================================================
-- 27 — tax_aggregates.uncertain_parameters
-- ---------------------------------------------------------------------------
-- Backs the proactive "things to verify" popup on the Tax Summary page.
-- Two of its three sources (fields excluded for a missing tax parameter;
-- items excluded as separately taxed / unconverted foreign currency) are
-- already fully derivable from tax_aggregate_components (needs_verification
-- + the existing note text) — no new column needed there.
--
-- The third source — which "da confermare" tax_parameters rows were
-- actually USED in this specific calculation — has never been tracked
-- anywhere before: a parameter's own uncertainty note lives on
-- tax_parameters, completely disconnected from whether/when it fed a given
-- client's result. This column is the engine's answer to that, written
-- once per calculation: a plain array of ready-to-display strings (not a
-- structured reference — the popup is an index, not a report, so there is
-- nothing further to join against).
-- ---------------------------------------------------------------------------
alter table public.tax_aggregates
  add column if not exists uncertain_parameters jsonb not null default '[]'::jsonb;

-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

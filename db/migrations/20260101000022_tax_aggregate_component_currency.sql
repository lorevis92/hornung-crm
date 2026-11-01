-- ===========================================================================
-- 22 — tax_aggregate_components.currency_code
-- ---------------------------------------------------------------------------
-- Set only on a "needs verification" row excluded because it's in a
-- non-CHF currency (see CURRENCY_FIELD_BY_CATEGORY in
-- src/lib/taxCalculation.js) — the summary/PDF use it to show that row's
-- amount labeled with its real currency (e.g. "USD 5'000") instead of
-- formatting an unconverted foreign figure as if it were francs. Purely
-- additive: one nullable text column.
-- ===========================================================================

alter table public.tax_aggregate_components
  add column if not exists currency_code text;

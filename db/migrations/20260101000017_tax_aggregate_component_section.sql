-- ===========================================================================
-- 17 — tax_aggregate_components.section_key
-- ---------------------------------------------------------------------------
-- Lets the "how this was calculated" breakdown be grouped per tax-summary
-- section (income / deductions / wealth) instead of shown as one flat list
-- — the value is document_categories.group_key with assets/property merged
-- into "wealth", same mapping the tax summary view already uses. Purely
-- additive: one nullable text column. Rows written before this migration
-- keep section_key = null until the next recalculation
-- (tax_aggregate_components is fully recomputed on every calculate call).
-- ===========================================================================

alter table public.tax_aggregate_components
  add column if not exists section_key text;

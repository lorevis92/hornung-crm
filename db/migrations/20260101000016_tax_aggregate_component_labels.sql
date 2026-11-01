-- ===========================================================================
-- 16 — tax_aggregate_components.field_label / source_label
-- ---------------------------------------------------------------------------
-- Splits the single free-text `label` column into two parts so the tax
-- summary/PDF can render a proper table (item / source document / amount)
-- instead of parsing one concatenated string:
--   field_label  — the item itself (e.g. "Gross salary"), what the summary
--                  view calls "voce".
--   source_label — the category and originating document/identifier (e.g.
--                  "Salary certificate — ACME SA"), the "categoria/documento
--                  di origine" column.
-- `label` itself is kept as-is for whatever already reads it. Purely
-- additive: two nullable text columns. Rows written before this migration
-- keep field_label/source_label = null until the next recalculation
-- (tax_aggregate_components is fully recomputed on every calculate call).
-- ===========================================================================

alter table public.tax_aggregate_components
  add column if not exists field_label text,
  add column if not exists source_label text;

-- ===========================================================================
-- 15 — extracted_document_fields.included_in_calculation
-- ---------------------------------------------------------------------------
-- Lets the specialist exclude a single verified value from the tax
-- calculation for this specific client, without touching the general rule in
-- field_calculation_rules (which would affect every client). Purely
-- additive: one nullable-with-default boolean column.
--
-- Only fields with verified_by_specialist = true AND
-- included_in_calculation = true are ever summed by the calculation engine
-- (api/calculate-aggregates.js / src/lib/taxCalculation.js).
-- ===========================================================================

alter table public.extracted_document_fields
  add column if not exists included_in_calculation boolean not null default true;

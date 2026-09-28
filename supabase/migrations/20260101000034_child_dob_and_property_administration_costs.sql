-- ===========================================================================
-- 34 — Child date of birth field + property administration (régie) costs
-- ---------------------------------------------------------------------------
-- Two missing fields found during the Weber regression review:
--
-- 1. childcare_costs never had a field for the child's date of birth, even
--    though client_children.date_of_birth already exists and is already
--    read by src/lib/taxCalculation.js's resolveChild() to bracket the
--    per-child deduction by age — a specialist just had to type it in by
--    hand every time, even when the invoice states it outright. New field,
--    contribution_type 'none' (informational, like child_name), consumed by
--    api/_childSuggestion.js/syncChildSuggestions alongside child_name so
--    an accepted suggestion now proposes both.
--
-- 2. property_tax_value only ever had one generic maintenance_costs field —
--    a document that itemizes régie/administration fees separately from
--    actual upkeep/repairs had the régie amount either dropped or wrongly
--    folded into "maintenance". New field, same income_minus treatment as
--    maintenance_costs (both are legitimate property-expense deductions;
--    this only keeps the document's own distinction visible instead of
--    forcing everything under one label).
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('childcare_costs', 'child_date_of_birth', 'Child date of birth', 'date', 15),
  ('property_tax_value', 'administration_costs', 'Administration/management costs (régie)', 'numeric', 45)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('childcare_costs', 'child_date_of_birth', 'none', null, null),
  ('property_tax_value', 'administration_costs', 'income_minus', null, null)
on conflict (category_code, field_key) do nothing;

-- ===========================================================================
-- 31 — Childcare subsidy field + property rental ancillary income field
-- ---------------------------------------------------------------------------
-- Two missing fields found during the Weber regression review:
--
-- 1. childcare_costs.annual_amount is the invoice's gross amount — when a
--    subsidy/contribution is deducted before the parents actually pay,
--    the cantonal cap must apply to what they NET paid, not the gross
--    invoice (same reasoning as medical_costs' insurance_reimbursement).
--    src/lib/taxCalculation.js's NETS_AGAINST already nets annual_amount
--    against this new subsidy_amount field before the cap is applied.
--
-- 2. property_tax_value's rental income only ever had one field
--    (annual_rental_income) — a document reporting rent plus a separate
--    ancillary item (e.g. a parking space) on its own line had that second
--    amount silently uncaptured. New field, summed the same way
--    (income_plus) as the rent itself.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('childcare_costs', 'subsidy_amount', 'Subsidy/contribution received', 'numeric', 35),
  ('property_tax_value', 'annual_ancillary_income', 'Ancillary rental income (parking, cellar, etc.)', 'numeric', 37)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('childcare_costs', 'subsidy_amount', 'none', null, null),
  ('property_tax_value', 'annual_ancillary_income', 'income_plus', null, null)
on conflict (category_code, field_key) do nothing;

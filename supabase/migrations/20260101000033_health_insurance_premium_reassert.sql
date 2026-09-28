-- ===========================================================================
-- 33 — Re-assert health_insurance_policy.annual_premium
-- ---------------------------------------------------------------------------
-- Found on the Weber case: a health-insurance premium document
-- ("13_premi_cassa_malati.pdf") extracted the insurer's name but never a
-- premium amount, so it contributed nothing to the deduction it exists
-- for. The field/rule have existed since early migrations (09/14, with
-- 23 updating its cap family) — this re-asserts both anyway, idempotent
-- (on conflict do nothing), in case this specific field definition was
-- ever missed on the live database the same way other fields have been
-- in this project's history. The other half of this fix is in code:
-- health_insurance_policy's insurer_name/annual_premium are now allowed
-- to repeat (src/lib/repeatableFields.js), since one uploaded document
-- can bundle a separate policy per family member rather than a single
-- combined one.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('health_insurance_policy', 'insurer_name', 'Insurer name', 'text', 10),
  ('health_insurance_policy', 'insured_persons_count', 'Insured persons count', 'numeric', 20),
  ('health_insurance_policy', 'annual_premium', 'Annual premium', 'numeric', 30)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('health_insurance_policy', 'insurer_name', 'none', null, null),
  ('health_insurance_policy', 'insured_persons_count', 'none', null, null),
  ('health_insurance_policy', 'annual_premium', 'income_minus', 'insurance_premium_pool', null)
on conflict (category_code, field_key) do nothing;

-- ===========================================================================
-- 35 — current_tax_sheet also gets its own child_date_of_birth field
-- ---------------------------------------------------------------------------
-- Migration 34 added childcare_costs.child_date_of_birth on the assumption
-- a childcare invoice is where a child's date of birth would be stated —
-- for Weber it's actually current_tax_sheet (01_lettera_cliente.pdf, the
-- personal-details letter) that states it, not the childcare invoice.
-- current_tax_sheet only ever tracks children_count as a single number
-- (no per-child name field), so this new field is only ever safe to
-- attach automatically when there's exactly one child overall — see
-- buildChildSuggestionCandidates' fallbackDateOfBirth handling in
-- src/lib/personalDetails.js, which refuses to guess whose date of birth
-- it is once there's more than one child in play.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('current_tax_sheet', 'child_date_of_birth', 'Child date of birth', 'date', 75)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('current_tax_sheet', 'child_date_of_birth', 'none', null, null)
on conflict (category_code, field_key) do nothing;

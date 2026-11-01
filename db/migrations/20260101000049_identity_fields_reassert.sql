-- ===========================================================================
-- 49 — the identity fields the by-category view needs, re-asserted and completed
-- ---------------------------------------------------------------------------
-- WHAT HAPPENED TO THE MISSING FIELDS (investigated before writing this):
--
-- account_holder_name / account_iban (bank), insured_person_name /
-- policy_type (health), person_name (medical costs) and policyholder_name
-- (pillar 3a) were NOT removed by anyone. They were added deliberately by
-- migration 37 (20260101000037_occurrence_context_fields.sql, commit
-- a64405b, 2026-09-29 14:53) and no later migration touches them — grep for
-- them across this folder and migration 37 is the only hit.
--
-- They are missing from test/fixtures/weber-2025.json because that fixture
-- was exported from production at 2026-09-29T00:18Z, about fourteen hours
-- BEFORE migration 37 was written. The fixture is a snapshot of the live
-- database, so it simply predates them.
--
-- They are also missing from src/lib/demoSeed.js's CATEGORY_FIELD_DEFINITIONS
-- (fixed in the same commit as this migration) — demo mode never had them at
-- all, which is a genuine gap this closes.
--
-- Whether they exist in the LIVE database depends on one thing only: whether
-- migration 37 was ever run in the Supabase SQL editor. If it was not, this
-- migration puts them there; if it was, the `on conflict do nothing` makes
-- re-running it free. Either way, after running this, re-extract the affected
-- documents so the AI can actually fill the new fields in — a field that
-- exists in the dictionary is only populated by a fresh extraction.
--
-- Same pattern as migration 33 (health_insurance_premium_reassert): purely
-- additive DATA into category_field_definitions, no schema change. Nothing is
-- inserted into field_calculation_rules, which migration 45 deprecated along
-- with the calculation engine.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  -- ---- Re-asserted from migration 37, in case it was never run ----------
  ('bank_securities_crypto_statement', 'account_holder_name', 'Account holder name', 'text', 45),
  ('bank_securities_crypto_statement', 'account_iban', 'Account IBAN', 'text', 46),
  ('health_insurance_policy', 'insured_person_name', 'Insured person', 'text', 45),
  ('health_insurance_policy', 'policy_type', 'Policy type (basic LAMal/KVG or supplementary LCA/VVG)', 'text', 46),
  ('medical_costs', 'person_name', 'Person the expense belongs to', 'text', 45),
  ('pillar_3a_certificate', 'policyholder_name', 'Policyholder name', 'text', 45),

  -- ---- New: what was still missing -------------------------------------
  -- A foreign broker or crypto account has an account number and no IBAN at
  -- all (Weber's three USD positions are exactly this), so IBAN alone
  -- cannot be the only strong identifier for this category.
  ('bank_securities_crypto_statement', 'account_number', 'Account number (when there is no IBAN)', 'text', 47),

  -- The reason creditor + debt type had to stop counting as a certain
  -- identity: two different mortgages from the same bank can both be
  -- written "Ipoteca". A contract/mortgage number identifies the actual
  -- debt, and is what src/lib/categoryEntities.js now treats as certain.
  ('debt_certificate', 'contract_number', 'Contract / mortgage number', 'text', 5),

  -- A health insurer's own policy number, which identifies the policy more
  -- precisely than insurer + person + cover type does.
  ('health_insurance_policy', 'policy_number', 'Policy number', 'text', 47),

  -- Nominal identity on the remaining person-bearing categories, so a
  -- statement can say WHOSE it is the same way the others can.
  ('pension_fund_statement', 'insured_person_name', 'Insured person', 'text', 5),
  ('life_insurance_policy', 'policyholder_name', 'Policyholder name', 'text', 5),
  ('life_insurance_policy', 'policy_number', 'Policy number', 'text', 6)
on conflict (category_code, field_key) do nothing;

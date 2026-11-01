-- ===========================================================================
-- 37 — occurrence context fields (who/what a repeated row belongs to)
-- ---------------------------------------------------------------------------
-- A repeated field (a second bank account, a second insurance premium, a
-- second family member's medical expense, a second 3a policy on the same
-- document) used to show up in Tax Summary as nothing more than "#2" — an
-- insurer/bank's own name is the same for every occurrence on a statement,
-- so it can never tell two of them apart, and there was nowhere for the
-- data that actually WOULD (whose account, whose premium, whose expense)
-- to go even if a document stated it.
--
-- Purely additive DATA — new category_field_definitions/
-- field_calculation_rules rows, same two ordinary runtime tables a
-- specialist can already edit from Tax settings (not a schema change).
-- src/lib/taxCalculation.js (OCCURRENCE_CONTEXT_FIELDS) already looks for
-- these exact field keys; without this migration they simply won't be
-- there yet for the AI to extract into, and every genuinely repeated
-- occurrence lacking one is now explicitly flagged "not identified — needs
-- verification" instead of showing a bare number (see the same commit's
-- code change) — re-run extraction on an affected document once these
-- fields exist to pick them up.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('bank_securities_crypto_statement', 'account_holder_name', 'Account holder name', 'text', 45),
  ('bank_securities_crypto_statement', 'account_iban', 'Account IBAN', 'text', 46),
  ('health_insurance_policy', 'insured_person_name', 'Insured person', 'text', 45),
  ('health_insurance_policy', 'policy_type', 'Policy type (basic LAMal/KVG or supplementary LCA/VVG)', 'text', 46),
  ('medical_costs', 'person_name', 'Person the expense belongs to', 'text', 45),
  ('pillar_3a_certificate', 'policyholder_name', 'Policyholder name', 'text', 45)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('bank_securities_crypto_statement', 'account_holder_name', 'none', null,
   'Context only — identifies which repeated account a balance/interest/dividend row belongs to, never a monetary contribution itself.'),
  ('bank_securities_crypto_statement', 'account_iban', 'none', null,
   'Context only — same reasoning as account_holder_name.'),
  ('health_insurance_policy', 'insured_person_name', 'none', null,
   'Context only — also drives the per-person insurance premium cap (adult household pool vs. each child''s own increment) instead of one generic pooled cap.'),
  ('health_insurance_policy', 'policy_type', 'none', null,
   'Context only — basic (LAMal/KVG) vs. supplementary (LCA/VVG) cover, shown alongside the insured person''s name.'),
  ('medical_costs', 'person_name', 'none', null,
   'Context only — identifies whose medical expense a repeated total_amount/insurance_reimbursement row is.'),
  ('pillar_3a_certificate', 'policyholder_name', 'none', null,
   'Context only — identifies whose 3a policy a repeated annual_contribution row is, when a document covers more than one family member.')
on conflict (category_code, field_key) do nothing;
-- ===========================================================================

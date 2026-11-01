-- ===========================================================================
-- 21 — Swiss tax rule corrections (verified against a real test case)
-- ---------------------------------------------------------------------------
-- Six corrections to field_calculation_rules/category_field_definitions,
-- all federal-level principles (apply to every canton, not just the one the
-- test case happened to be in). See the calculation engine
-- (src/lib/taxCalculation.js) for how the new fields below are actually
-- used — NETS_AGAINST, VOID_IF_TRUTHY and CURRENCY_FIELD_BY_CATEGORY.
--
-- 1. Taxable employment income is net_salary (gross minus mandatory AHV/IV/
--    ALV/LPP contributions, already netted out on the Lohnausweis), not
--    gross_salary — gross_salary stays extracted/visible, just stops
--    contributing.
-- 2. property_tax_value gets an annual_rental_income field (income_plus)
--    for a property let to a third party — distinct from imputed_rental_value
--    (the figurative income for an owner-occupied property). maintenance_costs
--    already applies against the section total either way.
-- 3. debt_certificate gets an annual_amortization field, deliberately mapped
--    to 'none' — so if the AI extracts a principal-repayment figure it's
--    captured/visible but structurally can never become a deduction (unlike
--    annual_interest_paid, which is deductible).
-- 4. medical_costs gets an insurance_reimbursement field; total_amount now
--    nets against it before the existing percentage-threshold logic runs
--    (see NETS_AGAINST). Adds a Valais cantonal medical_costs_threshold_pct
--    row (2%, distinct from the federal 5%) since the threshold varies by
--    canton and was hardcoded to the federal default everywhere.
-- 5. donation_certificate gets a has_consideration field; annual_amount is
--    excluded (not silently deducted) when it's affirmative — a membership
--    fee with a benefit in return isn't a pure donation.
-- 6. bank_securities_crypto_statement gets a currency field; every numeric
--    field on that document is excluded (not silently summed as CHF) when
--    it says anything other than CHF/SFR.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 — net salary, not gross, is the taxable base
-- ---------------------------------------------------------------------------
update public.field_calculation_rules
   set contribution_type = 'none'
 where category_code = 'salary_statement' and field_key = 'gross_salary';

update public.field_calculation_rules
   set contribution_type = 'income_plus'
 where category_code = 'salary_statement' and field_key = 'net_salary';

-- ---------------------------------------------------------------------------
-- 2-6 — new fields
-- ---------------------------------------------------------------------------
insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('property_tax_value', 'annual_rental_income', 'Annual rental income received', 'numeric', 35),
  ('debt_certificate', 'annual_amortization', 'Annual amortization (principal repayment)', 'numeric', 50),
  ('medical_costs', 'insurance_reimbursement', 'Insurance reimbursement received', 'numeric', 15),
  ('donation_certificate', 'has_consideration', 'Consideration/benefit received in return (yes/no)', 'text', 30),
  ('bank_securities_crypto_statement', 'currency', 'Currency', 'text', 5)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('property_tax_value', 'annual_rental_income', 'income_plus', null,
   'Reddito da locazione a terzi — diverso dal valore locativo (immobile occupato dal proprietario).'),
  ('debt_certificate', 'annual_amortization', 'none', null,
   'Ammortamento del mutuo: pagamento patrimoniale, mai deducibile dal reddito (a differenza degli interessi).'),
  ('medical_costs', 'insurance_reimbursement', 'none', null, null),
  ('donation_certificate', 'has_consideration', 'none', null, null),
  ('bank_securities_crypto_statement', 'currency', 'none', null, null)
on conflict (category_code, field_key) do nothing;

-- ---------------------------------------------------------------------------
-- Valais medical-costs deduction threshold (2%, vs. the 5% federal default)
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'VS', 2026, 'medical_costs_threshold', 'medical_costs_threshold_pct', 'Spese mediche',
   2, 'percentage', 'https://www.estv2.admin.ch/stp/kb/vs-fr.pdf',
   'Valore 2025 secondo la scheda fiscale AFC Vallese — da riverificare per il 2026.', null)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

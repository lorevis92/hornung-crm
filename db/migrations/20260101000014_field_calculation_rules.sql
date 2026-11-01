-- ===========================================================================
-- 14 — Calculation rules per extracted field + a stable "parameter family"
-- ---------------------------------------------------------------------------
-- Prepares the general formula the (future) calculation engine will use to
-- sum verified field values into taxable income/wealth. Editable by staff,
-- not hardcoded — same principle already applied to
-- category_field_definitions and tax_parameters.
--
-- Part 1 — tax_parameters.parameter_family: parameter_key today is often
-- different per row (e.g. one per canton), which makes it impossible to say
-- "this is the same threshold at federal level and in every canton". A
-- stable, shared family code fixes that. Backfills the rows already seeded
-- in 20260101000013_tax_parameters_data.sql.
--
-- Part 2 — field_calculation_rules: one row per (category_code, field_key)
-- of category_field_definitions — including the ones that don't feed the
-- calculation at all (contribution_type = 'none'), so the table is always a
-- complete, authoritative map of every field's role, not just an exception
-- list. cap_parameter_family is a soft/logical reference to
-- tax_parameters.parameter_family (deliberately not a hard FK: tax_parameters
-- has many rows per family, one per canton/year, so a FK would have to point
-- at a specific row rather than the family concept) — validated at the
-- application level in the /tax-settings UI, not by the database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Part 1 — parameter_family
-- ---------------------------------------------------------------------------
alter table public.tax_parameters add column if not exists parameter_family text;

update public.tax_parameters set parameter_family = 'pillar_3a_with_lpp'
  where parameter_key = 'pillar_3a_with_lpp' and parameter_family is null;
update public.tax_parameters set parameter_family = 'pillar_3a_without_lpp'
  where parameter_key = 'pillar_3a_without_lpp' and parameter_family is null;
update public.tax_parameters set parameter_family = 'childcare_costs_cap'
  where parameter_key = 'childcare_costs' and parameter_family is null;
update public.tax_parameters set parameter_family = 'medical_costs_threshold_pct'
  where parameter_key = 'medical_costs_threshold' and parameter_family is null;
update public.tax_parameters set parameter_family = 'donation_cap_pct'
  where parameter_key = 'donations_cap' and parameter_family is null;
update public.tax_parameters set parameter_family = 'debt_interest_extra_allowance'
  where parameter_key = 'debt_interest_deduction' and parameter_family is null;
update public.tax_parameters set parameter_family = 'health_insurance_premium_cap'
  where parameter_key = 'health_insurance_premium_single' and parameter_family is null;

-- ---------------------------------------------------------------------------
-- Part 2 — field_calculation_rules
-- ---------------------------------------------------------------------------
create table if not exists public.field_calculation_rules (
  id                   uuid primary key default gen_random_uuid(),
  category_code        text not null references public.document_categories(code) on delete cascade,
  field_key            text not null,
  contribution_type    text not null default 'none'
                       check (contribution_type in ('none', 'income_plus', 'income_minus', 'wealth_plus', 'wealth_minus')),
  cap_parameter_family text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (category_code, field_key)
);

drop trigger if exists field_calculation_rules_touch on public.field_calculation_rules;
create trigger field_calculation_rules_touch before update on public.field_calculation_rules
  for each row execute function public.touch_updated_at();

alter table public.field_calculation_rules enable row level security;

drop policy if exists "calc rules: staff only" on public.field_calculation_rules;
create policy "calc rules: staff only" on public.field_calculation_rules for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

-- One row per (category_code, field_key) currently in category_field_definitions
-- (20260101000009_seed_category_field_definitions.sql) — uninvolved fields get
-- contribution_type = 'none' explicitly, rather than being left out.
insert into public.field_calculation_rules
  (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  -- current_tax_sheet — basic data, not part of the calculation
  ('current_tax_sheet', 'full_name', 'none', null, null),
  ('current_tax_sheet', 'date_of_birth', 'none', null, null),
  ('current_tax_sheet', 'marital_status', 'none', null, null),
  ('current_tax_sheet', 'canton', 'none', null, null),
  ('current_tax_sheet', 'municipality', 'none', null, null),
  ('current_tax_sheet', 'zip', 'none', null, null),
  ('current_tax_sheet', 'children_count', 'none', null, null),
  ('current_tax_sheet', 'religious_affiliation', 'none', null, null),
  ('current_tax_sheet', 'partner_full_name', 'none', null, null),
  ('current_tax_sheet', 'partner_date_of_birth', 'none', null, null),
  ('current_tax_sheet', 'partner_religious_affiliation', 'none', null, null),

  -- previous_tax_return — reference only
  ('previous_tax_return', 'tax_year', 'none', null, null),
  ('previous_tax_return', 'previous_taxable_income', 'none', null, null),
  ('previous_tax_return', 'previous_taxable_wealth', 'none', null, null),

  -- previous_tax_assessment — reference only
  ('previous_tax_assessment', 'assessment_date', 'none', null, null),
  ('previous_tax_assessment', 'assessed_taxable_income', 'none', null, null),
  ('previous_tax_assessment', 'assessed_taxable_wealth', 'none', null, null),

  -- salary_statement
  ('salary_statement', 'employer_name', 'none', null, null),
  ('salary_statement', 'gross_salary', 'income_plus', null, null),
  ('salary_statement', 'net_salary', 'none', null, null),
  ('salary_statement', 'withholding_tax', 'none', null, null),
  ('salary_statement', 'ahv_contributions', 'none', null, null),
  ('salary_statement', 'pension_fund_contributions', 'none', null, null),
  ('salary_statement', 'expense_allowances', 'none', null, null),
  ('salary_statement', 'employment_period_from', 'none', null, null),
  ('salary_statement', 'employment_period_to', 'none', null, null),

  -- self_employed_income_statement
  ('self_employed_income_statement', 'business_name', 'none', null, null),
  ('self_employed_income_statement', 'revenue', 'none', null, null),
  ('self_employed_income_statement', 'expenses', 'none', null, null),
  ('self_employed_income_statement', 'net_profit', 'income_plus', null, null),
  ('self_employed_income_statement', 'fiscal_year', 'none', null, null),

  -- alimony_received
  ('alimony_received', 'payer_name', 'none', null, null),
  ('alimony_received', 'annual_amount', 'income_plus', null, null),
  ('alimony_received', 'type', 'none', null, null),

  -- alimony_paid
  ('alimony_paid', 'recipient_name', 'none', null, null),
  ('alimony_paid', 'annual_amount', 'income_minus', null, null),
  ('alimony_paid', 'type', 'none', null, null),

  -- childcare_costs
  ('childcare_costs', 'child_name', 'none', null, null),
  ('childcare_costs', 'provider_name', 'none', null, null),
  ('childcare_costs', 'annual_amount', 'income_minus', 'childcare_costs_cap', null),

  -- debt_certificate
  ('debt_certificate', 'creditor_name', 'none', null, null),
  ('debt_certificate', 'debt_type', 'none', null, null),
  ('debt_certificate', 'debt_balance', 'wealth_minus', null, null),
  ('debt_certificate', 'annual_interest_paid', 'income_minus', 'debt_interest_extra_allowance',
   'Il tetto non è un importo fisso: è pari al reddito da patrimonio del cliente più l''importo del parametro.'),

  -- pillar_3a_certificate
  ('pillar_3a_certificate', 'institution_name', 'none', null, null),
  ('pillar_3a_certificate', 'policy_number', 'none', null, null),
  ('pillar_3a_certificate', 'annual_contribution', 'income_minus', null,
   'Il tetto dipende dalla situazione previdenziale del cliente: usare il parametro "3° pilastro a, con LPP" se affiliato a una cassa pensione, altrimenti "3° pilastro a, senza LPP".'),

  -- health_insurance_policy
  ('health_insurance_policy', 'insurer_name', 'none', null, null),
  ('health_insurance_policy', 'insured_persons_count', 'none', null, null),
  ('health_insurance_policy', 'annual_premium', 'income_minus', 'health_insurance_premium_cap', null),

  -- medical_costs
  ('medical_costs', 'description', 'none', null, null),
  ('medical_costs', 'total_amount', 'income_minus', 'medical_costs_threshold_pct',
   'È una soglia, non un tetto: deducibile solo l''importo che eccede la percentuale del reddito netto.'),

  -- donation_certificate
  ('donation_certificate', 'recipient_organization', 'none', null, null),
  ('donation_certificate', 'annual_amount', 'income_minus', 'donation_cap_pct', null),

  -- supported_person_transfer
  ('supported_person_transfer', 'supported_person_name', 'none', null, null),
  ('supported_person_transfer', 'relationship', 'none', null, null),
  ('supported_person_transfer', 'annual_amount', 'income_minus', null, null),

  -- bank_securities_crypto_statement
  ('bank_securities_crypto_statement', 'institution_name', 'none', null, null),
  ('bank_securities_crypto_statement', 'account_type', 'none', null, null),
  ('bank_securities_crypto_statement', 'account_balance_31_12', 'wealth_plus', null, null),
  ('bank_securities_crypto_statement', 'interest_income', 'income_plus', null, null),
  ('bank_securities_crypto_statement', 'dividend_income', 'income_plus', null, null),

  -- pension_fund_statement — informational, not part of the calculation
  ('pension_fund_statement', 'institution_name', 'none', null, null),
  ('pension_fund_statement', 'accumulated_capital', 'none', null, null),

  -- inheritance_gift_lpp_payment — taxed separately, not part of ordinary income/wealth
  ('inheritance_gift_lpp_payment', 'type', 'none', null, null),
  ('inheritance_gift_lpp_payment', 'amount', 'none', null, null),
  ('inheritance_gift_lpp_payment', 'date_received', 'none', null, null),

  -- property_tax_value
  ('property_tax_value', 'property_address', 'none', null, null),
  ('property_tax_value', 'tax_value', 'wealth_plus', null, null),
  ('property_tax_value', 'imputed_rental_value', 'income_plus', null, null),
  ('property_tax_value', 'maintenance_costs', 'income_minus', null, null),

  -- rental_contract_zug
  ('rental_contract_zug', 'property_address', 'none', null, null),
  ('rental_contract_zug', 'annual_rent', 'income_minus', null, null)
on conflict (category_code, field_key) do nothing;

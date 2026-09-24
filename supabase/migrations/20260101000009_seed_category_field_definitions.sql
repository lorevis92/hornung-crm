-- ===========================================================================
-- 09 — Seed category_field_definitions (first draft)
-- ---------------------------------------------------------------------------
-- Purely additive: only inserts rows into category_field_definitions
-- (created empty in 20260101000007_tax_extraction_schema.sql). Nothing else
-- is touched. None of these are marked `required` yet — strict validation
-- comes later. The staff-only "Tax settings" admin screen lets specialists
-- add/rename/remove/reorder these afterwards without a migration.
--
-- IMPORTANT: run this manually in the Supabase SQL editor, like every other
-- migration here — merging to GitHub does not apply it to the live database.
-- ===========================================================================

insert into public.category_field_definitions
  (category_code, field_key, field_label, value_type, sort_order)
values
  -- current_tax_sheet
  ('current_tax_sheet', 'full_name', 'Full name', 'text', 10),
  ('current_tax_sheet', 'date_of_birth', 'Date of birth', 'date', 20),
  ('current_tax_sheet', 'marital_status', 'Marital status', 'text', 30),
  ('current_tax_sheet', 'canton', 'Canton', 'text', 40),
  ('current_tax_sheet', 'municipality', 'Municipality', 'text', 50),
  ('current_tax_sheet', 'zip', 'ZIP code', 'text', 60),
  ('current_tax_sheet', 'children_count', 'Number of children', 'numeric', 70),
  ('current_tax_sheet', 'religious_affiliation', 'Religious affiliation', 'text', 80),
  ('current_tax_sheet', 'partner_full_name', 'Partner''s full name', 'text', 90),
  ('current_tax_sheet', 'partner_date_of_birth', 'Partner''s date of birth', 'date', 100),
  ('current_tax_sheet', 'partner_religious_affiliation', 'Partner''s religious affiliation', 'text', 110),

  -- previous_tax_return
  ('previous_tax_return', 'tax_year', 'Tax year', 'numeric', 10),
  ('previous_tax_return', 'previous_taxable_income', 'Previous taxable income', 'numeric', 20),
  ('previous_tax_return', 'previous_taxable_wealth', 'Previous taxable wealth', 'numeric', 30),

  -- previous_tax_assessment
  ('previous_tax_assessment', 'assessment_date', 'Assessment date', 'date', 10),
  ('previous_tax_assessment', 'assessed_taxable_income', 'Assessed taxable income', 'numeric', 20),
  ('previous_tax_assessment', 'assessed_taxable_wealth', 'Assessed taxable wealth', 'numeric', 30),

  -- salary_statement
  ('salary_statement', 'employer_name', 'Employer name', 'text', 10),
  ('salary_statement', 'gross_salary', 'Gross salary', 'numeric', 20),
  ('salary_statement', 'net_salary', 'Net salary', 'numeric', 30),
  ('salary_statement', 'withholding_tax', 'Withholding tax', 'numeric', 40),
  ('salary_statement', 'ahv_contributions', 'AHV contributions', 'numeric', 50),
  ('salary_statement', 'pension_fund_contributions', 'Pension fund contributions', 'numeric', 60),
  ('salary_statement', 'expense_allowances', 'Expense allowances', 'numeric', 70),
  ('salary_statement', 'employment_period_from', 'Employment period from', 'date', 80),
  ('salary_statement', 'employment_period_to', 'Employment period to', 'date', 90),

  -- self_employed_income_statement
  ('self_employed_income_statement', 'business_name', 'Business name', 'text', 10),
  ('self_employed_income_statement', 'revenue', 'Revenue', 'numeric', 20),
  ('self_employed_income_statement', 'expenses', 'Expenses', 'numeric', 30),
  ('self_employed_income_statement', 'net_profit', 'Net profit', 'numeric', 40),
  ('self_employed_income_statement', 'fiscal_year', 'Fiscal year', 'text', 50),

  -- alimony_received
  ('alimony_received', 'payer_name', 'Payer name', 'text', 10),
  ('alimony_received', 'annual_amount', 'Annual amount', 'numeric', 20),
  ('alimony_received', 'type', 'Type', 'text', 30),

  -- alimony_paid
  ('alimony_paid', 'recipient_name', 'Recipient name', 'text', 10),
  ('alimony_paid', 'annual_amount', 'Annual amount', 'numeric', 20),
  ('alimony_paid', 'type', 'Type', 'text', 30),

  -- childcare_costs
  ('childcare_costs', 'child_name', 'Child name', 'text', 10),
  ('childcare_costs', 'provider_name', 'Provider name', 'text', 20),
  ('childcare_costs', 'annual_amount', 'Annual amount', 'numeric', 30),

  -- debt_certificate
  ('debt_certificate', 'creditor_name', 'Creditor name', 'text', 10),
  ('debt_certificate', 'debt_type', 'Debt type', 'text', 20),
  ('debt_certificate', 'debt_balance', 'Debt balance', 'numeric', 30),
  ('debt_certificate', 'annual_interest_paid', 'Annual interest paid', 'numeric', 40),

  -- pillar_3a_certificate
  ('pillar_3a_certificate', 'institution_name', 'Institution name', 'text', 10),
  ('pillar_3a_certificate', 'policy_number', 'Policy number', 'text', 20),
  ('pillar_3a_certificate', 'annual_contribution', 'Annual contribution', 'numeric', 30),

  -- health_insurance_policy
  ('health_insurance_policy', 'insurer_name', 'Insurer name', 'text', 10),
  ('health_insurance_policy', 'insured_persons_count', 'Insured persons count', 'numeric', 20),
  ('health_insurance_policy', 'annual_premium', 'Annual premium', 'numeric', 30),

  -- medical_costs
  ('medical_costs', 'description', 'Description', 'text', 10),
  ('medical_costs', 'total_amount', 'Total amount', 'numeric', 20),

  -- donation_certificate
  ('donation_certificate', 'recipient_organization', 'Recipient organization', 'text', 10),
  ('donation_certificate', 'annual_amount', 'Annual amount', 'numeric', 20),

  -- supported_person_transfer
  ('supported_person_transfer', 'supported_person_name', 'Supported person name', 'text', 10),
  ('supported_person_transfer', 'relationship', 'Relationship', 'text', 20),
  ('supported_person_transfer', 'annual_amount', 'Annual amount', 'numeric', 30),

  -- bank_securities_crypto_statement
  ('bank_securities_crypto_statement', 'institution_name', 'Institution name', 'text', 10),
  ('bank_securities_crypto_statement', 'account_type', 'Account type', 'text', 20),
  ('bank_securities_crypto_statement', 'account_balance_31_12', 'Account balance (31.12)', 'numeric', 30),
  ('bank_securities_crypto_statement', 'interest_income', 'Interest income', 'numeric', 40),
  ('bank_securities_crypto_statement', 'dividend_income', 'Dividend income', 'numeric', 50),

  -- pension_fund_statement
  ('pension_fund_statement', 'institution_name', 'Institution name', 'text', 10),
  ('pension_fund_statement', 'accumulated_capital', 'Accumulated capital', 'numeric', 20),

  -- inheritance_gift_lpp_payment
  ('inheritance_gift_lpp_payment', 'type', 'Type', 'text', 10),
  ('inheritance_gift_lpp_payment', 'amount', 'Amount', 'numeric', 20),
  ('inheritance_gift_lpp_payment', 'date_received', 'Date received', 'date', 30),

  -- property_tax_value
  ('property_tax_value', 'property_address', 'Property address', 'text', 10),
  ('property_tax_value', 'tax_value', 'Tax value', 'numeric', 20),
  ('property_tax_value', 'imputed_rental_value', 'Imputed rental value', 'numeric', 30),
  ('property_tax_value', 'maintenance_costs', 'Maintenance costs', 'numeric', 40),

  -- rental_contract_zug
  ('rental_contract_zug', 'property_address', 'Property address', 'text', 10),
  ('rental_contract_zug', 'annual_rent', 'Annual rent', 'numeric', 20)
on conflict (category_code, field_key) do nothing;

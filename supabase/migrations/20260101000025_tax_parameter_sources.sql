-- ===========================================================================
-- 25 — Source citations for tax_parameters (backfill)
-- ---------------------------------------------------------------------------
-- tax_parameters already has a source_url column (added in migration 13)
-- and it's already displayed + editable in the "Tax settings" admin screen
-- (src/pages/TaxSettings.jsx) — nothing to add there. This migration is a
-- pure data backfill: every row inserted in earlier migrations gets the AFC
-- Steuermäppchen 2025 PDF its family was actually sourced from, so a
-- specialist can always check where a number came from instead of trusting
-- it blindly.
--
-- Rule applied throughout: a row's source_url is overwritten UNLESS it
-- already points to a specific cantonal fact sheet ('/stp/kb/...') — that's
-- a more specific citation than the general comparative Steuermäppchen
-- table and is left untouched (e.g. Valais's medical-threshold row, sourced
-- from the VS cantonal fact sheet in an earlier round). Every other
-- existing value — null, or the generic https://www.estv.admin.ch
-- placeholder used in the last round — is replaced with the specific PDF.
--
-- "Da confermare" rows from the previous round (Svitto's medical threshold,
-- the non-standard child-deduction cantons, ...) get the same treatment:
-- the source is added even though the VALUE itself stays flagged uncertain
-- in `notes` — so whoever verifies it knows exactly which document to
-- check.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/drittbetreuungskosten-de-fr.pdf'
 where parameter_family = 'childcare_costs_cap'
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/zweitverdiener-de-fr.pdf'
 where parameter_family in ('two_income_deduction_min', 'two_income_deduction_max', 'two_income_deduction_pct', 'two_income_deduction_cantonal_amount')
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/versicherungspraemien-zinsen-de-fr.pdf'
 where parameter_family in ('insurance_premium_cap_single', 'insurance_premium_cap_married', 'insurance_premium_child_increment', 'health_insurance_premium_cap')
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/aus-weiterbildungskosten-de-fr.pdf'
 where parameter_family = 'training_costs_cap'
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/kinderabzug-e-de-fr.pdf'
 where parameter_family in ('child_deduction_flat', 'child_deduction_0_6', 'child_deduction_6_16', 'child_deduction_16_plus')
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/unterstuetzungsabzug-e-de-fr.pdf'
 where parameter_family = 'dependent_support_cap'
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/krankheitskosten-de-fr.pdf'
 where parameter_family = 'medical_costs_threshold_pct'
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/parteien-de-fr.pdf'
 where parameter_family = 'party_contribution_cap'
   and (source_url is null or source_url not like '%/stp/kb/%');

-- Wealth-tax exempt amount — only single/married rows exist so far (all
-- Valais); the per-child/steuerfreies-minimum variants mentioned in the
-- request don't apply to any row currently in the table.
update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/persoenlicher-abzug-v-de-fr.pdf'
 where parameter_family in ('wealth_exempt_single', 'wealth_exempt_married')
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/fahrkosten-de-fr.pdf'
 where parameter_family = 'commute_costs_cap'
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/mehrkosten-verpflegung-de-fr.pdf'
 where parameter_family = 'meal_costs_cap'
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/berufskosten-de-fr.pdf'
 where parameter_family in ('professional_expenses_pct', 'professional_expenses_min', 'professional_expenses_max')
   and (source_url is null or source_url not like '%/stp/kb/%');

update public.tax_parameters
   set source_url = 'https://www.estv2.admin.ch/stp/sm/freiwillige-leistungen-de-fr.pdf'
 where parameter_family in ('donation_cap_pct', 'donation_min_amount')
   and (source_url is null or source_url not like '%/stp/kb/%');

-- Interessi passivi privati (LAID art. 9) — no per-canton AFC PDF exists (a
-- uniform federal rule, same everywhere); the citation goes in `notes`
-- instead of `source_url`, appended rather than overwriting any existing
-- note (e.g. the debt-interest-allowance formula explanation already there).
update public.tax_parameters
   set notes = case
     when notes is null or notes = '' then 'Fonte: regola federale uniforme, LAID art. 9 cpv. 2 lett. a — nessuna fonte cantonale specifica.'
     else notes || E'\nFonte: regola federale uniforme, LAID art. 9 cpv. 2 lett. a — nessuna fonte cantonale specifica.'
   end
 where parameter_family = 'debt_interest_extra_allowance'
   and (notes is null or notes not like '%LAID art. 9%');

-- ---------------------------------------------------------------------------
-- Regression fix (unrelated to source citations, caught while touching this
-- family): migration 24 generalized the "doppio reddito" advisory to read
-- 'two_income_deduction_cantonal_amount' for ANY canton, but Valais's own
-- row (added in migration 23) was never migrated off the old, VS-only
-- 'two_income_deduction_vs_fixed' family — since then, VS has been silently
-- falling back to the federal minimum (8'600) instead of its own verified
-- figure (6'290). The old row is left in place (unused, harmless); a new
-- one is added under the family the engine actually reads.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'VS', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 6290, 'fixed_amount',
   'https://www.estv2.admin.ch/stp/sm/zweitverdiener-de-fr.pdf', 'Non calcolato automaticamente.', now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

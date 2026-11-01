-- ===========================================================================
-- 26 — Wealth-tax exempt amounts for all remaining cantons (tax year 2025)
-- ---------------------------------------------------------------------------
-- A prior round's prompt claimed this table was already complete for all 26
-- cantons — checking the actual migrations, only Valais (wealth_exempt_single
-- / wealth_exempt_married, migration 23) was ever inserted. This migration
-- adds every other canton, plus a new wealth_exempt_child family (per-child
-- increment) for the cantons that have one — not modeled before now.
-- Valais is left untouched, as instructed (no per-child row there either).
--
-- Source for every row: AFC Steuermäppchen "persoenlicher-abzug-v"
-- (single/married); the per-child increment is the same document's child
-- column, consistent with how Valais's own wealth-exempt rows are already
-- sourced.
--
-- Corresponding engine change in taxCalculation.js: the wealth-exemption
-- entry now adds a 'wealth_exempt_child' increment (per qualifying child,
-- same list the income-side child deduction already resolves) on top of
-- the single/married base, instead of only ever reading the flat base.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'wealth_exempt_single', 'wealth_exempt_single', 'Importo esente sulla sostanza (persona singola)',
       value_numeric, 'fixed_amount', 'https://www.estv2.admin.ch/stp/sm/persoenlicher-abzug-v-de-fr.pdf',
       'Nessun importo esente a livello federale.', now()
from (values
  ('ZH', 80000), ('LU', 62500), ('UR', 105800), ('SZ', 125000), ('OW', 25000), ('NW', 35000),
  ('GL', 77300), ('ZG', 204000), ('FR', 55000), ('SO', 60000), ('BS', 75000), ('BL', 90000),
  ('SH', 50000), ('AR', 75000), ('AI', 50000), ('SG', 75000), ('GR', 69000), ('AG', 130000),
  ('TG', 100000), ('VD', 60000), ('NE', 50000), ('GE', 87632), ('JU', 28500)
  -- BE and TI deliberately excluded: no exempt amount for single filers.
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'wealth_exempt_married', 'wealth_exempt_married', 'Importo esente sulla sostanza (coniugi)',
       value_numeric, 'fixed_amount', 'https://www.estv2.admin.ch/stp/sm/persoenlicher-abzug-v-de-fr.pdf',
       'Nessun importo esente a livello federale.', now()
from (values
  ('ZH', 159000), ('BE', 18000), ('LU', 125000), ('UR', 211500), ('SZ', 250000), ('OW', 50000),
  ('NW', 70000), ('GL', 154600), ('ZG', 408000), ('FR', 105000), ('SO', 100000), ('BS', 150000),
  ('BL', 180000), ('SH', 100000), ('AR', 150000), ('AI', 100000), ('SG', 150000), ('GR', 138000),
  ('AG', 260000), ('TG', 200000), ('TI', 60000), ('VD', 120000), ('NE', 93000), ('GE', 175264),
  ('JU', 57000)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'wealth_exempt_child', 'wealth_exempt_child', 'Importo esente sulla sostanza (per figlio)',
       value_numeric, 'fixed_amount', 'https://www.estv2.admin.ch/stp/sm/persoenlicher-abzug-v-de-fr.pdf',
       'Nessun importo esente a livello federale.', now()
from (values
  ('BE', 18000), ('LU', 12500), ('UR', 31700), ('SZ', 30000), ('OW', 10000), ('NW', 15000),
  ('GL', 25800), ('ZG', 102000), ('SO', 20000), ('BS', 15000), ('SH', 30000), ('AR', 25000),
  ('AI', 20000), ('SG', 20000), ('GR', 28000), ('AG', 16000), ('TG', 100000), ('TI', 30000),
  ('GE', 43816), ('JU', 28500)
  -- ZH, FR, BL, VD, NE deliberately excluded: no per-child exempt amount.
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ===========================================================================
-- 13 — Tax parameters: human-readable label + notes, plus a first data set
-- ---------------------------------------------------------------------------
-- tax_parameters (created empty in 20260101000007_tax_extraction_schema.sql)
-- had no column for a plain-language name — only the internal parameter_key.
-- Same fix as category_field_definitions got for field names: the specialist
-- (non-technical) types a name, the app derives parameter_key internally and
-- never shows it. Also adds `notes`, needed for "formula" parameters and for
-- caveats about a value's reliability.
--
-- Purely additive: two new nullable columns, then a first batch of real
-- federal/cantonal parameters for tax_year 2026. Where the underlying data
-- itself is uncertain, that uncertainty is recorded rather than smoothed
-- over: last_verified_at is left null and the caveat is spelled out in notes
-- — never silently guessed at.
-- ===========================================================================

alter table public.tax_parameters
  add column if not exists parameter_label text,
  add column if not exists notes text;

-- ---------------------------------------------------------------------------
-- Federal
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('federal', null, 2026, 'pillar_3a_with_lpp', '3° pilastro a, con LPP',
   7258, 'fixed_amount', 'https://www.admin.ch', null, now()),

  ('federal', null, 2026, 'pillar_3a_without_lpp', '3° pilastro a, senza LPP',
   36288, 'formula', 'https://www.admin.ch',
   '20% del reddito netto da attività lucrativa, fino a un massimo di CHF 36''288.', now()),

  ('federal', null, 2026, 'childcare_costs', 'Custodia di terzi per i figli',
   25500, 'fixed_amount', null,
   'Valore 2024 — le fonti non sono concordi: un''altra fonte indica CHF 25''800. Da riverificare per il 2026.',
   null),

  ('federal', null, 2026, 'medical_costs_threshold', 'Spese mediche',
   5, 'percentage', null,
   'Soglia di deducibilità, non un tetto: sono deducibili solo le spese mediche che superano il 5% del reddito netto.',
   now()),

  ('federal', null, 2026, 'donations_cap', 'Donazioni',
   20, 'percentage', null, 'Tetto massimo deducibile: 20% del reddito netto.', now()),

  ('federal', null, 2026, 'debt_interest_deduction', 'Interessi passivi su debiti',
   50000, 'formula', null,
   'Deducibili fino a un importo pari al reddito da patrimonio più CHF 50''000.', now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- Cantonal — custodia di terzi per i figli (dati parziali: solo ZH e BS
-- trovati finora; gli altri 24 cantoni restano da aggiungere dallo staff)
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_label, value_numeric, value_type, notes, last_verified_at)
values
  ('cantonal', 'ZH', 2026, 'childcare_costs', 'Custodia di terzi per i figli', 25000, 'fixed_amount', null, now()),
  ('cantonal', 'BS', 2026, 'childcare_costs', 'Custodia di terzi per i figli', 26000, 'fixed_amount', null, now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- Cantonal — premio cassa malati, deduzione persona singola (tutti i 26
-- cantoni). Fonte secondaria (Blick, dati 2025/2026 a seconda del cantone),
-- non una fonte ufficiale cantonale — last_verified_at lasciato null di
-- proposito, da verificare con le fonti cantonali ufficiali.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_label, value_numeric, value_type, notes, last_verified_at)
select 'cantonal', canton_code, 2026, 'health_insurance_premium_single', 'Premio cassa malati (persona singola)',
       value_numeric, 'fixed_amount',
       'Persona singola — verificare per coniugati/con figli. Fonte secondaria (Blick); da verificare con la fonte cantonale ufficiale.',
       null
from (values
  ('AI', 2900), ('AR', 2700), ('BE', 2450), ('GL', 3100), ('GR', 4600), ('JU', 3400),
  ('LU', 2600), ('NE', 2500), ('NW', 1800), ('OW', 1700), ('SG', 3400), ('SO', 2500),
  ('SZ', 4200), ('TG', 3500), ('TI', 5500), ('UR', 1800), ('ZG', 4600), ('ZH', 2900),
  ('AG', 3800), ('BL', 2000), ('BS', 4200), ('FR', 4810), ('SH', 3750), ('VD', 5000),
  ('VS', 3800), ('GE', 17520)
) as canton_values(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

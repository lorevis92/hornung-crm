-- ===========================================================================
-- 24 — Cantonal parameters, batch 2: the 15 remaining small/German-speaking
--      cantons (UR, SZ, OW, NW, GL, FR, SO, BL, SH, AR, AI, GR, TG, NE, JU)
--      on the same families already modeled in migration 23 — tax year 2025,
--      source: Steuermäppchen AFC 2025.
-- ---------------------------------------------------------------------------
-- Purely additive, plus two narrow engine changes in taxCalculation.js:
--   - the "doppio reddito" advisory now reads a general
--     'two_income_deduction_cantonal_amount' family (any canton) instead of
--     being hardcoded to VS; TG is confirmed to have no such deduction at
--     all, so the advisory is suppressed outright for that canton.
--   - 'child_deduction_flat' is skipped for BL (a CHF 750/child tax CREDIT
--     there, not a base deduction) — a warning is pushed instead, the exact
--     same treatment VS already gets for its married-couple credit.
--
-- Reliability convention for this migration: every VERIFIED row is inserted
-- as a normal, trustworthy parameter. Every row the source material flags as
-- uncertain (conflicting AFC sources, a non-standard structure this engine
-- can only approximate, or "probably equals the federal figure but not
-- confirmed") is still inserted — a flagged number beats no number — but
-- its `notes` column carries an explicit, specialist-facing caveat. Where a
-- canton's structure is genuinely incompatible with this engine (income- or
-- birth-order-dependent amounts, multiple age bands), the LOWEST/most
-- conservative figure is stored and the full real structure is spelled out
-- in `notes`, so a specialist reviewing "Tax settings" for that canton sees
-- exactly why the number is a floor, not an authoritative answer.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Childcare costs (childcare_costs_cap) — all verified
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'childcare_costs', 'childcare_costs_cap', 'Custodia di terzi per i figli',
       value_numeric, 'fixed_amount', 'https://www.estv.admin.ch', null, now()
from (values
  ('UR', 25800), ('SZ', 6000), ('OW', 10000), ('NW', 8100), ('GL', 25800), ('FR', 12000),
  ('SO', 25000), ('BL', 10000), ('SH', 9400), ('AR', 25000), ('AI', 18000), ('GR', 10900),
  ('TG', 10100), ('NE', 20400), ('JU', 10600)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Two-income deduction (two_income_deduction_cantonal_amount — NEW,
-- general family; see engine change above). TG deliberately gets no row —
-- confirmed to have no such deduction, so the app suppresses the advisory
-- entirely for that canton instead of showing a misleading placeholder.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'UR', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 3700, 'fixed_amount', null, 'Importo massimo secondo lo Steuermäppchen AFC.', now()),
  ('cantonal', 'SZ', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 2100, 'fixed_amount', null, null, now()),
  ('cantonal', 'OW', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 3400, 'fixed_amount', null, null, now()),
  ('cantonal', 'NW', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 1200, 'fixed_amount', null, null, now()),
  ('cantonal', 'GL', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 10300, 'fixed_amount', null, 'Importo massimo — formula: 10% del reddito minore dei due coniugi, minimo CHF 3''600.', now()),
  ('cantonal', 'FR', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 500, 'fixed_amount', null, null, now()),
  ('cantonal', 'SO', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 1000, 'fixed_amount', null, null, now()),
  ('cantonal', 'BL', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 1000, 'fixed_amount', null, null, now()),
  ('cantonal', 'SH', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 800, 'fixed_amount', null, null, now()),
  ('cantonal', 'AR', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 5200, 'fixed_amount', null, 'Importo massimo — formula: 10% del reddito minore, minimo CHF 2''500.', now()),
  ('cantonal', 'AI', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 500, 'fixed_amount', null, null, now()),
  ('cantonal', 'GR', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 600, 'fixed_amount', null, null, now()),
  ('cantonal', 'NE', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 1200, 'fixed_amount', null, 'Importo massimo — formula: 25% del reddito minore dei due coniugi.', now()),
  ('cantonal', 'JU', 2025, 'two_income_deduction', 'two_income_deduction_cantonal_amount', 'Deduzione doppio reddito', 2700, 'fixed_amount', null, null, now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Insurance premiums + savings interest (insurance_premium_cap_single /
-- _married / _child_increment) — 11 verified cantons, then UR/NW inserted
-- with an explicit "unconfirmed" caveat (probably equal to federal, not
-- verified on the primary source). FR and JU are skipped entirely: the
-- source material gives no usable number for either (FR's structure has
-- separate, unlisted caps for life insurance/savings interest; JU's
-- structure has unclear student-specific rules) — inventing a number would
-- be worse than leaving the federal fallback in place.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'insurance_premium_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)',
       value_numeric, 'fixed_amount', 'https://www.estv.admin.ch', null, now()
from (values
  ('SZ', 3200), ('GL', 3100), ('SO', 2500), ('BL', 2000), ('SH', 3750), ('AR', 2700),
  ('AI', 2900), ('GR', 4600), ('TG', 3500), ('NE', 2500), ('OW', 1700)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'insurance_premium_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)',
       value_numeric, 'fixed_amount', 'https://www.estv.admin.ch', null, now()
from (values
  ('SZ', 4800), ('GL', 4600), ('SO', 3750), ('BL', 4000), ('SH', 7500), ('AR', 5400),
  ('AI', 3400), ('GR', 5800), ('TG', 7000), ('NE', 3125), ('OW', 2550)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'insurance_premium_child', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)',
       value_numeric, 'fixed_amount', 'https://www.estv.admin.ch', null, now()
from (values
  ('SZ', 400), ('GL', 1000), ('SO', 650), ('BL', 450), ('SH', 1000), ('AR', 1000),
  ('AI', 600), ('GR', 1000), ('TG', 1000), ('NE', 800), ('OW', 700)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- UR / NW — unconfirmed, mirrors the federal amounts with a caveat
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'UR', 2025, 'insurance_premium_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)', 1800, 'fixed_amount', null,
   'DA CONFERMARE — valore probabilmente identico al federale ma non confermato su fonte primaria (Steuermäppchen AFC): verificare prima di affidarsi a questo numero.', null),
  ('cantonal', 'UR', 2025, 'insurance_premium_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)', 3700, 'fixed_amount', null,
   'DA CONFERMARE — valore probabilmente identico al federale ma non confermato su fonte primaria: verificare prima di affidarsi a questo numero.', null),
  ('cantonal', 'UR', 2025, 'insurance_premium_child', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)', 700, 'fixed_amount', null,
   'DA CONFERMARE — valore probabilmente identico al federale ma non confermato su fonte primaria: verificare prima di affidarsi a questo numero.', null),
  ('cantonal', 'NW', 2025, 'insurance_premium_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)', 1800, 'fixed_amount', null,
   'DA CONFERMARE — valore probabilmente identico al federale ma non confermato su fonte primaria (Steuermäppchen AFC): verificare prima di affidarsi a questo numero.', null),
  ('cantonal', 'NW', 2025, 'insurance_premium_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)', 3700, 'fixed_amount', null,
   'DA CONFERMARE — valore probabilmente identico al federale ma non confermato su fonte primaria: verificare prima di affidarsi a questo numero.', null),
  ('cantonal', 'NW', 2025, 'insurance_premium_child', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)', 700, 'fixed_amount', null,
   'DA CONFERMARE — valore probabilmente identico al federale ma non confermato su fonte primaria: verificare prima di affidarsi a questo numero.', null)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Training / continuing education (training_costs_cap) — all verified
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'training_costs', 'training_costs_cap', 'Formazione e perfezionamento',
       value_numeric, 'fixed_amount', 'https://www.estv.admin.ch', null, now()
from (values
  ('UR', 13000), ('SZ', 12000), ('OW', 12000), ('NW', 12400), ('GL', 13000), ('FR', 12000),
  ('SO', 12000), ('BL', 12000), ('SH', 12000), ('AR', 12000), ('AI', 12000), ('GR', 13000),
  ('TG', 13000), ('NE', 12400), ('JU', 12000)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Child deduction (child_deduction_flat) — standard/flat cantons
-- verified, using the base amount; several have supplements this engine
-- doesn't model (age bonus, external housing, multiple age bands) — spelled
-- out in notes rather than applied. BL gets no row at all (see engine
-- change note at the top of this file).
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'UR', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 8500, 'fixed_amount', null,
   'Supplementi non gestiti da questo motore: +CHF 4''500 se il figlio è in formazione/apprendistato, fino a CHF 13''500 totali se vive fuori casa per motivi di studio.', now()),
  ('cantonal', 'OW', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 6200, 'fixed_amount', null,
   'Supplemento non gestito da questo motore: +CHF 5''100 se il figlio vive fuori casa per motivi di studio.', now()),
  ('cantonal', 'GL', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 7200, 'fixed_amount', null,
   'Raddoppia a CHF 14''400 se il figlio vive fuori casa per motivi di studio — non gestito da questo motore.', now()),
  ('cantonal', 'SO', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 9000, 'fixed_amount', null, null, now()),
  ('cantonal', 'SH', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 8400, 'fixed_amount', null,
   'Bonus di CHF 3''000 per figli tra 0 e 5 anni non gestito da questo motore.', now()),
  ('cantonal', 'GR', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 6600, 'fixed_amount', null,
   'Usato il valore più basso delle 3 fasce (età prescolare); CHF 9''900 per minorenni/studenti, CHF 19''700 se residenza esterna per formazione — fasce non gestite da questo motore, verificare l''età/situazione esatta del figlio.', now()),
  ('cantonal', 'TG', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 7400, 'fixed_amount', null,
   'Usato il valore più basso delle 3 fasce (fino a 16 anni); CHF 8''500 per studenti fino a 20 anni, CHF 10''600 fino a 26 anni — fasce non gestite da questo motore, verificare l''età/situazione esatta del figlio.', now()),
  ('cantonal', 'NE', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 6200, 'fixed_amount', null,
   'Usato il valore più basso delle 3 fasce (0-4 anni); CHF 6''700 (4-14 anni), CHF 8''200 (14+ anni) — fasce non gestite da questo motore, verificare l''età esatta del figlio.', now()),

  -- non-standard structures — inserted per "meglio un dato con avviso che
  -- nessun dato", using the most conservative figure in each range
  ('cantonal', 'SZ', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 9000, 'fixed_amount', null,
   'DA CONFERMARE — struttura non standard: CHF 9''000 per figli minorenni, CHF 11''000 fino a 28 anni se in formazione. Usato il valore minorenni; verificare manualmente per figli 16-28 anni in formazione.', null),
  ('cantonal', 'NW', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 6400, 'fixed_amount', null,
   'DA CONFERMARE — struttura non standard: importo base + supplemento CHF 1''700–7''800 se il figlio vive fuori casa, non gestito da questo motore.', null),
  ('cantonal', 'FR', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 7100, 'fixed_amount', null,
   'DA CONFERMARE — sistema degressivo dipendente dal reddito e dall''ordine di nascita (CHF 7''100–8''600/figlio, cresce dal 3° figlio), non gestibile da questo motore. Usato il valore minimo: verificare manualmente OGNI caso Friburgo.', null),
  ('cantonal', 'AR', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 5300, 'fixed_amount', null,
   'DA CONFERMARE — graduato per età: CHF 5''300 / 7''400 / 11''600. Usato il valore minimo; fasce non gestite da questo motore.', null),
  ('cantonal', 'AI', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 6000, 'fixed_amount', null,
   'DA CONFERMARE — dipendente dall''ordine di nascita: CHF 6''000 per il 1°/2° figlio, CHF 8''000 dal 3° figlio in poi — non gestito da questo motore (nessun ordine di nascita tracciato). Usato il valore base.', null),
  ('cantonal', 'JU', 2025, 'child_deduction', 'child_deduction_flat', 'Deduzione per figlio', 5700, 'fixed_amount', null,
   'DA CONFERMARE — CHF 5''700 base + CHF 6''400 dal 3° figlio + bonus per alloggio esterno, non gestiti da questo motore. Usato il valore base.', null)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Persone a carico (dependent_support_cap) — verified where listed;
-- SZ/AR/AI deliberately get no row (confirmed to have no such deduction at
-- all — the app falls back to the federal figure, an accepted, pre-existing
-- limitation of the fallback mechanism rather than something new here).
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'UR', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 3200, 'fixed_amount', null, null, now()),
  ('cantonal', 'OW', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 2400, 'fixed_amount', null, null, now()),
  ('cantonal', 'FR', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 5000, 'fixed_amount', null, null, now()),
  ('cantonal', 'SO', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 2000, 'fixed_amount', null,
   'Varia CHF 2''000–4''200 secondo il grado di bisogno — usato il minimo come stima prudente.', now()),
  ('cantonal', 'SH', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 1300, 'fixed_amount', null, null, now()),
  ('cantonal', 'GR', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 5500, 'fixed_amount', null, null, now()),
  ('cantonal', 'TG', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 2700, 'fixed_amount', null, null, now()),
  ('cantonal', 'NE', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 3100, 'fixed_amount', null, null, now()),
  ('cantonal', 'JU', 2025, 'dependent_support', 'dependent_support_cap', 'Persone a carico', 2400, 'fixed_amount', null, null, now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Medical costs threshold (medical_costs_threshold_pct) — GL/BL verified;
-- SZ inserted with a source-conflict caveat. The other 12 cantons in this
-- batch are confirmed identical to the federal 5% and deliberately get no
-- row — the existing cantonal-then-federal fallback already gives the
-- right answer without a redundant row.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'GL', 2025, 'medical_costs_threshold', 'medical_costs_threshold_pct', 'Spese mediche', 2, 'percentage', null, null, now()),
  ('cantonal', 'BL', 2025, 'medical_costs_threshold', 'medical_costs_threshold_pct', 'Spese mediche', 0, 'percentage', null, 'Nessuna soglia di deducibilità.', now()),
  ('cantonal', 'SZ', 2025, 'medical_costs_threshold', 'medical_costs_threshold_pct', 'Spese mediche', 3, 'percentage', null,
   'DA CONFERMARE — fonti AFC in conflitto: lo Steuermäppchen indica 5% (standard), ma il foglio cantonale SZ cita "3% dei proventi imponibili al netto delle spese" (art. 33 cpv. 3 lett. a StG). Inserito 3% secondo la fonte cantonale specifica — verificare sul testo di legge.', null)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Party contributions (party_contribution_cap — NEW family). Verified
-- amounts, all 15 cantons except NW (percentage-based, see below). No
-- document category/field/calculation rule consumes this family yet — the
-- deduction itself was never modeled in the engine (out of scope for this
-- data-completion round) — these rows are inserted now, ready for whenever
-- that category is built, per "meglio un dato con avviso che nessun dato".
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
select 'cantonal', canton_code, 2025, 'party_contributions', 'party_contribution_cap', 'Contributi a partiti',
       value_numeric, 'fixed_amount', 'https://www.estv.admin.ch',
       'Nessuna categoria documento/regola di calcolo collegata ancora — dato pronto per quando questa deduzione verrà modellata.', now()
from (values
  ('UR', 10600), ('SZ', 6000), ('OW', 10000), ('GL', 10600), ('FR', 5000), ('SO', 20000),
  ('BL', 10000), ('SH', 15000), ('AR', 10000), ('AI', 10000), ('GR', 10000), ('TG', 10000),
  ('NE', 5200), ('JU', 10600)
) as v(canton_code, value_numeric)
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'NW', 2025, 'party_contributions', 'party_contribution_cap', 'Contributi a partiti', 20, 'percentage', null,
   'Nessun tetto fisso in CHF: limite del 20% del reddito netto, cumulato con le altre liberalità/donazioni (stesso meccanismo delle donazioni). Nessuna categoria documento/regola di calcolo collegata ancora.', now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ===========================================================================
-- 23 — Swiss tax rules, phase 2: missing income/deduction categories +
--      calculation order (per a deeper AFC/ESTV research pass, tax year 2025)
-- ---------------------------------------------------------------------------
-- Purely additive except two narrow, deliberate corrections to existing rows
-- (spelled out below) — nothing else already applied is touched.
--
-- Note on tax_parameters' year dimension: tax_year already existed as a
-- NOT NULL column and part of the unique key since the table was first
-- created (20260101000007_tax_extraction_schema.sql), and _recalc.js/demo.js
-- already filter parameters by it. No schema change was needed there — this
-- migration instead adds a parallel tax_year = 2025 dataset (the year this
-- round's research verified), leaving every existing tax_year = 2026 row
-- exactly as it was. Federal amounts are identical between 2025 and 2026
-- (confirmed cold-progression freeze), so federal 2025 rows mirror the
-- already-applied 2026 values where such a row already exists.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Part 1 — new document categories
-- ---------------------------------------------------------------------------
insert into public.document_categories
  (code, group_key, label_en, label_de, label_fr, label_it, aggregate_effect, secondary_aggregate_effect, notes, sort_order)
values
  ('pension_buyback', 'deductions',
   'Pension fund buy-in (Einkauf)', 'Einkauf in die Pensionskasse',
   'Rachat de la caisse de pension', 'Riscatto LPP',
   'income_minus', null, 'Voluntary contribution to close a pension gap — fully deductible, distinct from a capital withdrawal.', 95),

  ('pension_capital_withdrawal', 'other',
   'Pension capital withdrawal', 'Kapitalauszahlung Vorsorge',
   'Versement en capital de prévoyance', 'Prelievo in capitale da previdenza',
   'separate_taxation', null, 'LPP / 3a / vested benefits / severance capital — taxed separately, never part of ordinary income.', 172),

  ('life_insurance_policy', 'assets',
   'Life/annuity insurance with surrender value', 'Lebens-/Rentenversicherung mit Rückkaufswert',
   'Assurance vie/rente avec valeur de rachat', 'Assicurazione vita/rendita con valore di riscatto',
   'wealth_plus', 'income_minus',
   'Surrender value (wealth) plus premiums paid, pooled with health insurance premiums under the same deduction cap.', 152),

  ('disability_costs', 'deductions',
   'Disability-related costs', 'Behinderungsbedingte Kosten',
   'Frais liés au handicap', 'Spese legate a disabilità',
   'income_minus', null, 'Fully deductible, no percentage threshold (unlike ordinary medical costs).', 122),

  ('training_costs', 'deductions',
   'Training / continuing education costs', 'Aus- und Weiterbildungskosten',
   'Frais de formation et de perfectionnement', 'Spese di formazione e perfezionamento',
   'income_minus', null, null, 105),

  ('private_vehicle', 'assets',
   'Private vehicle', 'Privatfahrzeug',
   'Véhicule privé', 'Veicolo privato',
   'wealth_plus', null,
   'Wealth item — depreciated value; cantonal depreciation schedules are not implemented, so this is always shown flagged for manual valuation.', 153),

  ('property_sale', 'other',
   'Real estate sale', 'Grundstückgewinn (Verkauf einer Liegenschaft)',
   'Vente immobilière', 'Vendita immobiliare',
   'separate_taxation', null, 'Real estate capital gain — taxed separately (cantonal property-gains tax), never part of ordinary income.', 173)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Part 2 — new category_field_definitions
-- ---------------------------------------------------------------------------
insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('pension_buyback', 'institution_name', 'Institution name', 'text', 10),
  ('pension_buyback', 'annual_amount', 'Annual amount', 'numeric', 20),

  ('pension_capital_withdrawal', 'withdrawal_type', 'Withdrawal type (LPP / 3a / vested benefits / severance)', 'text', 10),
  ('pension_capital_withdrawal', 'gross_amount', 'Gross amount', 'numeric', 20),
  ('pension_capital_withdrawal', 'date_received', 'Date received', 'date', 30),

  ('life_insurance_policy', 'insurer_name', 'Insurer name', 'text', 10),
  ('life_insurance_policy', 'surrender_value', 'Surrender value (31.12)', 'numeric', 20),
  ('life_insurance_policy', 'annual_premium', 'Annual premium', 'numeric', 30),

  ('disability_costs', 'description', 'Description', 'text', 10),
  ('disability_costs', 'annual_amount', 'Annual amount', 'numeric', 20),

  ('training_costs', 'description', 'Description', 'text', 10),
  ('training_costs', 'annual_amount', 'Annual amount', 'numeric', 20),

  ('private_vehicle', 'description', 'Description (make/model)', 'text', 10),
  ('private_vehicle', 'purchase_price', 'Purchase price', 'numeric', 20),
  ('private_vehicle', 'purchase_year', 'Purchase year', 'numeric', 30),

  ('property_sale', 'property_address', 'Property address', 'text', 10),
  ('property_sale', 'sale_gain_amount', 'Capital gain on sale', 'numeric', 20),
  ('property_sale', 'sale_date', 'Sale date', 'date', 30),

  -- salary_statement additions: Lohnausweis codes F/G, plus the two
  -- actually-claimed professional-expense amounts they modify.
  ('salary_statement', 'code_f_present', 'Code F present (free commute provided by employer)', 'text', 100),
  ('salary_statement', 'code_g_present', 'Code G present (subsidized meals)', 'text', 110),
  ('salary_statement', 'annual_commute_cost', 'Annual commute cost claimed', 'numeric', 120),
  ('salary_statement', 'annual_meal_costs', 'Annual extra meal costs claimed', 'numeric', 130),

  -- bank_securities_crypto_statement: capital gains are extracted for
  -- completeness but never summed (private capital gains are tax-exempt).
  ('bank_securities_crypto_statement', 'capital_gain_loss', 'Capital gain/loss on sale (not taxable — reference only)', 'numeric', 55),

  -- alimony: deductible/taxable only while the child is a minor (or the
  -- recipient is the ex-spouse, with no such cutoff).
  ('alimony_paid', 'beneficiary_type', 'Beneficiary (ex-spouse / child)', 'text', 40),
  ('alimony_paid', 'beneficiary_is_minor', 'Beneficiary still a minor (yes/no)', 'text', 50),
  ('alimony_received', 'beneficiary_type', 'Beneficiary (ex-spouse / child)', 'text', 40),
  ('alimony_received', 'beneficiary_is_minor', 'Beneficiary still a minor (yes/no)', 'text', 50)
on conflict (category_code, field_key) do nothing;

-- ---------------------------------------------------------------------------
-- Part 3 — field_calculation_rules for the new fields
-- ---------------------------------------------------------------------------
insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('pension_buyback', 'institution_name', 'none', null, null),
  ('pension_buyback', 'annual_amount', 'income_minus', null, 'Riscatto LPP: deduzione integrale, distinta dal prelievo in capitale.'),

  ('pension_capital_withdrawal', 'withdrawal_type', 'none', null, null),
  ('pension_capital_withdrawal', 'gross_amount', 'income_plus', null,
   'Tassato separatamente (rendita al 1/5 della tariffa) — sempre escluso dal calcolo ordinario e segnalato.'),
  ('pension_capital_withdrawal', 'date_received', 'none', null, null),

  ('life_insurance_policy', 'insurer_name', 'none', null, null),
  ('life_insurance_policy', 'surrender_value', 'wealth_plus', null, null),
  ('life_insurance_policy', 'annual_premium', 'income_minus', 'insurance_premium_pool',
   'Premio raggruppato con quello della cassa malati sotto lo stesso tetto (premi assicurativi e interessi di risparmio).'),

  ('disability_costs', 'description', 'none', null, null),
  ('disability_costs', 'annual_amount', 'income_minus', null, 'Deducibile per intero, senza soglia (a differenza delle spese mediche ordinarie).'),

  ('training_costs', 'description', 'none', null, null),
  ('training_costs', 'annual_amount', 'income_minus', 'training_costs_cap', null),

  ('private_vehicle', 'description', 'none', null, null),
  ('private_vehicle', 'purchase_price', 'wealth_plus', null,
   'Nessuna formula di ammortamento cantonale implementata: mostrato sempre come "da verificare", non sommato al patrimonio.'),
  ('private_vehicle', 'purchase_year', 'none', null, null),

  ('property_sale', 'property_address', 'none', null, null),
  ('property_sale', 'sale_gain_amount', 'income_plus', null,
   'Plusvalenza immobiliare: tassata separatamente (imposta cantonale sugli utili immobiliari) — sempre esclusa e segnalata.'),
  ('property_sale', 'sale_date', 'none', null, null),

  ('salary_statement', 'code_f_present', 'none', null, null),
  ('salary_statement', 'code_g_present', 'none', null, null),
  ('salary_statement', 'annual_commute_cost', 'income_minus', 'commute_costs_cap',
   'Azzerato se il codice F è presente (trasporto casa-lavoro gratuito fornito dal datore).'),
  ('salary_statement', 'annual_meal_costs', 'income_minus', 'meal_costs_cap',
   'Tetto dimezzato se il codice G è presente (pasti sovvenzionati dal datore).'),

  ('bank_securities_crypto_statement', 'capital_gain_loss', 'none', null,
   'Plusvalenza su vendita di titoli/crypto nella sostanza privata: esente da imposta, estratta solo per completezza documentale.'),

  ('alimony_paid', 'beneficiary_type', 'none', null, null),
  ('alimony_paid', 'beneficiary_is_minor', 'none', null, null),
  ('alimony_received', 'beneficiary_type', 'none', null, null),
  ('alimony_received', 'beneficiary_is_minor', 'none', null, null)
on conflict (category_code, field_key) do nothing;

-- ---------------------------------------------------------------------------
-- Part 4 — two deliberate corrections to already-applied rules (not new rows)
-- ---------------------------------------------------------------------------

-- inheritance_gift_lpp_payment.amount was contribution_type 'none' (silently
-- invisible everywhere). It must instead be shown, flagged, and excluded —
-- same "separate taxation" treatment as the two new categories above.
update public.field_calculation_rules
   set contribution_type = 'wealth_plus',
       notes = 'Eredità, donazione o capitale previdenza ricevuti: tassati separatamente — sempre esclusi dal calcolo ordinario e segnalati.'
 where category_code = 'inheritance_gift_lpp_payment' and field_key = 'amount';

-- health_insurance_policy.annual_premium moves from the old, single-canton
-- "premio cassa malati persona singola" cap (sourced from a secondary
-- outlet, kept as-is / unused from here on) to the new pooled family shared
-- with life_insurance_policy.annual_premium, whose cap now depends on
-- marital status + number of children (see taxCalculation.js).
update public.field_calculation_rules
   set cap_parameter_family = 'insurance_premium_pool'
 where category_code = 'health_insurance_policy' and field_key = 'annual_premium';

-- supported_person_transfer.annual_amount gets a cap for the first time
-- (previously uncapped).
update public.field_calculation_rules
   set cap_parameter_family = 'dependent_support_cap'
 where category_code = 'supported_person_transfer' and field_key = 'annual_amount';

-- ---------------------------------------------------------------------------
-- Part 5 — tax_parameters, tax_year 2025 (federal mirrors of already-applied
-- 2026 rows + brand-new families this round introduces). Every row here is
-- additive; none of the 2026 rows from earlier migrations are modified.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  -- mirrors of existing federal 2026 rows (identical for 2025 — cold
  -- progression frozen between the two years)
  ('federal', null, 2025, 'pillar_3a_with_lpp', 'pillar_3a_with_lpp', '3° pilastro a, con LPP',
   7258, 'fixed_amount', 'https://www.admin.ch', null, now()),
  ('federal', null, 2025, 'pillar_3a_without_lpp', 'pillar_3a_without_lpp', '3° pilastro a, senza LPP',
   36288, 'formula', 'https://www.admin.ch',
   '20% del reddito netto da attività lucrativa, fino a un massimo di CHF 36''288.', now()),
  ('federal', null, 2025, 'medical_costs_threshold', 'medical_costs_threshold_pct', 'Spese mediche',
   5, 'percentage', null,
   'Soglia di deducibilità, non un tetto: sono deducibili solo le spese mediche che superano il 5% del reddito netto, calcolato dopo tutte le altre deduzioni.', now()),
  ('federal', null, 2025, 'donations_cap', 'donation_cap_pct', 'Donazioni',
   20, 'percentage', null, 'Tetto massimo deducibile: 20% del reddito netto.', now()),
  ('federal', null, 2025, 'debt_interest_deduction', 'debt_interest_extra_allowance', 'Interessi passivi su debiti',
   50000, 'formula', null,
   'Deducibili fino a un importo pari al reddito da patrimonio più CHF 50''000.', now()),

  -- freshly verified 2025 childcare federal figure (AFC Steuermäppchen) —
  -- the existing 2026 row (25'500) is left untouched; its own notes already
  -- flag it as uncertain and due for review
  ('federal', null, 2025, 'childcare_costs', 'childcare_costs_cap', 'Custodia di terzi per i figli',
   25800, 'fixed_amount', 'https://www.estv.admin.ch',
   'Valore 2025 verificato via Steuermäppchen AFC (max CHF 25''800 per figlio sotto i 14 anni).', now()),

  -- professional expenses (flat-rate 3%, min/max) — same federal and VS
  ('federal', null, 2025, 'professional_expenses_pct', 'professional_expenses_pct', 'Spese professionali forfait (%)',
   3, 'percentage', null, 'Federale e Vallese uguali.', now()),
  ('federal', null, 2025, 'professional_expenses_min', 'professional_expenses_min', 'Spese professionali forfait (minimo)',
   2000, 'fixed_amount', null, 'Federale e Vallese uguali.', now()),
  ('federal', null, 2025, 'professional_expenses_max', 'professional_expenses_max', 'Spese professionali forfait (massimo)',
   4000, 'fixed_amount', null, 'Federale e Vallese uguali.', now()),

  -- commute costs — federal cap, VS unlimited (see cantonal block below)
  ('federal', null, 2025, 'commute_costs_cap', 'commute_costs_cap', 'Spese di trasporto casa-lavoro',
   3300, 'fixed_amount', null, null, now()),

  -- meals away from home — same federal and VS; halved at engine level when
  -- Lohnausweis code G is present
  ('federal', null, 2025, 'meal_costs_cap', 'meal_costs_cap', 'Pasti fuori casa',
   3200, 'fixed_amount', null, 'CHF 15/giorno; dimezzato (CHF 1''600, 7.50/giorno) se il datore sovvenziona i pasti (codice G).', now()),

  -- training / continuing education
  ('federal', null, 2025, 'training_costs_cap', 'training_costs_cap', 'Formazione e perfezionamento',
   13000, 'fixed_amount', null, null, now()),

  -- pooled insurance premiums (health + life) + per-child increment
  ('federal', null, 2025, 'insurance_premium_cap_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)',
   1800, 'fixed_amount', null, 'Include premi cassa malati, vita e interessi di risparmio.', now()),
  ('federal', null, 2025, 'insurance_premium_cap_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)',
   3700, 'fixed_amount', null, 'Include premi cassa malati, vita e interessi di risparmio.', now()),
  ('federal', null, 2025, 'insurance_premium_child_increment', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)',
   700, 'fixed_amount', null, null, now()),

  -- donation minimum floor
  ('federal', null, 2025, 'donation_min_amount', 'donation_min_amount', 'Donazioni (minimo deducibile)',
   100, 'fixed_amount', null, 'Sotto questa soglia annua la donazione non è deducibile.', now()),

  -- social deductions — per child (flat, used by every canton without its
  -- own age-banded rows), married (flat deduction; VS handles this as a tax
  -- credit instead — see cantonal block/engine), dependents
  ('federal', null, 2025, 'child_social_deduction', 'child_deduction_flat', 'Deduzione per figlio',
   6800, 'fixed_amount', null, null, now()),
  ('federal', null, 2025, 'married_social_deduction', 'married_deduction_flat', 'Deduzione per coniugati',
   2800, 'fixed_amount', null, null, now()),
  ('federal', null, 2025, 'dependent_support_cap', 'dependent_support_cap', 'Persone a carico',
   6800, 'fixed_amount', null, null, now()),

  -- two-income deduction — stored for reference/the advisory note; never
  -- applied automatically (income can't be attributed per spouse from
  -- uploaded documents)
  ('federal', null, 2025, 'two_income_deduction_pct', 'two_income_deduction_pct', 'Deduzione doppio reddito (%)',
   50, 'percentage', null, '50% del reddito minore dei due coniugi — non calcolato automaticamente, richiede verifica manuale.', now()),
  ('federal', null, 2025, 'two_income_deduction_min', 'two_income_deduction_min', 'Deduzione doppio reddito (minimo)',
   8600, 'fixed_amount', null, null, now()),
  ('federal', null, 2025, 'two_income_deduction_max', 'two_income_deduction_max', 'Deduzione doppio reddito (massimo)',
   14100, 'fixed_amount', null, null, now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- Part 6 — tax_parameters, cantonal (Valais), tax_year 2025 — every point
-- where VS differs from the federal figure above.
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('cantonal', 'VS', 2025, 'medical_costs_threshold', 'medical_costs_threshold_pct', 'Spese mediche',
   2, 'percentage', 'https://www.estv2.admin.ch/stp/kb/vs-fr.pdf', 'Scheda fiscale AFC Vallese 2025.', now()),

  ('cantonal', 'VS', 2025, 'commute_costs_cap', 'commute_costs_cap', 'Spese di trasporto casa-lavoro',
   null, 'no_cap', null, 'Nessun tetto cantonale in Vallese (a differenza del limite federale di CHF 3''300).', now()),

  ('cantonal', 'VS', 2025, 'training_costs_cap', 'training_costs_cap', 'Formazione e perfezionamento',
   12550, 'fixed_amount', null, null, now()),

  ('cantonal', 'VS', 2025, 'insurance_premium_cap_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)',
   3620, 'fixed_amount', null, 'Include premi cassa malati, vita e interessi di risparmio.', now()),
  ('cantonal', 'VS', 2025, 'insurance_premium_cap_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)',
   7240, 'fixed_amount', null, 'Include premi cassa malati, vita e interessi di risparmio.', now()),
  ('cantonal', 'VS', 2025, 'insurance_premium_child_increment', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)',
   1130, 'fixed_amount', null, null, now()),

  ('cantonal', 'VS', 2025, 'childcare_costs', 'childcare_costs_cap', 'Custodia di terzi per i figli',
   10000, 'fixed_amount', null, null, now()),

  ('cantonal', 'VS', 2025, 'child_deduction_0_6', 'child_deduction_0_6', 'Deduzione per figlio (0-6 anni)',
   7860, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2025, 'child_deduction_6_16', 'child_deduction_6_16', 'Deduzione per figlio (6-16 anni)',
   8940, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2025, 'child_deduction_16_plus', 'child_deduction_16_plus', 'Deduzione per figlio (16+ in formazione)',
   11930, 'fixed_amount', null, null, now()),

  ('cantonal', 'VS', 2025, 'dependent_support_cap', 'dependent_support_cap', 'Persone a carico',
   2510, 'fixed_amount', null,
   'Il Vallese fa variare questa deduzione (CHF 2''510–6''030) in base al contributo versato — usato qui il valore minimo come stima prudente; verificare manualmente l''importo esatto.', null),

  ('cantonal', 'VS', 2025, 'two_income_deduction_vs_fixed', 'two_income_deduction_vs_fixed', 'Deduzione doppio reddito (Vallese)',
   6290, 'fixed_amount', null, 'Non calcolato automaticamente, richiede verifica manuale.', now()),

  ('cantonal', 'VS', 2025, 'wealth_exempt_single', 'wealth_exempt_single', 'Importo esente sulla sostanza (persona singola)',
   45000, 'fixed_amount', null, 'Nessun importo esente a livello federale (solo cantonale).', now()),
  ('cantonal', 'VS', 2025, 'wealth_exempt_married', 'wealth_exempt_married', 'Importo esente sulla sostanza (coniugi)',
   90000, 'fixed_amount', null, 'Nessun importo esente a livello federale (solo cantonale).', now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

-- ---------------------------------------------------------------------------
-- Part 7 — same new-family parameters, tax_year 2026 (so a 2026 case can
-- exercise them too — federal amounts unchanged per the cold-progression
-- freeze; VS cantonal amounts not expected to move year to year either,
-- carried forward identically pending each year's official update).
-- ---------------------------------------------------------------------------
insert into public.tax_parameters
  (scope, canton_code, tax_year, parameter_key, parameter_family, parameter_label, value_numeric, value_type, source_url, notes, last_verified_at)
values
  ('federal', null, 2026, 'professional_expenses_pct', 'professional_expenses_pct', 'Spese professionali forfait (%)', 3, 'percentage', null, 'Federale e Vallese uguali.', now()),
  ('federal', null, 2026, 'professional_expenses_min', 'professional_expenses_min', 'Spese professionali forfait (minimo)', 2000, 'fixed_amount', null, 'Federale e Vallese uguali.', now()),
  ('federal', null, 2026, 'professional_expenses_max', 'professional_expenses_max', 'Spese professionali forfait (massimo)', 4000, 'fixed_amount', null, 'Federale e Vallese uguali.', now()),
  ('federal', null, 2026, 'commute_costs_cap', 'commute_costs_cap', 'Spese di trasporto casa-lavoro', 3300, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'meal_costs_cap', 'meal_costs_cap', 'Pasti fuori casa', 3200, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'training_costs_cap', 'training_costs_cap', 'Formazione e perfezionamento', 13000, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'insurance_premium_cap_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)', 1800, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'insurance_premium_cap_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)', 3700, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'insurance_premium_child_increment', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)', 700, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'donation_min_amount', 'donation_min_amount', 'Donazioni (minimo deducibile)', 100, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'child_social_deduction', 'child_deduction_flat', 'Deduzione per figlio', 6800, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'married_social_deduction', 'married_deduction_flat', 'Deduzione per coniugati', 2800, 'fixed_amount', null, null, now()),
  ('federal', null, 2026, 'dependent_support_cap', 'dependent_support_cap', 'Persone a carico', 6800, 'fixed_amount', null, null, now()),

  ('cantonal', 'VS', 2026, 'commute_costs_cap', 'commute_costs_cap', 'Spese di trasporto casa-lavoro', null, 'no_cap', null, null, now()),
  ('cantonal', 'VS', 2026, 'training_costs_cap', 'training_costs_cap', 'Formazione e perfezionamento', 12550, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'insurance_premium_cap_single', 'insurance_premium_cap_single', 'Premi assicurativi (persona singola)', 3620, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'insurance_premium_cap_married', 'insurance_premium_cap_married', 'Premi assicurativi (coniugi)', 7240, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'insurance_premium_child_increment', 'insurance_premium_child_increment', 'Premi assicurativi (supplemento per figlio)', 1130, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'childcare_costs', 'childcare_costs_cap', 'Custodia di terzi per i figli', 10000, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'child_deduction_0_6', 'child_deduction_0_6', 'Deduzione per figlio (0-6 anni)', 7860, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'child_deduction_6_16', 'child_deduction_6_16', 'Deduzione per figlio (6-16 anni)', 8940, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'child_deduction_16_plus', 'child_deduction_16_plus', 'Deduzione per figlio (16+ in formazione)', 11930, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'dependent_support_cap', 'dependent_support_cap', 'Persone a carico', 2510, 'fixed_amount', null,
   'Varia CHF 2''510–6''030 in base al contributo — usato il minimo come stima prudente.', null),
  ('cantonal', 'VS', 2026, 'wealth_exempt_single', 'wealth_exempt_single', 'Importo esente sulla sostanza (persona singola)', 45000, 'fixed_amount', null, null, now()),
  ('cantonal', 'VS', 2026, 'wealth_exempt_married', 'wealth_exempt_married', 'Importo esente sulla sostanza (coniugi)', 90000, 'fixed_amount', null, null, now())
on conflict (scope, coalesce(canton_code, ''), tax_year, parameter_key) do nothing;

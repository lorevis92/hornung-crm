-- ===========================================================================
-- 07 — TAX DATA EXTRACTION MODULE — foundations (schema only)
-- ---------------------------------------------------------------------------
-- Purely additive: new tables + new FKs into the existing `clients` table.
-- Nothing in 20260101000002_hornung_schema.sql (or any other already-applied
-- migration) is altered — this file only creates new objects.
--
-- Scope of this module: clients upload one of ~19 known document categories
-- per tax year, an AI extracts field-level data from each document, a
-- specialist verifies it, the system aggregates it into taxable income /
-- wealth figures, and (later) sends those to the external Dr Tax API.
--
-- Deliberately decoupled from `tax_cases` / `case_documents` (the existing
-- upload + checklist feature): this module keys off (client_id, tax_year)
-- directly rather than a case, since the extraction/aggregation pipeline
-- reasons about a client's whole tax year, not a single case record. No UI
-- or business logic ships in this migration — just the schema.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Document category catalogue (~19 known tax-document types)
-- ---------------------------------------------------------------------------
create table if not exists public.document_categories (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  group_key                text not null check (group_key in ('base','income','deductions','assets','property','other')),
  label_en                 text not null,
  label_de                 text not null,
  label_fr                 text not null,
  label_it                 text not null,
  -- How this document type impacts the final aggregate calculation.
  aggregate_effect         text not null
                           check (aggregate_effect in
                             ('income_plus','income_minus','wealth_plus','wealth_minus',
                              'basic_data','separate_taxation','none')),
  -- A few categories genuinely affect two aggregates at once (e.g. a debt
  -- certificate carries both a deductible interest AND a wealth-reducing
  -- balance) — captured here instead of splitting into a second row, so the
  -- catalogue stays exactly one row per document category.
  secondary_aggregate_effect text
                           check (secondary_aggregate_effect in
                             ('income_plus','income_minus','wealth_plus','wealth_minus',
                              'basic_data','separate_taxation','none')),
  notes                    text,
  sort_order               integer not null default 0,
  active                   boolean not null default true,
  created_at               timestamptz not null default now()
);

create index if not exists document_categories_group_idx on public.document_categories (group_key);

insert into public.document_categories
  (code, group_key, label_en, label_de, label_fr, label_it, aggregate_effect, secondary_aggregate_effect, notes, sort_order)
values
  ('current_tax_sheet', 'base',
   'Current year''s tax return form', 'Steuererklärungsformular (laufendes Jahr)',
   'Formulaire de déclaration d''impôt (année en cours)', 'Modulo dichiarazione d''imposta (anno corrente)',
   'basic_data', null, null, 10),

  ('previous_tax_return', 'base',
   'Previous year''s tax return', 'Steuererklärung Vorjahr',
   'Déclaration d''impôt de l''année précédente', 'Dichiarazione d''imposta anno precedente',
   'basic_data', null, null, 20),

  ('previous_tax_assessment', 'base',
   'Previous year''s tax assessment', 'Steuerveranlagung Vorjahr',
   'Décision de taxation de l''année précédente', 'Tassazione anno precedente',
   'basic_data', null, null, 30),

  ('salary_statement', 'income',
   'Salary statement', 'Lohnausweis',
   'Certificat de salaire', 'Certificato di salario',
   'income_plus', null, null, 40),

  ('self_employed_income_statement', 'income',
   'Self-employment income statement', 'Erfolgsrechnung Selbständigerwerbende',
   'Compte de résultat (indépendant)', 'Conto economico (attività indipendente)',
   'income_plus', null, null, 50),

  ('alimony_received', 'income',
   'Alimony received', 'Erhaltene Unterhaltsbeiträge',
   'Pensions alimentaires reçues', 'Alimenti ricevuti',
   'income_plus', null, null, 60),

  ('alimony_paid', 'deductions',
   'Alimony paid', 'Geleistete Unterhaltsbeiträge',
   'Pensions alimentaires versées', 'Alimenti versati',
   'income_minus', null, null, 70),

  ('childcare_costs', 'deductions',
   'Childcare costs', 'Fremdbetreuungskosten Kinder',
   'Frais de garde des enfants', 'Spese di custodia dei figli',
   'income_minus', null, null, 80),

  ('debt_certificate', 'deductions',
   'Debt certificate', 'Schuldenverzeichnis / Schuldzinsbescheinigung',
   'Attestation de dettes', 'Attestato di debito',
   'income_minus', 'wealth_minus',
   'Deductible debt interest (income) plus the outstanding balance (wealth).', 90),

  ('pillar_3a_certificate', 'deductions',
   'Pillar 3a certificate', 'Bescheinigung Säule 3a',
   'Attestation du pilier 3a', 'Attestato del pilastro 3a',
   'income_minus', null, null, 100),

  ('health_insurance_policy', 'deductions',
   'Health insurance policy', 'Krankenkassenpolice',
   'Police d''assurance-maladie', 'Polizza di assicurazione malattia',
   'income_minus', null, null, 110),

  ('medical_costs', 'deductions',
   'Medical costs', 'Krankheitskosten',
   'Frais de maladie', 'Spese mediche',
   'income_minus', null, null, 120),

  ('donation_certificate', 'deductions',
   'Donation certificate', 'Spendenbescheinigung',
   'Attestation de don', 'Attestato di donazione',
   'income_minus', null, null, 130),

  ('supported_person_transfer', 'deductions',
   'Support payments to a dependent person', 'Unterstützungsleistungen an bedürftige Person',
   'Soutien à une personne dans le besoin', 'Sostegno a persona bisognosa',
   'income_minus', null, null, 140),

  ('bank_securities_crypto_statement', 'assets',
   'Bank, securities & crypto statement', 'Bank-, Wertschriften- und Krypto-Verzeichnis',
   'Relevé bancaire, titres et cryptomonnaies', 'Estratto conto banca, titoli e crypto',
   'wealth_plus', 'income_plus',
   'Account/portfolio balance (wealth) plus interest and dividends earned (income).', 150),

  ('pension_fund_statement', 'other',
   'Pension fund statement', 'Pensionskassenausweis',
   'Certificat de la caisse de pension', 'Attestato cassa pensione',
   'none', null, 'Informational only — not part of the taxable income/wealth aggregate.', 160),

  ('inheritance_gift_lpp_payment', 'other',
   'Inheritance, gift or pension lump-sum payment', 'Erbschaft, Schenkung oder Kapitalauszahlung Vorsorge',
   'Succession, donation ou versement en capital LPP', 'Successione, donazione o versamento in capitale LPP',
   'separate_taxation', null, 'Taxed separately from ordinary income/wealth.', 170),

  ('property_tax_value', 'property',
   'Property tax value statement', 'Steuerwert Liegenschaft',
   'Valeur fiscale de l''immeuble', 'Valore fiscale immobile',
   'wealth_plus', 'income_plus',
   'Tax value (wealth) plus imputed rental value / rental income (income).', 180),

  ('rental_contract_zug', 'property',
   'Zug rental contract', 'Mietvertrag Zug',
   'Contrat de bail Zoug', 'Contratto di locazione Zugo',
   'income_minus', null, 'Canton Zug-specific rent deduction — cantonal scope only, not federal.', 190)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Expected fields per document category (dictionary the AI extraction is
-- validated against). Intentionally left unseeded here — the field taxonomy
-- for each category is a product decision for a later round.
-- ---------------------------------------------------------------------------
create table if not exists public.category_field_definitions (
  id            uuid primary key default gen_random_uuid(),
  category_code text not null references public.document_categories(code) on delete cascade,
  field_key     text not null,
  field_label   text,
  value_type    text not null default 'text' check (value_type in ('text','numeric','date','boolean')),
  required      boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (category_code, field_key)
);

create index if not exists category_field_definitions_category_idx on public.category_field_definitions (category_code);

-- ---------------------------------------------------------------------------
-- Documents uploaded by a client for a given tax year
-- ---------------------------------------------------------------------------
create table if not exists public.client_documents (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  tax_year       integer not null check (tax_year between 2000 and 2100),
  category_code  text not null references public.document_categories(code),
  storage_path   text not null,
  file_name      text not null,
  file_size      bigint,
  mime_type      text,
  status         text not null default 'uploaded'
                 check (status in ('uploaded','extracting','extracted','verified_by_specialist','rejected')),
  uploaded_by    uuid references public.app_profiles(id) on delete set null,
  uploaded_at    timestamptz not null default now(),
  processed_at   timestamptz
);

create index if not exists client_documents_client_year_idx on public.client_documents (client_id, tax_year);
create index if not exists client_documents_category_idx    on public.client_documents (category_code);

-- ---------------------------------------------------------------------------
-- Field values extracted (and later corrected) from a document
-- ---------------------------------------------------------------------------
create table if not exists public.extracted_document_fields (
  id                      uuid primary key default gen_random_uuid(),
  document_id             uuid not null references public.client_documents(id) on delete cascade,
  field_key               text not null,
  field_value             text,
  confidence              numeric(4,3),
  verified_by_specialist  boolean not null default false,
  verified_at             timestamptz,
  verified_by             uuid references public.app_profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  unique (document_id, field_key)
);

create index if not exists extracted_document_fields_document_idx on public.extracted_document_fields (document_id);

-- ---------------------------------------------------------------------------
-- Aggregated taxable income / wealth per client and tax year
-- ---------------------------------------------------------------------------
create table if not exists public.tax_aggregates (
  id                          uuid primary key default gen_random_uuid(),
  client_id                   uuid not null references public.clients(id) on delete cascade,
  tax_year                    integer not null check (tax_year between 2000 and 2100),
  taxable_income_cantonal     numeric(14,2),
  taxable_wealth_cantonal     numeric(14,2),
  taxable_income_federal      numeric(14,2),
  status                      text not null default 'draft'
                              check (status in ('draft','ready_for_simulation','sent_to_specialist')),
  computed_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (client_id, tax_year)
);

create index if not exists tax_aggregates_client_idx on public.tax_aggregates (client_id, tax_year);

drop trigger if exists tax_aggregates_touch on public.tax_aggregates;
create trigger tax_aggregates_touch before update on public.tax_aggregates
  for each row execute function public.touch_updated_at();

-- Traceable breakdown of every figure that makes up an aggregate
create table if not exists public.tax_aggregate_components (
  id             uuid primary key default gen_random_uuid(),
  aggregate_id   uuid not null references public.tax_aggregates(id) on delete cascade,
  document_id    uuid references public.client_documents(id) on delete set null,
  component_type text not null check (component_type in ('income','deduction','wealth','debt')),
  amount         numeric(14,2) not null,
  label          text,
  created_at     timestamptz not null default now()
);

create index if not exists tax_aggregate_components_aggregate_idx on public.tax_aggregate_components (aggregate_id);

-- ---------------------------------------------------------------------------
-- Federal / cantonal tax parameters (deduction caps, thresholds, ...) —
-- maintained by hand once a year from a future admin screen.
-- ---------------------------------------------------------------------------
create table if not exists public.tax_parameters (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('federal','cantonal')),
  canton_code      text,
  tax_year         integer not null check (tax_year between 2000 and 2100),
  parameter_key    text not null,
  value_numeric    numeric(14,4),
  value_type       text not null check (value_type in ('fixed_amount','percentage','formula','no_cap')),
  source_url       text,
  last_verified_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((scope = 'federal' and canton_code is null) or (scope = 'cantonal' and canton_code is not null))
);

create unique index if not exists tax_parameters_key_idx
  on public.tax_parameters (scope, coalesce(canton_code, ''), tax_year, parameter_key);

drop trigger if exists tax_parameters_touch on public.tax_parameters;
create trigger tax_parameters_touch before update on public.tax_parameters
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — catalogues are readable by any authenticated user (like
-- document_types/pricing_items already are); everything client-specific
-- follows the same staff-all / client-own-only pattern as the rest of the
-- schema; the extraction/aggregation internals are staff only, matching the
-- existing extracted_fields/export_jobs convention.
-- ---------------------------------------------------------------------------
alter table public.document_categories        enable row level security;
alter table public.category_field_definitions enable row level security;
alter table public.client_documents            enable row level security;
alter table public.extracted_document_fields   enable row level security;
alter table public.tax_aggregates              enable row level security;
alter table public.tax_aggregate_components    enable row level security;
alter table public.tax_parameters              enable row level security;

drop policy if exists "doc categories: read" on public.document_categories;
create policy "doc categories: read" on public.document_categories for select to authenticated using (true);

drop policy if exists "doc categories: staff write" on public.document_categories;
create policy "doc categories: staff write" on public.document_categories for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "field defs: read" on public.category_field_definitions;
create policy "field defs: read" on public.category_field_definitions for select to authenticated using (true);

drop policy if exists "field defs: staff write" on public.category_field_definitions;
create policy "field defs: staff write" on public.category_field_definitions for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "client documents: staff all" on public.client_documents;
create policy "client documents: staff all" on public.client_documents for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "client documents: read own" on public.client_documents;
create policy "client documents: read own" on public.client_documents for select to authenticated
  using (client_id = public.my_client_id());

drop policy if exists "client documents: client upload" on public.client_documents;
create policy "client documents: client upload" on public.client_documents for insert to authenticated
  with check (client_id = public.my_client_id());

drop policy if exists "extracted doc fields: staff only" on public.extracted_document_fields;
create policy "extracted doc fields: staff only" on public.extracted_document_fields for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "tax aggregates: staff only" on public.tax_aggregates;
create policy "tax aggregates: staff only" on public.tax_aggregates for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "tax aggregate components: staff only" on public.tax_aggregate_components;
create policy "tax aggregate components: staff only" on public.tax_aggregate_components for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "tax parameters: staff only" on public.tax_parameters;
create policy "tax parameters: staff only" on public.tax_parameters for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

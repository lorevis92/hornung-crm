-- ===========================================================================
-- 02 — HORNUNG CONSULTING CRM — tables
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Clients
-- The specialist creates the client first (status 'invited'); the profile_id is
-- filled in as soon as the invitation is generated / the account is linked.
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id                  uuid primary key default gen_random_uuid(),
  app_id              text not null default 'hornung_crm' references public.apps(id),
  profile_id          uuid references public.app_profiles(id) on delete set null,
  email               text not null,
  first_name          text,
  last_name           text,
  phone               text,
  preferred_language  text not null default 'en' check (preferred_language in ('en','de','fr','it')),
  canton              text,
  status              text not null default 'invited' check (status in ('invited','active','archived')),
  internal_notes      text,                     -- staff only (never sent to the client)
  invited_at          timestamptz,
  activated_at        timestamptz,
  created_by          uuid references public.app_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists clients_app_email_key on public.clients (app_id, lower(email));
create index if not exists clients_profile_idx on public.clients (profile_id);
create index if not exists clients_status_idx  on public.clients (app_id, status);

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Questionnaire — general part (one row per client)
-- Mirrors the header of the Hornung "Tax questionnaire" PDF.
-- ---------------------------------------------------------------------------
create table if not exists public.client_details (
  client_id            uuid primary key references public.clients(id) on delete cascade,
  in_ch_since          text,      -- "Since when in CH"
  age_on_arrival       text,      -- "Age by arrival"
  permit_type          text,      -- B / C / L / CH ...
  nationality          text,
  has_crypto_or_shares boolean default false,
  due_date             date,      -- filing deadline agreed with the authority
  comments             text,      -- "Commentaries" page of the questionnaire
  completed_at         timestamptz,
  updated_at           timestamptz not null default now()
);

drop trigger if exists client_details_touch on public.client_details;
create trigger client_details_touch before update on public.client_details
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Questionnaire — "Personal details" (taxpayer + spouse columns of the PDF)
-- ---------------------------------------------------------------------------
create table if not exists public.client_persons (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  person_type            text not null check (person_type in ('primary','spouse')),
  last_name              text,
  first_name             text,
  mobile_phone           text,
  email                  text,
  marital_status         text,
  date_of_birth          date,
  religious_denomination text,   -- required in CH for church tax
  current_address        text,
  address_dec31          text,   -- "Address as of 31.12."
  profession             text,
  employer               text,
  employer_address       text,   -- address / city of place of work
  work_percentage        integer check (work_percentage between 0 and 100),
  public_transport_costs numeric(10,2),
  car_km_home_to_work    numeric(10,2),
  work_address           text,
  other_work_costs       text,   -- education, career, job related
  is_self_employed       boolean default false,
  qualifying_shareholdings integer default 0,
  asset_statement_count  integer default 0,   -- accounts, crypto, stocks ... (drives the fee)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (client_id, person_type)
);

drop trigger if exists client_persons_touch on public.client_persons;
create trigger client_persons_touch before update on public.client_persons
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Questionnaire — children / vehicles / properties
-- ---------------------------------------------------------------------------
create table if not exists public.client_children (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  full_name        text,
  date_of_birth    date,
  school_education text,
  religious        text,
  until_when       text,
  custody          text,     -- e.g. "50/50"
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists client_children_client_idx on public.client_children (client_id);

create table if not exists public.client_vehicles (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  brand          text,
  model          text,
  year_of_issue  integer,
  purchase_price numeric(12,2),
  purchase_year  integer,
  leasing        boolean default false,
  license_plate  text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists client_vehicles_client_idx on public.client_vehicles (client_id);

create table if not exists public.client_properties (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  address          text,
  country          text,
  purchase_year    integer,
  year_of_building integer,
  purchase_price   numeric(12,2),
  rental_income    numeric(12,2),
  number_of_rooms  numeric(4,1),
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists client_properties_client_idx on public.client_properties (client_id);

-- ---------------------------------------------------------------------------
-- Tax cases — one per client and tax year
-- ---------------------------------------------------------------------------
create table if not exists public.tax_cases (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  tax_year          integer not null check (tax_year between 2000 and 2100),
  status            text not null default 'opened'
                    check (status in ('opened','waiting_client','in_process','review','finished')),
  status_updated_at timestamptz not null default now(),
  client_message    text,            -- visible to the client (e.g. "missing 3a certificate")
  specialist_notes  text,            -- staff only
  due_date          date,
  delivery_by_post  boolean not null default false,
  express           boolean not null default false,
  fee_estimate      numeric(10,2),
  fee_breakdown     jsonb,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (client_id, tax_year)
);

create index if not exists tax_cases_year_status_idx on public.tax_cases (tax_year, status);
create index if not exists tax_cases_client_idx      on public.tax_cases (client_id);

drop trigger if exists tax_cases_touch on public.tax_cases;
create trigger tax_cases_touch before update on public.tax_cases
  for each row execute function public.touch_updated_at();

-- Timeline of everything that happened on a case (status changes, uploads...)
create table if not exists public.case_events (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.tax_cases(id) on delete cascade,
  event_type  text not null,            -- status_change | document_uploaded | message | email_sent
  from_status text,
  to_status   text,
  note        text,
  actor_id    uuid references public.app_profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists case_events_case_idx on public.case_events (case_id, created_at desc);

-- Log status changes automatically
create or replace function public.log_case_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    new.status_updated_at := now();
    if new.status = 'finished' and old.status <> 'finished' then
      new.finished_at := now();
    end if;
    insert into public.case_events (case_id, event_type, from_status, to_status, actor_id)
    values (new.id, 'status_change', old.status, new.status,
            public.current_profile_id('hornung_crm'));
  end if;
  return new;
end;
$$;

drop trigger if exists tax_cases_status_log on public.tax_cases;
create trigger tax_cases_status_log before update on public.tax_cases
  for each row execute function public.log_case_status_change();

-- ---------------------------------------------------------------------------
-- Document catalogue (the list on page 2 of the questionnaire)
-- ---------------------------------------------------------------------------
create table if not exists public.document_types (
  id          text primary key,
  category    text not null check (category in ('base','income','deductions','assets','property','other')),
  label_en    text not null,
  label_de    text,
  label_fr    text,
  label_it    text,
  help_en     text,
  sort_order  integer not null default 0,
  active      boolean not null default true
);

-- Documents actually agreed with the client for a given year (the checklist)
create table if not exists public.case_requested_documents (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.tax_cases(id) on delete cascade,
  document_type_id text not null references public.document_types(id),
  required         boolean not null default true,
  note             text,
  created_at       timestamptz not null default now(),
  unique (case_id, document_type_id)
);

-- Uploaded files (both directions)
create table if not exists public.case_documents (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.tax_cases(id) on delete cascade,
  document_type_id text references public.document_types(id),
  direction        text not null check (direction in ('client_upload','specialist_upload')),
  storage_path     text not null,
  file_name        text not null,
  file_size        bigint,
  mime_type        text,
  note             text,
  uploaded_by      uuid references public.app_profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists case_documents_case_idx on public.case_documents (case_id, direction, created_at desc);

-- ---------------------------------------------------------------------------
-- Pricing (editable by the specialist, no code change needed)
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_items (
  id            uuid primary key default gen_random_uuid(),
  app_id        text not null default 'hornung_crm' references public.apps(id),
  code          text not null,
  kind          text not null check (kind in ('base','per_unit','tier','surcharge','service')),
  label_en      text not null,
  label_fr      text,
  label_de      text,
  label_it      text,
  price         numeric(10,2) not null default 0,
  quantity_from integer,          -- for 'tier' rows: applies from this quantity upwards
  unit          text,             -- property | asset_unit | shareholding ...
  sort_order    integer not null default 0,
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  unique (app_id, code)
);

drop trigger if exists pricing_items_touch on public.pricing_items;
create trigger pricing_items_touch before update on public.pricing_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- PHASE 2 — AI extraction (tables ready, module to be plugged in later)
-- ---------------------------------------------------------------------------
create table if not exists public.extracted_fields (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.tax_cases(id) on delete cascade,
  document_id    uuid references public.case_documents(id) on delete set null,
  group_key      text,             -- income | deductions | assets | property ...
  field_key      text not null,    -- e.g. gross_salary, pillar_3a_amount
  field_label    text,
  field_value    text,
  value_numeric  numeric(14,2),
  currency       text default 'CHF',
  confidence     numeric(4,3),
  source_page    integer,
  source_snippet text,             -- quote from the document -> "where does this come from?"
  status         text not null default 'pending'
                 check (status in ('pending','confirmed','rejected')),
  reviewed_by    uuid references public.app_profiles(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists extracted_fields_case_idx on public.extracted_fields (case_id, group_key);

-- PHASE 3 — export log towards Doctor Tax (or any other engine)
create table if not exists public.export_jobs (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.tax_cases(id) on delete cascade,
  target       text not null default 'doctor_tax',
  status       text not null default 'queued' check (status in ('queued','sent','failed','acknowledged')),
  payload      jsonb,
  response     jsonb,
  created_by   uuid references public.app_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

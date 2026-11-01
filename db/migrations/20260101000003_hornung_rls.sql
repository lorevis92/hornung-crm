-- ===========================================================================
-- 03 — ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- Two rules everywhere:
--   * staff  (specialist/admin of app 'hornung_crm')  -> full access
--   * client (role 'client' of app 'hornung_crm')     -> only its own records
-- Everything is additionally scoped by app_id, so no WisiHealth row can ever
-- be reached through these policies and vice versa.
-- ===========================================================================

-- Helper: the client row(s) belonging to the logged-in profile
create or replace function public.my_client_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select c.id
  from public.clients c
  where c.app_id = 'hornung_crm'
    and c.profile_id = public.current_profile_id('hornung_crm')
  limit 1;
$$;

create or replace function public.owns_case(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.tax_cases tc
    where tc.id = p_case_id
      and tc.client_id = public.my_client_id()
  );
$$;

create or replace function public.case_is_open_for_client(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tax_cases tc
    where tc.id = p_case_id
      and tc.status in ('opened', 'waiting_client', 'in_process')
  );
$$;

-- ---------------------------------------------------------------------------
alter table public.clients                  enable row level security;
alter table public.client_details           enable row level security;
alter table public.client_persons           enable row level security;
alter table public.client_children          enable row level security;
alter table public.client_vehicles          enable row level security;
alter table public.client_properties        enable row level security;
alter table public.tax_cases                enable row level security;
alter table public.case_events              enable row level security;
alter table public.document_types           enable row level security;
alter table public.case_requested_documents enable row level security;
alter table public.case_documents           enable row level security;
alter table public.pricing_items            enable row level security;
alter table public.extracted_fields         enable row level security;
alter table public.export_jobs              enable row level security;

-- --------------------------- clients ---------------------------------------
drop policy if exists "clients: staff all" on public.clients;
create policy "clients: staff all" on public.clients for all to authenticated
  using (app_id = 'hornung_crm' and public.is_hornung_staff())
  with check (app_id = 'hornung_crm' and public.is_hornung_staff());

drop policy if exists "clients: read own" on public.clients;
create policy "clients: read own" on public.clients for select to authenticated
  using (app_id = 'hornung_crm' and profile_id = public.current_profile_id('hornung_crm'));

-- Clients change their own contact data through this function only, so they
-- can never touch status / internal notes / profile linkage.
create or replace function public.update_my_contact(
  p_first_name text, p_last_name text, p_phone text, p_language text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clients
     set first_name = coalesce(p_first_name, first_name),
         last_name  = coalesce(p_last_name, last_name),
         phone      = coalesce(p_phone, phone),
         preferred_language = coalesce(p_language, preferred_language)
   where id = public.my_client_id();

  update public.app_profiles
     set full_name = trim(coalesce(p_first_name,'') || ' ' || coalesce(p_last_name,'')),
         phone     = coalesce(p_phone, phone),
         locale    = coalesce(p_language, locale)
   where id = public.current_profile_id('hornung_crm');
end;
$$;

-- Called by the app on first successful login
create or replace function public.mark_client_active()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clients
     set status = case when status = 'invited' then 'active' else status end,
         activated_at = coalesce(activated_at, now())
   where id = public.my_client_id();

  update public.app_profiles
     set last_seen_at = now()
   where id = public.current_profile_id('hornung_crm');
end;
$$;

-- ------------------- questionnaire child tables ----------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'client_details','client_persons','client_children','client_vehicles','client_properties'
  ] loop
    execute format('drop policy if exists "%s: staff all" on public.%I', t, t);
    execute format(
      'create policy "%s: staff all" on public.%I for all to authenticated
         using (public.is_hornung_staff()) with check (public.is_hornung_staff())', t, t);

    execute format('drop policy if exists "%s: own" on public.%I', t, t);
    execute format(
      'create policy "%s: own" on public.%I for all to authenticated
         using (client_id = public.my_client_id())
         with check (client_id = public.my_client_id())', t, t);
  end loop;
end $$;

-- --------------------------- tax cases -------------------------------------
drop policy if exists "cases: staff all" on public.tax_cases;
create policy "cases: staff all" on public.tax_cases for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "cases: read own" on public.tax_cases;
create policy "cases: read own" on public.tax_cases for select to authenticated
  using (client_id = public.my_client_id());

-- --------------------------- case events -----------------------------------
drop policy if exists "events: staff all" on public.case_events;
create policy "events: staff all" on public.case_events for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "events: read own" on public.case_events;
create policy "events: read own" on public.case_events for select to authenticated
  using (public.owns_case(case_id));

-- ------------------------ document catalogue -------------------------------
drop policy if exists "doc types: read" on public.document_types;
create policy "doc types: read" on public.document_types for select to authenticated using (true);

drop policy if exists "doc types: staff write" on public.document_types;
create policy "doc types: staff write" on public.document_types for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

-- ------------------------ requested documents ------------------------------
drop policy if exists "requested: staff all" on public.case_requested_documents;
create policy "requested: staff all" on public.case_requested_documents for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "requested: read own" on public.case_requested_documents;
create policy "requested: read own" on public.case_requested_documents for select to authenticated
  using (public.owns_case(case_id));

-- --------------------------- documents -------------------------------------
drop policy if exists "documents: staff all" on public.case_documents;
create policy "documents: staff all" on public.case_documents for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "documents: read own" on public.case_documents;
create policy "documents: read own" on public.case_documents for select to authenticated
  using (public.owns_case(case_id));

-- Clients can always upload their own documents, regardless of the case
-- status (opened/waiting_client/in_process/review/finished) — intentionally
-- NOT gated by case_is_open_for_client() here. If they upload while the case
-- is already in review/finished, api/notify-late-upload.js alerts staff by
-- e-mail instead of the database silently rejecting the insert.
drop policy if exists "documents: client upload" on public.case_documents;
create policy "documents: client upload" on public.case_documents for insert to authenticated
  with check (
    public.owns_case(case_id)
    and direction = 'client_upload'
  );

-- A client may remove a file they uploaded themselves, as long as the case has
-- not been closed yet.
drop policy if exists "documents: client delete own" on public.case_documents;
create policy "documents: client delete own" on public.case_documents for delete to authenticated
  using (
    public.owns_case(case_id)
    and direction = 'client_upload'
    and public.case_is_open_for_client(case_id)
  );

-- --------------------------- pricing ---------------------------------------
drop policy if exists "pricing: read" on public.pricing_items;
create policy "pricing: read" on public.pricing_items for select to authenticated
  using (app_id = 'hornung_crm' and active = true);

drop policy if exists "pricing: staff write" on public.pricing_items;
create policy "pricing: staff write" on public.pricing_items for all to authenticated
  using (app_id = 'hornung_crm' and public.is_hornung_staff())
  with check (app_id = 'hornung_crm' and public.is_hornung_staff());

-- ------------------- AI extraction / exports: STAFF ONLY --------------------
drop policy if exists "extracted: staff only" on public.extracted_fields;
create policy "extracted: staff only" on public.extracted_fields for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

drop policy if exists "exports: staff only" on public.export_jobs;
create policy "exports: staff only" on public.export_jobs for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

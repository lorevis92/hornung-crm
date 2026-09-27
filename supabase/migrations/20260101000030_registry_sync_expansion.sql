-- ===========================================================================
-- 30 — Registry sync expansion: own fields, properties, children
-- ---------------------------------------------------------------------------
-- Extends the auto-fill/suggestion mechanism introduced for marital status
-- to the rest of what a "personal details" document and a property
-- document already extract but which never reached the client's registry:
-- the client's own name/DOB/address, a suggested client_properties row per
-- property document (deduplicated on re-extraction via source_document_id),
-- and a suggested client_children row when a child's name can be
-- cross-referenced from another document (e.g. a childcare invoice).
--
-- client_field_suggestions.target_table only allowed ('clients',
-- 'client_persons') — widened to also allow a suggestion that creates a
-- client_properties or client_children row. Those two use target_person =
-- 'none' (same convention 'canton' already uses) and a synthetic
-- document-scoped target_field (e.g. 'property:<document_id>') so multiple
-- properties/children for the same client don't collide on the table's
-- (client_id, target_table, target_person, target_field) unique key;
-- suggested_value holds a small JSON payload instead of a single scalar for
-- these two.
-- ---------------------------------------------------------------------------
alter table public.client_field_suggestions
  drop constraint if exists client_field_suggestions_target_table_check;
alter table public.client_field_suggestions
  add constraint client_field_suggestions_target_table_check
  check (target_table in ('clients', 'client_persons', 'client_properties', 'client_children'));

-- client_properties: a tax document's "tax value" has no existing column
-- (the questionnaire's own property model never had one), and there was no
-- way to tell "this row already came from document X" apart from a
-- specialist re-entering the same property a second time — needed to
-- update in place on re-extraction instead of duplicating.
alter table public.client_properties
  add column if not exists tax_value numeric(14,2),
  add column if not exists source_document_id uuid references public.client_documents(id) on delete set null;

-- current_tax_sheet gets a street-address field — the client's own
-- registry fields (first/last name, date of birth) already had a source
-- field; the address didn't, since client_persons.current_address is a
-- single combined string ("Street 12, 6300 Zug") while municipality/zip
-- were already extracted separately for the canton-detection flow.
insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values ('current_tax_sheet', 'street_address', 'Street address', 'text', 45)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values ('current_tax_sheet', 'street_address', 'none', null, null)
on conflict (category_code, field_key) do nothing;

-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

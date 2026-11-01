-- ===========================================================================
-- 39 — Person gender + husband-first display order for married couples
-- ---------------------------------------------------------------------------
-- A married couple's tax return is one client with two client_persons rows
-- (primary/spouse) — that part of the model was already correct. What was
-- missing: a rule for which of the two is shown FIRST wherever both appear
-- together (Questionnaire, Tax Summary header, the exported PDF, ...). The
-- consultant's rule is "husband first" — which requires knowing each
-- person's gender, and a documented fallback for when that isn't known.
--
-- gender is nullable and deliberately has no default: an unknown gender is a
-- real, common state (most existing rows), not an error — src/lib/
-- personOrder.js treats null on either side as "can't determine the order
-- automatically", never guesses.
--
-- person_order_override lives on `clients` (not `tax_cases`) so the SAME
-- order is used everywhere this client's two people are shown together —
-- the Questionnaire and "Client record" are per-client, not per tax year,
-- so a per-case override could not be applied there consistently. Set only
-- when a specialist explicitly resolves the "can't tell" case (see
-- src/lib/personOrder.js's needsVerification); left null otherwise, in
-- which case the computed (gender-based, or primary-first fallback) order
-- applies.
-- ===========================================================================

alter table public.client_persons
  add column if not exists gender text check (gender in ('male','female'));

alter table public.clients
  add column if not exists person_order_override text check (person_order_override in ('primary_first','spouse_first'));

insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('current_tax_sheet', 'gender', 'Gender', 'text', 15),
  ('current_tax_sheet', 'partner_gender', 'Partner''s gender', 'text', 95)
on conflict (category_code, field_key) do nothing;

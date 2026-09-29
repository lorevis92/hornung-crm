-- ===========================================================================
-- 38 — row_key: a repeated field belongs to a ROW, not an independent list
-- ---------------------------------------------------------------------------
-- The previous model kept every repeatable field ("account_balance_31_12",
-- "institution_name", ...) as its own independent numbered list ("_2",
-- "_3", ...), with nothing tying one list's Nth entry to another's. That's
-- exactly how Sara Bianchi's three bank accounts ended up all labeled
-- "BANQUE DES ALPES" once a second, different institution appeared on the
-- same statement — the balance list and the institution-name list simply
-- weren't the same length, and there was no shared key to align them by.
--
-- row_key fixes this: every extracted_document_fields row for the SAME
-- real-world entity (the same account, the same insurance premium, the
-- same mortgage) shares one row_key value, assigned by the extraction
-- itself — never inferred from list position. field_key goes back to
-- always being the plain, canonical key (no more "_2"/"_3" suffixes);
-- row_key alone distinguishes occurrences. A document-level field (an
-- employer name, a bank statement's single reporting currency) simply
-- uses row_key = '' (see src/lib/rowBasedFields.js's
-- ROW_KEY_DOCUMENT_LEVEL), which is also what every field extracted before
-- this migration already implicitly has (the column's default).
--
-- Existing data extracted under the OLD suffix convention is NOT migrated
-- automatically — there is no reliable way to know which old "_2" in one
-- field's list corresponds to which "_2" in another's (that ambiguity is
-- the whole bug this fixes). Affected documents need to be re-extracted;
-- until then, src/lib/taxCalculation.js explicitly flags any leftover
-- "_N"-suffixed field on a row-based category as "extracted with an old
-- format — re-extract this document" rather than silently dropping it.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

alter table public.extracted_document_fields
  add column if not exists row_key text not null default '';

-- The old (document_id, field_key) uniqueness no longer holds — the same
-- field_key can legitimately appear once per row (e.g. "annual_premium" for
-- each of four people's premiums). Uniqueness now needs row_key too.
alter table public.extracted_document_fields
  drop constraint if exists extracted_document_fields_document_id_field_key_key;
alter table public.extracted_document_fields
  add constraint extracted_document_fields_document_id_field_key_row_key_key
  unique (document_id, field_key, row_key);

-- A specialist's include/exclude decision (tax_field_decisions, added in an
-- earlier round) targets one specific field on one specific document —
-- under the row model that also means one specific row, or it could end up
-- silently applying to the wrong occurrence of a repeated field.
alter table public.tax_field_decisions
  add column if not exists row_key text not null default '';
alter table public.tax_field_decisions
  drop constraint if exists tax_field_decisions_document_id_field_key_key;
alter table public.tax_field_decisions
  add constraint tax_field_decisions_document_id_field_key_row_key_key
  unique (document_id, field_key, row_key);

-- tax_aggregate_components (the persisted "how this was calculated"
-- breakdown, rebuilt on every recalculation — see api/_recalc.js) needs
-- row_key too, so the UI can match a breakdown row or a "needs
-- verification" row back to the exact extracted_document_fields row it
-- came from (to view its source, or record a decision on it) even when
-- several rows share the same field_key.
alter table public.tax_aggregate_components
  add column if not exists row_key text not null default '';

-- Optional, document-level "the document itself states a combined total"
-- fields — when present, src/lib/taxCalculation.js cross-checks them
-- against the sum of that category's own rows and flags a mismatch instead
-- of silently trusting whichever figure. Genuinely optional: most
-- documents never state a total at all, which is fine (nothing to check
-- against). insured_persons_count (health_insurance_policy) is now
-- superseded by insured_person_name existing per row — left in place
-- (nothing depends on removing it), but no longer needed for anything.
insert into public.category_field_definitions (category_code, field_key, field_label, value_type, sort_order)
values
  ('health_insurance_policy', 'reported_total_premiums', 'Total premiums stated on the document (if any)', 'numeric', 47),
  ('bank_securities_crypto_statement', 'reported_total_balance', 'Total balance stated on the document (if any)', 'numeric', 47)
on conflict (category_code, field_key) do nothing;

insert into public.field_calculation_rules (category_code, field_key, contribution_type, cap_parameter_family, notes)
values
  ('health_insurance_policy', 'reported_total_premiums', 'none', null,
   'Reference only — cross-checked against the sum of this document''s own annual_premium rows; never itself a deduction.'),
  ('bank_securities_crypto_statement', 'reported_total_balance', 'none', null,
   'Reference only — cross-checked against the sum of this document''s own account_balance_31_12 rows; never itself a wealth contribution.')
on conflict (category_code, field_key) do nothing;
-- ===========================================================================

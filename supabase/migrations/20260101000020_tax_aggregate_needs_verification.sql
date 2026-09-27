-- ===========================================================================
-- 20 — tax_aggregate_components.needs_verification
-- ---------------------------------------------------------------------------
-- A capped entry (cap_parameter_family set on its field_calculation_rules
-- row) whose tax_parameters row can't be found for the client's canton/year
-- used to be applied uncapped, as if it had been validated against a real
-- limit. That's not safe for a document meant to resemble an official
-- filing: an amount nobody could check against an actual limit shouldn't
-- silently count as if it had been.
--
-- Now such an entry is EXCLUDED from the total by default (amount here is
-- what it *would* contribute, not what it does) unless a specialist has
-- explicitly reviewed that specific field (src/lib/taxCalculation.js checks
-- extracted_document_fields.verified_by_specialist) — same override
-- mechanism already used for including/excluding fields, just read
-- differently for this one condition: "untouched" defaults to excluded
-- instead of included.
--
-- Purely additive: one nullable-with-default boolean column, read by the
-- summary/PDF to render a distinct "needs verification" section instead of
-- folding these rows into the normal breakdown (which would break the
-- "totals above = sum of the rows below" reconciliation, since these rows
-- display the not-applied amount).
-- ===========================================================================

alter table public.tax_aggregate_components
  add column if not exists needs_verification boolean not null default false;

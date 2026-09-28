-- ===========================================================================
-- 32 — tax_aggregate_components.field_key
-- ---------------------------------------------------------------------------
-- The persisted breakdown only ever kept a human-readable field_label
-- (translated text, with a note/document identifier already appended) —
-- fine to display, but there was no reliable way to match a "needs
-- verification" row back to the exact extracted_document_fields row that
-- produced it. Needed to make the "things to verify" popup actionable
-- (e.g. letting a specialist enter a converted CHF amount for an
-- unconverted foreign-currency item directly from there) instead of just
-- describing the problem.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

alter table public.tax_aggregate_components
  add column if not exists field_key text;

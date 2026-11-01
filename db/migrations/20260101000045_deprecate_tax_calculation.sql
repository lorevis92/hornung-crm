-- ===========================================================================
-- 45 — The tax calculation engine is gone; its tables are kept, not dropped
-- ---------------------------------------------------------------------------
-- The app no longer computes a tax declaration: the specialist does the real
-- calculation in their own software, and this app is now a document
-- collection and consultation tool (upload, extract into the row model,
-- ask the assistant where a value came from). Everything that existed only
-- to compute or export a declaration was removed from the CODE in this
-- change — src/lib/taxCalculation.js, api/_recalc.js,
-- api/calculate-aggregates.js, api/save-field-decision.js,
-- api/save-manual-entry.js, api/delete-manual-entry.js, the PDF export, the
-- "Calculation results" / "How this was calculated" sections of Tax Summary,
-- and the Diagnostics page (api/diagnose-client.js).
--
-- NOTHING IS DROPPED HERE ON PURPOSE. The tables below still hold real
-- historical rows for past clients and years, and a dropped table cannot be
-- recovered. They are simply no longer read or written by any code path;
-- this migration only records that, so the next person reading the schema
-- doesn't go looking for the code that maintains them.
--
-- No longer used by any code (kept for historical data):
--   tax_aggregates                 — the computed taxable income/wealth per
--                                    client/year, with its status and
--                                    "uncertain parameters" notes.
--   tax_aggregate_components       — the per-row "how this was calculated"
--                                    breakdown that fed the removed section
--                                    of Tax Summary and the PDF export.
--   tax_field_decisions            — a specialist's include/exclude call on
--                                    a flagged field. These decided the
--                                    FISCAL treatment of a value (does it
--                                    count towards a total), which no longer
--                                    exists. The data-quality questions that
--                                    remain (whose row is this, was a line
--                                    read twice) are recomputed live from the
--                                    extraction itself — see
--                                    src/lib/extractionQuality.js — and are
--                                    resolved by correcting the extracted
--                                    value, not by storing a decision.
--   tax_manual_aggregate_entries   — specialist-typed rows added straight to
--                                    the calculation breakdown.
--   field_calculation_rules        — which extracted field contributed to
--                                    income/wealth and under which cap. The
--                                    "Document fields" tab in Tax settings no
--                                    longer shows the contribution/cap
--                                    columns that edited this.
--
-- Still very much in use, despite the name: tax_parameters. It is now
-- reference data the consultant maintains and consults in Tax settings
-- (rates, caps, allowances per canton and year) — nothing computes from it.
--
-- Extraction, documents, the client registry, the assistant, pricing and
-- everything else are untouched.
-- ===========================================================================

comment on table public.tax_aggregates is
  'DEPRECATED (migration 45): the tax calculation engine was removed from the app. Historical rows only — no code reads or writes this.';
comment on table public.tax_aggregate_components is
  'DEPRECATED (migration 45): breakdown rows of the removed tax calculation. Historical rows only — no code reads or writes this.';
comment on table public.tax_field_decisions is
  'DEPRECATED (migration 45): include/exclude decisions on a value''s fiscal treatment, which the app no longer determines. Historical rows only. Data-quality questions are now recomputed live (src/lib/extractionQuality.js).';
comment on table public.tax_manual_aggregate_entries is
  'DEPRECATED (migration 45): manual rows added to the removed calculation breakdown. Historical rows only — no code reads or writes this.';
comment on table public.field_calculation_rules is
  'DEPRECATED (migration 45): mapped an extracted field onto the removed calculation (contribution type, cap family). Historical rows only — no code reads or writes this.';
comment on table public.tax_parameters is
  'IN USE: reference data only (rates, caps, allowances per canton/year), maintained and consulted by the specialist in Tax settings. Nothing computes from it since migration 45.';

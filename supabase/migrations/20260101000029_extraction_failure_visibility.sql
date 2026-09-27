-- ===========================================================================
-- 29 — client_documents.extraction_error
-- ---------------------------------------------------------------------------
-- A document stuck at status = 'extraction_failed' (the status itself has
-- existed since migration 10) previously vanished silently from the tax
-- summary — the failure reason only ever reached a server console.log,
-- never anything queryable. This captures it: api/extract-document.js now
-- writes the actual error message here on failure, and clears it again on
-- a successful (re-)extraction — src/pages/Diagnostics.jsx and the new
-- "data completeness" banner on the Tax Summary page both read it.
--
-- Purely additive: one nullable text column.
--
-- IMPORTANT: like every migration in this folder, this must be run manually
-- in the Supabase SQL editor — merging it to GitHub does not apply it to the
-- live database.
-- ===========================================================================

alter table public.client_documents
  add column if not exists extraction_error text;

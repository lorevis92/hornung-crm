-- ===========================================================================
-- 12 — extracted_document_fields: source quote + page (for future highlighting)
-- ---------------------------------------------------------------------------
-- Prepares the data needed for a later feature: clicking an extracted value
-- and seeing exactly where in the source document it came from. Purely
-- additive — two nullable columns, nothing else changes.
--
-- source_quote: the exact verbatim text the value was read from, so it can
--   later be searched for and highlighted in the document. Null when the
--   model can't pin one down (never populated with an invented quote).
-- source_page: the PDF page number (1-based) that quote is on. Always null
--   for image uploads (no page concept) and for any field where the model
--   couldn't determine it.
--
-- api/extract-document.js's extraction prompt now asks for both alongside
-- field_value; classification (phase 1) is unchanged.
-- ===========================================================================

alter table public.extracted_document_fields
  add column if not exists source_quote text,
  add column if not exists source_page  integer;

-- ===========================================================================
-- 50 — whom a document refers to, and a readable name for each extracted row
-- ---------------------------------------------------------------------------
-- client_documents:
--   person_ref    who the document is about, chosen by the extraction among
--                 the persons of the case:
--                   'taxpayer' | 'spouse' | 'both_spouses' | 'household' |
--                   'child:<client_children.id>' | 'unknown'
--                 NULL = not extracted with this version yet.
--   person_name   the name as it was when the extraction chose it (kept so
--                 the document still says something if a child is later
--                 renamed or removed from the Questionnaire).
--   person_quote  the sentence of the document that justifies the choice.
--   person_page   its page (PDF only).
--
-- extracted_document_fields:
--   row_label     the readable name the extraction gives to a row
--                 ("Conto risparmio UBS – Mario Rossi"); every field of the
--                 same row carries the same label.
--
-- Purely additive and re-runnable (IF NOT EXISTS): no table is dropped, no
-- existing value is changed. Documents extracted before this migration keep
-- working; they get a person and row labels at their next extraction
-- ("Ricarica tutto dai documenti" on the case page does all of them).
--
-- Run it manually in the Supabase SQL editor, like every migration here.
-- ===========================================================================

alter table public.client_documents
  add column if not exists person_ref   text,
  add column if not exists person_name  text,
  add column if not exists person_quote text,
  add column if not exists person_page  integer;

alter table public.extracted_document_fields
  add column if not exists row_label text;

-- ===========================================================================
-- 40 — Price list becomes staff-editable (description + explicit "on request")
-- ---------------------------------------------------------------------------
-- pricing_items already existed with the right RLS (staff write, any
-- authenticated read the active rows — see 20260101000003_hornung_rls.sql),
-- but nothing in the app ever wrote to it: the price list and "further
-- services" were effectively fixed once seeded. Two additions needed for a
-- real settings page:
--  - description_{en,de,fr,it}: the price list only ever had a one-line
--    label; the consultant asked to manage a name AND a description.
--  - on_request: Pricing.jsx used to infer "price on request" from price
--    being exactly 0 — real, but implicit, and every 'service' row happened
--    to be seeded at 0 either way. An explicit flag replaces that guess, so
--    a row can be "CHF 0" (free) and "on request" (no price yet) without
--    conflating the two, and so a specialist adding a new service has to
--    pick one explicitly instead of a price of 0 silently meaning something.
--    Backfilled true for every existing 'service' row (all currently priced
--    at 0, all currently shown as "on request") — behavior-preserving.
--
-- IMPORTANT: like every migration in this folder, run this manually in the
-- Supabase SQL editor — merging to GitHub does not apply it to the live
-- database.
-- ===========================================================================

alter table public.pricing_items
  add column if not exists description_en text,
  add column if not exists description_fr text,
  add column if not exists description_de text,
  add column if not exists description_it text,
  add column if not exists on_request boolean not null default false;

update public.pricing_items set on_request = true where kind = 'service';

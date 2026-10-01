-- ---------------------------------------------------------------------------
-- 47 — The fee estimate becomes the consultant's, not just the calculator's
--
-- Until now the estimate on a case was derived entirely from the
-- Questionnaire and the price list: base fee by marital status, one line per
-- property, the asset-statement tier, self-employment, shareholdings, plus
-- the two surcharge booleans already on tax_cases (delivery_by_post,
-- express). Correct as a starting point, and wrong as a final answer — the
-- consultant regularly knows that a derived line does not apply to this
-- client, that a further service does, or simply what they intend to charge.
--
-- Three columns, all optional, all defaulting to today's behaviour:
--
--   fee_excluded_codes — pricing_items.code values the consultant switched
--     OFF for this case. The line is still DERIVED (so it reappears if the
--     Questionnaire changes) and still shown, just not counted. Storing what
--     was excluded rather than what was included is deliberate: a case left
--     alone keeps tracking the Questionnaire, which is what the automatic
--     estimate is for.
--
--   fee_extra_codes — pricing_items.code values the consultant switched ON
--     although nothing in the Questionnaire implies them. This is how the
--     "further services" (kind = 'service', price on request) reach a case
--     at all; they have never fed the automatic estimate and still do not.
--
--   fee_total_override — a total typed by hand. NULL means "use the sum of
--     the selected lines", which is the only state that existed before this
--     migration, so every existing row keeps behaving exactly as it does
--     today. A non-null value wins over the sum, and the interface says so
--     and offers to clear it.
--
-- Nothing is dropped and nothing is backfilled: the estimate stays an
-- estimate, and the invoice stays a human decision.
-- ---------------------------------------------------------------------------
alter table public.tax_cases
  add column if not exists fee_excluded_codes text[] not null default '{}'::text[],
  add column if not exists fee_extra_codes    text[] not null default '{}'::text[],
  add column if not exists fee_total_override numeric(10,2);

comment on column public.tax_cases.fee_excluded_codes is
  'pricing_items.code values excluded from this case''s fee estimate by the consultant. The line is still derived and shown, just not counted.';
comment on column public.tax_cases.fee_extra_codes is
  'pricing_items.code values added to this case''s fee estimate by hand — how "further services" reach a case, since they never feed the automatic estimate.';
comment on column public.tax_cases.fee_total_override is
  'Fee total typed by the consultant. NULL = use the sum of the selected lines (the pre-migration-47 behaviour).';

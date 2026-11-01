-- ---------------------------------------------------------------------------
-- 48 — "Is this the same property/account/mortgage as that one?"
--
-- Tax Summary gains a second way to read the same extraction: by CATEGORY
-- instead of by document — every bank account of the client in one place,
-- every property in one place — regardless of which document each row came
-- from (src/lib/categoryEntities.js).
--
-- Reading across documents immediately raises a question reading one
-- document never did: two rows in the same category may describe the SAME
-- real-world thing. When they share a strong identifier (the same address
-- written the same way, the same creditor and debt type, the same policy
-- number) that is settled, and they are merged automatically with no
-- decision to store. When they only LOOK alike — Weber's "Rue des Finettes
-- 6, 1920 Martigny" on the rental statement and "RUE DES FINETTES 6" on the
-- maintenance invoices — guessing would be worse than asking. Those stay
-- separate, flagged, until a specialist says which it is. This table holds
-- that answer.
--
-- Keys, not row ids, on purpose. An extracted row's row_key is assigned by
-- the extraction itself and can be reassigned the next time the document is
-- re-extracted, so a decision stored against (document_id, row_key) would
-- quietly evaporate on re-extraction. entity_key is derived from what
-- identifies the thing (its normalized address, its creditor + debt type,
-- ...) and is therefore reproduced identically by the next extraction of
-- the same document — see entityKeyOf() in src/lib/categoryEntities.js. The
-- decision survives because it is a statement about the client's property,
-- not about a particular parse of a particular file.
--
-- decision:
--   'merged'   — the specialist confirmed these are one thing. The two are
--                shown as a single entity from then on, union-find style
--                (confirming A=B and B=C merges all three).
--   'separate' — the specialist confirmed these are different things. The
--                suggestion stops being raised, instead of coming back on
--                every page load forever.
-- ---------------------------------------------------------------------------
create table if not exists public.entity_merge_decisions (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  tax_year      integer not null check (tax_year between 2000 and 2100),
  category_code text not null references public.document_categories(code) on delete cascade,
  -- Always stored with entity_key_a < entity_key_b (the caller sorts them),
  -- so one pair can never be recorded twice in opposite orders.
  entity_key_a  text not null,
  entity_key_b  text not null,
  decision      text not null check (decision in ('merged', 'separate')),
  decided_by    uuid references public.app_profiles(id) on delete set null,
  decided_at    timestamptz not null default now(),
  unique (client_id, tax_year, category_code, entity_key_a, entity_key_b)
);

create index if not exists entity_merge_decisions_client_year_idx
  on public.entity_merge_decisions (client_id, tax_year);

alter table public.entity_merge_decisions enable row level security;

-- Same audience as the extraction it describes: staff only.
drop policy if exists "entity merge decisions: staff only" on public.entity_merge_decisions;
create policy "entity merge decisions: staff only" on public.entity_merge_decisions for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());

comment on table public.entity_merge_decisions is
  'Specialist answers to "are these two extracted rows the same real-world thing?" in Tax Summary''s by-category view. Keyed by derived entity_key (not row ids) so the answer survives re-extraction — see migration 48.';

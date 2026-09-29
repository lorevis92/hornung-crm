-- ===========================================================================
-- 41 — A client can add their own tax year (not just the consultant)
-- ---------------------------------------------------------------------------
-- tax_cases already had "cases: read own" for clients but no INSERT policy
-- at all — only staff could create one (see "cases: staff all"). Adding a
-- narrow, additive INSERT policy: a client can create a row ONLY for their
-- OWN client_id (my_client_id(), the same function every other "read own"
-- policy already uses) and ONLY for a tax_year that isn't in the future —
-- never for another client, never a duplicate (the existing
-- unique(client_id, tax_year) constraint already rejects that with a plain
-- 23505 error, same as when a specialist does it — see createCase in both
-- data layers). No UPDATE/DELETE policy is added for clients — they can
-- create a year, never remove one.
--
-- created_by_client records which of the two paths created the row, purely
-- so the specialist's own case list can flag it — never used for any access
-- decision.
-- ===========================================================================

alter table public.tax_cases
  add column if not exists created_by_client boolean not null default false;

drop policy if exists "cases: client insert own" on public.tax_cases;
create policy "cases: client insert own" on public.tax_cases for insert to authenticated
  with check (
    client_id = public.my_client_id()
    and tax_year <= extract(year from now())::int
  );

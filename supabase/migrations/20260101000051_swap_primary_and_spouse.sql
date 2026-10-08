-- ===========================================================================
-- 51 — swap who is "primary" and who is "spouse" for one client
-- ---------------------------------------------------------------------------
-- Used by the Questionnaire's "Scambia contribuente e coniuge" action, for a
-- case created with the wrong person as primary. One function, so the whole
-- swap happens in one transaction — never half done.
--
-- What moves, and why:
--   * client_persons — each person's OWN data swaps rows with the other's
--     (name, birth date, gender, religion, job, contacts, ...). The data of
--     the couple as a whole (marital_status, current_address, address_dec31)
--     stays on the row it is on. person_type itself is never touched, so
--     the (client_id, person_type) unique key is never in the way.
--     The list of personal columns must match PERSONAL_FIELDS in
--     src/lib/personSwap.js (a test checks it).
--   * client_documents.person_ref — a document is attributed to a ROLE
--     ('taxpayer' = the primary row, 'spouse' = the spouse row). Once the
--     people change rows, the roles must change with them, or every
--     document already extracted would point at the other person.
--   * client_field_suggestions — a pending suggestion for one person's own
--     field follows that person; couple fields stay.
--   * clients.person_order_override — 'primary_first'/'spouse_first' names
--     rows too: flipped so the order on screen stays the same people.
--
-- Staff only. Re-runnable (create or replace); running the FUNCTION twice
-- simply swaps back. Run it manually in the Supabase SQL editor.
-- ===========================================================================

create or replace function public.swap_primary_and_spouse(p_client_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not public.is_hornung_staff() then
    raise exception 'NOT_STAFF';
  end if;

  if (select count(*) from public.client_persons where client_id = p_client_id) <> 2 then
    raise exception 'NO_SPOUSE';
  end if;

  -- In one UPDATE ... FROM, `o` is read from the snapshot before the
  -- update, so both rows get the other's old values.
  update public.client_persons p
     set first_name               = o.first_name,
         last_name                = o.last_name,
         date_of_birth            = o.date_of_birth,
         gender                   = o.gender,
         religious_denomination   = o.religious_denomination,
         email                    = o.email,
         mobile_phone             = o.mobile_phone,
         profession               = o.profession,
         employer                 = o.employer,
         employer_address         = o.employer_address,
         work_address             = o.work_address,
         work_percentage          = o.work_percentage,
         public_transport_costs   = o.public_transport_costs,
         car_km_home_to_work      = o.car_km_home_to_work,
         other_work_costs         = o.other_work_costs,
         is_self_employed         = o.is_self_employed,
         qualifying_shareholdings = o.qualifying_shareholdings,
         asset_statement_count    = o.asset_statement_count
    from public.client_persons o
   where p.client_id = p_client_id
     and o.client_id = p_client_id
     and o.person_type <> p.person_type;

  update public.client_documents
     set person_ref = case person_ref when 'taxpayer' then 'spouse' else 'taxpayer' end
   where client_id = p_client_id
     and person_ref in ('taxpayer', 'spouse');

  -- Three steps: the unique key (client_id, target_table, target_person,
  -- target_field) would reject a direct swap row by row. 'none' is never
  -- used for client_persons, so it is free as a parking value.
  update public.client_field_suggestions
     set target_person = 'none'
   where client_id = p_client_id and target_table = 'client_persons' and target_person = 'primary'
     and target_field not in ('marital_status', 'current_address', 'address_dec31');
  update public.client_field_suggestions
     set target_person = 'primary'
   where client_id = p_client_id and target_table = 'client_persons' and target_person = 'spouse'
     and target_field not in ('marital_status', 'current_address', 'address_dec31');
  update public.client_field_suggestions
     set target_person = 'spouse'
   where client_id = p_client_id and target_table = 'client_persons' and target_person = 'none';

  update public.clients
     set person_order_override = case person_order_override
                                   when 'primary_first' then 'spouse_first'
                                   when 'spouse_first' then 'primary_first'
                                 end
   where id = p_client_id
     and person_order_override is not null;
end;
$$;

grant execute on function public.swap_primary_and_spouse(uuid) to authenticated;

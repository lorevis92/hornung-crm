-- ===========================================================================
-- 54 — EXTRACTION JOBS (the extraction runs from a Cloudflare Queue)
-- ---------------------------------------------------------------------------
-- An extraction (AI classification + fields + coverage check) can take
-- minutes, longer than one HTTP request should be tied to on Workers. So an
-- extraction is never run inside the request that asks for it: the request
-- records a job here, puts one message per document on the EXTRACTION_QUEUE
-- and answers at once with the job id; the queue consumer (worker/index.js
-- -> api/_extractionQueue.js) runs each document; the page that asked polls
-- the job (data op getExtractionJob) until it is finished.
--
--   extraction_jobs        one per request: an upload (automatic), "Riprova
--                          estrazione", the Questionnaire's "fill from a
--                          document", "Estrai tutto" for a client/year
--   extraction_job_items   one per document of a job, with its outcome
--
-- Queues deliver at least once: an item is claimed atomically before it
-- runs (a duplicate delivery finds it already taken), and a claim older
-- than 15 minutes (the consumer died mid-run) can be taken over.
-- ===========================================================================

create table if not exists public.extraction_jobs (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('upload', 'retry', 'now', 'reprocess')),
  client_id             uuid references public.clients(id) on delete cascade,
  tax_year              integer,
  requested_by          uuid references public.app_profiles(id) on delete set null,
  forced_category_code  text,
  total                 integer not null,
  result                jsonb,
  created_at            timestamptz not null default now(),
  finished_at           timestamptz
);
create index if not exists extraction_jobs_client_idx on public.extraction_jobs (client_id, created_at desc);

create table if not exists public.extraction_job_items (
  job_id         uuid not null references public.extraction_jobs(id) on delete cascade,
  document_id    uuid not null references public.client_documents(id) on delete cascade,
  file_name      text,
  from_statuses  text[] not null,
  state          text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed', 'skipped')),
  error          text,
  attempts       integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (job_id, document_id)
);
create index if not exists extraction_job_items_document_idx on public.extraction_job_items (document_id);

-- Claim one item for a run. Returns the item (with reclaimed = true when a
-- stale 'running' claim was taken over), or nothing when it is not
-- claimable: already finished, or being run right now by someone else.
create or replace function public.claim_extraction_job_item(p_job_id uuid, p_document_id uuid)
returns table (job_id uuid, document_id uuid, from_statuses text[], state text, attempts integer, reclaimed boolean)
language plpgsql set search_path = public
as $$
begin
  return query
  update public.extraction_job_items i
     set state = 'running',
         attempts = i.attempts + 1,
         updated_at = now()
    from (select i2.state as previous_state
            from public.extraction_job_items i2
           where i2.job_id = p_job_id and i2.document_id = p_document_id
           for update) prev
   where i.job_id = p_job_id
     and i.document_id = p_document_id
     and (i.state = 'queued' or (i.state = 'running' and i.updated_at < now() - interval '15 minutes'))
  returning i.job_id, i.document_id, i.from_statuses, i.state, i.attempts, prev.previous_state = 'running';
end;
$$;

-- Records the outcome of a running item. Returns:
--   'pending'   other items of the job are still queued/running
--   'finished'  this was the last one; the job is marked finished
--   'finalize'  this was the last one of a 'reprocess' job: the caller runs
--               the final step (property dedup) and then sets finished_at
--   'ignored'   the item was not running (a duplicate delivery)
-- The job row is locked first, so two items finishing at the same time are
-- counted one after the other and exactly one of them sees the job done.
create or replace function public.finish_extraction_job_item(p_job_id uuid, p_document_id uuid, p_state text, p_error text)
returns text
language plpgsql set search_path = public
as $$
declare
  v_kind text;
begin
  if p_state not in ('done', 'failed', 'skipped') then
    raise exception 'BAD_STATE %', p_state;
  end if;
  select kind into v_kind from public.extraction_jobs where id = p_job_id for update;
  if v_kind is null then
    return 'ignored';
  end if;

  update public.extraction_job_items
     set state = p_state, error = left(p_error, 2000), updated_at = now()
   where job_id = p_job_id and document_id = p_document_id and state = 'running';
  if not found then
    return 'ignored';
  end if;

  if exists (select 1 from public.extraction_job_items where job_id = p_job_id and state in ('queued', 'running')) then
    return 'pending';
  end if;
  if v_kind = 'reprocess' then
    return 'finalize';
  end if;
  update public.extraction_jobs set finished_at = now() where id = p_job_id and finished_at is null;
  return 'finished';
end;
$$;

-- ===========================================================================
-- 04 — STORAGE
-- ---------------------------------------------------------------------------
-- Private bucket, one folder tree per app so the bucket can be shared with the
-- other WisiApps products if you ever want to:
--
--   hornung/<client_id>/<tax_year>/<direction>/<uuid>-<file name>
--            ^[2]        ^[3]       ^[4] = client_upload | specialist_upload
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  26214400, -- 25 MB per file
  array[
    'application/pdf',
    'image/jpeg','image/png','image/heic','image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/csv','text/plain'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Staff: full access to the whole Hornung tree
-- ---------------------------------------------------------------------------
drop policy if exists "hornung staff manage files" on storage.objects;
create policy "hornung staff manage files" on storage.objects for all to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'hornung'
    and public.is_hornung_staff()
  )
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'hornung'
    and public.is_hornung_staff()
  );

-- ---------------------------------------------------------------------------
-- Clients: read everything inside their own folder (both directions, so they
-- can download the finished declaration), upload only into client_upload.
-- ---------------------------------------------------------------------------
drop policy if exists "hornung client reads own files" on storage.objects;
create policy "hornung client reads own files" on storage.objects for select to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'hornung'
    and (storage.foldername(name))[2] = public.my_client_id()::text
  );

drop policy if exists "hornung client uploads own files" on storage.objects;
create policy "hornung client uploads own files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'hornung'
    and (storage.foldername(name))[2] = public.my_client_id()::text
    and (storage.foldername(name))[4] = 'client_upload'
  );

drop policy if exists "hornung client deletes own uploads" on storage.objects;
create policy "hornung client deletes own uploads" on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'hornung'
    and (storage.foldername(name))[2] = public.my_client_id()::text
    and (storage.foldername(name))[4] = 'client_upload'
  );

-- VisaFlow-owned policies on the Supabase-managed storage.objects table.
-- Requires 20260717000050_visaflow_storage_buckets.sql first.
-- SECURITY REVIEW: the three AI audio policies intentionally reproduce the
-- current Production anon access and must be approved before any application.

create policy "VisaFlow AI audio temporary insert"
on storage.objects
for insert
to authenticated, anon
with check (bucket_id = 'ai-interview-audio'::text);

create policy "VisaFlow AI audio temporary read"
on storage.objects
for select
to authenticated, anon
using (bucket_id = 'ai-interview-audio'::text);

create policy "VisaFlow AI audio temporary update"
on storage.objects
for update
to authenticated, anon
using (bucket_id = 'ai-interview-audio'::text)
with check (bucket_id = 'ai-interview-audio'::text);

create policy talent_cv_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'talent-cv'::text
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy talent_cv_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'talent-cv'::text
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy talent_cv_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'talent-cv'::text
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy talent_cv_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'talent-cv'::text
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'talent-cv'::text
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy talent_resume_files_candidate_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'talent-resume-versions'::text
  and exists (
    select 1
    from public.talent_candidates as candidate
    where candidate.auth_user_id = auth.uid()
      and (storage.foldername(storage.objects.name))[1] = candidate.id::text
  )
);

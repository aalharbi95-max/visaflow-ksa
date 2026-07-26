-- VisaFlow Storage bucket metadata baseline.
-- Configuration only: this migration does not copy Storage objects or user data.
-- Apply before 20260717000060_visaflow_storage_policies.sql.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'ai-interview-audio',
    'ai-interview-audio',
    false,
    104857600,
    array[
      'audio/webm',
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/ogg',
      'audio/ogg;codecs=opus',
      'audio/wav',
      'video/webm',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/mp4'
    ]::text[]
  ),
  (
    'talent-cv',
    'talent-cv',
    false,
    10485760,
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]::text[]
  ),
  (
    'talent-resume-versions',
    'talent-resume-versions',
    false,
    10485760,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/html'
    ]::text[]
  )
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

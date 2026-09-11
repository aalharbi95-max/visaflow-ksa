-- Email delivery audit rows are server-owned. Browser roles retain only the
-- tenant-scoped SELECT granted by the existing RLS policy/RPC surface.
revoke insert, update, delete, truncate, references, trigger
  on table public.email_logs from anon, authenticated;
grant select on table public.email_logs to authenticated;

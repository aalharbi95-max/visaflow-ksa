-- Phase 3 only: do not apply until the new React release has been deployed
-- and production login and user-list flows have passed testing through the RPCs.

revoke all on table public.users from anon;
revoke all on table public.users from authenticated;

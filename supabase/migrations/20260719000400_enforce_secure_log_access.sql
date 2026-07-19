-- DO NOT APPLY until:
-- - React release is deployed.
-- - Legacy and Agency log requests are confirmed absent.
-- - Auth-linked company and platform tests pass.
-- - A privileges and policies snapshot has been saved.

drop policy if exists agency_score_history_all
  on public.agency_score_history;

drop policy if exists audit_select_public
  on public.request_audit_logs;

drop policy if exists audit_insert_public
  on public.request_audit_logs;

drop policy if exists "audit logs company access"
  on public.request_audit_logs;

alter table public.system_activity_logs enable row level security;
alter table public.request_audit_logs enable row level security;
alter table public.notification_events enable row level security;
alter table public.agency_score_history enable row level security;
alter table public.email_logs enable row level security;
alter table public.ai_agent_audit_logs enable row level security;
alter table public.talent_candidate_events enable row level security;
alter table public.support_tickets enable row level security;
alter table public.system_backups enable row level security;
alter table public.system_restore_requests enable row level security;

revoke all on table public.system_activity_logs from anon, authenticated;
revoke all on table public.request_audit_logs from anon, authenticated;
revoke all on table public.notification_events from anon, authenticated;
revoke all on table public.agency_score_history from anon, authenticated;
revoke all on table public.email_logs from anon, authenticated;
revoke all on table public.ai_agent_audit_logs from anon, authenticated;
revoke all on table public.talent_candidate_events from anon, authenticated;
revoke all on table public.support_tickets from anon, authenticated;
revoke all on table public.system_backups from anon, authenticated;
revoke all on table public.system_restore_requests from anon, authenticated;

grant select on table public.system_activity_logs to authenticated;
grant select, insert on table public.request_audit_logs to authenticated;
grant select, insert, update, delete on table public.notification_events to authenticated;
grant select, insert on table public.agency_score_history to authenticated;
grant select, insert on table public.email_logs to authenticated;
grant select, insert on table public.ai_agent_audit_logs to authenticated;
grant select, insert on table public.talent_candidate_events to authenticated;
grant select, insert, update, delete on table public.support_tickets to authenticated;
grant select, insert, delete on table public.system_backups to authenticated;
grant select, insert, update on table public.system_restore_requests to authenticated;

-- No TRUNCATE, REFERENCES, or TRIGGER privileges are granted to anon or authenticated.

-- Phase 1: add reviewed log policies without enabling RLS or changing table grants.
-- Apply this file first, test Auth-linked accounts, then deploy the matching React release.

create or replace function public.current_log_actor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  linked_rows bigint;
  actor jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;

  select count(*)
  into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    return null;
  end if;

  select jsonb_build_object(
    'id', app_user.id,
    'role', app_user.role,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id
  )
  into actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active'
    and app_user.is_active is true
    and (
      app_user.company_id is null
      or exists (
        select 1
        from public.companies as company
        where company.id = app_user.company_id
          and company.status = 'Active'
      )
    )
    and (
      app_user.role <> 'Agency'
      or (
        app_user.agency_id is not null
        and exists (
          select 1
          from public.agencies as agency
          where agency.id = app_user.agency_id
            and agency.status = 'Active'
        )
      )
    )
    and (
      app_user.role not in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
      or app_user.company_id is null
    );

  return actor;
end;
$function$;

revoke all on function public.current_log_actor() from public;
revoke all on function public.current_log_actor() from anon;
revoke all on function public.current_log_actor() from authenticated;
grant execute on function public.current_log_actor() to authenticated;

create policy secure_system_activity_select
on public.system_activity_logs
for select to authenticated
using (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Accounts User')
    and public.current_log_actor()->>'company_id' is null
  )
);

create policy secure_request_audit_select
on public.request_audit_logs
for select to authenticated
using (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' not in (
    'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  )
);

create policy secure_request_audit_insert
on public.request_audit_logs
for insert to authenticated
with check (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' not in (
    'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  )
);

create policy secure_notification_select
on public.notification_events
for select to authenticated
using (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' = 'Agency'
    and agency_id::text = public.current_log_actor()->>'agency_id'
    and exists (
      select 1
      from public.agency_company_user_access as access
      where access.user_id::text = public.current_log_actor()->>'id'
        and access.agency_id::text = public.current_log_actor()->>'agency_id'
        and access.company_id::text = notification_events.company_id::text
        and access.status = 'Active'
    )
  )
  or (
    public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Accounts User')
    and public.current_log_actor()->>'company_id' is null
  )
);

create policy secure_notification_insert
on public.notification_events
for insert to authenticated
with check (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' = 'Agency'
    and agency_id::text = public.current_log_actor()->>'agency_id'
    and exists (
      select 1
      from public.agency_company_user_access as access
      where access.user_id::text = public.current_log_actor()->>'id'
        and access.agency_id::text = public.current_log_actor()->>'agency_id'
        and access.company_id::text = notification_events.company_id::text
        and access.status = 'Active'
    )
  )
);

create policy secure_notification_update
on public.notification_events
for update to authenticated
using (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' = 'Agency'
    and agency_id::text = public.current_log_actor()->>'agency_id'
    and exists (
      select 1
      from public.agency_company_user_access as access
      where access.user_id::text = public.current_log_actor()->>'id'
        and access.agency_id::text = public.current_log_actor()->>'agency_id'
        and access.company_id::text = notification_events.company_id::text
        and access.status = 'Active'
    )
  )
)
with check (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' = 'Agency'
    and agency_id::text = public.current_log_actor()->>'agency_id'
    and exists (
      select 1
      from public.agency_company_user_access as access
      where access.user_id::text = public.current_log_actor()->>'id'
        and access.agency_id::text = public.current_log_actor()->>'agency_id'
        and access.company_id::text = notification_events.company_id::text
        and access.status = 'Active'
    )
  )
);

create policy secure_notification_delete
on public.notification_events
for delete to authenticated
using (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' not in (
    'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  )
);

create policy secure_agency_score_select
on public.agency_score_history
for select to authenticated
using (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' = 'Agency'
    and agency_id::text = public.current_log_actor()->>'agency_id'
    and exists (
      select 1
      from public.agency_company_user_access as access
      where access.user_id::text = public.current_log_actor()->>'id'
        and access.agency_id::text = public.current_log_actor()->>'agency_id'
        and access.company_id::text = agency_score_history.company_id::text
        and access.status = 'Active'
    )
  )
);

create policy secure_agency_score_insert
on public.agency_score_history
for insert to authenticated
with check (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' not in (
    'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  )
);

create policy secure_email_log_select
on public.email_logs
for select to authenticated
using (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Accounts User')
    and public.current_log_actor()->>'company_id' is null
  )
);

create policy secure_email_log_insert
on public.email_logs
for insert to authenticated
with check (
  (
    company_id::text = public.current_log_actor()->>'company_id'
    and public.current_log_actor()->>'role' not in (
      'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
    )
  )
  or (
    public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Accounts User')
    and public.current_log_actor()->>'company_id' is null
  )
);

create policy secure_ai_agent_audit_select
on public.ai_agent_audit_logs
for select to authenticated
using (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' not in (
    'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  )
);

create policy secure_ai_agent_audit_insert
on public.ai_agent_audit_logs
for insert to authenticated
with check (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' not in (
    'Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  )
);

create policy secure_talent_event_select_own
on public.talent_candidate_events
for select to authenticated
using (auth_user_id = auth.uid());

create policy secure_talent_event_insert_own
on public.talent_candidate_events
for insert to authenticated
with check (
  auth_user_id = auth.uid()
  and exists (
    select 1
    from public.talent_candidates as candidate
    where candidate.id = talent_candidate_events.candidate_id
      and candidate.auth_user_id = auth.uid()
  )
);

create policy secure_support_ticket_select
on public.support_tickets
for select to authenticated
using (
  public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Support User')
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_support_ticket_insert
on public.support_tickets
for insert to authenticated
with check (
  public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Support User')
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_support_ticket_update
on public.support_tickets
for update to authenticated
using (
  public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Support User')
  and public.current_log_actor()->>'company_id' is null
)
with check (
  public.current_log_actor()->>'role' in ('Platform Owner', 'Platform Support User')
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_support_ticket_delete
on public.support_tickets
for delete to authenticated
using (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_system_backup_select
on public.system_backups for select to authenticated
using (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_system_backup_insert
on public.system_backups for insert to authenticated
with check (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_system_backup_delete
on public.system_backups for delete to authenticated
using (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_restore_request_select
on public.system_restore_requests for select to authenticated
using (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_restore_request_insert
on public.system_restore_requests for insert to authenticated
with check (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

create policy secure_restore_request_update
on public.system_restore_requests for update to authenticated
using (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
)
with check (
  public.current_log_actor()->>'role' = 'Platform Owner'
  and public.current_log_actor()->>'company_id' is null
);

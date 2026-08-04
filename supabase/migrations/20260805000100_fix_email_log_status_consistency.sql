-- Keep delivery status, timestamps, and safe error details internally consistent.
-- Historical records could be marked Sent after a retry while retaining the
-- previous failure fields, which made the administration screen contradictory.

update public.email_logs
set error_code = null,
    error_message = null,
    failed_at = null,
    sent_at = coalesce(sent_at, created_at)
where lower(coalesce(status, '')) = 'sent'
  and (
    error_code is not null
    or error_message is not null
    or failed_at is not null
    or sent_at is null
  );

create or replace function public.email_log_list_v1()
returns table (
  id uuid, company_id uuid, agency_id uuid, user_id bigint,
  event_type text, type text, status text, recipient text, to_email text,
  subject text, provider text, provider_message_id text, message_id text,
  error_code text, error_message text, retry_count integer,
  created_at timestamptz, sent_at timestamptz, failed_at timestamptz
)
language plpgsql security definer stable set search_path = '' as $function$
declare actor public.users%rowtype;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active' and app_user.is_active is true
    and app_user.company_id is not null
    and app_user.role not in ('Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User');
  if actor.id is null then raise exception 'EMAIL_LOG_UNAUTHORIZED'; end if;
  return query
  select log.id, log.company_id, log.agency_id, log.user_id,
    log.event_type, log.type, log.status,
    case when actor.role in ('Admin', 'Company Admin') then coalesce(log.recipient, log.to_email)
      when position('@' in coalesce(log.recipient, log.to_email, '')) > 1 then
        left(split_part(coalesce(log.recipient, log.to_email), '@', 1), 2)
          || '***@' || split_part(coalesce(log.recipient, log.to_email), '@', 2)
      else null end,
    case when actor.role in ('Admin', 'Company Admin') then log.to_email
      when position('@' in coalesce(log.to_email, log.recipient, '')) > 1 then
        left(split_part(coalesce(log.to_email, log.recipient), '@', 1), 2)
          || '***@' || split_part(coalesce(log.to_email, log.recipient), '@', 2)
      else null end,
    log.subject, log.provider, log.provider_message_id, log.message_id,
    case when lower(coalesce(log.status, '')) = 'failed' then log.error_code else null end,
    case when lower(coalesce(log.status, '')) = 'failed' and log.error_message is not null
      then 'Email delivery failed at the provider.' else null end,
    log.retry_count, log.created_at,
    case when lower(coalesce(log.status, '')) = 'sent' then coalesce(log.sent_at, log.created_at) else log.sent_at end,
    case when lower(coalesce(log.status, '')) = 'failed' then log.failed_at else null end
  from public.email_logs log
  where log.company_id = actor.company_id
  order by log.created_at desc
  limit 100;
end;
$function$;


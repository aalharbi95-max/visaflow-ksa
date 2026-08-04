-- Staging follow-up: persist agreement email delivery state without changing
-- agreement availability or creating duplicate agreement records on retry.
alter table public.agency_agreements
  add column if not exists email_delivery_status text not null default 'Not Sent',
  add column if not exists email_provider_message_id text,
  add column if not exists email_error_code text,
  add column if not exists email_error_message text,
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_failed_at timestamptz;

alter table public.agency_agreements
  drop constraint if exists agency_agreements_email_delivery_status_check;
alter table public.agency_agreements
  add constraint agency_agreements_email_delivery_status_check
  check (email_delivery_status in ('Not Sent', 'Queued', 'Sent', 'Failed'));

update public.agency_agreements
set email_error_message = 'Email delivery failed at the provider.'
where email_error_message is not null and btrim(email_error_message) <> '';

create index if not exists agency_agreements_email_delivery_idx
  on public.agency_agreements (company_id, email_delivery_status, email_last_attempt_at desc);

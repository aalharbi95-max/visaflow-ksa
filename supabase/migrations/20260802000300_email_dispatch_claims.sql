-- An email attempt remains Queued while one dispatcher invocation owns its
-- short-lived delivery claim. Atomic UPDATE predicates prevent double sends.
alter table public.email_logs
  add column if not exists dispatch_claimed_at timestamptz;

create index if not exists email_logs_queued_claim_idx
  on public.email_logs (company_id, idempotency_key, dispatch_claimed_at)
  where status = 'Queued';

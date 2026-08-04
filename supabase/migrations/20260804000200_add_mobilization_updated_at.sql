-- Keep mobilization lifecycle changes auditable and compatible with the UI payload.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.mobilizations
  add column if not exists updated_at timestamptz not null default now();

commit;

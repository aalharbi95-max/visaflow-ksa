-- Complete the operational-table remediation by hardening identity sequences.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all on sequence public.employees_id_seq, public.mobilizations_id_seq from anon;
revoke all on sequence public.employees_id_seq, public.mobilizations_id_seq from authenticated;
grant usage, select on sequence public.employees_id_seq, public.mobilizations_id_seq to authenticated;
grant all on sequence public.employees_id_seq, public.mobilizations_id_seq to service_role;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.agency_penalties
  add column if not exists agency_evidence jsonb not null default '[]'::jsonb;

alter table public.agency_penalties
  drop constraint if exists agency_penalties_evidence_array;
alter table public.agency_penalties
  add constraint agency_penalties_evidence_array
  check (jsonb_typeof(agency_evidence) = 'array');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'penalty-evidence',
  'penalty-evidence',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.penalty_evidence_path_allowed_v1(
  p_name text,
  p_write boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor jsonb := public.current_log_actor();
  path_company uuid;
  path_agency uuid;
  path_penalty uuid;
begin
  if actor is null or nullif(trim(p_name), '') is null then
    return false;
  end if;

  begin
    path_company := split_part(p_name, '/', 1)::uuid;
    path_agency := split_part(p_name, '/', 2)::uuid;
    path_penalty := split_part(p_name, '/', 3)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (
    select 1
    from public.agency_penalties penalty
    where penalty.id = path_penalty
      and penalty.company_id = path_company
      and penalty.agency_id = path_agency
  ) then
    return false;
  end if;

  if actor->>'role' = 'Agency' then
    return path_agency::text = actor->>'agency_id'
      and exists (
        select 1
        from public.agency_company_user_access access
        where access.user_id::text = actor->>'id'
          and access.company_id = path_company
          and access.agency_id = path_agency
          and access.status = 'Active'
      );
  end if;

  if p_write then
    return false;
  end if;

  return path_company::text = actor->>'company_id'
    and actor->>'role' not in ('Platform Owner', 'Platform Accounts User', 'Platform Support User');
end;
$function$;

revoke all on function public.penalty_evidence_path_allowed_v1(text, boolean) from public, anon;
grant execute on function public.penalty_evidence_path_allowed_v1(text, boolean) to authenticated, service_role;

drop policy if exists penalty_evidence_select on storage.objects;
create policy penalty_evidence_select
on storage.objects for select to authenticated
using (
  bucket_id = 'penalty-evidence'
  and public.penalty_evidence_path_allowed_v1(name, false)
);

drop policy if exists penalty_evidence_insert on storage.objects;
create policy penalty_evidence_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'penalty-evidence'
  and public.penalty_evidence_path_allowed_v1(name, true)
);

drop policy if exists penalty_evidence_delete on storage.objects;
create policy penalty_evidence_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'penalty-evidence'
  and public.penalty_evidence_path_allowed_v1(name, true)
);

comment on column public.agency_penalties.agency_evidence is
  'Private agency objection evidence metadata. Files are stored in penalty-evidence and resolved through signed URLs.';

commit;

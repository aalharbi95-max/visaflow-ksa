-- Shared catalogue remains global; company additions are private to that company.
begin;
set local lock_timeout = '5s';
alter table public.professions add column if not exists company_id uuid references public.companies(id);
create index if not exists professions_company_id_idx on public.professions(company_id);

-- Replace all old policies: a permissive legacy SELECT would otherwise leak tenants.
do $$ declare p record; begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('professions', 'profession_aliases')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

alter table public.professions enable row level security;
alter table public.profession_aliases enable row level security;
revoke all on public.professions, public.profession_aliases from anon;
grant select, insert, update on public.professions, public.profession_aliases to authenticated;
revoke delete on public.professions, public.profession_aliases from authenticated;
grant usage on sequence public.professions_id_seq, public.profession_aliases_id_seq to authenticated;

create policy professions_read on public.professions for select to authenticated using (
  company_id is null or public.current_app_user_role() = 'Platform Owner'
  or company_id = public.current_app_user_company_id()
);
create policy professions_insert on public.professions for insert to authenticated with check (
  public.current_app_user_role() = 'Platform Owner'
  or (public.current_app_user_role() = 'Admin' and company_id = public.current_app_user_company_id())
);
create policy professions_update on public.professions for update to authenticated using (
  public.current_app_user_role() = 'Platform Owner'
  or (public.current_app_user_role() = 'Admin' and company_id = public.current_app_user_company_id())
) with check (
  public.current_app_user_role() = 'Platform Owner'
  or (public.current_app_user_role() = 'Admin' and company_id = public.current_app_user_company_id())
);
create policy profession_aliases_read on public.profession_aliases for select to authenticated using (
  (company_id is null or public.current_app_user_role() = 'Platform Owner'
    or company_id = public.current_app_user_company_id())
  and exists (select 1 from public.professions p where p.id = profession_id)
);
create policy profession_aliases_insert on public.profession_aliases for insert to authenticated with check (
  (public.current_app_user_role() = 'Platform Owner'
    or (public.current_app_user_role() = 'Admin' and company_id = public.current_app_user_company_id()))
  and exists (select 1 from public.professions p where p.id = profession_id
    and (p.company_id is null or p.company_id = profession_aliases.company_id))
);
create policy profession_aliases_update on public.profession_aliases for update to authenticated using (
  public.current_app_user_role() = 'Platform Owner'
  or (public.current_app_user_role() = 'Admin' and company_id = public.current_app_user_company_id())
) with check (
  (public.current_app_user_role() = 'Platform Owner'
    or (public.current_app_user_role() = 'Admin' and company_id = public.current_app_user_company_id()))
  and exists (select 1 from public.professions p where p.id = profession_id
    and (p.company_id is null or p.company_id = profession_aliases.company_id))
);

-- Editing must never move a private record into the shared catalogue or another tenant.
create or replace function public.preserve_profession_scope() returns trigger
language plpgsql set search_path = '' as $$ begin
  if new.company_id is distinct from old.company_id then
    raise exception 'Profession scope cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger professions_preserve_scope before update on public.professions
for each row execute function public.preserve_profession_scope();
create trigger profession_aliases_preserve_scope before update on public.profession_aliases
for each row execute function public.preserve_profession_scope();
commit;

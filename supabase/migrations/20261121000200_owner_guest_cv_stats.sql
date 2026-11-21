begin;
create or replace function public.get_owner_guest_cv_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
begin
  if auth.uid() is null or public.current_app_user_role() is distinct from 'Platform Owner' then
    raise exception 'Platform Owner required' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
    'total', count(*),
    'today', count(*) filter (where created_at >= v_today),
    'last_7_days', count(*) filter (where created_at >= v_today - interval '6 days'),
    'as_of', now()
  ) from public.talent_guest_submissions);
end $$;
revoke all on function public.get_owner_guest_cv_stats() from public, anon;
grant execute on function public.get_owner_guest_cv_stats() to authenticated;
commit;

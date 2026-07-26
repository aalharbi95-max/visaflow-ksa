-- Read-only preflight. Any returned row is a stop condition before backfill.

select 'ambiguous normalized workspace email' as issue, lower(btrim(u.email)) as normalized_email, count(*) as matches
from public.users u
where nullif(btrim(u.email), '') is not null
group by lower(btrim(u.email)) having count(*) > 1;

select 'duplicate interview answer order blocks secure upsert' as issue, session_id, question_order, count(*) as matches
from public.ai_interview_answers
group by session_id, question_order having count(*) > 1;

select 'candidate agency name is ambiguous within company' as issue, c.company_id, lower(btrim(c.agency)) as legacy_key, count(distinct a.id) as matches
from public.candidates c
join public.agencies a on lower(btrim(a.name)) = lower(btrim(c.agency))
join public.company_agency_access caa on caa.company_id = c.company_id and caa.agency_id = a.id and caa.status = 'Active'
where nullif(btrim(c.agency), '') is not null
  and nullif(to_jsonb(c) ->> 'agency_id', '') is null
group by c.company_id, lower(btrim(c.agency)) having count(distinct a.id) <> 1;

select 'candidate agency name has no active company mapping' as issue, c.id, c.company_id
from public.candidates c
where nullif(btrim(c.agency), '') is not null
  and nullif(to_jsonb(c) ->> 'agency_id', '') is null
and not exists (
  select 1 from public.agencies a join public.company_agency_access caa on caa.agency_id = a.id
  where caa.company_id = c.company_id and caa.status = 'Active' and lower(btrim(a.name)) = lower(btrim(c.agency))
);

select 'interview agency name is ambiguous within company' as issue, i.company_id, lower(btrim(i.agency)) as legacy_key, count(distinct a.id) as matches
from public.interviews i
join public.agencies a on lower(btrim(a.name)) = lower(btrim(i.agency))
join public.company_agency_access caa on caa.company_id = i.company_id and caa.agency_id = a.id and caa.status = 'Active'
where nullif(btrim(i.agency), '') is not null
  and nullif(to_jsonb(i) ->> 'agency_id', '') is null
group by i.company_id, lower(btrim(i.agency)) having count(distinct a.id) <> 1;

select 'interview candidate tenant/agency mismatch' as issue, i.id, i.company_id, i.candidate_id
from public.interviews i join public.candidates c on c.id = i.candidate_id
where i.company_id is distinct from c.company_id
   or (
     nullif(to_jsonb(i) ->> 'agency_id', '') is not null
     and (to_jsonb(i) ->> 'agency_id')::uuid is distinct from
         nullif(to_jsonb(c) ->> 'agency_id', '')::uuid
   );

select 'duplicate auth link' as issue, u.auth_user_id, count(*) as matches
from public.users u where u.auth_user_id is not null
group by u.auth_user_id having count(*) > 1;

select 'legacy active workspace account requires migration' as issue, u.id, u.role
from public.users u
where u.status = 'Active' and u.is_active is true and u.auth_user_id is null
  and u.role <> 'Agency';

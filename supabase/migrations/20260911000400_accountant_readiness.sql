-- Accountant readiness pilot. Candidate/private-owner review only; no employer publication.
create table if not exists public.talent_readiness_tasks (
  code text primary key,
  version integer not null,
  skill text not null,
  definition jsonb not null,
  answer_key jsonb not null,
  review_guide jsonb not null,
  active boolean not null default true
);
create table if not exists public.talent_readiness_attempts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.talent_candidates(id) on delete cascade,
  task_code text not null references public.talent_readiness_tasks(code),
  answers jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  status text not null default 'Draft' check (status in ('Draft','Submitted')),
  objective_score integer check(objective_score between 0 and 100),
  evidence jsonb,
  consented_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  review_status text not null default 'Pending' check(review_status in ('Pending','Confirmed','NeedsDevelopment')),
  review_note text,
  reviewed_at timestamptz,
  review_requested_at timestamptz,
  review_request_reason text,
  unique(candidate_id,task_code)
);
create table if not exists public.talent_readiness_review_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.talent_readiness_attempts(id) on delete cascade,
  actor_id uuid not null,
  event_type text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists readiness_review_queue on public.talent_readiness_attempts(status,updated_at,id);
alter table public.talent_readiness_tasks enable row level security;
alter table public.talent_readiness_attempts enable row level security;
alter table public.talent_readiness_review_events enable row level security;
revoke all on public.talent_readiness_tasks, public.talent_readiness_attempts, public.talent_readiness_review_events from public, anon, authenticated;

create or replace function public.readiness_require_owner() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.users u where u.auth_user_id=auth.uid() and u.company_id is null
    and u.role='Platform Owner' and u.is_active is true and lower(coalesce(u.status,''))='active'
  ) then raise exception using errcode='42501', message='Platform owner access required'; end if;
end; $$;

create or replace function public.get_my_accountant_readiness() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_candidate uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Candidate authentication required'; end if;
  select id into v_candidate from public.talent_candidates where auth_user_id=auth.uid();
  if v_candidate is null then raise exception using errcode='P0002',message='Complete your Talent profile first'; end if;
  return jsonb_build_object('tasks',coalesce((select jsonb_agg(jsonb_build_object(
    'code',t.code,'version',t.version,'skill',t.skill,'definition',t.definition,
    'attempt',(select to_jsonb(a)-'candidate_id' from public.talent_readiness_attempts a where a.candidate_id=v_candidate and a.task_code=t.code)
  ) order by t.code) from public.talent_readiness_tasks t where t.active),'[]'::jsonb));
end; $$;

create or replace function public.save_accountant_readiness(
  p_task_code text, p_answers jsonb, p_revision integer, p_submit boolean default false, p_consent boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_candidate uuid; v_task public.talent_readiness_tasks%rowtype; v_attempt public.talent_readiness_attempts%rowtype;
  v_field jsonb; v_value jsonb; v_key text; v_ok boolean; v_score integer:=0; v_evidence jsonb:='[]';
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Candidate authentication required'; end if;
  select id into v_candidate from public.talent_candidates where auth_user_id=auth.uid() for update;
  if v_candidate is null then raise exception using errcode='P0002',message='Complete your Talent profile first'; end if;
  select * into v_task from public.talent_readiness_tasks where code=p_task_code and active;
  if not found then raise exception using errcode='22023',message='Task unavailable'; end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>12000
    or p_revision is null or p_revision<0 or p_submit is null then
    raise exception using errcode='22023',message='Invalid answers';
  end if;
  for v_key in select jsonb_object_keys(p_answers) loop
    if v_key<>'rationale' and not exists(select 1 from jsonb_array_elements(v_task.definition->'fields') f where f->>'key'=v_key) then
      raise exception using errcode='22023',message='Unknown answer field';
    end if;
  end loop;
  if p_answers ? 'rationale' and (jsonb_typeof(p_answers->'rationale')<>'string' or length(p_answers->>'rationale')>2000) then
    raise exception using errcode='22023',message='Explanation must be text up to 2000 characters';
  end if;
  if p_submit and length(btrim(coalesce(p_answers->>'rationale','')))<30 then
    raise exception using errcode='22023',message='Explain your approach in at least 30 characters';
  end if;
  for v_field in select value from jsonb_array_elements(v_task.definition->'fields') loop
    v_key:=v_field->>'key'; v_value:=p_answers->v_key;
    if v_value is null or v_value='null'::jsonb or v_value='""'::jsonb then
      if p_submit then raise exception using errcode='22023',message='Complete every answer'; end if;
      continue;
    end if;
    if v_field->>'type'='number' then
      if jsonb_typeof(v_value) not in ('string','number') or (v_value#>>'{}') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
        raise exception using errcode='22023',message='Enter valid nonnegative amounts with up to two decimals';
      end if;
      v_ok:=(v_value#>>'{}')::numeric=(v_task.answer_key->>v_key)::numeric;
    else
      if jsonb_typeof(v_value)<>'string' or not exists(select 1 from jsonb_array_elements(v_field->'options') o where o->>'value'=v_value#>>'{}') then
        raise exception using errcode='22023',message='Select a listed option';
      end if;
      v_ok:=v_value=v_task.answer_key->v_key;
    end if;
    if v_ok then v_score:=v_score+(v_field->>'weight')::integer; end if;
    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object('key',v_key,'correct',v_ok,'earned',case when v_ok then (v_field->>'weight')::integer else 0 end,'possible',(v_field->>'weight')::integer));
  end loop;
  select * into v_attempt from public.talent_readiness_attempts where candidate_id=v_candidate and task_code=p_task_code for update;
  if not found then
    if not coalesce(p_consent,false) then raise exception using errcode='22023',message='Consent to private assessment and platform review is required'; end if;
    if p_revision<>0 then raise exception using errcode='40001',message='Draft changed; reload before saving'; end if;
    insert into public.talent_readiness_attempts(candidate_id,task_code) values(v_candidate,p_task_code) returning * into v_attempt;
  end if;
  if v_attempt.status='Submitted' then
    if p_submit and v_attempt.answers=p_answers then return to_jsonb(v_attempt)-'candidate_id'; end if;
    raise exception using errcode='22023',message='Submitted answers are locked';
  end if;
  if v_attempt.revision<>p_revision then raise exception using errcode='40001',message='Draft changed; reload before saving'; end if;
  update public.talent_readiness_attempts set answers=p_answers,revision=revision+1,updated_at=now(),
    status=case when p_submit then 'Submitted' else 'Draft' end,
    submitted_at=case when p_submit then now() else null end,
    objective_score=case when p_submit then v_score else null end,
    evidence=case when p_submit then v_evidence else null end
  where id=v_attempt.id returning * into v_attempt;
  return to_jsonb(v_attempt)-'candidate_id';
end; $$;

create or replace function public.request_accountant_readiness_review(p_attempt_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_attempt public.talent_readiness_attempts%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Candidate authentication required'; end if;
  if p_reason is null or length(btrim(p_reason))<10 or length(p_reason)>1000 then
    raise exception using errcode='22023',message='Review reason must contain 10 to 1000 characters'; end if;
  select a.* into v_attempt from public.talent_readiness_attempts a join public.talent_candidates c on c.id=a.candidate_id
    where a.id=p_attempt_id and c.auth_user_id=auth.uid() for update of a;
  if not found then raise exception using errcode='42501',message='Attempt unavailable'; end if;
  if v_attempt.status<>'Submitted' then raise exception using errcode='22023',message='Submit the task first'; end if;
  if v_attempt.review_requested_at is not null then return; end if;
  update public.talent_readiness_attempts set review_requested_at=now(),review_request_reason=btrim(p_reason),review_status='Pending',updated_at=now(),revision=revision+1 where id=p_attempt_id;
  insert into public.talent_readiness_review_events(attempt_id,actor_id,event_type,details)
    values(p_attempt_id,auth.uid(),'Requested',jsonb_build_object('reason',btrim(p_reason)));
end; $$;

create or replace function public.get_accountant_readiness_reviews(p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.readiness_require_owner();
  if p_offset is null or p_offset<0 then raise exception using errcode='22023',message='Invalid offset'; end if;
  return jsonb_build_object('total',(select count(*) from public.talent_readiness_attempts where status='Submitted'),
    'items',coalesce((select jsonb_agg(to_jsonb(q)) from (
      select a.*,c.full_name,t.definition,t.review_guide,t.answer_key,t.version
      from public.talent_readiness_attempts a join public.talent_candidates c on c.id=a.candidate_id
      join public.talent_readiness_tasks t on t.code=a.task_code where a.status='Submitted'
      order by (a.review_status='Pending') desc,a.updated_at desc,a.id limit 20 offset p_offset
    ) q),'[]'::jsonb));
end; $$;

create or replace function public.review_accountant_readiness(p_attempt_id uuid,p_revision integer,p_outcome text,p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_attempt public.talent_readiness_attempts%rowtype;
begin
  perform public.readiness_require_owner();
  if p_outcome is null or p_outcome not in ('Confirmed','NeedsDevelopment') or p_note is null or length(btrim(p_note))<20 or length(p_note)>2000 then
    raise exception using errcode='22023',message='Select an outcome and provide 20 to 2000 characters of evidence-based feedback';
  end if;
  select * into v_attempt from public.talent_readiness_attempts where id=p_attempt_id for update;
  if not found or v_attempt.status<>'Submitted' then raise exception using errcode='22023',message='Submitted attempt required'; end if;
  if p_revision is null or v_attempt.revision<>p_revision then raise exception using errcode='40001',message='Review changed; reload before saving'; end if;
  update public.talent_readiness_attempts set review_status=p_outcome,review_note=btrim(p_note),reviewed_at=now(),updated_at=now(),revision=revision+1 where id=p_attempt_id;
  insert into public.talent_readiness_review_events(attempt_id,actor_id,event_type,details)
    values(p_attempt_id,auth.uid(),'Reviewed',jsonb_build_object('outcome',p_outcome,'note',btrim(p_note),'previous_outcome',v_attempt.review_status,'revision',p_revision));
end; $$;

revoke all on function public.readiness_require_owner() from public,anon,authenticated;
revoke all on function public.get_my_accountant_readiness(),public.save_accountant_readiness(text,jsonb,integer,boolean,boolean),public.request_accountant_readiness_review(uuid,text),public.get_accountant_readiness_reviews(integer),public.review_accountant_readiness(uuid,integer,text,text) from public,anon;
grant execute on function public.get_my_accountant_readiness(),public.save_accountant_readiness(text,jsonb,integer,boolean,boolean),public.request_accountant_readiness_review(uuid,text),public.get_accountant_readiness_reviews(integer),public.review_accountant_readiness(uuid,integer,text,text) to authenticated;

-- TASK_SEEDS: generated from scripts/accountant-readiness-data.mjs
insert into public.talent_readiness_tasks(code,version,skill,definition,answer_key,review_guide) values('invoice-review-v1',1,'invoice_review','{"title":{"ar":"مراجعة الفواتير","en":"Invoice review"},"minutes":15,"introduction":{"ar":"راجع السجل الافتراضي أدناه. المبالغ بالريال ولا تتضمن ضرائب. المورد ورقم الفاتورة يحددان الفاتورة؛ تاريخ التسجيل وحده لا يثبت أنها فاتورة جديدة. المبلغ الأصلي مستند إلى الفاتورة المفترضة.","en":"Review this fictional register. Amounts are in SAR with no taxes. Supplier and invoice number identify an invoice; a posting date alone does not establish a new invoice. Source amounts come from the fictional source invoices."},"columns":{"ar":["السطر","المورد","الفاتورة","المبلغ الأصلي","المبلغ المسجل"],"en":["Row","Supplier","Invoice","Source amount","Posted amount"]},"rows":[["D1","Alpha","A101",1200,1200],["D2","Beta","B102",800,800],["D3","Beta","B102",800,800],["D4","Gamma","G103",650,560],["D5","Delta","D104",450,450]],"fields":[{"key":"duplicate","label":{"ar":"أي سطر يمثل التكرار الثاني؟","en":"Which row is the duplicate occurrence?"},"weight":25,"type":"select","options":[{"value":"D1","ar":"D1","en":"D1"},{"value":"D2","ar":"D2","en":"D2"},{"value":"D3","ar":"D3","en":"D3"},{"value":"D4","ar":"D4","en":"D4"},{"value":"D5","ar":"D5","en":"D5"}]},{"key":"incorrect","label":{"ar":"أي سطر يحتوي مبلغًا مسجلًا مخالفًا للأصل؟","en":"Which row has a posted amount different from its source?"},"weight":25,"type":"select","options":[{"value":"D1","ar":"D1","en":"D1"},{"value":"D2","ar":"D2","en":"D2"},{"value":"D3","ar":"D3","en":"D3"},{"value":"D4","ar":"D4","en":"D4"},{"value":"D5","ar":"D5","en":"D5"}]},{"key":"correct_amount","label":{"ar":"المبلغ الصحيح للسطر المخالف","en":"Correct amount for the incorrect row"},"weight":25,"type":"number"},{"key":"correct_total","label":{"ar":"إجمالي السجل بعد استبعاد التكرار وتصحيح المبلغ","en":"Register total after excluding the duplicate and correcting the amount"},"weight":25,"type":"number"}],"rationale":{"ar":"اشرح كيف تتحقق من التكرار وكيف توثق التصحيح وتحصل على الموافقة دون حذف أثر العملية الأصلية.","en":"Explain how you verify the duplicate, document the correction and obtain approval while preserving the original audit trail."},"guidance":{"ar":"راجع تحديد الفاتورة الفريدة، وطابق مبلغ السجل مع المصدر، ثم اجمع المبالغ مرة واحدة لكل فاتورة. وثّق أي تصحيح قبل اعتماده.","en":"Review unique invoice identification, compare posted amounts with sources and sum each invoice once. Document corrections before approval."},"threshold":80}'::jsonb,'{"duplicate":"D3","incorrect":"D4","correct_amount":650,"correct_total":3100}'::jsonb,'{"ar":"تحقق من الرجوع إلى المصدر ورقم الفاتورة والمورد، والحصول على موافقة التصحيح، والحفاظ على أثر المراجعة. لا تقبل حذف السجلات لإخفاء الخطأ.","en":"Look for source verification, supplier/invoice identity, correction approval and retained audit trail. Do not accept deletion to conceal the error."}'::jsonb) on conflict(code) do nothing;
insert into public.talent_readiness_tasks(code,version,skill,definition,answer_key,review_guide) values('bank-reconciliation-v1',1,'bank_reconciliation','{"title":{"ar":"التسوية البنكية","en":"Bank reconciliation"},"minutes":20,"introduction":{"ar":"في نهاية الشهر: رصيد كشف البنك 10,850 ريال، ورصيد البنك في دفاتر المنشأة 10,000 ريال. لا توجد فروق أخرى غير الموضحة أدناه. احسب الرصيدين المعدلين واختر القيود المطلوبة في دفاتر المنشأة.","en":"At month end, the bank statement balance is SAR 10,850 and the ledger bank balance is SAR 10,000. There are no other differences beyond those below. Calculate adjusted balances and select the required ledger entries."},"columns":{"ar":["البند","المبلغ","التفصيل"],"en":["Item","Amount","Details"]},"rows":[[{"ar":"إيداع بالطريق","en":"Deposit in transit"},1200,{"ar":"مسجل في الدفاتر ولم يظهر بكشف البنك","en":"In ledger, absent from bank statement"}],[{"ar":"شيك قائم","en":"Outstanding cheque"},800,{"ar":"مسجل في الدفاتر ولم يصرفه المستفيد","en":"In ledger, not yet cleared"}],[{"ar":"رسوم بنكية","en":"Bank fee"},50,{"ar":"في كشف البنك فقط","en":"Bank statement only"}],[{"ar":"إيراد فوائد","en":"Interest income"},100,{"ar":"في كشف البنك فقط","en":"Bank statement only"}],[{"ar":"تحصيل مديونية عميل","en":"Customer receivable collection"},1200,{"ar":"في كشف البنك فقط؛ مديونية مثبتة سابقًا","en":"Bank statement only; receivable previously recorded"}]],"fields":[{"key":"adjusted_bank","label":{"ar":"رصيد كشف البنك المعدل","en":"Adjusted statement balance"},"weight":25,"type":"number"},{"key":"adjusted_books","label":{"ar":"رصيد الدفاتر المعدل","en":"Adjusted ledger balance"},"weight":25,"type":"number"},{"key":"fee_entry","label":{"ar":"قيد الرسوم البنكية","en":"Bank fee entry"},"weight":15,"type":"select","options":[{"value":"fee","ar":"مدين مصروف رسوم / دائن البنك — 50","en":"Debit fee expense / credit bank — 50"},{"value":"reverse","ar":"مدين البنك / دائن مصروف رسوم — 50","en":"Debit bank / credit fee expense — 50"},{"value":"none","ar":"لا قيد","en":"No entry"}]},{"key":"interest_entry","label":{"ar":"قيد إيراد الفوائد","en":"Interest income entry"},"weight":15,"type":"select","options":[{"value":"none","ar":"لا قيد","en":"No entry"},{"value":"reverse","ar":"مدين إيراد فوائد / دائن البنك — 100","en":"Debit interest income / credit bank — 100"},{"value":"interest","ar":"مدين البنك / دائن إيراد فوائد — 100","en":"Debit bank / credit interest income — 100"}]},{"key":"collection_entry","label":{"ar":"قيد تحصيل مديونية العميل","en":"Receivable collection entry"},"weight":20,"type":"select","options":[{"value":"revenue","ar":"مدين البنك / دائن إيراد مبيعات — 1,200","en":"Debit bank / credit sales revenue — 1,200"},{"value":"receivable","ar":"مدين البنك / دائن العملاء — 1,200","en":"Debit bank / credit receivables — 1,200"},{"value":"none","ar":"لا قيد","en":"No entry"}]}],"rationale":{"ar":"وضح طريقة التسوية، ولماذا لا تعيد تسجيل الإيداع بالطريق والشيك القائم في الدفاتر. ما المستندات التي تراجعها قبل اعتماد القيود؟","en":"Explain your reconciliation and why the deposit in transit and outstanding cheque are not posted again. Which evidence would you review before approving entries?"},"guidance":{"ar":"افصل فروق التوقيت عن البنود التي لم تسجلها المنشأة. عدّل كل رصيد من جانبه، ثم طابق الرصيدين وراجع أطراف القيود.","en":"Separate timing differences from unrecorded ledger items. Adjust each balance on its own side, reconcile and check debit/credit accounts."},"threshold":80}'::jsonb,'{"adjusted_bank":11250,"adjusted_books":11250,"fee_entry":"fee","interest_entry":"interest","collection_entry":"receivable"}'::jsonb,'{"ar":"راجع الفصل بين بنود التوقيت وقيود الدفاتر، وعدم تسجيل التحصيل إيرادًا مرة ثانية، ومطابقة الرصيدين مع المستندات والاعتماد.","en":"Check timing differences versus ledger entries, no double counting of revenue, and evidence-supported reconciliation and approval."}'::jsonb) on conflict(code) do nothing;

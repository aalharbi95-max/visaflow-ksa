import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const workerSecret = process.env.AI_AGENT_WORKER_SECRET || "";
const requestNo = "REQ-MIRGAB-RH-20260817";

assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.match(projectRef, /^[a-z]{20}$/i, "SUPABASE_PROJECT_REF is invalid");
assert.equal(new URL(supabaseUrl).hostname, `${projectRef}.supabase.co`, "SUPABASE_URL does not match the Staging project");
assert.ok(anonKey, "SUPABASE_ANON_KEY is required");
assert.ok(workerSecret, "AI_AGENT_WORKER_SECRET is required");

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    let diagnostic = {};
    try { diagnostic = await response.json(); } catch { diagnostic = {}; }
    const code = String(diagnostic.code || diagnostic.error_code || "unknown").slice(0, 80);
    const message = String(diagnostic.message || diagnostic.error || "query rejected").slice(0, 500);
    throw new Error(`MIRGAB Staging query failed with HTTP ${response.status} (${code}): ${message}`);
  }
  return response.json();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function invoke(workerSecret, body, expectedStatus = 200) {
  const response = await fetch(`${supabaseUrl}/functions/v1/visaflow-agent-orchestrator`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "x-visaflow-worker-secret": workerSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  assert.equal(response.status, expectedStatus, `Orchestrator returned HTTP ${response.status}: ${String(payload.error || "unexpected_response")}`);
  return payload;
}

// Build one persistent, non-PII QA request from the previously validated tenant.
// Advisory locking and fixed identifiers make concurrent/replayed CI runs safe.
await query(`
  do $fixture$
  declare
    source_request public.requests%rowtype;
    new_request_id bigint;
    qa_request_no text;
    new_line_id uuid;
    responsible_agency text;
    responsible_agency_id uuid;
    source_line record;
  begin
    perform pg_advisory_xact_lock(hashtext('${requestNo}'));
    select * into source_request
    from public.requests
    where request_no='REQ-2026-0006'
    order by created_at desc nulls last
    limit 1;
    if source_request.id is null then raise exception 'MIRGAB_SOURCE_REQUEST_MISSING'; end if;
    if not exists(
      select 1 from public.ai_agent_settings s
      where s.company_id=source_request.company_id and s.is_active=true and s.allow_auto_agency_emails=false
    ) then raise exception 'MIRGAB_EMAIL_SAFETY_PRECONDITION_FAILED'; end if;

    select c.target_id::bigint into new_request_id
    from public.ai_agent_cases c
    where c.company_id=source_request.company_id
      and c.goal='Review and safely resolve recruitment blockers for ${requestNo}'
      and c.target_type='request' and c.target_id ~ '^[0-9]+$'
    order by c.created_at,c.id
    limit 1;
    if new_request_id is null then
      select r.id into new_request_id
      from public.requests r
      where r.company_id=source_request.company_id
        and r.notes='Canonical MIRGAB release-hardening QA fixture; no external email'
      order by r.id
      limit 1;
    end if;
    if new_request_id is null then
      perform pg_advisory_xact_lock(hashtext('public.requests.id'));
      select coalesce(max(id),0)+1 into new_request_id from public.requests;
      insert into public.requests
      select (jsonb_populate_record(
        null::public.requests,
        to_jsonb(source_request) || jsonb_build_object(
          'id',new_request_id,
          'request_no','${requestNo}',
          'notes','Canonical MIRGAB release-hardening QA fixture; no external email',
          'created_at',now()-interval '30 days',
          'updated_at',now()-interval '30 days'
        )
      )).*;
    end if;
    select r.request_no into qa_request_no
    from public.requests r
    where r.id=new_request_id and r.company_id=source_request.company_id;
    if qa_request_no is null then raise exception 'MIRGAB_QA_REQUEST_MISSING'; end if;

    select rl.id into new_line_id
    from public.request_lines rl
    where rl.company_id=source_request.company_id and rl.request_id=new_request_id
    order by rl.line_no
    limit 1;
    if new_line_id is null then
      select * into source_line
      from public.request_lines where request_id=source_request.id order by line_no limit 1;
      if source_line.id is null then raise exception 'MIRGAB_SOURCE_LINE_MISSING'; end if;
      new_line_id := gen_random_uuid();
      insert into public.request_lines
      select (jsonb_populate_record(
        null::public.request_lines,
        to_jsonb(source_line) || jsonb_build_object(
          'id',new_line_id,
          'request_id',new_request_id,
          'request_no',qa_request_no,
          'quantity',greatest(coalesce(source_line.quantity,0),6),
          'created_at',now()-interval '30 days',
          'updated_at',now()-interval '30 days'
        )
      )).*;
    end if;

    select v.agency into responsible_agency
    from public.visa_authorizations v
    where v.company_id=source_request.company_id and v.request_no=source_request.request_no
      and nullif(trim(v.agency),'') is not null
    order by v.created_at
    limit 1;
    if responsible_agency is null then raise exception 'MIRGAB_SOURCE_AGENCY_MISSING'; end if;
    select a.id into responsible_agency_id
    from public.agencies a
    where a.company_id=source_request.company_id and lower(trim(a.name))=lower(trim(responsible_agency))
    limit 1;
    if responsible_agency_id is null then raise exception 'MIRGAB_SOURCE_AGENCY_UNRESOLVED'; end if;
    if not exists(select 1 from public.candidates c where c.company_id=source_request.company_id and c.request_line_id=new_line_id) then
      update public.candidates
      set request_no=qa_request_no,agency=responsible_agency,agency_id=responsible_agency_id,
        request_line_id=new_line_id,medical_status='Pending',updated_at=now()-interval '30 days'
      where id=(
        select c.id from public.candidates c
        where c.company_id=source_request.company_id and c.passport_no='QA-MIRGAB-20260817'
        order by c.created_at,c.id limit 1
      );
    end if;
    if not exists(select 1 from public.candidates c where c.company_id=source_request.company_id and c.request_line_id=new_line_id) then
      insert into public.candidates(
        id,candidate_name,request_no,agency,agency_id,status,company_id,request_line_id,
        passport_no,medical_status,created_at,updated_at
      ) values (
        gen_random_uuid(),'MIRGAB QA Candidate',qa_request_no,responsible_agency,responsible_agency_id,
        'New',source_request.company_id,new_line_id,'QA-MIRGAB-20260817','Pending',
        now()-interval '30 days',now()-interval '30 days'
      );
    else
      update public.candidates
      set request_no=qa_request_no,agency=responsible_agency,agency_id=responsible_agency_id,request_line_id=new_line_id,
        medical_status='Pending',updated_at=least(updated_at,now()-interval '30 days')
      where company_id=source_request.company_id and request_line_id=new_line_id;
    end if;

    insert into public.ai_agent_cases(
      company_id,goal_type,goal,target_type,target_id,status,priority,stable_case_key
    ) values (
      source_request.company_id,'RECRUITMENT_REQUEST_REVIEW',
      'Review and safely resolve recruitment blockers for ${requestNo}',
      'request',new_request_id::text,'open','High','RECRUITMENT_REQUEST_REVIEW:'||new_request_id::text
    )
    on conflict(company_id,stable_case_key) do update
    set goal_type=excluded.goal_type,goal=excluded.goal,target_type=excluded.target_type,
      target_id=excluded.target_id,priority=excluded.priority,updated_at=now();
  end $fixture$;`);

const fixture = await query(`
  select c.id::text as case_id,c.company_id::text,c.target_id as request_id,
    (select count(*)::integer from public.ai_agent_runs x where x.case_id=c.id) as run_count,
    (select count(*)::integer from public.ai_agent_approval_requests a where a.case_id=c.id) as approval_count,
    (select allow_auto_agency_emails from public.ai_agent_settings s where s.company_id=c.company_id and s.is_active=true limit 1) as allow_email
  from public.ai_agent_cases c
  where c.goal_type='RECRUITMENT_REQUEST_REVIEW' and c.target_type='request'
    and c.goal='Review and safely resolve recruitment blockers for ${requestNo}'
  order by c.created_at,c.id
  limit 1`);
assert.equal(fixture.length, 1, "MIRGAB fixture is not unique");
const { case_id: caseId, company_id: companyId, request_id: requestId } = fixture[0];
assert.equal(fixture[0].allow_email, false, "External agency email must remain disabled");

// Keep database-scheduled worker calls on the same Staging-only credential.
await query(`
  do $vault_sync$
  declare secret_id uuid;
  begin
    select id into secret_id from vault.secrets where name='visaflow_ai_interview_worker_secret' limit 1;
    if secret_id is null then
      perform vault.create_secret(${sqlLiteral(workerSecret)},'visaflow_ai_interview_worker_secret','Staging worker authentication');
    else
      perform vault.update_secret(secret_id,${sqlLiteral(workerSecret)},'visaflow_ai_interview_worker_secret','Staging worker authentication');
    end if;
  end $vault_sync$;`);

const counts = async () => (await query(`
  select
    (select count(*)::integer from public.notification_events where company_id=${sqlLiteral(companyId)}::uuid and data->>'case_id'=${sqlLiteral(caseId)}) as notifications,
    (select count(*)::integer from public.ai_agent_followup_tasks where case_id=${sqlLiteral(caseId)}::uuid) as followups,
    (select count(*)::integer from public.ai_agent_approval_requests where case_id=${sqlLiteral(caseId)}::uuid) as approvals`))[0];

const lifecycleState = async () => (await query(`
  select
    (select count(*)::integer from public.ai_agent_runs where case_id=${sqlLiteral(caseId)}::uuid) as runs,
    (select count(*)::integer from public.ai_agent_approval_requests where case_id=${sqlLiteral(caseId)}::uuid) as approvals,
    (select approval_status from public.ai_agent_approval_requests where case_id=${sqlLiteral(caseId)}::uuid limit 1) as approval_status`))[0];

let state = await lifecycleState();
assert.ok(state.runs >= 0 && state.runs <= 4, "Existing MIRGAB fixture has unexpected runs");
if (state.runs === 0) {
  assert.equal(state.approvals, 0, "Approval exists before the first run");
  const first = await invoke(workerSecret, { case_id: caseId });
  assert.equal(first.ok, true);
  assert.equal(first.termination_reason, "awaiting_human_approval", "First run did not pause for YELLOW approval");
  state = await lifecycleState();
}
const afterFirst = await counts();
assert.equal(afterFirst.notifications, 2, "First run did not create exactly two notification business actions");
assert.equal(afterFirst.followups, 1, "First run did not create exactly one follow-up task");
assert.equal(afterFirst.approvals, 1, "First run did not create exactly one approval");

if (state.runs === 1) {
  assert.equal(state.approval_status, "Pending", "Approval changed before pending replay");
  const replay = await invoke(workerSecret, { case_id: caseId });
  assert.equal(replay.termination_reason, "awaiting_human_approval", "Pending replay did not remain paused");
  assert.deepEqual(await counts(), afterFirst, "Pending replay duplicated a business action or approval");
  state = await lifecycleState();
}

const approval = await query(`
    select id::text,approval_status from public.ai_agent_approval_requests
    where case_id=${sqlLiteral(caseId)}::uuid and action_type='REASSIGN_REQUEST_QUANTITY'`);
assert.equal(approval.length, 1, "Expected exactly one YELLOW approval");
if (approval[0].approval_status === "Pending") {
  assert.equal(state.runs, 2, "Approval became pending outside the expected replay state");
  const actor = await query(`
    select auth_user_id::text
    from public.users
    where company_id=${sqlLiteral(companyId)}::uuid and status='Active' and is_active=true
      and role in ('Admin','Company Admin','Recruitment Manager') and auth_user_id is not null
    order by case role when 'Company Admin' then 0 when 'Admin' then 1 else 2 end
    limit 1`);
  assert.equal(actor.length, 1, "No authorized QA manager is available");
  await query(`
    begin;
    select set_config('request.jwt.claim.sub',${sqlLiteral(actor[0].auth_user_id)},true);
    set local role authenticated;
    select public.decide_ai_agent_approval(${sqlLiteral(approval[0].id)}::uuid,'approve',null);
    commit;`);
  state = await lifecycleState();
}

if (state.runs === 2) {
  assert.equal(state.approval_status, "Approved", "Resume requires the existing Approved proposal");
  const resumed = await invoke(workerSecret, { case_id: caseId });
  assert.equal(resumed.termination_reason, "approved_awaiting_supported_execution", "Approved proposal did not enter the safe unsupported-executor state");
  assert.deepEqual(await counts(), afterFirst, "Approval resume duplicated a business action or approval");
  state = await lifecycleState();
}

if (state.runs === 3) {
  assert.equal(state.approval_status, "Approved", "Post-resume replay requires the same Approved proposal");
  const postResumeReplay = await invoke(workerSecret, { case_id: caseId });
  assert.equal(postResumeReplay.termination_reason, "approved_awaiting_supported_execution", "Post-resume replay left the safe state");
  assert.deepEqual(await counts(), afterFirst, "Post-resume replay duplicated a business action or approval");
  state = await lifecycleState();
}
assert.equal(state.runs, 4, "MIRGAB lifecycle did not reach four canonical runs");
assert.equal(state.approvals, 1, "MIRGAB lifecycle did not preserve exactly one approval");
assert.equal(state.approval_status, "Approved", "MIRGAB lifecycle did not preserve the Approved state");

const injectedCompanyId = randomUUID();
const rejected = await invoke(workerSecret, { case_id: caseId, company_id: injectedCompanyId }, 400);
assert.equal(rejected.error, "company_id_not_allowed", "Caller-supplied company_id was not rejected");

const evidence = await query(`
  with green as (
    select s.* from public.ai_agent_execution_steps s
    where s.case_id=${sqlLiteral(caseId)}::uuid
      and s.tool_name in ('send_agency_followup','create_followup_task','escalate_to_manager')
  ), proposed as (
    select a.*,a.proposed_payload->>'to_agency_id' as target_agency_id
    from public.ai_agent_approval_requests a
    where a.case_id=${sqlLiteral(caseId)}::uuid and a.action_type='REASSIGN_REQUEST_QUANTITY'
  )
  select
    (select count(*)::integer from public.ai_agent_runs where case_id=${sqlLiteral(caseId)}::uuid) as runs,
    (select count(*)::integer from public.ai_agent_runs where case_id=${sqlLiteral(caseId)}::uuid and status='failed') as failed_runs,
    (select count(*)::integer from public.ai_agent_execution_steps where case_id=${sqlLiteral(caseId)}::uuid and status='failed') as failed_steps,
    (select count(*)::integer from public.notification_events where company_id=${sqlLiteral(companyId)}::uuid and data->>'case_id'=${sqlLiteral(caseId)}) as notifications,
    (select count(distinct dedupe_key)::integer from public.notification_events where company_id=${sqlLiteral(companyId)}::uuid and data->>'case_id'=${sqlLiteral(caseId)}) as notification_keys,
    (select count(*)::integer from public.ai_agent_followup_tasks where case_id=${sqlLiteral(caseId)}::uuid) as followups,
    (select count(distinct stable_action_key)::integer from public.ai_agent_followup_tasks where case_id=${sqlLiteral(caseId)}::uuid) as followup_keys,
    (select count(*)::integer from proposed) as approvals,
    (select count(distinct stable_action_key)::integer from proposed) as approval_keys,
    (select count(*)::integer from green where status='completed') as green_completed,
    (select count(*)::integer from green where status='skipped' and output->>'reason'='previously_completed_and_verified') as green_reused,
    (select count(*)::integer from green where verification->>'verified'<>'true' or verification->>'verified' is null) as green_unverified,
    (select count(*)::integer from public.ai_agent_runs where case_id=${sqlLiteral(caseId)}::uuid and termination_reason='awaiting_human_approval') as awaiting_runs,
    (select count(*)::integer from public.ai_agent_runs where case_id=${sqlLiteral(caseId)}::uuid and termination_reason='approved_awaiting_supported_execution') as safely_paused_runs,
    (select count(*)::integer from proposed where approval_status='Approved' and executed_at is null) as approved_unexecuted,
    (select count(*)::integer from proposed where executed_at is not null) as executed_reassignments,
    (select count(*)::integer from public.ai_agent_execution_steps where case_id=${sqlLiteral(caseId)}::uuid and company_id<>${sqlLiteral(companyId)}::uuid) +
      (select count(*)::integer from public.ai_agent_runs where case_id=${sqlLiteral(caseId)}::uuid and company_id<>${sqlLiteral(companyId)}::uuid) +
      (select count(*)::integer from proposed where company_id<>${sqlLiteral(companyId)}::uuid) as tenant_mismatches,
    (select count(*)::integer
      from proposed p
      join public.agencies a on a.id::text=p.target_agency_id and a.company_id=p.company_id
      join public.visa_authorizations v on v.company_id=p.company_id
        and v.request_no=(select r.request_no from public.requests r where r.id=${sqlLiteral(requestId)}::bigint)
        and lower(trim(v.agency))=lower(trim(a.name))) as target_authorizations,
    (select count(*)::integer from public.ai_agent_approval_requests where action_type='REASSIGN_REQUEST_QUANTITY' and executed_at is not null) as global_executed_reassignments`);

assert.equal(evidence.length, 1);
const e = evidence[0];
assert.equal(e.runs, 4, "Lifecycle must contain exactly four canonical runs");
assert.equal(e.failed_runs, 0, "MIRGAB has failed runs");
assert.equal(e.failed_steps, 0, "MIRGAB has failed steps");
assert.equal(e.notifications, 2, "Duplicate or missing notification business actions");
assert.equal(e.notification_keys, 2, "Notification action keys are not unique");
assert.equal(e.followups, 1, "Duplicate or missing follow-up task");
assert.equal(e.followup_keys, 1, "Follow-up action key is not unique");
assert.equal(e.approvals, 1, "Duplicate or missing YELLOW approval");
assert.equal(e.approval_keys, 1, "Approval action key is not unique");
assert.equal(e.green_completed, 3, "Each GREEN business mutation must complete exactly once");
assert.equal(e.green_reused, 9, "Each completed GREEN mutation must be reused on all three replays/resumes");
assert.equal(e.green_unverified, 0, "A GREEN mutation or reuse lost verification");
assert.equal(e.awaiting_runs, 2, "First and pending replay must await approval");
assert.equal(e.safely_paused_runs, 2, "Resume and post-resume replay must remain safely paused");
assert.equal(e.approved_unexecuted, 1, "Approved unsupported proposal must remain unexecuted");
assert.equal(e.executed_reassignments, 0, "Fixture reassignment executed");
assert.equal(e.global_executed_reassignments, 0, "A request reassignment executed anywhere in Staging");
assert.equal(e.tenant_mismatches, 0, "MIRGAB lifecycle crossed a tenant boundary");
assert.equal(e.target_authorizations, 0, "Proposed target agency was assigned despite no supported executor");

console.log("MIRGAB Staging lifecycle PASS: first, replay, YELLOW approval, resume, post-resume replay, verified GREEN reuse, tenant boundary rejection, and unsupported reassignment safety.");

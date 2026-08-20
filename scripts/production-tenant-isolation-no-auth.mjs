import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const ref = process.env.SUPABASE_PROJECT_REF || "";
const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
assert.equal(ref, "zeocbftriydodzfgixjv", "Production project mismatch");
assert.ok(token && password, "Production credentials are required");
assert.equal(process.env.PRODUCTION_TENANT_DML_SMOKE, "ROLLBACK_ONLY_EXPLICITLY_APPROVED");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function api(path) {
  const response = await fetch(`https://api.supabase.com/v1${path}`, { headers, signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Supabase API failed with HTTP ${response.status}`);
  return response.json();
}
const [project, poolers] = await Promise.all([api(`/projects/${ref}`), api(`/projects/${ref}/config/database/pooler`)]);
assert.equal(project.id || project.ref, ref, "Supabase returned a different project");
const pooler = poolers.find((item) => String(item.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
const connection = String(pooler?.connection_string || pooler?.connectionString || "");
const parsed = connection.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i);
const host = String(pooler?.db_host || parsed?.[2] || "");
const user = String(parsed?.[1] || pooler?.db_user || "");
const database = String(pooler?.db_name || parsed?.[3] || "postgres");
assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i);
assert.equal(user, `postgres.${ref}`);

const csA = "85000000-0000-4000-8000-000000000041";
const csB = "85000000-0000-4000-8000-000000000042";
const csX = "85000000-0000-4000-8000-000000000043";
const apA = "85000000-0000-4000-8000-000000000051";
const apB = "85000000-0000-4000-8000-000000000052";
const apX = "85000000-0000-4000-8000-000000000053";

const sql = `
begin; set transaction read only; set local statement_timeout='60s';
do $safe$ declare r record; begin
  for r in select c.relname,t.tgname,l.lanname,pg_get_triggerdef(t.oid,true) td,pg_get_functiondef(p.oid) fd
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_language l on l.oid=p.prolang
    where not t.tgisinternal and n.nspname='public' and c.relname=any(array['company_email_settings','agency_penalties'])
  loop
    if lower(r.lanname) not in ('sql','plpgsql') or concat(r.td,E'\\n',r.fd)
      ~* '(pg_notify|dblink|lo_export|supabase_functions|pg_net|net\\.http|http_(get|post|put|delete)|aws_lambda|webhook|nextval|insert[[:space:]]+into)'
    then raise exception 'NO_SAFE_TRIGGER_FIXTURE'; end if;
  end loop;
end $safe$; commit;

create temp table isolation_baseline on commit preserve rows as
select (select count(*) from public.company_email_settings)::bigint cs_count,
       (select count(*) from public.agency_penalties)::bigint ap_count;

create temp table isolation_context on commit preserve rows as
with company_pair as (
  select ua.auth_user_id ca_auth,ua.company_id ca,ub.auth_user_id cb_auth,ub.company_id cb
  from public.users ua join public.users ub on ub.company_id<>ua.company_id
  where ua.auth_user_id is not null and ub.auth_user_id is not null
    and ua.company_id is not null and ub.company_id is not null
    and ua.is_active is true and ub.is_active is true
    and ua.role in ('Admin','Company Admin') and ub.role in ('Admin','Company Admin')
    and not exists(select 1 from public.company_email_settings s where s.company_id=ua.company_id)
    and not exists(select 1 from public.company_email_settings s where s.company_id=ub.company_id)
  order by ua.id,ub.id limit 1
), agency_pair as (
  select ua.auth_user_id aa_auth,ua.agency_id aa,ag_a.company_id aa_company,
         ub.auth_user_id ab_auth,ub.agency_id ab,ag_b.company_id ab_company
  from public.users ua join public.agencies ag_a on ag_a.id=ua.agency_id
  join public.users ub on ub.agency_id is not null and ub.agency_id<>ua.agency_id
  join public.agencies ag_b on ag_b.id=ub.agency_id
  where ua.auth_user_id is not null and ub.auth_user_id is not null
    and ua.is_active is true and ub.is_active is true and ua.role='Agency' and ub.role='Agency'
    and ag_a.company_id is not null and ag_b.company_id is not null
    and ag_b.company_id is distinct from ua.company_id and ag_a.company_id is distinct from ub.company_id
  order by ua.id,ub.id limit 1
)
select * from company_pair cross join agency_pair;

do $guard$ begin
  if (select count(*) from isolation_context)<>1 then raise exception 'NO_SAFE_TENANT_CONTEXTS'; end if;
  if exists(select 1 from public.company_email_settings where id=any(array['${csA}'::uuid,'${csB}'::uuid,'${csX}'::uuid]))
    or exists(select 1 from public.agency_penalties where id=any(array['${apA}'::uuid,'${apB}'::uuid,'${apX}'::uuid]))
  then raise exception 'NO_SAFE_PREDETERMINED_IDS'; end if;
end $guard$;

begin; set local lock_timeout='5s'; set local statement_timeout='90s';
insert into public.company_email_settings(id,company_id,from_name)
select '${csB}',cb,'CODEX_NO_AUTH_B_SEED' from isolation_context;
insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
select '${apB}',ab_company,'CODEX_NO_AUTH_B_SEED',ab,'CODEX_NO_AUTH_AGENCY_B','Open','[]'::jsonb from isolation_context;

select set_config('request.jwt.claim.sub',(select ca_auth::text from isolation_context),true); set local role authenticated;
do $ca$ declare n integer; begin
 if exists(select 1 from public.company_email_settings where id='${csB}') then raise exception 'COMPANY_A_CROSS_SELECT_ALLOWED'; end if;
 insert into public.company_email_settings(id,company_id,from_name) select '${csA}',ca,'CODEX_NO_AUTH_A' from isolation_context;
 update public.company_email_settings set from_name='CODEX_NO_AUTH_A_UPDATED' where id='${csA}'; get diagnostics n=row_count;
 if n<>1 then raise exception 'COMPANY_A_SAME_TENANT_UPDATE_FAILED'; end if;
 update public.company_email_settings set from_name='CODEX_NO_AUTH_CROSS' where id='${csB}'; get diagnostics n=row_count;
 if n<>0 then raise exception 'COMPANY_A_CROSS_UPDATE_ALLOWED'; end if;
 begin insert into public.company_email_settings(id,company_id,from_name) select '${csX}',cb,'CODEX_NO_AUTH_CROSS' from isolation_context;
   raise exception 'COMPANY_A_CROSS_INSERT_ALLOWED'; exception when insufficient_privilege then null; end;
end $ca$;

reset role; select set_config('request.jwt.claim.sub',(select cb_auth::text from isolation_context),true); set local role authenticated;
do $cb$ declare n integer; begin
 if exists(select 1 from public.company_email_settings where id='${csA}') then raise exception 'COMPANY_B_CROSS_SELECT_ALLOWED'; end if;
 if not exists(select 1 from public.company_email_settings where id='${csB}') then raise exception 'COMPANY_B_SAME_TENANT_SELECT_FAILED'; end if;
 update public.company_email_settings set from_name='CODEX_NO_AUTH_B_UPDATED' where id='${csB}'; get diagnostics n=row_count;
 if n<>1 then raise exception 'COMPANY_B_SAME_TENANT_UPDATE_FAILED'; end if;
end $cb$;

reset role; select set_config('request.jwt.claim.sub',(select aa_auth::text from isolation_context),true); set local role authenticated;
do $aa$ declare n integer; begin
 if exists(select 1 from public.agency_penalties where id='${apB}') then raise exception 'AGENCY_A_CROSS_SELECT_ALLOWED'; end if;
 insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
 select '${apA}',aa_company,'CODEX_NO_AUTH_A',aa,'CODEX_NO_AUTH_AGENCY_A','Open','[]'::jsonb from isolation_context;
 update public.agency_penalties set decision_notes='CODEX_NO_AUTH_A_UPDATED' where id='${apA}'; get diagnostics n=row_count;
 if n<>1 then raise exception 'AGENCY_A_SAME_TENANT_UPDATE_FAILED'; end if;
 update public.agency_penalties set decision_notes='CODEX_NO_AUTH_CROSS' where id='${apB}'; get diagnostics n=row_count;
 if n<>0 then raise exception 'AGENCY_A_CROSS_UPDATE_ALLOWED'; end if;
 begin insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
   select '${apX}',ab_company,'CODEX_NO_AUTH_CROSS',ab,'CODEX_NO_AUTH_AGENCY_B','Open','[]'::jsonb from isolation_context;
   raise exception 'AGENCY_A_CROSS_INSERT_ALLOWED'; exception when insufficient_privilege then null; end;
end $aa$;

reset role; select set_config('request.jwt.claim.sub',(select ab_auth::text from isolation_context),true); set local role authenticated;
do $ab$ declare n integer; begin
 if exists(select 1 from public.agency_penalties where id='${apA}') then raise exception 'AGENCY_B_CROSS_SELECT_ALLOWED'; end if;
 if not exists(select 1 from public.agency_penalties where id='${apB}') then raise exception 'AGENCY_B_SAME_TENANT_SELECT_FAILED'; end if;
 update public.agency_penalties set decision_notes='CODEX_NO_AUTH_B_UPDATED' where id='${apB}'; get diagnostics n=row_count;
 if n<>1 then raise exception 'AGENCY_B_SAME_TENANT_UPDATE_FAILED'; end if;
end $ab$;
reset role; rollback;

do $verify$ begin
 if (select count(*) from public.company_email_settings)<>(select cs_count from isolation_baseline)
   or (select count(*) from public.agency_penalties)<>(select ap_count from isolation_baseline)
   or exists(select 1 from public.company_email_settings where id=any(array['${csA}'::uuid,'${csB}'::uuid,'${csX}'::uuid]))
   or exists(select 1 from public.agency_penalties where id=any(array['${apA}'::uuid,'${apB}'::uuid,'${apX}'::uuid]))
 then raise exception 'ROLLBACK_VERIFICATION_FAILED'; end if;
end $verify$;
drop table isolation_context; drop table isolation_baseline;
`;

const path = join(process.env.RUNNER_TEMP || ".", "production-no-auth-isolation.sql");
await writeFile(path, sql, { encoding: "utf8", mode: 0o600 });
try {
  const result = spawnSync("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--host", host, "--port", "5432",
    "--username", user, "--dbname", database, "--quiet", "--file", path], {
    encoding: "utf8", shell: false, timeout: 300_000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "60" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostic = `${String(result.stderr || "")}\n${String(result.stdout || "")}`;
    const marker = diagnostic.match(/(NO_SAFE_[A-Z_]+|[A-Z]+_(?:CROSS|SAME_TENANT|CONTEXT|ROLLBACK|VERIFICATION)_[A-Z_]+)/)?.[1] || "SANITIZED_SQL_FAILURE";
    throw new Error(`Production no-auth isolation failed: ${marker}`);
  }
} finally {
  await unlink(path).catch(() => {});
}
console.log("Production isolation PASS without auth schema access: Company A/B and Agency A/B SELECT/INSERT/UPDATE.");
console.log("Rollback PASS: fixed test UUIDs absent and target row counts restored.");

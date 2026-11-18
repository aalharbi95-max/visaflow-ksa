import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('HR shortlists accept multiple applicants before approval without changing staffing and isolate CVs', async () => {
  const db=new PGlite();
  const a='10000000-0000-4000-8000-000000000001', b='10000000-0000-4000-8000-000000000002';
  const uid='30000000-0000-4000-8000-000000000001';
  const hash=n=>n.toString(16).padStart(64,'0');
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select '${uid}'::uuid $$;
    create function current_app_user_role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
    create function current_app_user_company_id() returns uuid language sql stable as $$ select nullif(current_setting('test.company',true),'')::uuid $$;
    create table companies(id uuid primary key); insert into companies values ('${a}'),('${b}');
    create table requests(id bigint primary key, company_id uuid, quantity integer, approval_status text);
    insert into requests values (1,'${a}',1,'Pending Recruitment Approval'),(2,'${b}',1,'Pending Recruitment Approval');
    create table request_lines(request_id bigint,company_id uuid,line_no integer,profession text);
    insert into request_lines values (1,'${a}',1,'HVAC'),(2,'${b}',1,'BMS');
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated,anon;
    create policy legacy_storage_allow on storage.objects for all to public using(true) with check(true);
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261118000200_request_candidate_shortlists.sql',import.meta.url),'utf8'));
  async function as(role,company='') { await db.exec(`reset role; set test.role='${role}'; set test.company='${company}'; set role authenticated;`); }
  const insert=(company,request,n,line=1)=>db.exec(`insert into request_candidate_shortlists(company_id,request_id,request_line_no,profession,candidate_name,cv_file_name,cv_sha256,cv_storage_path)
    values ('${company}',${request},${line},'forged','Candidate ${n}','cv.pdf','${hash(n)}','${company}/${hash(n)}.pdf')`);
  try {
    assert.equal((await db.query(`select public from storage.buckets where id='request-shortlist-cvs'`)).rows[0].public,false);
    await as('Admin',a);
    for(let n=1;n<=12;n++) await insert(a,1,n);
    assert.equal((await db.query('select * from request_candidate_shortlists')).rows.length,12);
    assert.equal((await db.query('select profession,created_by from request_candidate_shortlists limit 1')).rows[0].profession,'HVAC');
    await assert.rejects(insert(a,1,1),/unique/);
    await assert.rejects(insert(b,2,13),/row-level security/);
    await assert.rejects(insert(a,2,14),/does not belong/);
    await assert.rejects(insert(a,1,15,9),/line not found/);
    await assert.rejects(db.exec(`update request_candidate_shortlists set company_id='${b}'`),/ownership/);
    await db.exec(`insert into storage.objects(bucket_id,name) values ('request-shortlist-cvs','${a}/${hash(1)}.pdf');`);
    await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values ('request-shortlist-cvs','${b}/other.pdf')`),/row-level security/);
    await as('Recruitment Officer',a);
    assert.equal((await db.query('select * from request_candidate_shortlists')).rows.length,12);
    await as('Admin',b);
    assert.equal((await db.query('select * from request_candidate_shortlists')).rows.length,0);
    assert.equal((await db.query(`select * from storage.objects where bucket_id='request-shortlist-cvs'`)).rows.length,0);
    await as('Viewer',a);
    assert.equal((await db.query('select * from request_candidate_shortlists')).rows.length,0);
    assert.equal((await db.query(`select * from storage.objects where bucket_id='request-shortlist-cvs'`)).rows.length,0);
    await db.exec('reset role;set role anon;');
    await assert.rejects(db.query('select * from request_candidate_shortlists'),/permission denied/);
    assert.equal((await db.query(`select * from storage.objects where bucket_id='request-shortlist-cvs'`)).rows.length,0);
    await db.exec('reset role;delete from request_lines where request_id=1;');
    assert.equal((await db.query('select * from request_candidate_shortlists')).rows.length,12,'request editing must preserve shortlists');
    assert.deepEqual((await db.query('select quantity,approval_status from requests where id=1')).rows[0],{quantity:1,approval_status:'Pending Recruitment Approval'});
  } finally {await db.close();}
});

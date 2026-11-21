import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const read = name => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
test('guest upload publishes without an auth account, preserves company access, filters, quotas and atomicity', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema storage;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function public.current_app_user_company_id() returns uuid language sql stable as $$ select nullif(current_setting('test.company',true),'')::uuid $$;
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;`);
    const snapshot = await read('bootstrap/staging/production-schema-snapshot-20260727.sql');
    for (const name of ['talent_candidates','talent_candidate_documents','talent_candidate_consents','talent_candidate_skills']) {
      const sql = snapshot.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(sql, name);
      await db.exec(sql);
      await db.exec(`alter table public.${name} add primary key(id)`);
    }
    await db.exec(`alter table talent_candidates add employer_contact_sharing_consent boolean not null default false;
      create table platform_clients(operational_company_id uuid,talent_access_enabled boolean,subscription_status text,talent_profile_limit integer,created_at timestamptz default now());
      create table talent_interview_invitations(company_id uuid,candidate_id uuid,status text,interview_type text,scheduled_at timestamptz,created_at timestamptz);
      create table talent_public_campaign_applications(candidate_id uuid,cv_document_id uuid,cv_sharing_consent boolean,created_at timestamptz);
      create table talent_company_contact_requests(company_id uuid,prospect_id uuid,status text,email_delivery_status text);
      create table talent_imported_prospects(id uuid,marketplace_profile_consent_recorded_at timestamptz,created_at timestamptz,
        cv_specialty text,current_title text,general_location text,cv_years_experience integer,cv_professional_summary text,
        education_degree text,education_institution text,cv_skills jsonb,cv_source_filename text,full_name text,email text,phone text,
        marketplace_profile_consent boolean,claimed_candidate_id uuid);`);
    const campaign = await read('migrations/20260812000100_talent_engineering_campaign.sql');
    const getter = campaign.slice(campaign.indexOf('create or replace function public.get_company_talent_campaign_cv'),campaign.indexOf('drop policy if exists talent_cv_subscribed_company_read'));
    await db.exec(getter);
    await db.exec(await read('migrations/20260813000300_fix_talent_cv_storage_access.sql'));
    await db.exec(await read('migrations/20260817001000_talent_marketplace_scale_and_cv.sql'));
    await db.exec(await read('migrations/20260817001100_talent_marketplace_filters.sql'));
    await db.exec(await read('migrations/20261121000100_guest_cv_upload.sql'));
    const cid = '11111111-1111-4111-8111-111111111111';
    const rid = '22222222-2222-4222-8222-222222222222';
    const data = {consent:'yes',full_name:'Guest Candidate',email:'guest@example.test',phone:'+966500000000',profession:'Engineer',location:'Riyadh',years_experience:'5'};
    const publish = (request=rid, candidate=cid, consent='yes') => db.query('select publish_guest_cv($1,$2,$3,$4,$5,$6,$7,$8) result',
      [request,candidate,{...data,consent},`guest/${candidate}/cv.pdf`,'cv.pdf','application/pdf',100,'abc123']);
    const result=await publish();
    assert.match(result.rows[0].result.reference,/^VF-TAL-/);
    const row=(await db.query('select auth_user_id,is_verified,marketplace_status from talent_candidates')).rows[0];
    assert.deepEqual(row,{auth_user_id:null,is_verified:false,marketplace_status:'Approved'});
    await assert.rejects(publish('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','no'),/Invalid guest/);
    await assert.rejects(publish(rid,'55555555-5555-4555-8555-555555555555'),/duplicate key/);
    assert.equal((await db.query('select count(*)::int n from talent_candidates')).rows[0].n,1);
    await db.exec('set role anon');
    await assert.rejects(publish(),/permission denied/);
    await assert.rejects(db.query('select * from talent_guest_submissions'),/permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query('select get_company_talent_campaign_cv($1)',[cid]),/Active Talent/);
    await db.exec(`set test.uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; set test.company='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      insert into platform_clients values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'active',100000,now());`);
    const list=async(source=null) => (await db.query('select list_company_talent_marketplace_filtered_page($1,24,0,null,null,null,null,null,$2,null,\'Newest\') result',['',source])).rows[0].result;
    const page=await list('Guest');
    assert.equal(page.total,1); assert.equal(page.profiles[0].cv_available,true); assert.equal(page.profiles[0].profile_source,'Guest CV');
    assert.equal((await list('Registered')).total,0);
    assert.equal((await db.query('select list_company_talent_marketplace_page() result')).rows[0].result.total,1);
    assert.equal((await db.query('select get_company_talent_campaign_cv($1) result',[cid])).rows[0].result.path,`guest/${cid}/cv.pdf`);
    assert.equal((await db.query('select can_current_company_read_talent_cv($1) allowed',[`guest/${cid}/cv.pdf`])).rows[0].allowed,true);
    await db.exec("update talent_candidates set marketplace_status='Suspended'");
    assert.equal((await list()).total,0);
    assert.equal((await db.query('select get_company_talent_campaign_cv($1) result',[cid])).rows[0].result,null);
    assert.equal((await db.query('select can_current_company_read_talent_cv($1) allowed',[`guest/${cid}/cv.pdf`])).rows[0].allowed,false);
    await db.exec("update platform_clients set talent_access_enabled=false");
    await assert.rejects(db.query('select get_company_talent_campaign_cv($1)',[cid]),/Active Talent/);
    for(let i=0;i<6;i++) assert.equal((await db.query('select claim_guest_cv_attempt($1) allowed',['a'.repeat(64)])).rows[0].allowed,i<5);
  } finally { await db.close(); }
});

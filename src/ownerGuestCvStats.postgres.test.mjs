import {PGlite} from '@electric-sql/pglite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('only owner can read successful guest counts and Riyadh calendar boundaries',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create schema auth; create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 create function current_app_user_role() returns text language sql as $$ select current_setting('test.role',true) $$;
 create table talent_guest_submissions(created_at timestamptz);
 insert into talent_guest_submissions values(now()),
 ((date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') - interval '1 second'),
 ((date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') - interval '6 days'),
 ((date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') - interval '6 days 1 second');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261121000200_owner_guest_cv_stats.sql',import.meta.url),'utf8'));
 await assert.rejects(db.query('select get_owner_guest_cv_stats()'),/Platform Owner required/);
 await db.exec(`set test.uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; set test.role='Company Admin';`);
 await assert.rejects(db.query('select get_owner_guest_cv_stats()'),/Platform Owner required/);
 await db.exec(`set test.role='Platform Owner'; set role authenticated;`);
 const result=(await db.query('select get_owner_guest_cv_stats() as stats')).rows[0].stats;
 assert.equal(result.total,4);assert.equal(result.today,1);assert.equal(result.last_7_days,3);
 await assert.rejects(db.query('select * from talent_guest_submissions'),/permission denied/);
 await db.exec('reset role; set role anon;');
 await assert.rejects(db.query('select get_owner_guest_cv_stats()'),/permission denied/);
 }finally{await db.close();}
});

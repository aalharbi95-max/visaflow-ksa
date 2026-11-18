import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('profession management enforces tenant, role, shared catalogue and alias boundaries', async () => {
  const db = new PGlite();
  const a = '10000000-0000-4000-8000-000000000001';
  const b = '10000000-0000-4000-8000-000000000002';
  await db.exec(`
    create role anon; create role authenticated;
    create table companies(id uuid primary key);
    insert into companies values ('${a}'),('${b}');
    create table professions(id bigint generated always as identity primary key, name_ar text not null);
    create table profession_aliases(id bigint generated always as identity primary key,
      company_id uuid, profession_id bigint references professions(id), alias_name text);
    create function current_app_user_role() returns text language sql stable as $$
      select current_setting('test.role', true) $$;
    create function current_app_user_company_id() returns uuid language sql stable as $$
      select nullif(current_setting('test.company', true),'')::uuid $$;
    grant usage on schema public to authenticated;
    create policy legacy_read on professions for select using(true);
    insert into professions(name_ar) values ('Shared');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261118000100_tenant_profession_management.sql', import.meta.url), 'utf8'));
  async function as(role, company = '') {
    await db.exec(`reset role; set test.role='${role}'; set test.company='${company}'; set role authenticated;`);
  }
  try {
    await as('Admin', a);
    await db.exec(`insert into professions(name_ar,company_id) values ('Private A','${a}');`);
    await assert.rejects(db.exec(`insert into professions(name_ar,company_id) values ('Other','${b}');`), /row-level security/);
    await assert.rejects(db.exec(`insert into professions(name_ar) values ('Global');`), /row-level security/);
    assert.equal((await db.query(`update professions set name_ar='Bad' where id=1 returning id`)).rows.length, 0);
    await db.exec(`update professions set name_ar='A edited' where id=2;`);
    await assert.rejects(db.exec(`update professions set company_id=null where id=2;`), /scope cannot be changed/);
    await db.exec(`insert into profession_aliases(company_id,profession_id,alias_name) values ('${a}',1,'A shared alias');`);
    await as('Admin', b);
    assert.deepEqual((await db.query('select name_ar from professions order by id')).rows.map(r=>r.name_ar), ['Shared']);
    assert.equal((await db.query('select * from profession_aliases')).rows.length, 0);
    assert.equal((await db.query(`update professions set name_ar='Bad' where id=2 returning id`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into profession_aliases(company_id,profession_id,alias_name) values ('${b}',2,'Leak');`), /row-level security/);
    await db.exec(`insert into professions(name_ar,company_id) values ('Private B','${b}');`);
    for (const role of ['Viewer', 'Agency', 'Platform Support User']) {
      await as(role, a);
      await assert.rejects(db.exec(`insert into professions(name_ar,company_id) values ('Bad','${a}');`), /row-level security/);
    }
    await as('Platform Owner');
    await db.exec(`insert into professions(name_ar) values ('Owner global'); update professions set name_ar='Owner edit' where id=1;`);
    assert.equal((await db.query('select * from professions')).rows.length, 4);
    await as('Admin', a);
    assert.deepEqual((await db.query('select name_ar from professions order by id')).rows.map(r=>r.name_ar), ['Owner edit','A edited','Owner global']);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from professions'), /permission denied/);
  } finally { await db.close(); }
});

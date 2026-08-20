import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const target = process.argv[2] || "";
assert.ok(target, "Tenant smoke target path is required");
let source = await readFile(target, "utf8");

function replaceExact(before, after, label) {
  assert.equal(source.includes(before), true, `Canonical tenant smoke fixture changed: ${label}`);
  source = source.replace(before, after);
}

replaceExact(
  `assert.deepEqual(await fixturePresence(), emptyFixture, "Predetermined fixture identifiers already exist; DML smoke refused");`,
  `assert.deepEqual(await fixturePresence(), emptyFixture, "Predetermined fixture identifiers already exist; DML smoke refused");

async function authFixtureCount() {
  const rows = await query(\`
    select count(*)::integer as auth_users
    from auth.users
    where id in (
      '\${ids.companyAAuth}'::uuid,'\${ids.companyBAuth}'::uuid,
      '\${ids.agencyAAuth}'::uuid,'\${ids.agencyBAuth}'::uuid
    )\`, { readOnly: true });
  return rows[0].auth_users;
}
assert.equal(await authFixtureCount(), 0, "Predetermined auth.users fixture identifiers already exist; DML smoke refused");`,
  "auth fixture guard",
);

replaceExact(
  `where not t.tgisinternal and n.nspname='public'
    and c.relname = any(array[\${touchedTables.map((table) => \`'\${table}'\`).join(",")}])`,
  `where not t.tgisinternal
    and (
      (n.nspname='public' and c.relname = any(array[\${touchedTables.map((table) => \`'\${table}'\`).join(",")}]))
      or (n.nspname='auth' and c.relname='users')
    )`,
  "auth trigger inventory",
);

replaceExact(
  `const unsafeTriggerPattern = /\\b(pg_notify|dblink|lo_export|supabase_functions|pg_net|net\\.http|http_(?:get|post|put|delete)|aws_lambda|webhook)\\b/i;`,
  `const unsafeTriggerPattern = /\\b(pg_notify|dblink|lo_export|supabase_functions|pg_net|net\\.http|http_(?:get|post|put|delete)|aws_lambda|webhook|nextval)\\b|insert\\s+into\\s+public\\.users/i;`,
  "sequence and auth trigger safety",
);

replaceExact(
  `const countsBefore = await rowCounts();`,
  `const countsBefore = await rowCounts();
const authUsersBefore = (await query("select count(*)::bigint::text as row_count from auth.users", { readOnly: true }))[0].row_count;`,
  "auth row count baseline",
);

replaceExact(
  `  insert into public.companies(id,name,status) values`,
  `  insert into auth.users(
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000','\${ids.companyAAuth}','authenticated','authenticated','company-a-rls-smoke@example.invalid','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    ('00000000-0000-0000-0000-000000000000','\${ids.companyBAuth}','authenticated','authenticated','company-b-rls-smoke@example.invalid','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    ('00000000-0000-0000-0000-000000000000','\${ids.agencyAAuth}','authenticated','authenticated','agency-a-rls-smoke@example.invalid','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    ('00000000-0000-0000-0000-000000000000','\${ids.agencyBAuth}','authenticated','authenticated','agency-b-rls-smoke@example.invalid','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

  insert into public.companies(id,name,status) values`,
  "transactional auth fixture",
);

replaceExact(
  `assert.deepEqual(await rowCounts(), countsBefore, "Rollback verification failed: Production row counts changed");`,
  `assert.deepEqual(await rowCounts(), countsBefore, "Rollback verification failed: Production row counts changed");
assert.equal(await authFixtureCount(), 0, "Rollback verification failed: temporary auth.users rows remain");
const authUsersAfter = (await query("select count(*)::bigint::text as row_count from auth.users", { readOnly: true }))[0].row_count;
assert.equal(authUsersAfter, authUsersBefore, "Rollback verification failed: auth.users row count changed");`,
  "auth rollback verification",
);

await writeFile(target, source, { encoding: "utf8", mode: 0o600 });

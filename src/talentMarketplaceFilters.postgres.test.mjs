import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/20260815000300_talent_marketplace_filters.sql", import.meta.url);

test("Talent Marketplace filter migration creates the authenticated RPC", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create role anon;
    create role authenticated;
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create or replace function public.current_app_user_company_id() returns uuid language sql stable as $$ select null::uuid $$;
  `);

  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);

  const result = await db.query(`
    select count(*)::integer as count
    from pg_proc
    where proname = 'list_company_talent_marketplace_filtered_page'
      and pronargs = 11
  `);
  assert.equal(result.rows[0].count, 1);
  await db.close();
});

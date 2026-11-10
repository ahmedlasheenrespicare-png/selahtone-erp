/**
 * Disposable static + PGlite check for the cutover lab guard. The PostgreSQL
 * integration test needs FINANCE_TEST_PG_BIN; this test verifies the guarded
 * table list, its documented count and the existence of every target without
 * a server. No DATABASE_URL, no business data, no production SQL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const read = (f: string) => readFileSync(`${root}/${f}`, "utf8");
const bridge = read("prototypes/finance-cutover/lab-bridge.test-only.sql");
const schema = read("prototypes/finance-engine/schema.test-only.sql");
const integration = read("prototypes/finance-app/test/cutover-integration.test.ts");
const cutoverReadme = read("prototypes/finance-cutover/README.md");

function guardedTables(): string[] {
  const block = /FOREACH obj IN ARRAY ARRAY\[([\s\S]*?)\] LOOP/.exec(bridge)?.[1];
  assert.ok(block, "guard ARRAY block not found");
  const entries = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(entries.length > 0, "no guarded tables found");
  return entries;
}

test("the cutover lab guard protects the result-link table and its count stays in sync", () => {
  const entries = guardedTables();
  assert.equal(new Set(entries).size, entries.length, "guarded table list has duplicates");
  assert.equal(entries.length, 19);
  assert.ok(entries.includes("finance_lab.request_results"),
    "finance_lab.request_results must be protected from legacy/new application logins");

  const expected = /pg_trigger WHERE tgname='finance_cutover_lab_guard'[^;]*count\),(\d+)\)/.exec(integration);
  assert.ok(expected, "integration guard-count assertion not found");
  assert.equal(Number(expected[1]), entries.length,
    "cutover-integration.test.ts must expect the same number of guarded tables");
  assert.match(cutoverReadme, /19 جدولًا/, "cutover README must document 19 guarded tables");
});

test("every guarded lab table actually exists in the opted-in disposable schema", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    await pg.exec("SET selahtone.finance_lab_test_only = 'yes'");
    await pg.exec(schema);
    for (const table of guardedTables()) {
      const row = (await pg.query<{ present: string | null }>(
        "SELECT to_regclass($1)::text AS present", [table])).rows[0];
      assert.ok(row?.present, `guarded table missing from the lab schema: ${table}`);
    }
    assert.equal((await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='finance_lab' AND table_name='request_results'")).rows[0].n,
      6, "the result-link table must keep its documented six columns");
  } finally { await pg.close(); }
});

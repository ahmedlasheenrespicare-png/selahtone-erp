import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { observeSyntheticAccountIndexes as observe } from "../prototypes/finance-custody-uniqueness/index-observation.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("synthetic index observer reports catalog metadata without treating name as proof", async () => {
  const pg = new PGlite();
  try {
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []) => ({ rows: (await pg.query(sql,args)).rows as T[] }) };
    await assert.rejects(() => observe(tx,"0",2),/opt-in/);
    await pg.exec("SET selahtone.custody_uniqueness_test_only='yes'");
    await assert.rejects(() => observe(tx,"0",2),/unavailable/);
    await assert.rejects(() => observe(tx,"4294967296",2),/cursor/);
    await assert.rejects(() => observe(tx,"0",101),/limit/);
    await pg.exec(`CREATE SCHEMA finance; CREATE TABLE finance.accounts(id bigint PRIMARY KEY,holder_id bigint,kind text,closed_at timestamptz);
      CREATE INDEX misleading_unique_name ON finance.accounts(holder_id);`);
    await pg.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = []; let after: string | null = "0";
    while (after !== null) { const page = await observe(tx,after,1); rows.push(...page.rows); after = page.nextAfterOid; }
    const misleading = rows.find(item => item.name === "misleading_unique_name"); assert.ok(misleading);
    assert.equal(misleading.unique,false); assert.equal(misleading.valid,true); assert.equal(misleading.predicate,null);
    await assert.rejects(() => pg.exec("DROP INDEX finance.misleading_unique_name"),/read.only/i);
    await pg.exec("ROLLBACK");
  } finally { await pg.close(); }
});

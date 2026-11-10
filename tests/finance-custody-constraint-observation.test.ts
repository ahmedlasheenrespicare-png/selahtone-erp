/** Synthetic schema may deliberately violate candidate production constraints. */
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { observeSyntheticAccountColumns as columns, observeSyntheticAccountConstraints as constraints } from "../prototypes/finance-custody-uniqueness/constraint-observation.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("synthetic catalog records unvalidated check and nullable kind without declaring safety", async () => {
  const pg = new PGlite();
  try {
    const tx: FinanceTransaction = { query: async <T extends Record<string,unknown>>(sql: string, args: unknown[] = []) => ({ rows: (await pg.query(sql,args)).rows as T[] }) };
    await assert.rejects(() => constraints(tx,"0",2),/opt-in/);
    await pg.exec("SET selahtone.custody_uniqueness_test_only='yes'");
    await assert.rejects(() => columns(tx,0,1),/unavailable/);
    await assert.rejects(() => constraints(tx,"4294967296",1),/cursor/);
    await assert.rejects(() => columns(tx,0,0),/limit/);
    await pg.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.accounts (id bigint PRIMARY KEY,kind text,holder_id bigint);
      INSERT INTO finance.accounts VALUES (1,'CUSTODY',NULL);
      ALTER TABLE finance.accounts ADD CONSTRAINT holder_test CHECK (kind <> 'CUSTODY' OR holder_id IS NOT NULL) NOT VALID;`);
    // CHECK rejects new false expressions, but nullable kind produces UNKNOWN.
    await assert.rejects(() => pg.exec("INSERT INTO finance.accounts VALUES(2,'CUSTODY',NULL)"), /check constraint/);
    await pg.exec("INSERT INTO finance.accounts VALUES(3,NULL,NULL)");
    await assert.rejects(() => pg.exec("ALTER TABLE finance.accounts VALIDATE CONSTRAINT holder_test"), /check constraint/);
    await pg.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const allConstraints = []; let next: string | null = "0";
    while (next !== null) { const page = await constraints(tx,next,1); allConstraints.push(...page.rows); next=page.nextAfterOid; }
    const holder = allConstraints.find(row => row.name === "holder_test"); assert.ok(holder);
    assert.equal(holder.validated,false); assert.equal(holder.kind,"c"); assert.match(holder.definition,/CHECK/);
    const allColumns = []; let pos: number | null = 0;
    while (pos !== null) { const page = await columns(tx,pos,1); allColumns.push(...page.rows); pos=page.nextAfterPosition; }
    assert.equal(allColumns.find(row => row.name === "kind")?.notNull,false);
    assert.equal(allColumns.find(row => row.name === "id")?.notNull,true);
    await assert.rejects(() => pg.exec("ALTER TABLE finance.accounts DROP CONSTRAINT holder_test"),/read.only/i);
    await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ n:number }>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n,2);
  } finally { await pg.close(); }
});

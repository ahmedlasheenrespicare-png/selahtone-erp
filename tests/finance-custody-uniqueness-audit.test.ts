/** Permissive synthetic schema only: malformed relationships are intentional. */
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticOpenCustodies as audit } from "../prototypes/finance-custody-uniqueness/audit.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("global synthetic inventory pages anomaly accounts without repairs or cash inference", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE SCHEMA finance;
      CREATE TABLE public.branches(id bigint PRIMARY KEY);
      CREATE TABLE public.users(id bigint PRIMARY KEY,branch_id bigint,status text);
      CREATE TABLE finance.accounts(id bigint PRIMARY KEY,branch_id bigint,kind text,holder_id bigint,closed_at timestamptz);
      CREATE TABLE finance.cash_counts(id bigint PRIMARY KEY,account_id bigint,status text);
      CREATE TABLE finance.settlements(id bigint PRIMARY KEY,account_id bigint,status text);
      INSERT INTO branches VALUES(1),(2);
      INSERT INTO users VALUES(1,1,'ACTIVE'),(2,2,'ACTIVE'),(3,1,'SUSPENDED'),(4,NULL,'ACTIVE');
      INSERT INTO finance.accounts VALUES
        (10,1,'CUSTODY',1,NULL),(11,2,'CUSTODY',1,NULL),
        (12,2,'CUSTODY',2,NULL),(13,1,'CUSTODY',NULL,NULL),
        (14,1,'CUSTODY',999,NULL),(15,1,'CUSTODY',3,NULL),
        (16,1,'CUSTODY',4,NULL),(17,99,'CUSTODY',2,NULL),
        (18,1,'CUSTODY',1,'2026-01-01Z'),(19,1,'VAULT',NULL,NULL);
      INSERT INTO finance.cash_counts VALUES(1,10,'OPEN'),(2,11,'CANCELLED'),(3,12,'OPEN');
      INSERT INTO finance.settlements VALUES(1,10,'OPEN'),(2,11,'CONFIRMED');`);
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await pg.query(sql, params)).rows as T[] }) };
    await assert.rejects(() => audit(tx, "0", 2), /opt-in/);
    await assert.rejects(() => audit(tx, "-1", 2), /cursor/);
    await assert.rejects(() => audit(tx, "0", 101), /limit/);
    const before = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n;
    await pg.exec("BEGIN READ ONLY; SET LOCAL selahtone.custody_uniqueness_test_only='yes'");
    const rows = []; let cursor: string | null = "0";
    while (cursor !== null) { const page = await audit(tx, cursor, 2); rows.push(...page.rows); cursor = page.nextAfterId; }
    assert.deepEqual(rows.map(r => r.id), ["10","11","12","13","14","15","16","17"]);
    const byId = new Map(rows.map(row => [row.id,row]));
    assert.equal(byId.get("10")?.anotherOpenCustody, true);
    assert.equal(byId.get("10")?.openCount, true); assert.equal(byId.get("10")?.openSettlement, true);
    assert.equal(byId.get("11")?.branchMismatch, true); assert.equal(byId.get("11")?.openCount, false);
    assert.equal(byId.get("12")?.anotherOpenCustody, true);
    assert.equal(byId.get("13")?.missingHolder, true);
    assert.equal(byId.get("14")?.missingUser, true);
    assert.equal(byId.get("15")?.inactiveUser, true);
    assert.equal(byId.get("16")?.branchMismatch, true);
    assert.equal(byId.get("17")?.missingBranch, true);
    assert.ok(!("balance" in rows[0]) && !("amount" in rows[0]));
    await assert.rejects(() => pg.exec("UPDATE finance.accounts SET closed_at=now()"), /read.only/i);
    await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0].n, before);
  } finally { await pg.close(); }
});

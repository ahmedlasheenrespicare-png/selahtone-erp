import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readSyntheticRecordedEvents } from "../prototypes/finance-dashboard-flow-audit/sources.test-only";
import { RECORDED_FLOW_SQL } from "../src/lib/finance/recorded-flow-sql";
import { syntheticRecordedFlow } from "../prototypes/finance-dashboard-flow-audit/recorded-flow.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("disposable recorded-event inventory preserves actual source evidence and scope", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE SCHEMA finance;
      CREATE TABLE commerce_sales(id bigint PRIMARY KEY, branch_id bigint, cancelled_at timestamptz);
      CREATE TABLE commerce_collections(id bigint PRIMARY KEY,sale_id bigint,created_by_id bigint,method text,amount numeric(14,2),created_at timestamptz);
      CREATE TABLE commerce_refunds(id bigint PRIMARY KEY,sale_id bigint,created_by_id bigint,method text,amount numeric(14,2),created_at timestamptz);
      CREATE TABLE finance.expenses(id bigint PRIMARY KEY,branch_id bigint);
      CREATE TABLE finance.payments(id bigint PRIMARY KEY,expense_id bigint,recorded_by bigint,method text,amount numeric(14,2),recorded_at timestamptz,historical boolean);
      CREATE TABLE finance.expense_corrections(id bigint PRIMARY KEY,expense_id bigint);
      INSERT INTO commerce_sales VALUES(1,1,'2026-03-20Z'),(2,2,NULL);
      INSERT INTO commerce_collections VALUES(1,1,3,'CASH',10.20,'2026-02-28 22:00Z'),(2,1,4,'CARD',20,'2026-03-01Z'),(3,1,3,'CASH',3,'2026-02-28 21:59:59Z'),(4,2,3,'CASH',4,'2026-03-01Z'),(5,1,3,'CASH',9,'2026-03-31 22:00Z'),(6,1,3,'CASH',7,'2026-03-31 21:59:59Z');
      INSERT INTO commerce_refunds VALUES(1,1,3,'CASH',2.10,'2026-03-10Z');
      INSERT INTO finance.expenses VALUES(1,1),(2,1);
      INSERT INTO finance.payments VALUES(1,1,3,'CASH',5,'2026-03-02Z',true),(2,2,4,'CARD',8,'2026-03-03Z',false);
      INSERT INTO finance.expense_corrections VALUES(1,1);`);
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []) => ({ rows: (await pg.query(sql, args)).rows as T[] }) };
    await assert.rejects(() => readSyntheticRecordedEvents(tx, {branchId:"1"}, "2026-03"), /opt-in/);
    const before = (await pg.query(`SELECT (SELECT count(*) FROM commerce_collections)::int AS c,(SELECT count(*) FROM finance.payments)::int AS p,(SELECT count(*) FROM finance.expense_corrections)::int AS x`)).rows[0];
    await pg.exec("BEGIN READ ONLY; SET LOCAL selahtone.dashboard_flow_test_only='yes'");
    const own = await readSyntheticRecordedEvents(tx, {branchId:"1",actorId:"3"}, "2026-03");
    assert.deepEqual(own.map(e => `${e.kind}:${e.id}`), ["COLLECTION:1","COLLECTION:6","PAYMENT:1","REFUND:1"]);
    assert.equal(own[0].cancelledSale, true, "cancellation is evidence, not an assumed refund");
    assert.equal(own[2].historicalPayment, true);
    assert.equal(own[2].hasCorrection, true);
    const summary = syntheticRecordedFlow(own, {branchId:"1",actorId:"3"}, "2026-03");
    assert.equal(summary.complete, true);
    if (summary.complete) assert.deepEqual(summary.buckets.CASH, {collection:1720n,refund:210n,payment:500n});
    const actual = await pg.query<{kind:string;method:string;amount:string;count:number;flagged:number}>(RECORDED_FLOW_SQL, ["1", "3", "2026-03-01"]);
    assert.deepEqual(actual.rows, [
      {kind:"COLLECTION",method:"CASH",amount:"17.20",count:2,flagged:2},
      {kind:"PAYMENT",method:"CASH",amount:"5.00",count:1,flagged:1},
      {kind:"REFUND",method:"CASH",amount:"2.10",count:1,flagged:1},
    ]);
    const actualBranch = await pg.query<{kind:string;method:string}>(RECORDED_FLOW_SQL,["1",null,"2026-03-01"]);
    assert.ok(actualBranch.rows.some(r => r.kind === "COLLECTION" && r.method === "CARD"));
    assert.equal((await pg.query(RECORDED_FLOW_SQL,["2","4","2026-03-01"])).rows.length,0);
    const branch = await readSyntheticRecordedEvents(tx, {branchId:"1"}, "2026-03");
    assert.equal(branch.length,6);
    assert.equal((await readSyntheticRecordedEvents(tx, {branchId:"2"}, "2026-03")).length,1);
    await assert.rejects(() => readSyntheticRecordedEvents(tx, {branchId:"1 OR true"}, "2026-03"), /invalid/);
    await assert.rejects(() => pg.exec("UPDATE commerce_collections SET amount=0 WHERE id=1"), /read.only/i);
    await pg.exec("ROLLBACK");
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*) FROM commerce_collections)::int AS c,(SELECT count(*) FROM finance.payments)::int AS p,(SELECT count(*) FROM finance.expense_corrections)::int AS x`)).rows[0],before);
  } finally { await pg.close(); }
});

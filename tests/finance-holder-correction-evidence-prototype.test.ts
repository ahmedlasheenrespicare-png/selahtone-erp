import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticHolderCorrections } from "../prototypes/finance-holder-checkpoint-audit/corrections.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("synthetic correction evidence keeps missing, multiple, contradictory and movement links without inferring allocation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.expenses (id bigint PRIMARY KEY,branch_id bigint,requested_by bigint);
      CREATE TABLE finance.payments (id bigint PRIMARY KEY,expense_id bigint,amount numeric(14,2),payment_date date,recorded_at timestamptz,recorded_by bigint,historical boolean,source text);
      CREATE TABLE finance.expense_reviews (id bigint PRIMARY KEY,expense_id bigint,expense_revision int,proposed_amount numeric(14,2),reason text,original_snapshot jsonb,status text,created_by bigint,created_at timestamptz,resolved_by bigint,resolved_at timestamptz,resolution_reason text);
      CREATE TABLE finance.expense_corrections (id bigint PRIMARY KEY,expense_id bigint,payment_id bigint,review_id bigint,before_amount numeric(14,2),after_amount numeric(14,2),account_id bigint,book_difference numeric(14,2),balance_before numeric(14,2),balance_after numeric(14,2),reason text,created_by bigint,created_at timestamptz);
      CREATE TABLE finance.movements (id bigint PRIMARY KEY,expense_correction_id bigint,kind text,branch_id bigint,source_id bigint,destination_id bigint,amount numeric(14,2),actor_id bigint,created_at timestamptz);
      INSERT INTO finance.expenses VALUES (1,1,3),(2,1,4),(3,2,3),(4,1,3),(5,1,5);
      INSERT INTO finance.payments VALUES
        (1,1,10,'2026-03-01','2026-03-05 10:00Z',3,false,'HOLDER_CASH'),
        (2,2,20,'2026-03-01','2026-03-05 10:00Z',9,true,'HOLDER_CASH'),
        (3,3,30,'2026-03-01','2026-03-05 10:00Z',3,false,'HOLDER_CASH'),
        (4,4,40,'2026-03-01','2026-03-05 10:00Z',3,false,'ACCOUNT'),
        (5,5,50,'2026-03-01','2026-03-05 10:00Z',5,false,'HOLDER_CASH');
      INSERT INTO finance.expense_reviews VALUES
        (11,1,3,9,'open','{"payment":{"id":"1","amount":"10.00","source":"HOLDER_CASH"},"effectiveAmount":"10.00"}','OPEN',1,'2026-03-06Z',NULL,NULL,NULL),
        (12,1,3,NULL,'old','{"payment":{"id":"1"}}','CLOSED',1,'2026-03-07Z',2,'2026-03-08Z','closed'),
        (13,1,3,8,'corrected','{"payment":{"id":"1","source":null}}','CORRECTED',1,'2026-03-09Z',2,'2026-03-10Z','confirmed'),
        (14,2,3,19,'other','{}','CORRECTED',1,'2026-03-06Z',2,'2026-03-07Z','confirmed'),
        (15,3,3,NULL,'branch2','{}','OPEN',1,'2026-03-06Z',NULL,NULL,NULL);
      INSERT INTO finance.expense_corrections VALUES
        (21,1,1,13,10,8,NULL,NULL,NULL,NULL,'legacy',2,'2026-03-10Z'),
        (22,2,1,14,20,19,10,1,0,1,'mismatched links',2,'2026-03-11Z');
      INSERT INTO finance.movements VALUES (31,22,'EXPENSE_CORRECTION',1,NULL,10,1,2,'2026-03-11Z');`);
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await db.query(sql, params)).rows as T[] }) };
    await assert.rejects(() => auditSyntheticHolderCorrections(tx, "1", "0", 1), /opt-in/);
    await assert.rejects(() => auditSyntheticHolderCorrections(tx, "1", "0 OR 1=1", 1), /invalid/);
    await assert.rejects(() => auditSyntheticHolderCorrections(tx, "1", "0", 101), /invalid/);
    await db.exec("BEGIN READ ONLY; SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
    const first = await auditSyntheticHolderCorrections(tx, "1", "0", 1);
    assert.equal(first.nextAfterId, "1");
    assert.deepEqual(first.rows.map(r => r.kind), ["CORRECTION", "CORRECTION", "MOVEMENT", "PAYMENT", "REVIEW", "REVIEW", "REVIEW"]);
    const reviews = first.rows.filter(r => r.kind === "REVIEW").map(r => r.evidence);
    assert.deepEqual(reviews.map(r => [r.reviewId,r.status,r.snapshotHasSource,r.snapshotSource]), [["11","OPEN",true,"HOLDER_CASH"],["12","CLOSED",false,null],["13","CORRECTED",true,null]]);
    assert.equal(reviews[0].snapshotEffectiveAmount, "10.00");
    const corrections = first.rows.filter(r => r.kind === "CORRECTION").map(r => r.evidence);
    assert.deepEqual(corrections.map(c => [c.correctionId,c.expenseId,c.paymentId,c.reviewExpenseId]), [["21","1","1","1"],["22","2","1","2"]]);
    assert.equal(corrections[0].bookDifference, null, "absence of book movement is not zero settlement effect");
    assert.equal(first.rows.find(r => r.kind === "MOVEMENT")?.evidence.correctionId, "22");
    const second = await auditSyntheticHolderCorrections(tx, "1", first.nextAfterId!, 1);
    assert.equal(second.nextAfterId, "2");
    assert.deepEqual(second.rows.map(r => r.kind), ["CORRECTION","MOVEMENT","PAYMENT","REVIEW"]);
    assert.equal(second.rows.find(r => r.kind === "CORRECTION")?.evidence.paymentId, "1", "conflicting link stays visible from either expense");
    const third = await auditSyntheticHolderCorrections(tx, "1", second.nextAfterId!, 1);
    assert.equal(third.nextAfterId, null); assert.deepEqual(third.rows.map(r => r.kind), ["PAYMENT"]);
    assert.deepEqual((await auditSyntheticHolderCorrections(tx, "2", "0", 10)).rows.map(r => r.paymentId), ["3","3"]);
    await assert.rejects(() => db.exec("DELETE FROM finance.expense_reviews"), /read.only/i);
    await db.exec("ROLLBACK");
  } finally { await db.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticMixedPaymentReviews, auditSyntheticUnmatchedReviews } from "../prototypes/finance-holder-checkpoint-audit/unmatched-reviews.test-only";
import type { FinanceTransaction } from "../src/lib/finance/types";

test("expense-paged synthetic inventory reveals unmatched reviews and conflicting correction links without classifying them", async () => {
  const db = new PGlite();
  try {
    // Lax disposable tables permit synthetic corrupt legacy links, not possible
    // with all production constraints intact. They are evidence, not backfills.
    await db.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.expenses (id bigint PRIMARY KEY,branch_id bigint,requested_by bigint,status text,amount numeric(14,2),revision int);
      CREATE TABLE finance.payments (id bigint PRIMARY KEY,expense_id bigint,source text,method text,account_id bigint,amount numeric(14,2),payment_date date,recorded_at timestamptz,recorded_by bigint,historical boolean);
      CREATE TABLE finance.expense_reviews (id bigint PRIMARY KEY,expense_id bigint,expense_revision int,proposed_amount numeric(14,2),reason text,original_snapshot jsonb,status text,created_by bigint,created_at timestamptz,resolved_by bigint,resolved_at timestamptz,resolution_reason text);
      CREATE TABLE finance.expense_corrections (id bigint PRIMARY KEY,expense_id bigint,payment_id bigint,review_id bigint,before_amount numeric(14,2),after_amount numeric(14,2),account_id bigint,book_difference numeric(14,2),balance_before numeric(14,2),balance_after numeric(14,2),reason text,created_by bigint,created_at timestamptz);
      CREATE TABLE finance.movements (id bigint PRIMARY KEY,expense_correction_id bigint,kind text,branch_id bigint,source_id bigint,destination_id bigint,amount numeric(14,2),actor_id bigint,created_at timestamptz);
      INSERT INTO finance.expenses VALUES (1,1,3,'PAID',10,3),(2,1,3,'PAID',20,3),(3,1,3,'PAID',30,3),
        (4,1,3,'PAID',40,3),(5,2,3,'PAID',50,3),(6,1,3,'PAID',60,3),(7,1,3,'PAID',70,3),(8,1,3,'PAID',80,3),(9,1,3,'PAID',90,3),(10,1,3,'PAID',100,3);
      INSERT INTO finance.payments VALUES
        (21,2,'ACCOUNT','CARD',NULL,20,'2026-01-01','2026-01-02Z',3,false),
        (31,3,NULL,'CASH',NULL,30,'2026-01-01','2026-01-02Z',3,false),
        (41,4,'HOLDER_CASH','CASH',NULL,40,'2026-01-01','2026-01-02Z',3,false),
        (42,4,'ACCOUNT','CARD',NULL,40,'2026-01-01','2026-01-02Z',3,false),
        (51,5,'ACCOUNT','CARD',NULL,50,'2026-01-01','2026-01-02Z',3,false),
        (71,7,'ACCOUNT','CASH',99,70,'2026-01-01','2026-01-02Z',3,false),
        (91,9,'HOLDER_CASH','CASH',NULL,90,'2026-01-01','2026-01-02Z',3,false),
        (92,9,NULL,'CASH',NULL,90,'2026-01-01','2026-01-02Z',3,false),
        (100,10,'HOLDER_CASH','CASH',NULL,100,'2026-01-01','2026-01-02Z',3,false),
        (101,10,'ACCOUNT','CARD',NULL,100,'2026-01-01','2026-01-02Z',3,false);
      INSERT INTO finance.expense_reviews VALUES
        (11,1,3,9,'missing','{"payment":{"id":"999","source":"HOLDER_CASH"}}','OPEN',1,'2026-01-03Z',NULL,NULL,NULL),
        (12,1,3,NULL,'legacy','{"payment":{"id":"998"}}','CLOSED',1,'2026-01-03Z',2,'2026-01-04Z','closed'),
        (13,2,3,18,'card','{"payment":{"id":"21","source":"ACCOUNT"}}','CORRECTED',1,'2026-01-03Z',2,'2026-01-04Z','confirmed'),
        (14,3,3,NULL,'null source','{"payment":{"source":null}}','OPEN',1,'2026-01-03Z',NULL,NULL,NULL),
        (15,4,3,NULL,'holder','{}','OPEN',1,'2026-01-03Z',NULL,NULL,NULL),
        (16,5,3,NULL,'other branch','{}','OPEN',1,'2026-01-03Z',NULL,NULL,NULL),
        (17,9,3,NULL,'unknown source','{}','OPEN',1,'2026-01-03Z',NULL,NULL,NULL);
      INSERT INTO finance.expense_corrections VALUES
        (101,2,21,13,20,18,NULL,NULL,NULL,NULL,'normal card',2,'2026-01-04Z'),
        (102,6,999,11,60,59,NULL,NULL,NULL,NULL,'mismatch and missing payment',2,'2026-01-05Z'),
        (103,8,71,999,80,79,99,1,0,1,'missing review and mismatched payment',2,'2026-01-06Z');
      INSERT INTO finance.movements VALUES (201,103,'EXPENSE_CORRECTION',1,NULL,99,1,2,'2026-01-06Z');`);
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await db.query(sql, params)).rows as T[] }) };
    await assert.rejects(() => auditSyntheticUnmatchedReviews(tx,"1","0",1), /opt-in/);
    await assert.rejects(() => auditSyntheticMixedPaymentReviews(tx,"1","0",1), /opt-in/);
    await assert.rejects(() => auditSyntheticUnmatchedReviews(tx,"1 OR 1=1","0",1), /invalid/);
    await assert.rejects(() => auditSyntheticUnmatchedReviews(tx,"1","0",0), /invalid/);
    await db.exec("BEGIN READ ONLY; SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
    const one = await auditSyntheticUnmatchedReviews(tx,"1","0",1);
    assert.equal(one.nextAfterId,"1");
    assert.deepEqual(one.rows.map(r => r.kind), ["CORRECTION","EXPENSE","REVIEW","REVIEW"]);
    const reviews = one.rows.filter(r => r.kind === "REVIEW").map(r => r.evidence);
    assert.deepEqual(reviews.map(r => [r.snapshotHasSource,r.snapshotSource,r.snapshotPaymentId]), [[true,"HOLDER_CASH","999"],[false,null,"998"]]);
    const missing = one.rows.find(r => r.kind === "CORRECTION")!.evidence;
    assert.deepEqual([missing.expenseId,missing.paymentId,missing.paymentExpenseId,missing.reviewExpenseId], ["6","999",null,"1"]);
    const two = await auditSyntheticUnmatchedReviews(tx,"1",one.nextAfterId!,1);
    assert.equal(two.nextAfterId,"2");
    assert.deepEqual(two.rows.map(r => r.kind),["CORRECTION","EXPENSE","PAYMENT","REVIEW"]);
    assert.equal(two.rows.find(r => r.kind === "PAYMENT")!.evidence.method,"CARD", "legitimate noncash isn't classified as an error");
    const rest = await auditSyntheticUnmatchedReviews(tx,"1",two.nextAfterId!,10);
    assert.equal(rest.nextAfterId,null);
    assert.deepEqual([...new Set(rest.rows.map(r => r.expenseId))],["3","6","7","8"]);
    assert.equal(rest.rows.find(r => r.expenseId === "3" && r.kind === "PAYMENT")!.evidence.source,null);
    assert.equal(rest.rows.find(r => r.expenseId === "3" && r.kind === "REVIEW")!.evidence.snapshotHasSource,true);
    for (const id of ["7","8"]) {
      assert.equal(rest.rows.filter(r => r.expenseId === id && r.kind === "CORRECTION").length,1);
      assert.equal(rest.rows.filter(r => r.expenseId === id && r.kind === "MOVEMENT").length,1);
      const correction = rest.rows.find(r => r.expenseId === id && r.kind === "CORRECTION")!.evidence;
      assert.deepEqual([correction.expenseId,correction.paymentExpenseId,correction.reviewExpenseId],["8","7",null]);
    }
    assert.deepEqual([...new Set((await auditSyntheticUnmatchedReviews(tx,"2","0",10)).rows.map(r => r.expenseId))],["5"]);
    const mixed = await auditSyntheticMixedPaymentReviews(tx,"1","0",1);
    assert.equal(mixed.nextAfterId,"4");
    assert.deepEqual([...new Set(mixed.rows.map(r => r.expenseId))],["4"]);
    assert.deepEqual(mixed.rows.filter(r => r.kind === "PAYMENT").map(r => [r.evidence.paymentId,r.evidence.source]),[["41","HOLDER_CASH"],["42","ACCOUNT"]]);
    assert.equal(mixed.rows.filter(r => r.kind === "REVIEW").length,1);
    assert.deepEqual((await auditSyntheticMixedPaymentReviews(tx,"2","0",10)).rows,[]);
    const mixedNext = await auditSyntheticMixedPaymentReviews(tx,"1",mixed.nextAfterId!,10);
    assert.equal(mixedNext.nextAfterId,null);
    assert.deepEqual([...new Set(mixedNext.rows.map(r => r.expenseId))],["9"]);
    assert.deepEqual(mixedNext.rows.filter(r => r.kind === "PAYMENT").map(r => r.evidence.source),["HOLDER_CASH",null]);
    assert.deepEqual((await auditSyntheticMixedPaymentReviews(tx,"1","9",10)).rows,[]);
    await assert.rejects(() => auditSyntheticMixedPaymentReviews(tx,"1","0",101), /invalid/);
    await assert.rejects(() => db.exec("UPDATE finance.expenses SET amount=0"),/read.only/i);
    await db.exec("ROLLBACK");
  } finally { await db.close(); }
});

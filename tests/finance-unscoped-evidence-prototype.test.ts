import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FinanceTransaction } from "../src/lib/finance/types";
import { auditSyntheticUnscopedEvidence as audit } from "../prototypes/finance-holder-checkpoint-audit/unscoped-evidence.test-only";

test("global unscoped synthetic evidence has independent cursors and never infers source or branch", async () => {
  const db = new PGlite();
  try {
    // Permissive synthetic tables deliberately allow absent foreign keys and branches.
    await db.exec(`CREATE SCHEMA finance;
      CREATE TABLE finance.expenses(id bigint primary key,branch_id bigint);
      CREATE TABLE finance.payments(id bigint primary key,expense_id bigint);
      CREATE TABLE finance.expense_reviews(id bigint primary key,expense_id bigint,status text,reason text,proposed_amount numeric,original_snapshot jsonb);
      CREATE TABLE finance.expense_corrections(id bigint primary key,expense_id bigint,payment_id bigint,review_id bigint,before_amount numeric,after_amount numeric,book_difference numeric,reason text);
      CREATE TABLE finance.movements(id bigint primary key,expense_correction_id bigint,branch_id bigint,kind text,source_id bigint,destination_id bigint,amount numeric,created_at timestamptz);
      INSERT INTO finance.expenses VALUES (1,10),(2,NULL),(3,20);
      INSERT INTO finance.payments VALUES (10,1),(11,2),(12,999);
      INSERT INTO finance.expense_reviews VALUES
        (1,999,'OPEN','missing',5,'{"payment":{"source":"HOLDER_CASH"}}'),
        (2,2,'OPEN','no branch',6,'{"payment":{}}'),
        (3,1,'OPEN','scoped',7,'{}'),(4,3,'OPEN','other branch',8,'{}');
      INSERT INTO finance.expense_corrections VALUES
        (1,999,12,1,10,9,NULL,'unscoped'),
        (2,2,11,2,10,8,2,'no branch'),
        (3,999,10,1,10,7,NULL,'payment scoped'),
        (4,999,12,4,10,6,NULL,'review scoped'),
        (5,3,11,1,10,5,NULL,'direct scoped');
      INSERT INTO finance.movements VALUES
        (1,1,99,'EXPENSE_CORRECTION',NULL,5,1,'2026-01-01Z'),
        (2,1,10,'EXPENSE_CORRECTION',5,NULL,2,'2026-01-02Z');`);
    const tx: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await db.query(sql, params)).rows as T[] }) };
    await assert.rejects(() => audit(tx,"reviews","0",1),/opt-in/);
    await assert.rejects(() => audit(tx,"corrections","-1",1),/invalid/);
    await assert.rejects(() => audit(tx,"reviews","0",101),/invalid/);
    await db.exec("BEGIN READ ONLY; SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
    const r1 = await audit(tx,"reviews","0",1);
    assert.equal(r1.nextAfterId,"1");
    assert.deepEqual([r1.rows[0].evidence.expenseId,r1.rows[0].evidence.existingExpenseId,r1.rows[0].evidence.snapshotSource],["999",null,"HOLDER_CASH"]);
    const r2 = await audit(tx,"reviews",r1.nextAfterId!,1);
    assert.equal(r2.nextAfterId,null);
    assert.deepEqual([r2.rows[0].id,r2.rows[0].evidence.existingExpenseId,r2.rows[0].evidence.branchId,r2.rows[0].evidence.snapshotHasSource],["2","2",null,false]);
    const c1 = await audit(tx,"corrections","0",1);
    assert.equal(c1.nextAfterId,"1");
    assert.deepEqual(c1.rows.map(r => r.kind),["CORRECTION","MOVEMENT","MOVEMENT"]);
    assert.deepEqual(c1.rows.slice(1).map(r => r.evidence.branchId),["99","10"]);
    const c2 = await audit(tx,"corrections",c1.nextAfterId!,10);
    assert.equal(c2.nextAfterId,null);
    assert.deepEqual(c2.rows.map(r => r.id),["2"]);
    assert.deepEqual([c2.rows[0].evidence.expenseId,c2.rows[0].evidence.paymentExpenseId,c2.rows[0].evidence.reviewExpenseId],["2","2","2"]);
    await assert.rejects(() => db.exec("UPDATE finance.expenses SET branch_id=1"),/read.only/i);
    await db.exec("ROLLBACK");
  } finally { await db.close(); }
});

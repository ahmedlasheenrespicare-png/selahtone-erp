/** Disposable data only; the queue never changes reviews or money. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listOpenExpenseReviewQueue } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("open expense review queue is manager-only, paged without duplication and does not write", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(read(f));
    await pg.exec(`INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
      SELECT CASE WHEN n%2=0 THEN 1 ELSE 2 END,1,'اختبار',10,'2026-01-01','EXP_'||n,'PAID',3,1,now() FROM generate_series(1,27) n;
      INSERT INTO finance.payments(expense_id,amount,method,source,account_id,payment_date,recorded_by,actually_paid)
      SELECT id,10,CASE WHEN id=1 THEN 'CASH' ELSE 'CARD' END,CASE WHEN id=1 THEN 'HOLDER_CASH' ELSE 'ACCOUNT' END,NULL,'2026-01-01',1,true
        FROM finance.expenses WHERE id<=26;
      INSERT INTO finance.expense_reviews(expense_id,expense_revision,proposed_amount,reason,original_snapshot,status,created_by)
      SELECT id,1,CASE WHEN id=27 THEN NULL ELSE 8 END,'REVIEW_'||id,'{}','OPEN',1 FROM finance.expenses;
      UPDATE finance.expenses SET revision=2 WHERE id=26;
      INSERT INTO finance.expense_reviews(expense_id,expense_revision,reason,original_snapshot,status,created_by,resolved_by,resolved_at,resolution_reason)
      VALUES(1,1,'CLOSED_CANARY','{}','CLOSED',1,2,now(),'closed');`);
    const db: FinanceDatabase = { serializable: work => pg.transaction(async tx => {
      await tx.exec("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query(sql, params)).rows as T[] }) };
      return work(port);
    }) };
    await assert.rejects(() => listOpenExpenseReviewQueue(db, "3", null), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await assert.rejects(() => listOpenExpenseReviewQueue(db, "1", "0 OR 1=1"), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    const first = await listOpenExpenseReviewQueue(db, "2", null);
    assert.equal(first.rows.length, 25); assert.equal(first.rows[0].reason, "REVIEW_27");
    assert.equal(first.rows[0].hasPayment, false); assert.equal(first.rows[0].proposedAmount, null);
    assert.notEqual(first.rows[1].expenseRevision, first.rows[1].reviewRevision);
    assert.equal(first.nextBefore, first.rows[24].id);
    const second = await listOpenExpenseReviewQueue(db, "1", first.nextBefore);
    assert.deepEqual(second.rows.map(row => row.reason), ["REVIEW_2", "REVIEW_1"]);
    assert.equal(second.rows[1].hasHolderCash, true); assert.equal(second.rows[0].hasHolderCash, false);
    assert.equal(second.nextBefore, null);
    assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 27);
    assert.ok([...first.rows, ...second.rows].every(row => row.reason !== "CLOSED_CANARY"));
    assert.equal((await listOpenExpenseReviewQueue(db, "1", "1")).rows.length, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.expense_corrections")).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
  } finally { await pg.close(); }
});

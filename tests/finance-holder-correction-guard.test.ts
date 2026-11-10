/** Disposable integration test of current correction restrictions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { approveExpense, confirmPaidExpenseCorrection, createExpense, openAccount, payExpense, requestPaidExpenseReview } from "../src/lib/finance/engine";
import { auditSyntheticUnmatchedReviews } from "../prototypes/finance-holder-checkpoint-audit/unmatched-reviews.test-only";
import { auditSyntheticHolderCorrections } from "../prototypes/finance-holder-checkpoint-audit/corrections.test-only";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("holder-cash review records source and refuses automatic correction, including legacy historical flags", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(read(f));
    const db: FinanceDatabase = { serializable: work => pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query(sql, params)).rows as T[] }) };
      return work(port);
    }) };
    const today = "2026-11-07";
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
    for (const historical of [false, true]) {
      const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: today, description: "مراجعة نقد حامل اصطناعية" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
      await payExpense(db, "3", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", source: "HOLDER_CASH", paymentDate: today, actuallyPaid: true }, today);
      // A synthetic legacy or externally-created historical flag was accepted
      // by the SQL constraints but cannot prove that the period was settled.
      if (historical) await pg.query("UPDATE finance.payments SET historical=true,included_in_opening=true WHERE expense_id=$1::bigint", [expense.id]);
      const request = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "3", reason: "تحقق اصطناعي", proposedAmount: "8" };
      const review = await requestPaidExpenseReview(db, "1", request);
      assert.equal((await requestPaidExpenseReview(db, "1", request)).replayed, true);
      const snapshot = (await pg.query<{ source: string; historical: boolean }>(`SELECT original_snapshot->'payment'->>'source' AS source, (original_snapshot->'payment'->>'historical')::boolean AS historical FROM finance.expense_reviews WHERE id=$1::bigint`, [review.id])).rows[0];
      assert.deepEqual(snapshot, { source: "HOLDER_CASH", historical });
      const before = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests, (SELECT count(*)::int FROM finance.audit_events) AS audit,
        (SELECT count(*)::int FROM finance.movements) AS movements, (SELECT count(*)::int FROM finance.expense_corrections) AS corrections,
        (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision`, [account.id])).rows[0];
      const correction = { requestId: randomUUID(), reviewId: review.id, confirmedAmount: "8", reason: "تصحيح اصطناعي", verifiedPayment: true, noPriorSettlement: true };
      await assert.rejects(() => confirmPaidExpenseCorrection(db, "2", correction), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_correction_review");
      const after = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests, (SELECT count(*)::int FROM finance.audit_events) AS audit,
        (SELECT count(*)::int FROM finance.movements) AS movements, (SELECT count(*)::int FROM finance.expense_corrections) AS corrections,
        (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision`, [account.id])).rows[0];
      assert.deepEqual(after, before);
      assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expense_reviews WHERE id=$1::bigint", [review.id])).rows[0].status, "OPEN");
    }
    // A normal noncash correction remains independently supported.
    const card = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: today, description: "بطاقة اصطناعية" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: card.id, expectedRevision: "1" });
    await payExpense(db, "1", { requestId: randomUUID(), expenseId: card.id, expectedRevision: "2", method: "CARD", source: "ACCOUNT", paymentDate: today, actuallyPaid: true }, today);
    const cardReview = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId: card.id, expectedRevision: "3", reason: "مراجعة بطاقة", proposedAmount: "8" });
    const correction = { requestId: randomUUID(), reviewId: cardReview.id, confirmedAmount: "8", reason: "تصحيح بطاقة", verifiedPayment: true, noPriorSettlement: true };
    assert.equal((await confirmPaidExpenseCorrection(db, "2", correction)).replayed, false);
    assert.equal((await confirmPaidExpenseCorrection(db, "2", correction)).replayed, true);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.expense_corrections")).rows[0].n, 1);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    await pg.transaction(async (tx) => {
      await tx.exec("SET TRANSACTION READ ONLY; SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query(sql, params)).rows as T[] }) };
      const inventory = await auditSyntheticHolderCorrections(port, "1", "0", 10);
      assert.deepEqual(inventory.rows.map(row => row.kind), ["PAYMENT", "REVIEW", "PAYMENT", "REVIEW"]);
      const reviewEvidence = inventory.rows.filter(row => row.kind === "REVIEW");
      assert.ok(reviewEvidence.every(row => row.evidence.snapshotSource === "HOLDER_CASH" && row.evidence.status === "OPEN"));
      assert.deepEqual(inventory.rows.filter(row => row.kind === "PAYMENT").map(row => row.evidence.historical), [false, true]);
      const unmatched = await auditSyntheticUnmatchedReviews(port, "1", "0", 10);
      assert.deepEqual([...new Set(unmatched.rows.map(row => row.expenseId))], [card.id]);
      assert.deepEqual(unmatched.rows.map(row => row.kind), ["CORRECTION", "EXPENSE", "PAYMENT", "REVIEW"]);
      assert.equal(unmatched.rows.find(row => row.kind === "PAYMENT")?.evidence.method, "CARD");
      assert.equal(unmatched.rows.find(row => row.kind === "REVIEW")?.evidence.status, "CORRECTED");
      assert.equal(unmatched.rows.find(row => row.kind === "CORRECTION")?.evidence.bookDifference, null);

    });
  } finally { await pg.close(); }
});

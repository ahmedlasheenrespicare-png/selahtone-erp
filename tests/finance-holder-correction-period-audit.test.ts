/** Synthetic diagnostic only; never changes or connects to actual finance data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { auditSyntheticHolderCorrections } from "../prototypes/finance-holder-checkpoint-audit/corrections.test-only";
import { approveExpense, cancelCashCount, cancelSettlement, closeAccount, closePaidExpenseReview, confirmCashCount, confirmSettlement, createExpense, listExpenses, openAccount, payExpense, requestCashCount, requestCountFromHolder, requestPaidExpenseReview, requestSettlement, settlementOverview, submitHolderCount } from "../src/lib/finance/engine";
import { expenseReviewSnapshot } from "../src/lib/finance/expense-review-snapshot";
import { CUSTODY_EXPECTATION_SQL } from "../src/lib/finance/custody-summary-sql";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("a synthetic legacy holder-cash correction does not change the period calculation", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  try {
    for (const file of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(file));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(read(file));
    const db: FinanceDatabase = { serializable: work => pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query(sql, params)).rows as T[] }) };
      return work(port);
    }) };
    const today = "2026-11-07";
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: today, description: "تصحيح نقد اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    await payExpense(db, "3", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", source: "HOLDER_CASH", paymentDate: today, actuallyPaid: true }, today);
    const review = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "3", reason: "طلب اصطناعي", proposedAmount: "6" });
    await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    await pg.exec(`INSERT INTO public.users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES
      (20,1,'CS_AGENT','موظف اصطناعي','guard20@test.local','x','ACTIVE',false),
      (21,1,'CS_AGENT','موظف اصطناعي','guard21@test.local','x','ACTIVE',false),
      (22,2,'CS_AGENT','موظف آخر','guard22@test.local','x','ACTIVE',false)`);
    const makeCustody = (holderId: string, branchId = "1") => openAccount(db, "1", { requestId: randomUUID(), branchId, kind: "CUSTODY", holderId, openingAmount: "0", openingDate: "2026-10-20", counted: true }, today);
    const countAccount = await makeCustody("20");
    const directedAccount = await makeCustody("21");
    const otherBranch = await makeCustody("22", "2");
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id IN ($1::bigint,$2::bigint,$3::bigint)", [countAccount.id,directedAccount.id,otherBranch.id]);
    const settlementInput = { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "94", reason: "جرد افتراضي اصطناعي", actuallyCounted: true };
    const settlement = await requestSettlement(db, "3", settlementInput);
    const count = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: countAccount.id, expectedBalance: "0", countedAmount: "0", reason: "جرد اصطناعي", actuallyCounted: true }, today);
    const directed = await requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: directedAccount.id, reason: "جرد موجّه" });
    // These are deliberately fabricated legacy rows. Current service forbids
    // confirmation of HOLDER_CASH corrections; no claim is made about actual
    // ordering, correctness, custody allocation or physical cash.
    await pg.query(`UPDATE finance.expense_reviews SET status='CORRECTED',resolved_by=2,resolved_at=now(),resolution_reason='تصحيح اصطناعي' WHERE id=$1::bigint`, [review.id]);
    await pg.query(`INSERT INTO finance.expense_corrections (expense_id,payment_id,review_id,before_amount,after_amount,reason,created_by)
      SELECT p.expense_id,p.id,$2::bigint,10,6,'سجل قديم اصطناعي',2 FROM finance.payments p WHERE p.expense_id=$1::bigint`, [expense.id,review.id]);
    // Closing a later no-change review does not remove or settle the earlier
    // correction evidence or its branch-period guard.
    const laterReview = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "3", reason: "مراجعة لاحقة اصطناعية" });
    const snapshotReview = (await pg.query<{ id:string; expenseId:string; expenseRevision:number; status:string; reason:string; proposedAmount:string|null; createdBy:string; createdAt:string }>(`SELECT id::text AS id,expense_id::text AS "expenseId",expense_revision AS "expenseRevision",status,reason,proposed_amount::text AS "proposedAmount",created_by::text AS "createdBy",created_at::text AS "createdAt" FROM finance.expense_reviews WHERE id=$1::bigint`,[laterReview.id])).rows[0];
    await closePaidExpenseReview(db, "2", { requestId: randomUUID(), reviewId: laterReview.id, reason: "لا تصحيح إضافي", reviewedNoChange: true, expectedRevision: "3", expectedReviewSnapshot: expenseReviewSnapshot(snapshotReview) });
    assert.equal((await settlementOverview(db, "3", account.id)).holderCorrectionInPeriod, true);
    const listed = (await listExpenses(db, "1")).find(row => row.id === expense.id);
    assert.equal(listed?.originalAmount, "10.00"); assert.equal(listed?.amount, "6.00"); assert.equal(listed?.paymentAmount, "10.00");
    const overview = await settlementOverview(db, "3", account.id);
    assert.equal(overview.expenses, "10.00"); assert.equal(overview.expected, "90.00");
    assert.equal(overview.holderCorrectionInPeriod, true);
    assert.equal((await settlementOverview(db, "20", countAccount.id)).holderCorrectionInPeriod, true, "another holder in the same branch is conservatively blocked");
    assert.equal((await settlementOverview(db, "22", otherBranch.id)).holderCorrectionInPeriod, false, "another branch is not blocked");
    const sql = (await pg.query<{ id: string; period_expenses: string; holder_correction_in_period: boolean }>(CUSTODY_EXPECTATION_SQL, ["1"])).rows.find(row => String(row.id) === account.id);
    assert.equal(sql?.period_expenses, "10.00"); assert.equal(sql?.holder_correction_in_period, true);
    const inventory = await db.serializable(async tx => {
      await tx.query("SET TRANSACTION READ ONLY"); await tx.query("SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
      return auditSyntheticHolderCorrections(tx, "1", "0", 10);
    });
    const correction = inventory.rows.find(row => row.kind === "CORRECTION" && row.expenseId === expense.id);
    assert.equal(correction?.evidence.beforeAmount, "10.00"); assert.equal(correction?.evidence.afterAmount, "6.00");
    assert.equal(correction?.evidence.bookDifference, null);
    assert.ok(!inventory.rows.some(row => row.kind === "MOVEMENT"));
    // The request was made before the synthetic correction. No affected write
    // may proceed now; replay remains side-effect-free and cancellation works.
    assert.equal((await requestSettlement(db, "3", settlementInput)).replayed, true);
    const snapshot = async () => (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit,(SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT count(*)::int FROM finance.cash_counts) AS counts,(SELECT count(*)::int FROM finance.settlements) AS settlements,
      (SELECT jsonb_agg(jsonb_build_array(id::text,revision::text,closed_at::text) ORDER BY id) FROM finance.accounts) AS accounts,
      (SELECT jsonb_agg(jsonb_build_array(id::text,status) ORDER BY id) FROM finance.cash_counts) AS count_status,
      (SELECT jsonb_agg(jsonb_build_array(id::text,status) ORDER BY id) FROM finance.settlements) AS settlement_status`)).rows[0];
    const before = await snapshot();
    const blocked = (error: unknown) => error instanceof FinanceProblem && error.code === "holder_cash_correction_period";
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: settlement.id, expectedBalance: "100", transferAmount: "6", transferDirection: "TO_CUSTODY", reason: "اختبار", actuallyTransferred: true }), blocked);
    await assert.rejects(() => confirmCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "اختبار", stillCurrent: true }), blocked);
    await assert.rejects(() => submitHolderCount(db, "21", { requestId: randomUUID(), countId: directed.id, countedAmount: "0", actuallyCounted: true }), blocked);
    await assert.rejects(() => requestCashCount(db, "1", { requestId: randomUUID(), accountId: account.id, expectedBalance: "90", countedAmount: "94", reason: "اختبار", actuallyCounted: true }, today), blocked);
    await assert.rejects(() => requestSettlement(db, "20", { ...settlementInput, requestId: randomUUID(), accountId: countAccount.id, expectedBalance: "0", countedAmount: "0" }), blocked);
    assert.deepEqual(await snapshot(), before);
    const otherOverview = await settlementOverview(db, "22", otherBranch.id);
    const otherCount = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: otherBranch.id, expectedBalance: otherOverview.expected, countedAmount: "0", reason: "فرع آخر اصطناعي", actuallyCounted: true }, today);
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: otherCount.id, reason: "إلغاء اصطناعي" });
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء اصطناعي" });
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: directed.id, reason: "إلغاء اصطناعي" });
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: settlement.id, reason: "إلغاء اصطناعي" });
    await assert.rejects(() => closeAccount(db, "1", { requestId: randomUUID(), accountId: countAccount.id, reason: "إقفال اصطناعي" }), blocked);
    await assert.rejects(() => requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: countAccount.id, reason: "طلب اصطناعي" }), blocked);
    // Contradictory links are examined by any of the three independently;
    // these synthetic edits do not prescribe a repair for real records.
    const card = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "4", expenseDate: today, description: "مصروف آخر اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: card.id, expectedRevision: "1" });
    await payExpense(db, "1", { requestId: randomUUID(), expenseId: card.id, expectedRevision: "2", method: "CARD", source: "ACCOUNT", paymentDate: today, actuallyPaid: true }, today);
    const cardReview = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId: card.id, expectedRevision: "3", reason: "مراجعة اصطناعية أخرى" });
    const ids = (await pg.query<{ holder: string; card: string }>(`SELECT
      (SELECT id::text FROM finance.payments WHERE expense_id=$1::bigint) AS holder,
      (SELECT id::text FROM finance.payments WHERE expense_id=$2::bigint) AS card`, [expense.id,card.id])).rows[0];
    const updateLinks = async (expenseId: string, paymentId: string, reviewId: string) => {
      await pg.query(`UPDATE finance.expense_corrections SET expense_id=$1::bigint,payment_id=$2::bigint,review_id=$3::bigint WHERE reason='سجل قديم اصطناعي'`, [expenseId,paymentId,reviewId]);
      assert.equal((await settlementOverview(db, "3", account.id)).holderCorrectionInPeriod, true);
      assert.equal((await pg.query<{ flag: boolean }>(`SELECT holder_correction_in_period AS flag FROM (${CUSTODY_EXPECTATION_SQL}) x WHERE x.id=$2::bigint`, ["1",account.id])).rows[0].flag, true);
    };
    await updateLinks(card.id, ids.card, review.id); // review expense only
    await updateLinks(expense.id, ids.card, cardReview.id); // correction expense only
    await updateLinks(card.id, ids.holder, cardReview.id); // payment only
    await updateLinks(expense.id, ids.holder, review.id);
    // Equality is included even though strict period amounts exclude it.
    await pg.query("UPDATE finance.payments SET recorded_at=(SELECT opened_at FROM finance.accounts WHERE id=$1::bigint) WHERE expense_id=$2::bigint", [account.id, expense.id]);
    assert.equal((await settlementOverview(db, "3", account.id)).holderCorrectionInPeriod, true);
    await assert.rejects(() => requestSettlement(db, "3", { ...settlementInput, requestId: randomUUID() }), blocked);
    // This policy intentionally does not block a payment recorded before the
    // current reference; it does not prove that its correction is settled.
    await pg.query("UPDATE finance.payments SET recorded_at=(SELECT opened_at - interval '1 second' FROM finance.accounts WHERE id=$1::bigint) WHERE expense_id=$2::bigint", [account.id, expense.id]);
    assert.equal((await settlementOverview(db, "3", account.id)).holderCorrectionInPeriod, false);
    assert.equal((await settlementOverview(db, "20", countAccount.id)).holderCorrectionInPeriod, false);
    assert.equal((await closeAccount(db, "1", { requestId: randomUUID(), accountId: countAccount.id, reason: "إقفال اصطناعي" })).replayed, false);
  } finally { await pg.close(); }
});

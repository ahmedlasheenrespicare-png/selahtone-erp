/** Regression guard for an ambiguity demonstrated on a disposable database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { approveExpense, confirmCashCount, createExpense, openAccount, payExpense, requestCashCount, settlementOverview } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("holder-cash new recording after a confirmed count is blocked without side effects", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  const sql = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  try {
    for (const file of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(sql(file));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(sql(file));
    const db: FinanceDatabase = { serializable: work => pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(query: string, params: unknown[] = []) => ({ rows: (await tx.query(query, params)).rows as T[] }) };
      return work(port);
    }) };
    const today = "2026-11-07";
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "100", openingDate: "2026-10-20", counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: today, description: "دفع اصطناعي وتوقيت غير مثبت" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const count = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "90", reason: "جرد اصطناعي", actuallyCounted: true }, today);
    await confirmCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "اعتماد اصطناعي", stillCurrent: true });
    const afterCount = await settlementOverview(db, "3", account.id);
    assert.equal(afterCount.account?.balance, "90.00");
    assert.equal(afterCount.expected, "90.00");
    const raw = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    const before = (await pg.query(`SELECT a.revision::text AS revision,
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit FROM finance.accounts a WHERE a.id=$1::bigint`, [account.id])).rows[0];
    await assert.rejects(() => payExpense(db, "3", raw, today), (error: unknown) => error instanceof FinanceProblem && error.code === "holder_cash_after_count");
    const after = (await pg.query(`SELECT a.revision::text AS revision,
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit FROM finance.accounts a WHERE a.id=$1::bigint`, [account.id])).rows[0];
    assert.deepEqual(after, before);
    const overview = await settlementOverview(db, "3", account.id);
    assert.equal(overview.account?.balance, "90.00");
    assert.equal(overview.expenses, "0.00");
    assert.equal(overview.expected, "90.00");
    const evidence = await pg.query<{ kind: string; amount: string }>("SELECT kind,amount::text AS amount FROM finance.movements ORDER BY id");
    assert.deepEqual(evidence.rows, [{ kind: "COUNT_ADJUSTMENT", amount: "10.00" }]);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expenses WHERE id=$1::bigint", [expense.id])).rows[0].status, "APPROVED");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.payments")).rows[0].n, 0);
  } finally { await pg.close(); }
});

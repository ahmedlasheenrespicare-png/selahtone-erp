/** Characterizes known unsafe behavior, NOT a release-readiness test. Disposable PGlite only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { cancelCashCount, cancelSettlement, closeAccount, confirmCashCount, confirmSettlement, listAccounts, listSettlements, openAccount, payExpense, postCashCollectionInTransaction, postCashRefundInTransaction, requestCashCount, requestCountFromHolder, requestSettlement, submitHolderCount, settlementOverview, transferCash } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("closed custody guards transfers, settlements and counts; known closure defects remain", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  const sql = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  try {
    await pg.exec(sql("tests/fixtures/inventory-baseline.sql"));
    await pg.exec(sql("tests/fixtures/finance-legacy-categories.sql"));
    await pg.exec(sql("tests/fixtures/commerce-collections.sql"));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint");
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(sql(file));
    const db: FinanceDatabase = { serializable: (work) => pg.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(query: string, params: unknown[] = []) => ({ rows: (await tx.query(query, params)).rows as T[] }) };
      return work(port);
    }) };
    const open = (kind: "VAULT" | "CUSTODY", holderId: string | null, amount: string) => openAccount(db, "1", {
      requestId: randomUUID(), branchId: "1", kind, holderId, openingAmount: amount, openingDate: "2026-10-20", counted: true,
    }, "2026-11-07");
    const vault = (await open("VAULT", null, "100")).id;
    const custody = (await open("CUSTODY", "3", "0")).id;
    assert.equal((await settlementOverview(db, "3")).account?.id, custody);
    await pg.exec("UPDATE public.users SET branch_id=2 WHERE id=3");
    assert.equal((await settlementOverview(db, "3")).account, null, "staff cannot read an old branch custody after transfer");
    assert.equal((await settlementOverview(db, "3", custody)).account, null);
    assert.equal((await settlementOverview(db, "1", custody)).account?.id, custody);
    await pg.exec("UPDATE public.users SET branch_id=1 WHERE id=3");
    const pendingInput = { requestId: randomUUID(), accountId: custody, countedAmount: "10", expectedBalance: "0", reason: "اختبار عهدة", actuallyCounted: true };
    const pending = await requestSettlement(db, "3", pendingInput);
    const count = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: custody, expectedBalance: "0", countedAmount: "10", reason: "اختبار جرد", actuallyCounted: true }, "2026-11-07");
    const closeInput = { requestId: randomUUID(), accountId: custody, reason: "اختبار اصطناعي" };
    await assert.rejects(() => closeAccount(db, "1", closeInput), (error: unknown) => error instanceof FinanceProblem && error.code === "account_pending");
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: pending.id, reason: "إلغاء قبل الإقفال" });
    await assert.rejects(() => closeAccount(db, "1", closeInput), (error: unknown) => error instanceof FinanceProblem && error.code === "account_pending");
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء قبل الإقفال" });
    await closeAccount(db, "1", closeInput);
    assert.equal((await closeAccount(db, "1", closeInput)).replayed, true);
    // Simulate legacy pending records from before these closure checks existed.
    const legacySettlement = (await pg.query<{ id: number }>(`INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES ($1::bigint,1,3,0,10,0,0,0,10,10,'طلب قديم') RETURNING id`, [custody])).rows[0].id.toString();
    const legacyCount = (await pg.query<{ id: number }>(`INSERT INTO finance.cash_counts (account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by)
      VALUES ($1::bigint,10,0,10,0,CURRENT_DATE,'جرد قديم',1) RETURNING id`, [custody])).rows[0].id.toString();
    assert.ok((await listAccounts(db, "1")).find((row) => row.id === custody)?.closedAt);
    // Both directions must reject before inserting a movement, even with a valid actor.
    for (const [fromId, toId, expectedBalance] of [[vault, custody, "100"], [custody, vault, "0"]]) {
      await assert.rejects(() => transferCash(db, "1", { requestId: randomUUID(), fromId, toId, amount: "10", expectedBalance, actuallyTransferred: true, negativeAcknowledged: true }),
        (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    }
    const row = (await listAccounts(db, "1")).find((item) => item.id === custody);
    assert.equal(row?.balance, "0.00"); assert.ok(row?.closedAt);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    assert.equal((await settlementOverview(db, "3")).account, null);
    assert.equal((await settlementOverview(db, "1", custody)).account, null);
    // A request created before closure cannot post a financial adjustment afterwards,
    // but it remains available for non-financial cancellation and in the history.
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: legacySettlement, expectedBalance: "0", transferAmount: "10", transferDirection: "TO_VAULT", reason: "اعتماد", actuallyTransferred: true }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    assert.equal((await listSettlements(db, "3"))[0]?.status, "OPEN");
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: legacySettlement, reason: "إلغاء بعد الإقفال" });
    assert.equal((await listSettlements(db, "3"))[0]?.status, "CANCELLED");
    await assert.rejects(() => requestSettlement(db, "3", { ...pendingInput, requestId: randomUUID() }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    // Idempotent retry returns the prior request, without creating another one.
    assert.equal((await requestSettlement(db, "3", pendingInput)).replayed, true);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.settlements")).rows[0].n, 2);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    // Money-bearing account operations reject the closed account, without side effects.
    await assert.rejects(() => db.serializable((tx) => postCashRefundInTransaction(tx, "1", { branchId: "1", accountId: custody, amount: "10", refundId: "998", expectedBalance: "0", negativeAcknowledged: true })),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    await assert.rejects(() => db.serializable((tx) => postCashCollectionInTransaction(tx, "3", { branchId: "1", accountId: custody, amount: "10", collectionId: "998" })),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    const approved = await pg.query<{ id: number }>(`INSERT INTO finance.expenses (branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
      VALUES (1,1,'اختبار',10,'2026-10-21','مصروف للتجربة','APPROVED',3,1,CURRENT_TIMESTAMP) RETURNING id`);
    await assert.rejects(() => payExpense(db, "1", { requestId: randomUUID(), expenseId: String(approved.rows[0].id), expectedRevision: "1", method: "CASH", accountId: custody, paymentDate: "2026-10-21", actuallyPaid: true, expectedBalance: "0", negativeAcknowledged: true, source: "ACCOUNT" }, "2026-11-07"),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expenses WHERE id=$1", [approved.rows[0].id])).rows[0].status, "APPROVED");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.payments")).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    // The existing explicit pre-opening historical annotation remains possible
    // without a new cash movement; it is not a general correction policy.
    await payExpense(db, "1", { requestId: randomUUID(), expenseId: String(approved.rows[0].id), expectedRevision: "1", method: "CASH", accountId: custody, paymentDate: "2026-10-20", actuallyPaid: true, openingOrder: "BEFORE", includedInOpening: true, source: "ACCOUNT" }, "2026-11-07");
    assert.equal((await pg.query<{ historical: boolean }>("SELECT historical FROM finance.payments WHERE expense_id=$1", [approved.rows[0].id])).rows[0].historical, true);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    // Known defect: the permanent index prevents a new custody for the same holder and branch.
    await assert.rejects(() => open("CUSTODY", "3", "0"), (error: unknown) => error instanceof FinanceProblem && error.code === "duplicate");
    // A previously open count cannot create a balance adjustment after closure.
    await assert.rejects(() => confirmCashCount(db, "2", { requestId: randomUUID(), countId: legacyCount, reason: "اختبار اعتماد", stillCurrent: true }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: legacyCount, reason: "إلغاء بعد الإقفال" });
    await assert.rejects(() => requestCashCount(db, "1", { requestId: randomUUID(), accountId: custody, expectedBalance: "0", countedAmount: "10", reason: "جرد مقفل", actuallyCounted: true }, "2026-11-07"),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    await assert.rejects(() => requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: custody, reason: "جرد مقفل" }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    // Model a legacy directed count that was already open when the account closed.
    const legacy = await pg.query<{ id: number }>(`INSERT INTO finance.cash_counts (account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,requested_by,request_reason)
      VALUES ($1::bigint,0,0,0,0,CURRENT_DATE,'جرد قديم',1,1,'جرد قديم') RETURNING id`, [custody]);
    await assert.rejects(() => submitHolderCount(db, "3", { requestId: randomUUID(), countId: String(legacy.rows[0].id), countedAmount: "10", actuallyCounted: true }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: String(legacy.rows[0].id), reason: "إلغاء جرد قديم" });
    assert.equal((await listAccounts(db, "1")).find((item) => item.id === custody)?.balance, "0.00");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    // Zero book balance alone does not establish a cleared period.
    await pg.exec(`INSERT INTO public.users(branch_id,role_code,full_name,email,password_hash,status,must_change_password)
      VALUES (1,'CS_AGENT','موظف آخر','other@example.test','fixture','ACTIVE',false)`);
    const otherCustody = (await open("CUSTODY", "5", "0")).id;
    await pg.query("UPDATE finance.accounts SET opened_at=CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id=$1::bigint", [otherCustody]);
    const sale = await pg.query<{ id: number }>("INSERT INTO public.commerce_sales(branch_id,created_by_id) VALUES (1,5) RETURNING id");
    await pg.query("INSERT INTO public.commerce_collections(sale_id,amount,method) VALUES ($1::bigint,100,'CASH')", [sale.rows[0].id]);
    assert.equal((await settlementOverview(db, "5")).expected, "100.00");
    const otherClose = { requestId: randomUUID(), accountId: otherCustody, reason: "اختبار إقفال" };
    await assert.rejects(() => closeAccount(db, "1", otherClose), (error: unknown) => error instanceof FinanceProblem && error.code === "account_unsettled");
    assert.equal((await settlementOverview(db, "5")).expected, "100.00");
    const expense = await pg.query<{ id: number }>(`INSERT INTO finance.expenses (branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
      VALUES (1,1,'اختبار',100,CURRENT_DATE,'مصروف اصطناعي','PAID',5,1,CURRENT_TIMESTAMP) RETURNING id`);
    await pg.query(`INSERT INTO finance.payments (expense_id,amount,method,payment_date,recorded_by,actually_paid,source)
      VALUES ($1::bigint,100,'CASH',CURRENT_DATE,5,true,'HOLDER_CASH')`, [expense.rows[0].id]);
    assert.equal((await settlementOverview(db, "5")).expected, "0.00", "equal unsettled sales and expenses produce a zero net");
    await assert.rejects(() => closeAccount(db, "1", otherClose), (error: unknown) => error instanceof FinanceProblem && error.code === "account_unsettled");
    const cleared = await requestSettlement(db, "5", { requestId: randomUUID(), accountId: otherCustody, countedAmount: "0", expectedBalance: "0", reason: "تسوية الفترة", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: cleared.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "تسوية صافي صفر", actuallyTransferred: true });
    await closeAccount(db, "1", otherClose);
    assert.equal((await settlementOverview(db, "5")).account, null);
    // A later collection for an earlier sale can still be recorded without an
    // account hook; this fixture models the resulting row, not the HTTP path.
    await pg.query("INSERT INTO public.commerce_collections(sale_id,amount,method) VALUES ($1::bigint,25,'CASH')", [sale.rows[0].id]);
    assert.equal((await settlementOverview(db, "5")).account, null);
  } finally { await pg.close(); }
});

/** Synthetic candidate only: tests item membership, not real settlement posting. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { allocateTestCollection, pendingTestCollections } from "../prototypes/finance-collection-policy/allocate.test-only";
import { allocateTestHolderPayment, captureRevisionCheckedTestPeriod, captureTestPeriod, reviewTestPeriod } from "../prototypes/finance-collection-policy/period.test-only";
import { approveExpense, createExpense, openAccount, payExpense } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

const sql = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const id = () => randomUUID();
test("synthetic period captures exact collection and holder-payment IDs, independent of timestamps", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(sql(f));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; ALTER TABLE public.commerce_collections ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(sql(f));
    await pg.exec("SET selahtone.collection_policy_test_only='yes'"); await pg.exec(sql("prototypes/finance-collection-policy/allocations.test-only.sql"));
    const db: FinanceDatabase = { serializable: work => pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(q: string, p: unknown[] = []) => ({ rows: (await tx.query(q, p)).rows as T[] }) };
      return work(port);
    }) };
    const today = "2026-11-07";
    const custody = await openAccount(db, "1", { requestId: id(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: "2026-10-20", counted: true }, today);
    const sale = (await pg.query<{ id: string }>("INSERT INTO public.commerce_sales(branch_id,created_by_id) VALUES(1,3) RETURNING id::text")).rows[0].id;
    const collection = async (amount: string, time?: string) => db.serializable(async tx => {
      const row = await tx.query<{ id: string }>("INSERT INTO public.commerce_collections(sale_id,amount,method,created_by_id,created_at) VALUES($1::bigint,$2::numeric,'CASH',3,COALESCE($3::timestamptz,CURRENT_TIMESTAMP)) RETURNING id::text", [sale,amount,time ?? null]);
      const assigned = await allocateTestCollection(tx, "3", row.rows[0].id);
      assert.equal(assigned.accountId, custody.id);
      return row.rows[0].id;
    });
    const payment = async (amount: string) => {
      const expense = await createExpense(db, "3", { requestId: id(), branchId: "1", categoryId: "1", amount, expenseDate: today, description: "مصروف اصطناعي" });
      await approveExpense(db, "1", { requestId: id(), expenseId: expense.id, expectedRevision: "1" });
      const result = await payExpense(db, "3", { requestId: id(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" }, today);
      const assigned = await db.serializable(tx => allocateTestHolderPayment(tx, "3", result.id));
      assert.equal(assigned.accountId, custody.id);
      assert.equal((await db.serializable(tx => allocateTestHolderPayment(tx, "3", result.id))).replayed, true);
      await assert.rejects(() => db.serializable(tx => allocateTestHolderPayment(tx, "1", result.id)), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_payment");
      return result.id;
    };
    const rollbackExpense = await createExpense(db, "3", { requestId: id(), branchId: "1", categoryId: "1", amount: "2", expenseDate: today, description: "مصروف تراجع اصطناعي" });
    await approveExpense(db, "1", { requestId: id(), expenseId: rollbackExpense.id, expectedRevision: "1" });
    await assert.rejects(() => db.serializable(async tx => {
      const joined: FinanceDatabase = { serializable: work => work(tx) };
      const paid = await payExpense(joined, "3", { requestId: id(), expenseId: rollbackExpense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" }, today);
      await allocateTestHolderPayment(tx, "3", paid.id);
      throw new Error("payment allocation rollback");
    }), /payment allocation rollback/);
    const rolled = await pg.query<{ status: string; payments: number; assignments: number }>(`SELECT status,(SELECT count(*)::int FROM finance.payments WHERE expense_id=$1::bigint) AS payments,(SELECT count(*)::int FROM finance.holder_payment_allocations_test_only) AS assignments FROM finance.expenses WHERE id=$1::bigint`, [rollbackExpense.id]);
    assert.deepEqual(rolled.rows[0], { status: "APPROVED", payments: 0, assignments: 0 });
    const c1 = await collection("10"), c2 = await collection("5"), p1 = await payment("4"), p2 = await payment("6");
    const newSettlement = async (sales: string, expenses: string) => (await pg.query<{ id: string }>(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES($1::bigint,1,3,0,0,$2::numeric,$3::numeric,$2::numeric-$3::numeric,0,0,'اختبار معرّفات') RETURNING id::text`, [custody.id,sales,expenses])).rows[0].id;
    const settlement = await newSettlement("15", "10");
    const reviewed = await db.serializable(tx => reviewTestPeriod(tx, custody.id));
    const capture = (cs: string[], ps: string[], actor = "1", abort = false) => db.serializable(async tx => {
      const result = await captureTestPeriod(tx, custody.id, settlement, actor, cs, ps, reviewed.hash);
      if (abort) throw new Error("synthetic rollback");
      return result;
    });
    await assert.rejects(() => capture([c1,c1], [p1,p2]), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_review");
    await assert.rejects(() => capture([c1], [p1,p2]), (e: unknown) => e instanceof FinanceProblem && e.code === "period_stale");
    await assert.rejects(() => capture([c1,c2], [p1,p2], "3"), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await assert.rejects(() => capture([c1,c2], [p1,p2], "2"), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await pg.query("UPDATE finance.settlements SET account_revision=(SELECT revision FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint", [custody.id, settlement]);
    const guardedCapture = (actor = "1") => db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,settlement,actor,[c1,c2],[p1,p2],reviewed.hash));
    await pg.query("UPDATE public.commerce_collections SET amount=11 WHERE id=$1::bigint", [c1]);
    await pg.query("UPDATE public.commerce_collections SET amount=4 WHERE id=$1::bigint", [c2]);
    await assert.rejects(() => capture([c1,c2], [p1,p2]), (e: unknown) => e instanceof FinanceProblem && e.code === "period_stale");
    await assert.rejects(guardedCapture, (e: unknown) => e instanceof FinanceProblem && e.code === "period_stale", "matching account revision does not bypass changed item amounts even when totals match");
    await pg.query("UPDATE public.commerce_collections SET amount=10 WHERE id=$1::bigint", [c1]);
    await pg.query("UPDATE public.commerce_collections SET amount=5 WHERE id=$1::bigint", [c2]);
    await pg.query("UPDATE finance.settlements SET sales_total=16 WHERE id=$1::bigint", [settlement]);
    await assert.rejects(() => capture([c1,c2], [p1,p2]), (e: unknown) => e instanceof FinanceProblem && e.code === "total_mismatch");
    await pg.query("UPDATE finance.settlements SET sales_total=15 WHERE id=$1::bigint", [settlement]);
    await assert.rejects(() => capture([c1,c2], [p1,p2], "1", true), /synthetic rollback/);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [settlement])).rows[0].status, "OPEN");
    assert.equal(await db.serializable(tx => pendingTestCollections(tx, custody.id)), "15.00");
    assert.equal((await capture([c2,c1], [p2,p1])).replayed, false);
    assert.equal((await capture([c1,c2], [p1,p2])).replayed, true);
    await assert.rejects(() => capture([c1], [p1,p2]), (e: unknown) => e instanceof FinanceProblem && e.code === "settlement_conflict");
    assert.equal(await db.serializable(tx => pendingTestCollections(tx, custody.id)), "0.00");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0, "capture is not real settlement posting");
    const resolved = (await pg.query<{ at: string }>("SELECT resolved_at::text AS at FROM finance.settlements WHERE id=$1::bigint", [settlement])).rows[0].at;
    const c3 = await collection("7", resolved);
    assert.equal(await db.serializable(tx => pendingTestCollections(tx, custody.id)), "7.00", "new ID remains pending even at the old settlement timestamp");
    assert.equal((await capture([c1,c2], [p1,p2])).replayed, true, "replay does not consume later IDs");
    const second = await newSettlement("7", "0");
    const laterReview = await db.serializable(tx => reviewTestPeriod(tx, custody.id));
    assert.equal((await db.serializable(tx => captureTestPeriod(tx,custody.id,second,"1",[c3],[],laterReview.hash))).replayed, false);
    const empty = await newSettlement("0", "0");
    const emptyReview = await db.serializable(tx => reviewTestPeriod(tx, custody.id));
    assert.equal((await db.serializable(tx => captureTestPeriod(tx,custody.id,empty,"1",[],[],emptyReview.hash))).replayed, false);
    assert.equal((await db.serializable(tx => captureTestPeriod(tx,custody.id,empty,"1",[],[],emptyReview.hash))).replayed, true, "an empty receipt is unambiguous on replay");
    const versioned = await newSettlement("0", "0");
    const versionedReview = await db.serializable(tx => reviewTestPeriod(tx, custody.id));
    await assert.rejects(() => db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"1",[],[],versionedReview.hash)), (e: unknown) => e instanceof FinanceProblem && e.code === "experimental_revision_stale", "missing revision is not a fresh review");
    await assert.rejects(() => db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"3",[],[],versionedReview.hash)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden", "unauthorized requester does not reach freshness check");
    await pg.query("UPDATE finance.settlements SET account_revision=(SELECT revision FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint", [custody.id, versioned]);
    assert.equal((await db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"1",[],[],versionedReview.hash))).replayed, false);
    await pg.query("UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint", [custody.id]);
    assert.equal((await db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"1",[],[],versionedReview.hash))).replayed, true, "stored replay survives later revision changes");
    await assert.rejects(() => db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"3",[],[],versionedReview.hash)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden", "replay still requires an authorized non-requester");
    await assert.rejects(() => db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"2",[],[],versionedReview.hash)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden", "replay does not grant another branch permission");
    await assert.rejects(() => db.serializable(tx => captureRevisionCheckedTestPeriod(tx,custody.id,versioned,"1",[],[],"0".repeat(64))), (e: unknown) => e instanceof FinanceProblem && e.code === "settlement_conflict");
    // A non-cooperating writer can change ledger state without bumping the
    // revision. The lab guard does not claim to detect it; roll back the entire
    // deliberately malformed probe, including its tentative capture.
    const uncoordinated = await newSettlement("0", "0");
    await pg.query("UPDATE finance.settlements SET account_revision=(SELECT revision FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint", [custody.id, uncoordinated]);
    let bypassProbeReached = false;
    await assert.rejects(() => db.serializable(async tx => {
      await tx.query("INSERT INTO finance.movements(kind,branch_id,source_id,amount,external_ref,actor_id) VALUES('REFUND',1,$1::bigint,1,'refund:uncoordinated-test-only',1)", [custody.id]);
      assert.equal((await captureRevisionCheckedTestPeriod(tx,custody.id,uncoordinated,"1",[],[],versionedReview.hash)).replayed, false);
      bypassProbeReached = true;
      throw new Error("uncoordinated writer probe rollback");
    }), /uncoordinated writer probe rollback/);
    assert.ok(bypassProbeReached, "revision-only check cannot detect a writer that fails to bump it");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref='refund:uncoordinated-test-only'")).rows[0].n, 0);
    assert.equal((await pg.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [uncoordinated])).rows[0].status, "OPEN");
    await pg.query("UPDATE finance.settlements SET status='CANCELLED',resolved_by=1,resolved_at=now(),resolution_reason='انتهاء تجربة اصطناعية' WHERE id=$1::bigint", [uncoordinated]);
    const legacy = await newSettlement("0", "0");
    await pg.query("UPDATE finance.settlements SET status='CONFIRMED',resolved_by=1,resolved_at=now(),resolution_reason='قديم',transfer_amount=0,transfer_direction='TO_VAULT' WHERE id=$1::bigint", [legacy]);
    await assert.rejects(() => db.serializable(tx => captureTestPeriod(tx,custody.id,legacy,"1",[],[],emptyReview.hash)), (e: unknown) => e instanceof FinanceProblem && e.code === "legacy_settlement");
  } finally { await pg.close(); }
});

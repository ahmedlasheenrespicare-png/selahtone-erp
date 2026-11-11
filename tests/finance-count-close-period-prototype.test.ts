/** Synthetic only: real engine writes in disposable DB, with test-only adapter. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { recordCommerceCollection } from "../src/lib/commerce-operations";
import { approveExpense, cancelCashCount, cancelSettlement, closeAccount, confirmCashCount, confirmSettlement, createExpense, openAccount, payExpense, requestCashCount, requestCountFromHolder, requestSettlement, settlementOverview, submitHolderCount } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import { SETTLEMENT_STALE_SQL } from "../src/lib/finance/settlement-staleness-sql";
import { CUSTODY_EXPECTATION_SQL } from "../src/lib/finance/custody-summary-sql";
import type { FinanceDatabase } from "../src/lib/finance/types";
import { testCollectionService, testCountClosePeriodGuard, testHolderPaymentService } from "../prototypes/finance-collection-policy/runtime-adapters.test-only";
import { reviewTestPeriod } from "../prototypes/finance-collection-policy/period.test-only";
import { allocateTestCollection } from "../prototypes/finance-collection-policy/allocate.test-only";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const { PrismaClient: WasmClient } = require("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

test("experimental count/closure guard rolls back boundary mismatch and preserves replay", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-count-close-period-")); let pg: PGlite | undefined; let client: PrismaClient | undefined;
  const previous = process.env.FINANCE_ENABLED; process.env.FINANCE_ENABLED = "true";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir);
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'; SET selahtone.collection_policy_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql", "prototypes/finance-collection-policy/allocations.test-only.sql"]) await pg.exec(readFileSync(join(root, f), "utf8"));
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    await pg.exec("UPDATE commerce_sales SET created_by_id=3 WHERE id=2; UPDATE commerce_collections SET created_at=now()-interval '10 days'");
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: today, counted: true }, today);
    const guarded = testCountClosePeriodGuard(db, account.id);
    const collection = await recordCommerceCollection(testCollectionService(client, "3"), 3n, { requestId: randomUUID(), saleId: "2", amount: "10", method: "CASH", actuallyPaid: false });
    // Deliberately construct the proven timestamp ambiguity: assignment exists,
    // but the current engine's strict > boundary excludes the collection.
    const item = (await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections[0]; assert.ok(item);
    // A matching nonempty pending set does not itself prevent a count. It is
    // still pending after the count: a count does not settle the collection.
    const matchingCount = { requestId: randomUUID(), accountId: account.id, expectedBalance: "10", countedAmount: "10", reason: "جرد متطابق اصطناعي", actuallyCounted: true };
    // Current recorder can drift without changing either ID or amount. A
    // synthetic direct writer demonstrates this gap, then is rolled back.
    const beforeProbe=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
    const countProbe={...matchingCount,requestId:randomUUID()};
    await assert.rejects(()=>db.serializable(async tx=>{
      await tx.query("UPDATE public.commerce_collections SET created_by_id=1 WHERE id=$1::bigint",[item.id]);
      assert.deepEqual(await reviewTestPeriod(tx,account.id),beforeProbe);
      const joined:FinanceDatabase={serializable:work=>work(tx)};
      await requestCashCount(testCountClosePeriodGuard(joined,account.id),"1",countProbe,today);
    }),/مصدر التحصيل المخصص غير متسق/);
    assert.equal((await pg.query<{creator:string}>("SELECT created_by_id::text AS creator FROM commerce_collections WHERE id=$1::bigint",[item.id])).rows[0].creator,"3");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[countProbe.requestId])).rows[0].n,0);
    assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,account.id)),beforeProbe);
    const matching = await requestCashCount(guarded, "1", matchingCount, today);
    assert.equal((await requestCashCount(guarded, "1", matchingCount, today)).replayed, true);
    const matchingConfirm = { requestId: randomUUID(), countId: matching.id, reason: "اعتماد مطابق", stillCurrent: true };
    await confirmCashCount(guarded, "1", matchingConfirm);
    assert.equal((await confirmCashCount(guarded, "1", matchingConfirm)).replayed, true);
    assert.deepEqual((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.map(c => c.id), [item.id]);
    // Keep the artificial +1 second event safely before subsequent requests;
    // otherwise a fast fixture may place it in the future and mark them stale.
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 minute' WHERE id=$1::bigint", [account.id]);
    await pg.query(`UPDATE commerce_collections SET created_at=(SELECT opened_at FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint`, [account.id, item.id]);
    // Completed commands replay their original receipt, rather than re-running
    // an interceptor for writes that have already committed.
    assert.equal((await requestCashCount(guarded, "1", matchingCount, today)).replayed, true);
    assert.equal((await confirmCashCount(guarded, "1", matchingConfirm)).replayed, true);
    const snapshot = async () => (await pg!.query(`SELECT
      (SELECT count(*)::int FROM finance.cash_counts) AS counts,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audits,
      (SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision,
      (SELECT closed_at::text FROM finance.accounts WHERE id=$1::bigint) AS closed`, [account.id])).rows[0];
    const before = await snapshot();
    const count = { requestId: randomUUID(), accountId: account.id, expectedBalance: "0", countedAmount: "10", reason: "حد اصطناعي", actuallyCounted: true };
    for (const candidate of [db, guarded]) {
      await assert.rejects(() => requestCashCount(candidate, "1", count, today), /بنفس وقت بداية الفترة/);
      await assert.rejects(() => requestCountFromHolder(candidate, "1", { requestId: randomUUID(), accountId: account.id, reason: "جرد موجّه اصطناعي" }), /بنفس وقت بداية الفترة/);
      await assert.rejects(() => closeAccount(candidate, "1", { requestId: randomUUID(), accountId: account.id, reason: "إقفال اختبار" }), /بنفس وقت بداية الفترة/);
      assert.deepEqual(await snapshot(), before, "boundary refusal must leave no write, audit, request or revision");
    }
    assert.deepEqual((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.map(c => c.id), [item.id]);
    assert.ok(collection.id);
    assert.equal((await settlementOverview(db, "3", account.id)).boundaryAmbiguous, true);
    const moveBoundary = (equal: boolean) => pg!.query(`UPDATE commerce_collections SET created_at=(SELECT opened_at FROM finance.accounts WHERE id=$1::bigint) + ($3::int * interval '1 second') WHERE id=$2::bigint`, [account.id, item.id, equal ? 0 : 1]);
    // A pre-existing count is not confirmable once ambiguity is detected, but
    // cancellation remains possible; all checks are inside the real service.
    await moveBoundary(false);
    const pendingCount = await requestCashCount(db, "1", { ...matchingCount, requestId: randomUUID() }, today);
    await moveBoundary(true);
    const beforeBlockedConfirmation = await snapshot();
    await assert.rejects(() => confirmCashCount(db, "1", { requestId: randomUUID(), countId: pendingCount.id, reason: "مراجعة اصطناعية", stillCurrent: true }), /بنفس وقت بداية الفترة/);
    assert.deepEqual(await snapshot(), beforeBlockedConfirmation);
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: pendingCount.id, reason: "إلغاء آمن" });
    await moveBoundary(false);
    const directed = await requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: account.id, reason: "جرد موجّه" });
    await moveBoundary(true);
    const beforeBlockedSubmit = await snapshot();
    await assert.rejects(() => submitHolderCount(db, "3", { requestId: randomUUID(), countId: directed.id, countedAmount: "10", actuallyCounted: true }), /بنفس وقت بداية الفترة/);
    assert.deepEqual(await snapshot(), beforeBlockedSubmit);
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: directed.id, reason: "إلغاء آمن" });
    await moveBoundary(false);
    await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "0", openingDate: today, counted: true }, today);
    const settlementInput = { requestId: randomUUID(), accountId: account.id, expectedBalance: "0", countedAmount: "10", reason: "تسوية اختبار", actuallyCounted: true };
    const pendingSettlement = await requestSettlement(db, "3", settlementInput);
    const displayStale = async () => (await pg!.query<{ stale: boolean }>(`SELECT ${SETTLEMENT_STALE_SQL} AS stale FROM finance.settlements st JOIN finance.accounts a ON a.id=st.account_id WHERE st.id=$1::bigint`, [pendingSettlement.id])).rows[0].stale;
    assert.equal(await displayStale(), false, "current revision and no later events");
    await pg.query(`UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint`, [account.id]);
    assert.equal(await displayStale(), true, "revision detects change even without a later timestamp");
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: pendingSettlement.id, expectedBalance: "0", transferAmount: "10", transferDirection: "TO_VAULT", reason: "مراجعة", actuallyTransferred: true }), /مراجعة موثوقة/);
    await pg.query(`UPDATE finance.accounts SET revision=revision-1 WHERE id=$1::bigint`, [account.id]);
    await pg.query(`UPDATE finance.settlements SET account_revision=NULL WHERE id=$1::bigint`, [pendingSettlement.id]);
    assert.equal(await displayStale(), true, "legacy requests without revision are not confirmable");
    await pg.query(`UPDATE finance.settlements SET account_revision=(SELECT revision FROM finance.accounts WHERE id=$2::bigint) WHERE id=$1::bigint`, [pendingSettlement.id, account.id]);
    assert.equal(await displayStale(), false);
    await moveBoundary(true);
    const beforeBlockedSettlement = await snapshot();
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: pendingSettlement.id, expectedBalance: "0", transferAmount: "10", transferDirection: "TO_VAULT", reason: "مراجعة", actuallyTransferred: true }), /بنفس وقت بداية الفترة/);
    assert.deepEqual(await snapshot(), beforeBlockedSettlement);
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: pendingSettlement.id, reason: "إلغاء آمن" });
    const beforeNewSettlement = await snapshot();
    await assert.rejects(() => requestSettlement(db, "3", { ...settlementInput, requestId: randomUUID() }), /بنفس وقت بداية الفترة/);
    assert.deepEqual(await snapshot(), beforeNewSettlement);
    // A boundary event for a different invoice creator in the same branch is
    // still ambiguous: historical cash attribution cannot be safely inferred.
    await pg.query("UPDATE commerce_sales SET created_by_id=1 WHERE id=2");
    assert.equal((await settlementOverview(db, "3", account.id)).boundaryAmbiguous, true);
    await pg.query("UPDATE commerce_sales SET branch_id=2 WHERE id=2");
    assert.equal((await settlementOverview(db, "3", account.id)).boundaryAmbiguous, false, "another branch must not block this account");
    await pg.query("UPDATE commerce_sales SET branch_id=1,created_by_id=3 WHERE id=2");
    // Manufacture a confirmed settlement boundary independently of the opening
    // boundary; no physical history or production migration is inferred.
    const confirmed = await pg.query<{ at: string }>(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,status,resolved_by,resolved_at,resolution_reason,transfer_amount,transfer_direction)
      VALUES($1::bigint,1,3,0,0,0,0,0,0,0,'تسوية اصطناعية','CONFIRMED',1,now(),'تأكيد اصطناعي',0,'TO_VAULT') RETURNING resolved_at::text AS at`, [account.id]);
    await pg.query("UPDATE commerce_collections SET created_at=$2::timestamptz WHERE id=$1::bigint", [item.id, confirmed.rows[0].at]);
    assert.equal((await settlementOverview(db, "3", account.id)).boundaryAmbiguous, true);
    await assert.rejects(() => requestCashCount(db, "1", { ...matchingCount, requestId: randomUUID() }, today), /بنفس وقت بداية الفترة/);
    await assert.rejects(() => closeAccount(db, "1", { requestId: randomUUID(), accountId: account.id }), /بنفس وقت بداية الفترة/);

    // Separate empty custody: accepted guarded commands can be replayed without
    // creating additional counts, closure events or movements.
    await pg.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 19,1,role_code,'موظف اصطناعي','count-close-test@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const empty = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "19", openingAmount: "0", openingDate: today, counted: true }, today);
    const safe = testCountClosePeriodGuard(db, empty.id);
    const cleanCount = { requestId: randomUUID(), accountId: empty.id, expectedBalance: "0", countedAmount: "0", reason: "جرد فارغ اصطناعي", actuallyCounted: true };
    const c = await requestCashCount(safe, "1", cleanCount, today); assert.equal((await requestCashCount(safe, "1", cleanCount, today)).replayed, true);
    const confirm = { requestId: randomUUID(), countId: c.id, reason: "اعتماد اختبار", stillCurrent: true };
    await confirmCashCount(safe, "1", confirm); assert.equal((await confirmCashCount(safe, "1", confirm)).replayed, true);
    const cleanClose = { requestId: randomUUID(), accountId: empty.id, reason: "إقفال فارغ اصطناعي" };
    await closeAccount(safe, "1", cleanClose); assert.equal((await closeAccount(safe, "1", cleanClose)).replayed, true);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);

    // Equal sums but different IDs: the guard compares membership, not just
    // the numeric expected-in-hand. These are explicit legacy-style fixtures.
    await pg.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 20,1,role_code,'موظف تطابق اصطناعي','count-close-cross@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const cross = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "20", openingAmount: "0", openingDate: today, counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [cross.id]);
    const sale = async (creator: string) => (await pg!.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'فاتورة اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(),creator])).rows[0].id;
    const addCollection = async (saleId: string, recorder: string) => (await pg!.query<{ id: string }>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,repeat('b',64),$2::bigint,10,'CASH',false,$3::bigint) RETURNING id::text`, [randomUUID(),saleId,recorder])).rows[0].id;
    const assigned = await addCollection(await sale("1"), "20");
    const oldOnly = await addCollection(await sale("20"), "1");
    await db.serializable(tx => allocateTestCollection(tx, "20", assigned));
    // Dashboard aggregates must use the engine's holder scope; branch-wide
    // aggregation would count these same two collections for every custody.
    const dashboardRows = (await pg.query<{ id: string; expected: string; boundary: boolean }>(`SELECT x.id::text AS id,(x.bal+x.period_sales-x.period_expenses)::text AS expected,x.boundary_ambiguous AS boundary FROM (${CUSTODY_EXPECTATION_SQL}) x ORDER BY x.id`, [null])).rows;
    for (const row of dashboardRows) {
      const overview = await settlementOverview(db, "1", row.id);
      assert.equal(row.expected, overview.expected, `dashboard and settlement differ for custody ${row.id}`);
      assert.equal(row.boundary, overview.boundaryAmbiguous);
    }
    assert.equal(dashboardRows.find(row => row.id === cross.id)?.expected, "10.00", "only the invoice creator's legacy collection belongs to this holder");
    const crossReview = await db.serializable(tx => reviewTestPeriod(tx, cross.id));
    assert.deepEqual(crossReview.collections.map(c => c.id), [assigned]); assert.notEqual(assigned, oldOnly);
    const crossCount = { requestId: randomUUID(), accountId: cross.id, expectedBalance: "10", countedAmount: "10", reason: "مبالغ متساوية معرفات مختلفة", actuallyCounted: true };
    const crossGuard = testCountClosePeriodGuard(db, cross.id);
    await assert.rejects(() => requestCashCount(testCountClosePeriodGuard(db, empty.id), "1", crossCount, today), /bound to the wrong account/);
    await assert.rejects(() => requestCashCount(crossGuard, "1", crossCount, today), /تختلف عناصر الفترة/);
    const rawCross = await requestCashCount(db, "1", crossCount, today);
    const crossSaved = (await pg.query<{ observed: string; difference: string }>("SELECT observed_balance::text AS observed,difference::text AS difference FROM finance.cash_counts WHERE id=$1::bigint", [rawCross.id])).rows[0];
    assert.deepEqual(crossSaved, { observed: "10.00", difference: "0.00" }, "matching totals conceal different IDs");
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: rawCross.id, reason: "إلغاء اختبار الاختلاف" });

    // The same manufactured boundary ambiguity on the payment side: a real
    // holder-cash service writes a pending assignment, then test SQL moves its
    // recorded_at to the account boundary. This is NOT historical inference.
    await pg.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 21,1,role_code,'موظف دفع اصطناعي','count-close-payment@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const paymentAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "21", openingAmount: "0", openingDate: today, counted: true }, today);
    const expense = await createExpense(db, "21", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "8", expenseDate: today, description: "مصروف حد اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const paymentInput = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    await payExpense(testHolderPaymentService(db, "21"), "21", paymentInput, today);
    const paymentReview = await db.serializable(tx => reviewTestPeriod(tx, paymentAccount.id));
    assert.deepEqual(paymentReview.payments.map(payment => payment.amount), ["8.00"]);
    const paymentProbe={requestId:randomUUID(),accountId:paymentAccount.id,expectedBalance:"-8",countedAmount:"0",reason:"مصدر صرف اصطناعي",actuallyCounted:true};
    await assert.rejects(()=>db.serializable(async tx=>{
      await tx.query("UPDATE finance.payments SET recorded_by=1 WHERE id=$1::bigint",[paymentReview.payments[0].id]);
      assert.deepEqual(await reviewTestPeriod(tx,paymentAccount.id),paymentReview);
      const joined:FinanceDatabase={serializable:work=>work(tx)};
      await requestCashCount(testCountClosePeriodGuard(joined,paymentAccount.id),"1",paymentProbe,today);
    }),/مصدر الصرف المخصص غير متسق/);
    assert.equal((await pg.query<{recorder:string}>("SELECT recorded_by::text AS recorder FROM finance.payments WHERE id=$1::bigint",[paymentReview.payments[0].id])).rows[0].recorder,"21");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[paymentProbe.requestId])).rows[0].n,0);
    assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,paymentAccount.id)),paymentReview);
    await pg.query("UPDATE finance.payments SET recorded_at=(SELECT opened_at FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint", [paymentAccount.id, paymentReview.payments[0].id]);
    const paymentGuard = testCountClosePeriodGuard(db, paymentAccount.id);
    const boundaryCount = { requestId: randomUUID(), accountId: paymentAccount.id, expectedBalance: "0", countedAmount: "0", reason: "حد دفع اصطناعي", actuallyCounted: true };
    const countTotalBefore = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.cash_counts")).rows[0].n;
    await assert.rejects(() => requestCashCount(paymentGuard, "1", boundaryCount, today), /بنفس وقت بداية الفترة/);
    await assert.rejects(() => requestCashCount(db, "1", boundaryCount, today), /بنفس وقت بداية الفترة/);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.cash_counts")).rows[0].n, countTotalBefore);
    const boundaryClose = { requestId: randomUUID(), accountId: paymentAccount.id, reason: "إقفال حد دفع اصطناعي" };
    await assert.rejects(() => closeAccount(paymentGuard, "1", boundaryClose), /بنفس وقت بداية الفترة/);
    await assert.rejects(() => closeAccount(db, "1", boundaryClose), /بنفس وقت بداية الفترة/);
    assert.equal((await pg.query<{ closed: string | null }>("SELECT closed_at::text AS closed FROM finance.accounts WHERE id=$1::bigint", [paymentAccount.id])).rows[0].closed, null);
    assert.deepEqual((await db.serializable(tx => reviewTestPeriod(tx, paymentAccount.id))).payments.map(payment => payment.id), [paymentReview.payments[0].id]);
  } finally {
    if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
    if (client) await client.$disconnect(); else if (pg) await pg.close(); rmSync(dir, { recursive: true, force: true });
  }
});

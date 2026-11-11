/** Synthetic transaction harness: real services, experimental isolated allocation. */
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
import { createCommerceSale, recordCommerceCollection, recordCommerceRefund, returnCommerceSale } from "../src/lib/commerce-operations";
import { createCatalogSale } from "../src/lib/catalog-sales";
import { approveExpense, cancelSettlement, confirmSettlement, createExpense, openAccount, payExpense, requestSettlement, settlementOverview } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import type { FinanceDatabase } from "../src/lib/finance/types";
import { testCollectionService, testHolderPaymentService, testRealSettlementWithPeriod } from "../prototypes/finance-collection-policy/runtime-adapters.test-only";
import { allocateTestCollection } from "../prototypes/finance-collection-policy/allocate.test-only";
import { captureRevisionCheckedTestPeriod, captureTestPeriod, reviewTestPeriod } from "../prototypes/finance-collection-policy/period.test-only";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const { PrismaClient: WasmClient } = require("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

test("experimental allocation in real collection, initial-sale and holder-payment transactions", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-runtime-prototype-"));
  let pg: PGlite | undefined; let client: PrismaClient | undefined;
  const previous = process.env.FINANCE_ENABLED, previousStock = process.env.SALES_STOCK_DECOUPLED;
  process.env.FINANCE_ENABLED = "true"; process.env.SALES_STOCK_DECOUPLED = "false";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir);
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'; SET selahtone.collection_policy_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql", "prototypes/finance-collection-policy/allocations.test-only.sql"]) await pg.exec(readFileSync(join(root, f), "utf8"));
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    await pg.exec("UPDATE commerce_sales SET created_by_id=3 WHERE id=2; UPDATE commerce_collections SET created_at=now()-interval '10 days'");
    const currentVault = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
    // The real collection service still requires a custody even for a manager.
    // The test interceptor is not a fallback integration and must not be used
    // to bypass this guard or simulate a real cash-receipt attestation.
    const managerSale = (await pg.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'فاتورة مدير اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,1 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const managerInput = { requestId: randomUUID(), saleId: managerSale, amount: "19", method: "CASH", actuallyPaid: true };
    const vaultRev = (await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [currentVault.id])).rows[0].revision;
    await assert.rejects(() => recordCommerceCollection(testCollectionService(client!, "1"), 1n, managerInput), /يلزم وجود عهدة مفتوحة للمسجّل/);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [managerInput.requestId])).rows[0].n, 0);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint", [currentVault.id])).rows[0].n, 0);
    assert.equal((await pg.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [currentVault.id])).rows[0].revision, vaultRev);
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: today, counted: true }, today);
    const hooked = testCollectionService(client, "3");
    const broken = testCollectionService(client, "3", true);
    const later = { requestId: randomUUID(), saleId: "2", amount: "11", method: "CASH", actuallyPaid: false };
    const revision = async () => (await pg!.query<{ n: string }>("SELECT revision::text AS n FROM finance.accounts WHERE id=$1::bigint", [account.id])).rows[0].n;
    const count = async (table: string) => (await pg!.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    const before = { allocations: await count("finance.collection_allocations_test_only"), collections: await count("commerce_collections"), revision: await revision() };
    await assert.rejects(() => recordCommerceCollection(broken, 3n, later), /synthetic failure after allocation/);
    assert.equal(await count("finance.collection_allocations_test_only"), before.allocations);
    assert.equal(await count("commerce_collections"), before.collections);
    assert.equal(await revision(), before.revision);
    const first = await recordCommerceCollection(hooked, 3n, later);
    assert.equal(first.replayed, false);
    const r1 = await revision();
    assert.equal((await recordCommerceCollection(hooked, 3n, later)).replayed, true);
    assert.equal(await revision(), r1, "replay must not allocate or bump twice");
    await assert.rejects(() => recordCommerceCollection(hooked, 3n, { ...later, amount: "12" }), /بيانات مختلفة/);
    const card = { ...later, requestId: randomUUID(), amount: "2", method: "CARD" };
    const allocationCount = await count("finance.collection_allocations_test_only");
    assert.equal((await recordCommerceCollection(broken, 3n, card)).replayed, false, "noncash skips even the failure-injecting allocation hook");
    assert.equal(await count("finance.collection_allocations_test_only"), allocationCount);
    assert.equal(await revision(), r1);

    const cat = (await pg.query<{ id: number }>("INSERT INTO sales_item_categories(code,name_ar) VALUES ('INTTEST','فئة اصطناعية') RETURNING id")).rows[0].id;
    const item = (await pg.query<{ id: number }>("INSERT INTO sales_item_types(category_id,name_ar) VALUES($1,'صنف اصطناعي') RETURNING id", [cat])).rows[0].id;
    const initialCatalog = { requestId: randomUUID(), branchId: "1", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "7", method: "CASH", lines: [{ typeId: String(item), quantity: "1", unitPrice: "100", details: [] }] };
    const stockSale = { requestId: randomUUID(), warehouseId: "1", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "5", method: "CASH", lines: [{ productId: "2", quantity: "1", serialIds: [], expectedUnitPrice: "45", expectedTaxRateId: "3", expectedTaxKind: "VAT", expectedTaxRate: "14" }] };
    const saleCount = await count("commerce_sales");
    const stockQty = async () => (await pg!.query<{ qty: string }>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=1 AND product_id=2")).rows[0].qty;
    const originalQty = await stockQty();
    for (const [service, payload] of [[createCatalogSale, initialCatalog], [createCommerceSale, stockSale]] as const) {
      const oldRev = await revision(); const oldCollections = await count("commerce_collections");
      await assert.rejects(() => service(broken, 3n, payload), /synthetic failure after allocation/);
      assert.equal(await count("commerce_sales"), saleCount + (payload === stockSale ? 1 : 0));
      assert.equal(await count("commerce_collections"), oldCollections);
      assert.equal(await revision(), oldRev);
      if (payload === stockSale) assert.equal(await stockQty(), originalQty, "failed allocation rolls back stock decrement");
      const result = await service(hooked, 3n, payload);
      assert.equal(result.replayed, false); const current = await revision();
      assert.equal((await service(hooked, 3n, payload)).replayed, true);
      assert.equal(await revision(), current);
    }
    assert.equal(Number(await stockQty()), Number(originalQty) - 1);
    const overview = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.deepEqual(overview.collections.map(x => x.amount), ["11.00", "7.00", "5.00"]);
    assert.equal(await count("finance.movements"), 0, "custody allocation must not post cash twice");

    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "4", expenseDate: today, description: "مصروف اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const payment = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    const beforePayRev = await revision();
    await assert.rejects(() => payExpense(testHolderPaymentService(db, "3", true), "3", payment, today), /synthetic failure after allocation/);
    assert.equal(await count("finance.payments"), 0); assert.equal(await count("finance.holder_payment_allocations_test_only"), 0);
    assert.equal(await revision(), beforePayRev);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expenses WHERE id=$1::bigint", [expense.id])).rows[0].status, "APPROVED");
    assert.equal((await payExpense(testHolderPaymentService(db, "3"), "3", payment, today)).replayed, false);
    const payRev = await revision();
    assert.equal((await payExpense(testHolderPaymentService(db, "3"), "3", payment, today)).replayed, true);
    assert.equal(await revision(), payRev);
    const period = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.deepEqual(period.payments.map(x => x.amount), ["4.00"]);
    assert.equal(await count("finance.movements"), 0);

    // Exercise actual request and confirmation including real adjustment and
    // handover movements, while a test-only hook attaches reviewed IDs in the
    // same transaction. This is not the production allocation path.
    const settlement = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, expectedBalance: "0", countedAmount: "19", reason: "تسوية اختبار اصطناعي", actuallyCounted: true });
    const snapshot = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    const hook = { accountId: account.id, actorId: "1", collectionIds: snapshot.collections.map(c => c.id), paymentIds: snapshot.payments.map(p => p.id), reviewedHash: snapshot.hash };
    const decision = { requestId: randomUUID(), settlementId: settlement.id, expectedBalance: "0", transferAmount: "19", transferDirection: "TO_VAULT", reason: "اعتماد اصطناعي", actuallyTransferred: true };
    const status = async () => (await pg!.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [settlement.id])).rows[0].status;
    const c1 = snapshot.collections[0].id, c2 = snapshot.collections[1].id;
    // The fingerprint still omits recorder fields. The test interceptor now
    // checks their current consistency independently and aborts the whole
    // transaction when the synthetic recorder or payment source has drifted.
    const probeRevision = await revision();
    for (const source of ["collection", "payment"] as const) {
      await assert.rejects(() => db.serializable(async tx => {
        if (source === "collection") await tx.query("UPDATE commerce_collections SET created_by_id=1 WHERE id=$1::bigint", [c1]);
        else await tx.query("UPDATE finance.payments SET recorded_by=1 WHERE id=$1::bigint", [snapshot.payments[0].id]);
        assert.deepEqual(await reviewTestPeriod(tx, account.id), snapshot, "recorder is outside the experimental fingerprint");
        const joined: FinanceDatabase = { serializable: work => work(tx) };
        await confirmSettlement(testRealSettlementWithPeriod(joined, hook), "1", decision);
      }), source === "collection" ? /مصدر التحصيل المخصص غير متسق/ : /مصدر الصرف المخصص غير متسق/);
      assert.equal((await pg.query<{recorder:string}>("SELECT created_by_id::text AS recorder FROM commerce_collections WHERE id=$1::bigint", [c1])).rows[0].recorder, "3");
      assert.equal((await pg.query<{recorder:string}>("SELECT recorded_by::text AS recorder FROM finance.payments WHERE id=$1::bigint", [snapshot.payments[0].id])).rows[0].recorder, "3");
      assert.equal(await status(), "OPEN");
      assert.equal(await revision(), probeRevision);
      assert.equal(await count("finance.movements"), 0);
      assert.equal(await count("finance.settlement_allocation_receipts_test_only"), 0);
      assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), snapshot);
    }
    await pg.query("UPDATE commerce_collections SET amount=CASE WHEN id=$1::bigint THEN 12 ELSE 6 END WHERE id IN ($1::bigint,$2::bigint)", [c1,c2]);
    await assert.rejects(() => confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision), /تغيّرت عناصر الفترة/);
    assert.equal(await status(), "OPEN"); assert.equal(await count("finance.movements"), 0);
    assert.equal(await count("finance.settlement_allocation_receipts_test_only"), 0);
    await pg.query("UPDATE commerce_collections SET amount=CASE WHEN id=$1::bigint THEN 11 ELSE 7 END WHERE id IN ($1::bigint,$2::bigint)", [c1,c2]);
    await assert.rejects(() => confirmSettlement(testRealSettlementWithPeriod(db, { ...hook, failAfterAllocation: true }), "1", decision), /synthetic failure after settlement allocation/);
    assert.equal(await status(), "OPEN"); assert.equal(await count("finance.movements"), 0);
    assert.equal(await count("finance.settlement_allocation_receipts_test_only"), 0);
    assert.equal((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.length, 3);
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, false);
    assert.equal(await status(), "CONFIRMED"); assert.equal(await count("finance.movements"), 2);
    assert.equal(await count("finance.settlement_allocation_receipts_test_only"), 1);
    assert.deepEqual((await pg.query<{ kind: string; amount: string }>("SELECT kind,amount::text AS amount FROM finance.movements ORDER BY id")).rows, [{ kind: "SETTLEMENT", amount: "19.00" }, { kind: "TRANSFER", amount: "19.00" }]);
    const afterConfirmation = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.equal(afterConfirmation.collections.length, 0); assert.equal(afterConfirmation.payments.length, 0);
    const next = { ...later, requestId: randomUUID(), amount: "2" };
    await recordCommerceCollection(hooked, 3n, next);
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
    assert.equal(await count("finance.movements"), 2); assert.equal(await count("finance.settlement_allocation_receipts_test_only"), 1);
    assert.deepEqual((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.map(c => c.amount), ["2.00"]);

    // A deliberately constructed legacy crossover demonstrates a remaining
    // blocker: equal totals do NOT prove that the real period formula counted
    // the same collection IDs as the allocation model. The test-only cross-check
    // must reject it; this remains unsuitable for production cutover.
    await pg.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 19,1,role_code,'موظف تاريخ اصطناعي','synthetic-legacy-cross@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const legacyAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "19", openingAmount: "0", openingDate: today, counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [legacyAccount.id]);
    const createLegacySale = async (creator: string) => (await pg!.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'فاتورة تاريخ اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(),creator])).rows[0].id;
    const foreignSale = await createLegacySale("1"), ownSale = await createLegacySale("19");
    const legacyCollection = async (saleId: string, recorder: string) => (await pg!.query<{ id: string }>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,repeat('b',64),$2::bigint,10,'CASH',false,$3::bigint) RETURNING id::text`, [randomUUID(),saleId,recorder])).rows[0].id;
    const assignedButNotInOldFormula = await legacyCollection(foreignSale, "19");
    const oldFormulaButNotAssigned = await legacyCollection(ownSale, "1");
    await db.serializable(tx => allocateTestCollection(tx, "19", assignedButNotInOldFormula));
    const crossoverReview = await db.serializable(tx => reviewTestPeriod(tx, legacyAccount.id));
    assert.deepEqual(crossoverReview.collections.map(c => c.id), [assignedButNotInOldFormula]);
    const oldFormulaIds = (await pg.query<{ id: string }>(`SELECT c.id::text AS id FROM commerce_collections c JOIN commerce_sales s ON s.id=c.sale_id JOIN finance.accounts a ON a.id=$1::bigint WHERE s.branch_id=a.branch_id AND s.created_by_id=a.holder_id AND c.method='CASH' AND c.created_at>a.opened_at ORDER BY c.id`, [legacyAccount.id])).rows.map(r => r.id);
    assert.deepEqual(oldFormulaIds, [oldFormulaButNotAssigned]);
    const crossoverRequest = await requestSettlement(db, "19", { requestId: randomUUID(), accountId: legacyAccount.id, expectedBalance: "0", countedAmount: "10", reason: "تاريخ اصطناعي ملتبس", actuallyCounted: true });
    const crossoverHook = { accountId: legacyAccount.id, actorId: "1", collectionIds: crossoverReview.collections.map(c => c.id), paymentIds: [], reviewedHash: crossoverReview.hash };
    const crossoverDecision = { requestId: randomUUID(), settlementId: crossoverRequest.id, expectedBalance: "0", transferAmount: "10", transferDirection: "TO_VAULT", reason: "اختبار خلل تاريخي", actuallyTransferred: true };
    assert.notEqual(assignedButNotInOldFormula, oldFormulaIds[0], "equal totals conceal different source IDs");
    await assert.rejects(() => confirmSettlement(testRealSettlementWithPeriod(db, crossoverHook), "1", crossoverDecision), /العناصر المخصصة لا تطابق عناصر معادلة التسوية الحالية/);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [crossoverRequest.id])).rows[0].status, "OPEN");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint", [crossoverRequest.id])).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [crossoverRequest.id])).rows[0].n, 0);

    // Equal expense totals can hide a different payment set at a timestamp
    // boundary too: the first is assigned but excluded by '>', the second is
    // counted by the legacy formula but not assigned. Both are synthetic.
    await pg.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 20,1,role_code,'موظف مصروف تاريخي اصطناعي','synthetic-payment-cross@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const boundaryAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "20", openingAmount: "0", openingDate: today, counted: true }, today);
    const draftBoundary = async () => {
      const e = await createExpense(db, "20", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "5", expenseDate: today, description: "حد زمني اصطناعي" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: e.id, expectedRevision: "1" });
      return { requestId: randomUUID(), expenseId: e.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    };
    const boundaryFirst = await draftBoundary();
    await payExpense(testHolderPaymentService(db, "20"), "20", boundaryFirst, today);
    await pg.query("UPDATE finance.accounts SET opened_at=(SELECT recorded_at FROM finance.payments WHERE expense_id=$1::bigint) WHERE id=$2::bigint", [boundaryFirst.expenseId,boundaryAccount.id]);
    const boundarySecond = await draftBoundary();
    await payExpense(db, "20", boundarySecond, today); // intentionally unassigned legacy-style row
    const boundaryReview = await db.serializable(tx => reviewTestPeriod(tx, boundaryAccount.id));
    assert.equal(boundaryReview.payments.length, 1);
    const oldPaymentIds = (await pg.query<{ id: string }>(`SELECT p.id::text AS id FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id JOIN finance.accounts a ON a.id=$1::bigint WHERE e.branch_id=a.branch_id AND e.requested_by=a.holder_id AND p.source='HOLDER_CASH' AND p.recorded_at>a.opened_at ORDER BY p.id`, [boundaryAccount.id])).rows.map(r => r.id);
    assert.equal(oldPaymentIds.length, 1); assert.notEqual(boundaryReview.payments[0].id, oldPaymentIds[0]);
    // The production equality guard now blocks this ambiguous case earlier,
    // before a request exists; do not bypass it to exercise the test-only hook.
    const boundaryRequestId = randomUUID();
    await assert.rejects(() => requestSettlement(db, "20", { requestId: boundaryRequestId, accountId: boundaryAccount.id, expectedBalance: "0", countedAmount: "0", reason: "مصروف حد زمني اصطناعي", actuallyCounted: true }), /بنفس وقت بداية الفترة/);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid", [boundaryRequestId])).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.settlements WHERE account_id=$1::bigint", [boundaryAccount.id])).rows[0].n, 0);

  } finally {
    if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
    if (previousStock === undefined) delete process.env.SALES_STOCK_DECOUPLED; else process.env.SALES_STOCK_DECOUPLED = previousStock;
    if (client) await client.$disconnect(); else if (pg) await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic pending collection and cash refund affect different evidence; refund invalidates a real settlement", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-allocation-refund-"));
  let pg: PGlite | undefined; let client: PrismaClient | undefined;
  const previous = process.env.FINANCE_ENABLED, previousStock = process.env.SALES_STOCK_DECOUPLED;
  process.env.FINANCE_ENABLED = "true"; process.env.SALES_STOCK_DECOUPLED = "false";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir);
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'; SET selahtone.collection_policy_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql", "prototypes/finance-collection-policy/allocations.test-only.sql"]) await pg.exec(readFileSync(join(root, f), "utf8"));
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const vault = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "20", openingDate: today, counted: true }, today);
    // The preview fixture can contain same-day collections later than the test
    // clock. Keep those unrelated seed rows before the artificial opening.
    await pg.query("UPDATE public.commerce_collections SET created_at=now()-interval '2 days'");
    // Deliberately separate the synthetic opening timestamp from the collection.
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
    const sale = await createCommerceSale(testCollectionService(client, "3"), 3n, { requestId: randomUUID(), warehouseId: "1", customerName: "عميل رد اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "10", method: "CASH", lines: [{ productId: "4", quantity: "1", serialIds: [], expectedUnitPrice: "150", expectedTaxRateId: "3", expectedTaxKind: "VAT", expectedTaxRate: "14" }] });
    const line = await client.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(sale.id) }, select: { id: true } });
    const returnInput = { requestId: randomUUID(), saleId: sale.id, cancel: false, accepted: true, lines: [{ saleLineId: String(line.id), quantity: "1", serialIds: [] }] };
    await returnCommerceSale(client, 1n, returnInput);
    const periodBefore = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.deepEqual(periodBefore.collections.map(item => item.amount), ["10.00"]);
    assert.equal(periodBefore.payments.length, 0);
    const overviewBefore = await settlementOverview(db, "3", account.id);
    assert.equal(overviewBefore.account?.balance, "20.00");
    assert.equal(overviewBefore.sales, "10.00");
    const request = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, expectedBalance: "20", countedAmount: "30", reason: "تسوية قبل رد اصطناعي", actuallyCounted: true });
    const refund = { requestId: randomUUID(), saleId: sale.id, amount: "4", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
    const saved = await recordCommerceRefund(client, 1n, refund);
    assert.equal(saved.replayed, false);
    assert.deepEqual(await recordCommerceRefund(client, 1n, refund), { id: saved.id, replayed: true });
    const periodAfter = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.deepEqual(periodAfter, periodBefore, "the experimental collection/payment fingerprint alone does not include refund movements");
    const overviewAfter = await settlementOverview(db, "3", account.id);
    assert.equal(overviewAfter.account?.balance, "16.00", "one real refund movement reduces the book balance");
    assert.equal(overviewAfter.sales, "10.00", "the recorded collection is not automatically cancelled or netted against the refund");
    const movements = await pg.query<{ amount: string; n: number }>("SELECT COALESCE(sum(amount),0)::text AS amount,count(*)::int AS n FROM finance.movements WHERE kind='REFUND' AND source_id=$1::bigint", [account.id]);
    assert.deepEqual(movements.rows[0], { amount: "4.00", n: 1 });
    // The standalone experimental capture does not check account revision or
    // execute real settlement movements. Prove that blind spot only inside a
    // transaction that is deliberately rolled back, then use the real engine.
    const revisionBeforeProbe = (await pg.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [account.id])).rows[0].revision;
    let probeReached = false;
    await assert.rejects(() => db.serializable(async tx => {
      const captured = await captureTestPeriod(tx, account.id, request.id, "1", periodBefore.collections.map(x => x.id), [], periodBefore.hash);
      assert.equal(captured.replayed, false);
      const tentative = await tx.query<{ status: string; receipts: number }>("SELECT s.status,(SELECT count(*)::int FROM finance.settlement_allocation_receipts_test_only r WHERE r.settlement_id=s.id) AS receipts FROM finance.settlements s WHERE s.id=$1::bigint", [request.id]);
      assert.deepEqual(tentative.rows[0], { status: "CONFIRMED", receipts: 1 });
      probeReached = true;
      throw new Error("synthetic probe rollback");
    }), /synthetic probe rollback/);
    assert.ok(probeReached, "the test-only capture must reach tentative confirmation to expose its limitation");
    assert.equal((await pg.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [account.id])).rows[0].revision, revisionBeforeProbe);
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), periodBefore, "rollback keeps all experimental membership pending");
    await assert.rejects(() => db.serializable(tx => captureRevisionCheckedTestPeriod(tx, account.id, request.id, "1", periodBefore.collections.map(x => x.id), [], periodBefore.hash)), /تغيّرت نسخة العهدة/);
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), periodBefore, "revision-checked test capture refuses without consuming the pending collection");
    const confirm = { requestId: randomUUID(), settlementId: request.id, expectedBalance: "20", transferDirection: "TO_VAULT", transferAmount: "0", reason: "تأكيد بعد رد اصطناعي", actuallyTransferred: true };
    await assert.rejects(() => confirmSettlement(db, "1", confirm), /تغيّرت العهدة منذ طلب التسوية/);
    const state = await pg.query<{ status: string; receipts: number }>("SELECT s.status,(SELECT count(*)::int FROM finance.settlement_allocation_receipts_test_only r WHERE r.settlement_id=s.id) AS receipts FROM finance.settlements s WHERE s.id=$1::bigint", [request.id]);
    assert.deepEqual(state.rows[0], { status: "OPEN", receipts: 0 });
    const commands = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid", [confirm.requestId]);
    assert.equal(commands.rows[0].n, 0, "rejected confirmation stores no receipt");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 0);

    // A second refund for the same synthetic sale is paid from the vault, not
    // the collector's custody. These are separate account movements, not a
    // reason to reassign or reduce the pending collection automatically.
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: request.id, reason: "إلغاء طلب قديم قبل إعادة المراجعة" });
    const refreshed = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, expectedBalance: "16", countedAmount: "26", reason: "طلب اصطناعي قبل رد من الخزنة", actuallyCounted: true });
    const reviewed = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    const revisionBefore = (await pg.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [account.id])).rows[0].revision;
    const vaultRefund = { ...refund, requestId: randomUUID(), amount: "3", accountId: vault.id };
    const vaultSaved = await recordCommerceRefund(client, 1n, vaultRefund);
    assert.equal(vaultSaved.replayed, false);
    assert.deepEqual(await recordCommerceRefund(client, 1n, vaultRefund), { id: vaultSaved.id, replayed: true });
    const afterVaultRefund = await settlementOverview(db, "3", account.id);
    assert.equal(afterVaultRefund.account?.balance, "16.00");
    assert.equal(afterVaultRefund.sales, "10.00");
    assert.equal((await pg.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [account.id])).rows[0].revision, revisionBefore);
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), reviewed);
    const refunds = await pg.query<{ source: string; amount: string; n: number }>("SELECT source_id::text AS source,sum(amount)::text AS amount,count(*)::int AS n FROM finance.movements WHERE kind='REFUND' GROUP BY source_id ORDER BY source_id");
    assert.deepEqual(refunds.rows, [{ source: vault.id, amount: "3.00", n: 1 }, { source: account.id, amount: "4.00", n: 1 }]);
    const confirmRefreshed = { requestId: randomUUID(), settlementId: refreshed.id, expectedBalance: "16", transferDirection: "TO_VAULT", transferAmount: "0", reason: "اعتماد اصطناعي مع تحويل صفر", actuallyTransferred: true };
    const hook = { accountId: account.id, actorId: "1", collectionIds: reviewed.collections.map(x => x.id), paymentIds: [], reviewedHash: reviewed.hash };
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", confirmRefreshed)).replayed, false);
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", confirmRefreshed)).replayed, true);
    assert.equal((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.length, 0);
    const settlementRows = await pg.query<{ amount: string; direction: string; n: number }>(`SELECT sum(amount)::text AS amount,CASE WHEN destination_id=$2::bigint THEN 'IN' ELSE 'OUT' END AS direction,count(*)::int AS n
      FROM finance.movements WHERE settlement_id=$1::bigint GROUP BY direction`, [refreshed.id, account.id]);
    assert.deepEqual(settlementRows.rows, [{ amount: "10.00", direction: "IN", n: 1 }], "zero transfer produces only the recorded adjustment, not a vault handover");
  } finally {
    if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
    if (previousStock === undefined) delete process.env.SALES_STOCK_DECOUPLED; else process.env.SALES_STOCK_DECOUPLED = previousStock;
    if (client) await client.$disconnect(); else if (pg) await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic pending-items example posts only settlement adjustment and partial handover", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-pending-contract-"));
  let pg: PGlite | undefined; let client: PrismaClient | undefined;
  const previous = process.env.FINANCE_ENABLED, previousStock = process.env.SALES_STOCK_DECOUPLED;
  process.env.FINANCE_ENABLED = "true"; process.env.SALES_STOCK_DECOUPLED = "false";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: "Synthetic-Test-2026!" }, stdio: "pipe", timeout: 60_000 });
    pg = new PGlite(dir);
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'; SET selahtone.collection_policy_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql", "prototypes/finance-collection-policy/allocations.test-only.sql"]) await pg.exec(readFileSync(join(root, f), "utf8"));
    client = new WasmClient({ adapter: new PrismaPGlite(pg) });
    const db: FinanceDatabase = { serializable: work => client!.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    await pg.exec("UPDATE commerce_sales SET created_by_id=3 WHERE id=2; UPDATE commerce_collections SET created_at=now()-interval '10 days'");
    const vault = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
    const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "100", openingDate: today, counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
    const collection = { requestId: randomUUID(), saleId: "2", amount: "30", method: "CASH", actuallyPaid: false };
    const collected = await recordCommerceCollection(testCollectionService(client, "3"), 3n, collection);
    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: today, description: "مصروف مثال اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const payment = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    const paid = await payExpense(testHolderPaymentService(db, "3"), "3", payment, today);
    const pending = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.deepEqual(pending.collections.map(x => [x.id,x.amount]), [[collected.id,"30.00"]]);
    assert.deepEqual(pending.payments.map(x => [x.id,x.amount]), [[paid.id,"10.00"]]);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint", [account.id])).rows[0].n, 0, "pending collection and holder payment post no custody movements");
    const before = await settlementOverview(db, "3", account.id);
    assert.equal(before.account?.balance, "100.00");
    assert.equal(before.sales, "30.00"); assert.equal(before.expenses, "10.00"); assert.equal(before.expected, "120.00");
    const cancelled = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "118", reason: "طلب للمراجعة فقط", actuallyCounted: true });
    const cancellation = { requestId: randomUUID(), settlementId: cancelled.id, reason: "إلغاء اصطناعي قبل التأكيد" };
    assert.equal((await cancelSettlement(db, "3", cancellation)).replayed, false);
    assert.equal((await cancelSettlement(db, "3", cancellation)).replayed, true);
    assert.equal((await pg.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [cancelled.id])).rows[0].status, "CANCELLED");
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), pending, "cancellation does not consume pending IDs");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint", [account.id])).rows[0].n, 0);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [cancelled.id])).rows[0].n, 0);
    const request = await requestSettlement(db, "3", { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "118", reason: "مثال تسوية اصطناعي", actuallyCounted: true });
    const values = await pg.query<{sales:string;expenses:string;expected:string;deviation:string;adjustment:string}>("SELECT sales_total::text AS sales,expenses_total::text AS expenses,expected_amount::text AS expected,deviation::text AS deviation,adjustment::text AS adjustment FROM finance.settlements WHERE id=$1::bigint", [request.id]);
    assert.deepEqual(values.rows[0], {sales:"30.00",expenses:"10.00",expected:"120.00",deviation:"-2.00",adjustment:"18.00"});
    const hook = { accountId: account.id, actorId: "1", collectionIds: [collected.id], paymentIds: [paid.id], reviewedHash: pending.hash };
    const decision = { requestId: randomUUID(), settlementId: request.id, expectedBalance: "100", transferAmount: "5", transferDirection: "TO_VAULT", reason: "تحويل جزئي اصطناعي", actuallyTransferred: true };
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, false);
    const moves = await pg.query<{kind:string;amount:string;source:string|null;destination:string|null}>("SELECT kind,amount::text AS amount,source_id::text AS source,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint ORDER BY id", [request.id]);
    assert.deepEqual(moves.rows, [{kind:"SETTLEMENT",amount:"18.00",source:null,destination:account.id},{kind:"TRANSFER",amount:"5.00",source:account.id,destination:vault.id}]);
    const after = await settlementOverview(db, "3", account.id);
    assert.equal(after.account?.balance, "113.00"); assert.equal(after.sales, "0.00"); assert.equal(after.expenses, "0.00"); assert.equal(after.expected, "113.00");
    assert.equal((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.length, 0);
    assert.equal((await db.serializable(tx => reviewTestPeriod(tx, account.id))).payments.length, 0);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 1);
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
    assert.equal((await recordCommerceCollection(testCollectionService(client, "3"), 3n, collection)).replayed, true);
    assert.equal((await payExpense(testHolderPaymentService(db, "3"), "3", payment, today)).replayed, true);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 2);
    const nextCollection = { ...collection, requestId: randomUUID(), amount: "7" };
    const later = await recordCommerceCollection(testCollectionService(client, "3"), 3n, nextCollection);
    const nextReview = await db.serializable(tx => reviewTestPeriod(tx, account.id));
    assert.deepEqual(nextReview.collections.map(x => [x.id,x.amount]), [[later.id,"7.00"]]);
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), nextReview, "replay of the old confirmation does not consume later membership");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint", [account.id])).rows[0].n, 2);
    const nextOverview = await settlementOverview(db, "3", account.id);
    assert.equal(nextOverview.account?.balance, "113.00"); assert.equal(nextOverview.sales, "7.00"); assert.equal(nextOverview.expected, "120.00");
  } finally {
    if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
    if (previousStock === undefined) delete process.env.SALES_STOCK_DECOUPLED; else process.env.SALES_STOCK_DECOUPLED = previousStock;
    if (client) await client.$disconnect(); else if (pg) await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

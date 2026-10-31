import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import type { PrismaClient as ClientType } from "@prisma/client";
import { InventoryProblem } from "../src/lib/inventory-operations";
import { receiveInventoryStock } from "../src/lib/receiving-operations";
import { createCommerceSale, recordCommerceCollection, recordCommerceRefund, returnCommerceSale, changeStaffDiscountLimit } from "../src/lib/commerce-operations";
import { searchAvailableSaleSerials } from "../src/lib/commerce-serial-search";

const root = process.cwd();
const baseline = readFileSync(path.join(root, "tests/fixtures/inventory-baseline.sql"), "utf8");
const openingUpgrade = readFileSync(path.join(root, "prisma/manual-inventory-upgrade.sql"), "utf8");
const receivingUpgrade = readFileSync(path.join(root, "prisma/manual-receiving-upgrade.sql"), "utf8");
const commerceUpgrade = readFileSync(path.join(root, "prisma/manual-commerce-upgrade.sql"), "utf8");
// عميل Prisma يقرأ أعمدة الأصناف الفنية الجديدة، فتُطبَّق ترقيتها هنا أيضًا.
const catalogUpgrade = readFileSync(path.join(root, "prisma/manual-catalog-sales-upgrade.sql"), "utf8");

function line(productId: string, quantity: string, serialIds: string[]) {
  return productId === "1"
    ? { productId, quantity, serialIds, expectedUnitPrice: "105", expectedTaxRateId: "1", expectedTaxKind: "VAT", expectedTaxRate: "5" }
    : { productId, quantity, serialIds, expectedUnitPrice: "20", expectedTaxRateId: "3", expectedTaxKind: "EXEMPT", expectedTaxRate: "0" };
}
function sale(overrides: Record<string, unknown> = {}) {
  return { requestId: randomUUID(), warehouseId: "1", customerName: "عميل تجريبي", customerPhone: "01000000000", discount: "10", initialPayment: "100", method: "CASH", lines: [line("1", "2", ["1", "2"]), line("2", "1", [])], ...overrides };
}
function movement(saleId: string, amount: string, extra: Record<string, unknown> = {}) { return { requestId: randomUUID(), saleId, amount, method: "CARD", ...extra }; }
async function expectProblem(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, (error: unknown) => error instanceof InventoryProblem && pattern.test(error.message));
}
async function setupInventory(pg: PGlite) {
  await pg.exec(baseline); await pg.exec(openingUpgrade); await pg.exec(receivingUpgrade);
  await pg.exec(`UPDATE tax_rates SET effective_from='2000-01-01' WHERE id=1;
    INSERT INTO tax_rates(code,name_ar,rate,kind,effective_from,is_active) VALUES('TEST-EX','معفى تجريبي',0,'EXEMPT','2000-01-01',TRUE);
    UPDATE products SET sale_price=105,tax_rate_id=1 WHERE id=1;
    UPDATE products SET sale_price=20,tax_rate_id=3 WHERE id=2;
    INSERT INTO users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES(2,'CS_AGENT','فرع آخر','other@example.test','fixture','ACTIVE',FALSE);`);
  await pg.query(`INSERT INTO inventory_openings(request_id,request_hash,warehouse_id,product_id,quantity,unit_cost,created_by_id) VALUES ($1::uuid,$2,1,1,3,10,1)`, [randomUUID(), "a".repeat(64)]);
  await pg.query(`INSERT INTO inventory_openings(request_id,request_hash,warehouse_id,product_id,quantity,unit_cost,created_by_id) VALUES ($1::uuid,$2,2,1,1,20,1)`, [randomUUID(), "b".repeat(64)]);
  await pg.exec(`INSERT INTO inventory_serials(opening_id,serial_number,serial_key) VALUES(1,'S1','S1'),(1,'S2','S2'),(1,'S3','S3'),(2,'B1','B1');
    INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES(1,1,3,10),(1,2,10,4),(2,1,1,20);`);
}

test("isolated sales, money and returns", { timeout: 120_000 }, async (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "selahtone-commerce-test-"));
  let pg: PGlite | undefined;
  let db: ClientType | undefined;
  try {
    symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
    const originalSchema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const testSchema = originalSchema.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"\n  engineType = "client"');
    assert.notEqual(testSchema, originalSchema);
    const schemaPath = path.join(tmp, "schema.prisma"); writeFileSync(schemaPath, testSchema);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: tmp, TMPDIR: process.env.TMPDIR, NODE_ENV: "test", DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture", DIRECT_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" };
    if (process.env.PRISMA_SCHEMA_ENGINE_BINARY) env.PRISMA_SCHEMA_ENGINE_BINARY = process.env.PRISMA_SCHEMA_ENGINE_BINARY;
    if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) env.PRISMA_QUERY_ENGINE_LIBRARY = process.env.PRISMA_QUERY_ENGINE_LIBRARY;
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "generate", `--schema=${schemaPath}`], { cwd: root, env, stdio: "pipe" });
    const localRequire = createRequire(path.join(root, "package.json"));
    const { PrismaClient: TestClient } = localRequire(path.join(tmp, "client")) as { PrismaClient: typeof import("@prisma/client").PrismaClient };

    await t.test("migration collision rolls back DDL and retains existing stock and serials", async () => {
      const other = new PGlite();
      try {
        await setupInventory(other);
        await other.exec("CREATE INDEX inventory_serials_current_sale_line_id_idx ON inventory_serials(id)");
        await assert.rejects(() => other.exec(commerceUpgrade));
        const state = await other.query<{ table_name: string | null; column_count: number }>(`SELECT to_regclass('public.commerce_sales') AS table_name,
          (SELECT count(*)::int FROM information_schema.columns WHERE table_name='inventory_serials' AND column_name='current_sale_line_id') AS column_count`);
        assert.equal(state.rows[0].table_name, null); assert.equal(Number(state.rows[0].column_count), 0);
        const serials = await other.query<{ count: number }>("SELECT count(*)::int AS count FROM inventory_serials"); assert.equal(Number(serials.rows[0].count), 4);
        const levels = await other.query<{ qty: string }>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=1 AND product_id=1"); assert.equal(levels.rows[0].qty, "3.00");
      } finally { await other.close(); }
    });
    pg = new PGlite(); await setupInventory(pg); await pg.exec(commerceUpgrade); await pg.exec(catalogUpgrade);
    db = new TestClient({ adapter: new PrismaPGlite(pg) as never }); const client = db;
    let saleId = ""; let aidLineId = "";

    await t.test("roles, branch scope, stale prices and discount cap reject before committing", async () => {
      await expectProblem(() => createCommerceSale(client, 2n, sale()), /صلاحية/);
      await expectProblem(() => createCommerceSale(client, 5n, sale()), /صلاحية/);
      await expectProblem(() => createCommerceSale(client, 4n, sale()), /صلاحية/);
      await expectProblem(() => createCommerceSale(client, 3n, sale({ discount: "11.51" })), /حد المسموح/);
      await expectProblem(() => createCommerceSale(client, 3n, sale({ lines: [{ ...line("1", "1", ["1"]), expectedUnitPrice: "100" }] })), /تغيّر السعر/);
      await expectProblem(() => createCommerceSale(client, 3n, sale({ lines: [{ ...line("1", "1", ["1"]), expectedTaxRate: "14" }] })), /تغيّر السعر/);
      await expectProblem(() => createCommerceSale(client, 3n, sale({ lines: [{ ...line("1", "1", ["1"]), productId: "5" }] })), /غير محددة/);
      assert.equal(await client.commerceSale.count(), 0);
    });

    await t.test("serial search is scoped, literal and restricted to selling roles", async () => {
      const query = (warehouseId: string, q: string) => ({ warehouseId, productId: "1", query: q });
      const results = await searchAvailableSaleSerials(client, 3n, query("1", "s"));
      assert.deepEqual(results.serials.map((item) => item.number), ["S3", "S2", "S1"]);
      assert.deepEqual((await searchAvailableSaleSerials(client, 3n, query("1", "S_"))).serials, []);
      assert.deepEqual((await searchAvailableSaleSerials(client, 3n, query("1", "%"))).serials, []);
      await expectProblem(() => searchAvailableSaleSerials(client, 3n, query("2", "B")), /صلاحية/);
      await expectProblem(() => searchAvailableSaleSerials(client, 2n, query("1", "S")), /صلاحية/);
      assert.deepEqual((await searchAvailableSaleSerials(client, 1n, query("2", "B"))).serials.map((item) => item.number), ["B1"]);
    });

    await t.test("sale atomically snapshots inclusive tax, cost, first payment and serials", async () => {
      const input = sale();
      const result = await createCommerceSale(client, 3n, input); saleId = result.id;
      assert.equal(result.replayed, false); assert.equal((await createCommerceSale(client, 3n, input)).replayed, true);
      await expectProblem(() => createCommerceSale(client, 3n, { ...input, customerName: "اسم مختلف" }), /بيانات مختلفة/);
      const saved = await client.commerceSale.findUniqueOrThrow({ where: { id: BigInt(saleId) }, include: { lines: true, collections: true } });
      assert.equal(saved.subtotal.toFixed(2), "230.00"); assert.equal(saved.discount.toFixed(2), "10.00"); assert.equal(saved.total.toFixed(2), "220.00");
      assert.equal(saved.taxableBase!.plus(saved.taxTotal!).toFixed(2), saved.total.toFixed(2));
      const aid = saved.lines.find((item) => item.productId === 1n)!; aidLineId = aid.id.toString();
      assert.equal(aid.unitCost!.toFixed(4), "10.0000"); assert.equal(aid.taxRateSnapshot!.toFixed(3), "5.000");
      assert.equal(saved.collections.length, 1); assert.equal(saved.collections[0].amount.toFixed(2), "100.00"); assert.equal(saved.collections[0].isInitial, true);
      assert.equal((await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } })).qtyOnHand.toFixed(2), "1.00");
      assert.equal((await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 2n } } })).qtyOnHand.toFixed(2), "9.00");
      assert.equal(await client.inventorySerial.count({ where: { currentSaleLineId: BigInt(aidLineId) } }), 2);
      const available = await searchAvailableSaleSerials(client, 3n, { warehouseId: "1", productId: "1", query: "S" });
      assert.deepEqual(available.serials.map((item) => item.number), ["S3"]);
    });

    await t.test("unavailable or wrong-branch serial rolls back the entire sale and payment", async () => {
      const beforeSales = await client.commerceSale.count(); const beforeCollections = await client.commerceCollection.count();
      const before = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      await expectProblem(() => createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "10", lines: [line("1", "1", ["1"])] })), /غير متاح/);
      await expectProblem(() => createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "10", lines: [line("1", "1", ["4"])] })), /غير متاح/);
      assert.equal(await client.commerceSale.count(), beforeSales); assert.equal(await client.commerceCollection.count(), beforeCollections);
      const after = await client.stockLevel.findUniqueOrThrow({ where: { id: before.id } }); assert.equal(after.qtyOnHand.toFixed(2), before.qtyOnHand.toFixed(2));
    });

    await t.test("later collections honor permissions, remaining due and idempotency", async () => {
      await expectProblem(() => recordCommerceCollection(client, 5n, movement(saleId, "1")), /صلاحية/);
      await expectProblem(() => recordCommerceCollection(client, 2n, movement(saleId, "120.01")), /يزيد/);
      const payment = movement(saleId, "30", { method: "WALLET" });
      assert.equal((await recordCommerceCollection(client, 2n, payment)).replayed, false);
      assert.equal((await recordCommerceCollection(client, 2n, payment)).replayed, true);
      await expectProblem(() => recordCommerceCollection(client, 2n, { ...payment, amount: "31" }), /بيانات مختلفة/);
      assert.equal(await client.commerceCollection.count({ where: { saleId: BigInt(saleId) } }), 2);
    });

    await t.test("return after a new-cost receipt restores saved sale cost and only creates a liability", async () => {
      await receiveInventoryStock(client, 3n, { requestId: randomUUID(), productId: "1", warehouseId: "1", quantity: "1", unitCost: "30", serialNumbers: "RESTOCK-1", sourceReference: "" });
      let level = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      assert.equal(level.qtyOnHand.toFixed(2), "2.00"); assert.equal(level.avgCost.toFixed(4), "20.0000");
      const input = { requestId: randomUUID(), saleId, cancel: false, accepted: true, lines: [{ saleLineId: aidLineId, quantity: "1", serialIds: ["1"] }] };
      await expectProblem(() => returnCommerceSale(client, 3n, input), /صلاحية/);
      await expectProblem(() => returnCommerceSale(client, 2n, input), /صلاحية/);
      assert.equal((await returnCommerceSale(client, 1n, input)).replayed, false);
      assert.equal((await returnCommerceSale(client, 1n, input)).replayed, true);
      level = await client.stockLevel.findUniqueOrThrow({ where: { id: level.id } });
      assert.equal(level.qtyOnHand.toFixed(2), "3.00"); assert.equal(level.avgCost.toFixed(4), "16.6667");
      const returned = await client.commerceReturnLine.findFirstOrThrow({ where: { saleLineId: BigInt(aidLineId) } });
      assert.equal(returned.total.toFixed(2), "100.44");
      assert.equal(await client.commerceRefund.count({ where: { saleId: BigInt(saleId) } }), 0);
      assert.equal((await client.inventorySerial.findUniqueOrThrow({ where: { id: 1n } })).currentSaleLineId, null);
      await expectProblem(() => returnCommerceSale(client, 1n, { ...input, requestId: randomUUID() }), /غير متاح|سابقًا/);
    });

    await t.test("refunds are recorded only after actual payment and may be partial", async () => {
      await expectProblem(() => recordCommerceRefund(client, 2n, movement(saleId, "5", { actuallyPaid: false })), /راجع رد المبلغ/);
      await expectProblem(() => recordCommerceRefund(client, 3n, movement(saleId, "5", { actuallyPaid: true })), /صلاحية/);
      await expectProblem(() => recordCommerceRefund(client, 2n, movement(saleId, "10.45", { actuallyPaid: true })), /يزيد/);
      const refund = movement(saleId, "5", { actuallyPaid: true });
      assert.equal((await recordCommerceRefund(client, 2n, refund)).replayed, false);
      assert.equal((await recordCommerceRefund(client, 2n, refund)).replayed, true);
      await recordCommerceRefund(client, 1n, movement(saleId, "5.44", { actuallyPaid: true, method: "CASH" }));
      assert.equal(await client.commerceRefund.count({ where: { saleId: BigInt(saleId) } }), 2);
      await expectProblem(() => recordCommerceRefund(client, 1n, movement(saleId, "0.01", { actuallyPaid: true })), /يزيد/);
    });

    await t.test("returned serial can be resold, but not returned twice on its original sale", async () => {
      const second = await createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "105", lines: [line("1", "1", ["1"])] }));
      const secondLine = await client.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(second.id) } });
      assert.equal(secondLine.unitCost!.toFixed(4), "16.6667");
      await expectProblem(() => returnCommerceSale(client, 1n, { requestId: randomUUID(), saleId, cancel: false, accepted: true, lines: [{ saleLineId: aidLineId, quantity: "1", serialIds: ["1"] }] }), /غير متاح|سابقًا/);
      assert.equal(await client.commerceSaleLineSerial.count({ where: { serialId: 1n } }), 2);
    });

    await t.test("cancellation returns remaining quantities and does not automatically refund", async () => {
      const refundsBefore = await client.commerceRefund.count({ where: { saleId: BigInt(saleId) } });
      const result = await returnCommerceSale(client, 1n, { requestId: randomUUID(), saleId, cancel: true, accepted: true, lines: [] });
      const invoice = await client.commerceSale.findUniqueOrThrow({ where: { id: BigInt(saleId) }, include: { returns: { include: { lines: true } } } });
      assert.ok(invoice.cancelledAt); assert.ok(result.id);
      const returnedTotal = invoice.returns.flatMap((entry) => entry.lines).reduce((sum, entry) => sum.plus(entry.total), invoice.total.minus(invoice.total));
      assert.equal(returnedTotal.toFixed(2), invoice.total.toFixed(2));
      assert.equal(await client.commerceRefund.count({ where: { saleId: BigInt(saleId) } }), refundsBefore);
      assert.equal((await client.inventorySerial.findUniqueOrThrow({ where: { id: 2n } })).currentSaleLineId, null);
      await expectProblem(() => returnCommerceSale(client, 1n, { requestId: randomUUID(), saleId, cancel: true, accepted: true, lines: [] }), /ملغاة/);
    });

    await t.test("manager controls the staff discount setting, with an audit and safe retry", async () => {
      const setting = { requestId: randomUUID(), percent: "7.5" };
      await expectProblem(() => changeStaffDiscountLimit(client, 2n, setting), /صلاحية/);
      await changeStaffDiscountLimit(client, 1n, setting);
      assert.equal((await changeStaffDiscountLimit(client, 1n, setting)).replayed, true);
      assert.equal((await client.commerceSettings.findUniqueOrThrow({ where: { id: 1 } })).staffDiscountBps, 750);
      assert.equal(await client.commerceSettingsChange.count(), 1);
      const permitted = sale({ discount: "6", initialPayment: "10", lines: [line("1", "1", ["2"])] });
      await createCommerceSale(client, 3n, permitted);
    });

    await t.test("missing, unsupported, inconsistent and inactive tax is never silently exempt", async () => {
      const draft = () => sale({ discount: "0", initialPayment: "1", lines: [line("1", "1", ["3"])] });
      await pg!.exec("UPDATE tax_rates SET kind='COMPOSITE' WHERE id=1");
      await expectProblem(() => createCommerceSale(client, 3n, draft()), /مراجعة منفصلتين/);
      await pg!.exec("UPDATE tax_rates SET kind='EXEMPT', rate=5 WHERE id=1");
      await expectProblem(() => createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "1", lines: [{ ...line("1", "1", ["3"]), expectedTaxKind: "EXEMPT" }] })), /يجب أن يساوي صفرًا/);
      await pg!.exec("UPDATE tax_rates SET kind='VAT', rate=5, is_active=false WHERE id=1");
      await expectProblem(() => createCommerceSale(client, 3n, draft()), /غير محددة أو غير سارية/);
      await pg!.exec("UPDATE tax_rates SET is_active=true WHERE id=1");
    });

    await t.test("concurrent requests cannot double-sell a serial, over-collect, double-return or over-refund", async () => {
      const beforeStock = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      const left = sale({ discount: "0", initialPayment: "1", lines: [line("1", "1", ["3"])] });
      const right = sale({ discount: "0", initialPayment: "1", lines: [line("1", "1", ["3"])] });
      const race = await Promise.allSettled([createCommerceSale(client, 3n, left), createCommerceSale(client, 3n, right)]);
      const winners = race.filter((entry): entry is PromiseFulfilledResult<{ id: string; replayed: boolean }> => entry.status === "fulfilled");
      assert.equal(winners.length, 1);
      const raceSaleId = winners[0].value.id;
      const afterStock = await client.stockLevel.findUniqueOrThrow({ where: { id: beforeStock.id } });
      assert.equal(Number(beforeStock.qtyOnHand.toFixed(2)) - Number(afterStock.qtyOnHand.toFixed(2)), 1);
      const saleLine = await client.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(raceSaleId) } });
      const collections = await Promise.allSettled([recordCommerceCollection(client, 2n, movement(raceSaleId, "70")), recordCommerceCollection(client, 3n, movement(raceSaleId, "70"))]);
      assert.equal(collections.filter((entry) => entry.status === "fulfilled").length, 1);
      const aggregate = await client.commerceCollection.aggregate({ where: { saleId: BigInt(raceSaleId) }, _sum: { amount: true } });
      assert.equal(aggregate._sum.amount!.toFixed(2), "71.00");
      const makeReturn = () => ({ requestId: randomUUID(), saleId: raceSaleId, cancel: false, accepted: true, lines: [{ saleLineId: saleLine.id.toString(), quantity: "1", serialIds: ["3"] }] });
      const returns = await Promise.allSettled([returnCommerceSale(client, 1n, makeReturn()), returnCommerceSale(client, 1n, makeReturn())]);
      assert.equal(returns.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(await client.commerceReturnLine.count({ where: { saleLineId: saleLine.id } }), 1);
      const refunds = await Promise.allSettled([recordCommerceRefund(client, 2n, movement(raceSaleId, "50", { actuallyPaid: true })), recordCommerceRefund(client, 1n, movement(raceSaleId, "50", { actuallyPaid: true }))]);
      assert.equal(refunds.filter((entry) => entry.status === "fulfilled").length, 1);
      const refundSum = await client.commerceRefund.aggregate({ where: { saleId: BigInt(raceSaleId) }, _sum: { amount: true } });
      assert.equal(refundSum._sum.amount!.toFixed(2), "50.00");
    });

    await t.test("a late database error rolls back the stock, serial, invoice and initial collection", async () => {
      await pg!.exec(`CREATE FUNCTION reject_initial_payment() RETURNS trigger AS $$ BEGIN
        IF NEW.is_initial THEN RAISE EXCEPTION 'intentional payment failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_initial_payment BEFORE INSERT ON commerce_collections FOR EACH ROW EXECUTE FUNCTION reject_initial_payment();`);
      const beforeSales = await client.commerceSale.count();
      const beforeLevel = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      assert.equal((await client.inventorySerial.findUniqueOrThrow({ where: { id: 3n } })).currentSaleLineId, null);
      await assert.rejects(() => createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "1", lines: [line("1", "1", ["3"])] })));
      assert.equal(await client.commerceSale.count(), beforeSales);
      assert.equal((await client.stockLevel.findUniqueOrThrow({ where: { id: beforeLevel.id } })).qtyOnHand.toFixed(2), beforeLevel.qtyOnHand.toFixed(2));
      assert.equal((await client.inventorySerial.findUniqueOrThrow({ where: { id: 3n } })).currentSaleLineId, null);
      await pg!.exec("DROP TRIGGER reject_initial_payment ON commerce_collections; DROP FUNCTION reject_initial_payment()");
    });

    await t.test("a late return error does not release serials or change stock", async () => {
      const made = await createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "1", lines: [line("1", "1", ["3"])] }));
      const madeLine = await client.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(made.id) } });
      await pg!.exec(`CREATE FUNCTION reject_return_serial() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'intentional return failure'; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_return_serial BEFORE INSERT ON commerce_return_serials FOR EACH ROW EXECUTE FUNCTION reject_return_serial();`);
      const before = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      await assert.rejects(() => returnCommerceSale(client, 1n, { requestId: randomUUID(), saleId: made.id, cancel: false, accepted: true, lines: [{ saleLineId: madeLine.id.toString(), quantity: "1", serialIds: ["3"] }] }));
      assert.equal(await client.commerceReturn.count({ where: { saleId: BigInt(made.id) } }), 0);
      assert.equal((await client.inventorySerial.findUniqueOrThrow({ where: { id: 3n } })).currentSaleLineId, madeLine.id);
      assert.equal((await client.stockLevel.findUniqueOrThrow({ where: { id: before.id } })).qtyOnHand.toFixed(2), before.qtyOnHand.toFixed(2));
    });
    await t.test("a cash refund leaves the chosen account in the same transaction, and a failed one leaves nothing", async () => {
      const legacyCategories = readFileSync(path.join(root, "tests/fixtures/finance-legacy-categories.sql"), "utf8");
      const financeUpgrade = readFileSync(path.join(root, "prisma/manual-finance-release-upgrade.sql"), "utf8");
      const settlementUpgrade = readFileSync(path.join(root, "prisma/manual-settlement-upgrade.sql"), "utf8");
      await pg!.exec(legacyCategories); await pg!.exec(financeUpgrade); await pg!.exec(settlementUpgrade);
      await pg!.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',3,1000,'2026-10-20',1)`);
      const accountId = String((await pg!.query<{ id: number }>(`SELECT id FROM finance.accounts WHERE kind='CUSTODY'`)).rows[0].id);
      const balanceOf = async () => (await pg!.query<{ balance: string }>(
        `SELECT (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
           FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0))::text AS balance
         FROM finance.accounts a WHERE a.id=$1::bigint`, [accountId])).rows[0].balance;

      const previous = process.env.FINANCE_ENABLED; process.env.FINANCE_ENABLED = "true";
      try {
        // صنف غير مسلسل: السيريالات المستخدمة في الاختبارات السابقة لم تعد متاحة.
        const made = await createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "20", lines: [line("2", "1", [])] }));
        const saleLine = await client.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(made.id) } });
        // مرتجع كامل: يولّد مبلغًا مستحقًا للعميل، ولا يحرك نقدًا بذاته.
        await returnCommerceSale(client, 1n, { requestId: randomUUID(), saleId: made.id, cancel: false, accepted: true, lines: [{ saleLineId: saleLine.id.toString(), quantity: "1", serialIds: [] }] });
        assert.equal(await balanceOf(), "1000.00");

        // رد نقدي بلا حساب مرفوض قبل أي حركة: النقد يخرج ولا نعرف من أين.
        await assert.rejects(
          () => recordCommerceRefund(client, 1n, { requestId: randomUUID(), saleId: made.id, amount: "20", method: "CASH", actuallyPaid: true }),
          (error: unknown) => error instanceof InventoryProblem && JSON.stringify(error).includes("الحساب"),
        );

        await recordCommerceRefund(client, 1n, { requestId: randomUUID(), saleId: made.id, amount: "20", method: "CASH", actuallyPaid: true, accountId, negativeAcknowledged: false });
        const movements = await pg!.query<{ kind: string; amount: string; source: string | null; external: string | null }>(
          `SELECT kind::text AS kind, amount::text AS amount, source_id::text AS source, external_ref AS external FROM finance.movements ORDER BY id`);
        assert.equal(movements.rows.length, 1);
        assert.equal(movements.rows[0].kind, "REFUND");
        assert.equal(movements.rows[0].amount, "20.00");
        assert.equal(movements.rows[0].source, accountId);
        assert.match(movements.rows[0].external ?? "", /^refund:\d+$/);
        assert.equal(await balanceOf(), "980.00");

        // الرد غير النقدي لا يحرك نقد الفرع ولو أُرسل حساب.
        const other = await createCommerceSale(client, 3n, sale({ discount: "0", initialPayment: "20", lines: [line("2", "1", [])] }));
        const otherLine = await client.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(other.id) } });
        await returnCommerceSale(client, 1n, { requestId: randomUUID(), saleId: other.id, cancel: false, accepted: true, lines: [{ saleLineId: otherLine.id.toString(), quantity: "1", serialIds: [] }] });
        await recordCommerceRefund(client, 1n, { requestId: randomUUID(), saleId: other.id, amount: "20", method: "CARD", actuallyPaid: true, accountId: "9" });
        assert.equal((await pg!.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.movements`)).rows[0].n, 1);
        assert.equal(await balanceOf(), "980.00");
      } finally {
        if (previous === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = previous;
      }
    });
  } finally {
    if (db) await db.$disconnect(); if (pg) await pg.close(); rmSync(tmp, { recursive: true, force: true });
  }
});

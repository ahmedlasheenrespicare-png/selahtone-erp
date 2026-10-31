/**
 * Isolated tests for the catalog (manual-price) sales engine: no warehouse, no
 * stock, no serials, and «الضريبة غير محددة» stored as NULL — never as zero.
 * Every case runs on a disposable PGlite database with the manual migrations
 * applied, and never touches DATABASE_URL.
 */
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
import { createCatalogSale, createSalesCategory, listCatalogAudit, loadSalesCatalog, setSalesTypeActive } from "../src/lib/catalog-sales";

const root = process.cwd();
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

async function expectProblem(work: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(work, (error: unknown) => error instanceof InventoryProblem && pattern.test(error.message));
}

test("catalog sales run without a warehouse, without stock and with unknown tax", { timeout: 300_000 }, async (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "selahtone-catalog-test-"));
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

    pg = new PGlite();
    await pg.exec(read("tests/fixtures/inventory-baseline.sql"));
    await pg.exec(read("prisma/manual-inventory-upgrade.sql"));
    await pg.exec(read("prisma/manual-receiving-upgrade.sql"));
    await pg.exec(read("prisma/manual-commerce-upgrade.sql"));
    await pg.exec(read("prisma/manual-catalog-sales-upgrade.sql"));
    await pg.exec(`INSERT INTO users(branch_id,role_code,full_name,email,password_hash,status,must_change_password)
      VALUES (2,'CS_AGENT','فرع آخر','other@example.test','fixture','ACTIVE',FALSE)`);
    db = new TestClient({ adapter: new PrismaPGlite(pg) as never });
    const client = db;

    const catalog = await loadSalesCatalog(client);
    assert.deepEqual(catalog.map((category) => category.name), ["بطاريات", "قوالب", "صيانة", "سماعة", "أخرى"]);
    assert.equal(catalog.reduce((sum, category) => sum + category.types.length, 0), 15);
    const battery = catalog[0]!.types.find((type) => type.name === "مقاس 13")!;
    const maintenance = catalog[2]!.types[0]!;
    assert.deepEqual(maintenance.fields.map((field) => field.label), ["نوع السماعة", "بيان الحالة", "بيان الصيانة"]);

    const maintenanceLine = (values: Record<string, string>) => ({
      typeId: maintenance.id, quantity: "1", unitPrice: "100",
      details: maintenance.fields.map((field) => ({ key: field.key, value: values[field.key] ?? "مكتوب" })),
    });
    const filled = { device_type: "سماعة خلف الأذن", condition_note: "شقوق بالقالب", work_note: "تبديل قالب" };
    const saleInput = (overrides: Record<string, unknown> = {}) => ({
      requestId: randomUUID(), branchId: "1", customerName: "عميل تجريبي", customerPhone: "01000000000",
      discount: "0", initialPayment: "100", method: "CASH",
      lines: [{ typeId: battery.id, quantity: "2", unitPrice: "150", details: [] }, maintenanceLine(filled)],
      ...overrides,
    });

    await t.test("a sale is recorded without stock, serials or tax", async () => {
      const input = saleInput();
      const result = await createCatalogSale(client, 3n, input);
      const saved = await client.commerceSale.findUniqueOrThrow({ where: { id: BigInt(result.id) }, include: { lines: true, collections: true } });
      assert.equal(result.replayed, false);
      assert.equal(saved.warehouseId, null);
      assert.equal(saved.subtotal.toFixed(2), "400.00");
      assert.equal(saved.total.toFixed(2), "400.00");
      // الضريبة غير محددة: فراغ لا صفر.
      assert.equal(saved.taxTotal, null);
      assert.equal(saved.taxableBase, null);
      assert.equal(saved.lines.length, 2);
      for (const line of saved.lines) {
        assert.equal(line.productId, null);
        assert.equal(line.isStock, false);
        assert.equal(line.isSerialized, false);
        assert.equal(line.taxAmount, null);
        assert.equal(line.taxKindSnapshot, null);
      }
      const batteryLine = saved.lines.find((line) => line.catalogTypeId === BigInt(battery.id))!;
      assert.equal(batteryLine.quantity.toFixed(2), "2.00");
      assert.equal(batteryLine.unitPrice.toFixed(2), "150.00");
      assert.equal(batteryLine.total.toFixed(2), "300.00");
      assert.equal(batteryLine.categorySnapshot, "بطاريات");
      assert.equal(batteryLine.typeSnapshot, "مقاس 13");
      const details = saved.lines.find((line) => line.catalogTypeId === BigInt(maintenance.id))!.details as { entries: Array<{ key: string; label: string; value: string }> };
      assert.deepEqual(details.entries.map((entry) => entry.label), ["نوع السماعة", "بيان الحالة", "بيان الصيانة"]);
      assert.equal(details.entries[0]!.value, "سماعة خلف الأذن");
      assert.equal(saved.collections.length, 1);
      assert.equal(saved.collections[0]!.isInitial, true);
      assert.equal(saved.collections[0]!.amount.toFixed(2), "100.00");
      // لا أثر على المخزون أو السيريالات.
      assert.equal(await client.commerceSaleLineSerial.count(), 0);
      assert.equal(await client.inventorySerial.count({ where: { currentSaleLineId: { not: null } } }), 0);
    });

    await t.test("idempotency replays the same request and rejects a changed one", async () => {
      const input = saleInput();
      const first = await createCatalogSale(client, 3n, input);
      assert.equal(first.replayed, false);
      assert.equal((await createCatalogSale(client, 3n, input)).replayed, true);
      await expectProblem(() => createCatalogSale(client, 3n, { ...input, customerName: "اسم آخر" }), /بيانات مختلفة/);
      assert.equal(await client.commerceSale.count(), 2);
    });

    await t.test("staff limits, branches and required fields are enforced", async () => {
      await expectProblem(() => createCatalogSale(client, 3n, saleInput({ branchId: "2" })), /صلاحية/);
      await expectProblem(() => createCatalogSale(client, 2n, saleInput()), /صلاحية/);
      await expectProblem(() => createCatalogSale(client, 1n, saleInput({ branchId: "999" })), /الفرع غير موجود/);
      await expectProblem(() => createCatalogSale(client, 3n, saleInput({ discount: "50" })), /الحد المسموح/);
      await expectProblem(() => createCatalogSale(client, 3n, saleInput({ initialPayment: "500" })), /التحصيل|المتبقي/);
      await expectProblem(() => createCatalogSale(client, 3n, saleInput({ lines: [maintenanceLine({ ...filled, condition_note: "" })] })), /بيان الحالة/);
      await expectProblem(() => createCatalogSale(client, 3n, saleInput({ lines: [{ typeId: battery.id, quantity: "1", unitPrice: "10", details: [] }, { typeId: battery.id, quantity: "1", unitPrice: "10", details: [] }] })), /لا تكرر/);
      await expectProblem(() => createCatalogSale(client, 3n, saleInput({ lines: [{ typeId: maintenance.id, quantity: "1", unitPrice: "10", details: [{ key: "unknown_field", value: "x" }] }] })), /غير معروفة|غير محددة|راجع/);
      assert.equal(await client.commerceSale.count(), 2);
    });

    await t.test("a stopped type cannot be sold, and stopping keeps history", async () => {
      await setSalesTypeActive(client, 1n, { requestId: randomUUID(), id: battery.id, active: false, reason: "إيقاف تجريبي" });
      await expectProblem(() => setSalesTypeActive(client, 3n, { requestId: randomUUID(), id: battery.id, active: true, reason: "محاولة من موظف" }), /للمدير فقط/);
      await expectProblem(() => createCatalogSale(client, 3n, saleInput()), /غير متاح أو موقوف/);
      const stopped = await loadSalesCatalog(client);
      assert.equal(stopped[0]!.types.some((type) => type.id === battery.id), false);
      const all = await loadSalesCatalog(client, true);
      const row = all[0]!.types.find((type) => type.id === battery.id)!;
      assert.equal(row.isActive, false);
      await setSalesTypeActive(client, 1n, { requestId: randomUUID(), id: battery.id, active: true, reason: "إعادة تشغيل بعد المراجعة" });
    });

    await t.test("catalog administration is manager-only, audited and replayable", async () => {
      await expectProblem(() => createSalesCategory(client, 3n, { requestId: randomUUID(), code: "NEW", nameAr: "جديد", sortOrder: 5 }), /للمدير فقط/);
      const requestId = randomUUID();
      const created = await createSalesCategory(client, 1n, { requestId, code: "NEW", nameAr: "جديد", sortOrder: 5 });
      assert.equal(created.replayed, false);
      assert.equal((await createSalesCategory(client, 1n, { requestId, code: "NEW", nameAr: "جديد", sortOrder: 5 })).replayed, true);
      await expectProblem(() => createSalesCategory(client, 1n, { requestId: randomUUID(), code: "NEW", nameAr: "مكرر", sortOrder: 6 }), /مستخدم بالفعل|تعارض/);
      const audit = await listCatalogAudit(client, 1n);
      assert.ok(audit.length >= 3);
      assert.equal(audit[0]!.entity, "CATEGORY");
      assert.equal(audit[0]!.action, "CREATE");
      assert.equal(audit[0]!.actor, "مدير تجريبي");
      assert.ok(audit.some((row) => row.reason === "إعادة تشغيل بعد المراجعة"));
      await expectProblem(() => listCatalogAudit(client, 3n), /للمدير فقط/);
    });
  } finally {
    if (db) await db.$disconnect();
    if (pg) await pg.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

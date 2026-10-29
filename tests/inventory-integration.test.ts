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
import { createInventoryOpening, createInventoryProduct, InventoryProblem } from "../src/lib/inventory-operations";
import { escapeLikeLiteral, parseProductInput, type ProductInputRaw } from "../src/lib/inventory-validation";

const root = process.cwd();
const baseline = readFileSync(path.join(root, "tests/fixtures/inventory-baseline.sql"), "utf8");
const preflight = readFileSync(path.join(root, "prisma/manual-inventory-preflight.sql"), "utf8");
const permissions = readFileSync(path.join(root, "prisma/manual-inventory-permissions.sql"), "utf8");
const upgrade = readFileSync(path.join(root, "prisma/manual-inventory-upgrade.sql"), "utf8");
const verification = readFileSync(path.join(root, "prisma/verify-manual-inventory.sql"), "utf8");
const inspection = readFileSync(path.join(root, "prisma/inspect-manual-inventory.sql"), "utf8");

function makeProduct(requestId: string): ProductInputRaw {
  return { requestId, sku: "new-ha", nameAr: "سماعة اختبار", category: "HEARING_AID", brand: "تجريبية", model: "X", purchaseCost: "1200.50", salePrice: "2100", taxRateId: "1", isSerialized: false };
}
function validProduct(raw: ProductInputRaw) {
  const parsed = parseProductInput(raw);
  assert.ok(parsed.ok);
  return parsed.value;
}
async function expectProblem(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, (error: unknown) => error instanceof InventoryProblem && pattern.test(error.message));
}

/** PGlite is strictly local/in-memory. No DATABASE_URL from the environment is used. */
test("isolated inventory transactions, authorization, serials and upgrade", { timeout: 120_000 }, async (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "selahtone-inventory-test-"));
  let pg: PGlite | undefined;
  let db: ClientType | undefined;
  try {
    // Use the Prisma JS engine + local PGlite adapter solely for this integration test.
    // Production keeps its existing native Prisma engine and database configuration.
    symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
    const originalSchema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const testSchema = originalSchema.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"\n  engineType = "client"');
    assert.notEqual(testSchema, originalSchema);
    const schemaPath = path.join(tmp, "schema.prisma");
    writeFileSync(schemaPath, testSchema);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: tmp,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture",
      DIRECT_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture",
      PRISMA_GENERATE_SKIP_AUTOINSTALL: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    };
    if (process.env.PRISMA_SCHEMA_ENGINE_BINARY) env.PRISMA_SCHEMA_ENGINE_BINARY = process.env.PRISMA_SCHEMA_ENGINE_BINARY;
    if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) env.PRISMA_QUERY_ENGINE_LIBRARY = process.env.PRISMA_QUERY_ENGINE_LIBRARY;
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "generate", `--schema=${schemaPath}`], { cwd: root, env, stdio: "pipe" });
    const localRequire = createRequire(path.join(root, "package.json"));
    const { PrismaClient: TestClient } = localRequire(path.join(tmp, "client")) as { PrismaClient: typeof import("@prisma/client").PrismaClient };

    await t.test("upgrade collision rolls back all newly created tables", async () => {
      const other = new PGlite();
      try {
        await other.exec(baseline);
        await other.exec(preflight);
        const access = JSON.parse((await other.query<{ result: string }>(permissions)).rows[0].result);
        assert.deepEqual(access.column_mismatches, []);
        assert.equal(access.create_tables, true);
        assert.equal(access.insert_products, true);
        assert.equal(access.insert_stock, true);
        assert.equal(access.products_unique_valid, true);
        assert.equal(access.stock_unique_valid, true);
        assert.equal(access.read_only_transaction, false);
        assert.equal((await other.query<{ name: string | null }>("SELECT to_regclass('public.inventory_openings') AS name")).rows[0].name, null);
        const absent = JSON.parse((await other.query<{ result: string }>(verification)).rows[0].result);
        assert.ok(absent.missing_objects.length > 0);
        assert.ok(absent.missing_constraints.length > 0);
        assert.ok(absent.invalid_unique_indexes.length > 0);
        assert.ok(absent.foreign_key_mismatches.length > 0);
        assert.ok(absent.column_mismatches.length > 0);
        await other.exec("CREATE TABLE inventory_serials(id INT PRIMARY KEY)");
        await assert.rejects(() => other.exec(upgrade));
        // The upgrade is one DO statement: its earlier CREATEs must already be rolled back.
        const result = await other.query<{ name: string | null }>("SELECT to_regclass('public.inventory_openings') AS name");
        assert.equal(result.rows[0].name, null);
      } finally { await other.close(); }
    });

    await t.test("post-upgrade verification detects incorrect indexes and foreign keys", async () => {
      const other = new PGlite();
      try {
        await other.exec(baseline);
        await other.exec(upgrade);
        await other.exec(`
          DROP INDEX public.inventory_serials_serial_key_key;
          CREATE INDEX inventory_serials_serial_key_key ON public.inventory_serials(serial_key);
          ALTER TABLE public.inventory_openings DROP CONSTRAINT inventory_openings_product_id_fkey;
          ALTER TABLE public.inventory_openings ADD CONSTRAINT inventory_openings_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE ON UPDATE CASCADE;
        `);
        const result = JSON.parse((await other.query<{ result: string }>(verification)).rows[0].result);
        assert.ok(result.invalid_unique_indexes.includes("inventory_serials_serial_key_key"));
        assert.ok(result.foreign_key_mismatches.includes("inventory_openings_product_id_fkey"));
      } finally { await other.close(); }
    });

    pg = new PGlite();
    await pg.exec(baseline);
    await pg.exec(upgrade);
    const verified = JSON.parse((await pg.query<{ result: string }>(verification)).rows[0].result);
    assert.deepEqual(verified.missing_objects, []);
    assert.deepEqual(verified.missing_constraints, []);
    assert.deepEqual(verified.invalid_unique_indexes, []);
    assert.deepEqual(verified.foreign_key_mismatches, []);
    assert.deepEqual(verified.column_mismatches, []);
    assert.equal(verified.products_count, 5);
    assert.equal(verified.stock_rows, 1);
    const inspected = JSON.parse((await pg.query<{ result: string }>(inspection)).rows[0].result);
    assert.equal(inspected.products_count, 5);
    assert.equal(inspected.stock_rows, 1);
    assert.equal(inspected.openings_rows, 0);
    assert.equal(inspected.serials_rows, 0);
    assert.equal(inspected.product_creation_rows, 0);
    assert.equal(inspected.columns.length, 20);
    // PostgreSQL 18 also exposes NOT NULL constraints in pg_constraint.
    assert.ok(inspected.constraints.length >= 15);
    assert.equal(inspected.indexes.length, 11);
    assert.ok(inspected.indexes.every((index: string) => index.includes("|valid:t|ready:t|")));
    db = new TestClient({ adapter: new PrismaPGlite(pg) as never });
    const client = db;
    let createdProductId = "";

    await t.test("product creation checks roles, SKU, tax and idempotent retries", async () => {
      const input = validProduct(makeProduct(randomUUID()));
      const created = await createInventoryProduct(client, 1n, input);
      createdProductId = created.id;
      assert.equal(created.replayed, false);
      assert.equal((await client.product.findUniqueOrThrow({ where: { id: BigInt(created.id) } })).isSerialized, true);
      assert.equal((await client.inventoryProductCreation.findFirstOrThrow({ where: { productId: BigInt(created.id) } })).createdById, 1n);
      assert.equal((await createInventoryProduct(client, 1n, input)).replayed, true);
      await expectProblem(() => createInventoryProduct(client, 1n, { ...input, nameAr: "اسم مختلف" }), /بيانات مختلفة/);
      await expectProblem(() => createInventoryProduct(client, 1n, { ...input, requestId: randomUUID(), sku: "exist-ha" }), /رمز الصنف مستخدم/);
      await expectProblem(() => createInventoryProduct(client, 3n, { ...input, requestId: randomUUID(), sku: "STAFF" }), /المحاسب فقط/);
      await expectProblem(() => createInventoryProduct(client, 4n, { ...input, requestId: randomUUID(), sku: "BLOCKED" }), /المحاسب فقط/);
      await expectProblem(() => createInventoryProduct(client, 2n, { ...input, requestId: randomUUID(), sku: "BAD-TAX", taxRateId: 2 }), /الضريبة المختار/);
      assert.equal(await client.product.count(), 6);
      await createInventoryProduct(client, 1n, { ...input, requestId: randomUUID(), sku: "ABC1X" });
      await createInventoryProduct(client, 1n, { ...input, requestId: randomUUID(), sku: "ABC_X" });
      assert.equal(await client.product.count(), 8, "underscore in an SKU must be compared literally");
    });

    await t.test("opening is exact, idempotent and never overwrites stock or serials", async () => {
      const opening = { requestId: randomUUID(), productId: createdProductId, warehouseId: "1", quantity: "2", unitCost: "1234.1234", serialNumbers: "SN-1\nSN-2" };
      const saved = await createInventoryOpening(client, 1n, opening);
      assert.equal(saved.replayed, false);
      const level = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: BigInt(createdProductId) } } });
      assert.equal(level.qtyOnHand.toString(), "2");
      assert.equal(level.avgCost.toString(), "1234.1234");
      assert.equal(await client.inventorySerial.count({ where: { openingId: BigInt(saved.id) } }), 2);
      assert.equal((await createInventoryOpening(client, 1n, opening)).replayed, true);
      await expectProblem(() => createInventoryOpening(client, 2n, opening), /بيانات مختلفة/);
      await expectProblem(() => createInventoryOpening(client, 1n, { ...opening, requestId: randomUUID() }), /يوجد رصيد مسجّل/);
      await expectProblem(() => createInventoryOpening(client, 1n, { ...opening, requestId: randomUUID(), warehouseId: "2", serialNumbers: "sn-١\nDIFFERENT" }), /مسجّل بالفعل/);
      assert.equal(await client.stockLevel.count({ where: { warehouseId: 2n, productId: BigInt(createdProductId) } }), 0);
      await expectProblem(() => createInventoryOpening(client, 1n, { ...opening, requestId: randomUUID(), warehouseId: "2", serialNumbers: "ONLY-ONE" }), /راجع البيانات/);
      await expectProblem(() => createInventoryOpening(client, 3n, { ...opening, requestId: randomUUID(), warehouseId: "2", serialNumbers: "S3\nS4" }), /المحاسب فقط/);
      await expectProblem(() => createInventoryOpening(client, 1n, { ...opening, requestId: randomUUID(), productId: "5", serialNumbers: "", quantity: "1" }), /يوجد رصيد مسجّل/);
      await expectProblem(() => createInventoryOpening(client, 1n, { ...opening, requestId: randomUUID(), warehouseId: "3", serialNumbers: "S3\nS4" }), /المستودع أو الفرع غير نشط/);
      await expectProblem(() => createInventoryOpening(client, 1n, { ...opening, requestId: randomUUID(), productId: "3", serialNumbers: "", quantity: "1" }), /خدمة/);
    });

    await t.test("database failure rolls back stock, opening and serials together", async () => {
      await pg!.exec(`ALTER TABLE inventory_serials ADD CONSTRAINT force_fixture_error CHECK (serial_number <> 'FAILME')`);
      const failing = { requestId: randomUUID(), productId: createdProductId, warehouseId: "2", quantity: "2", unitCost: "3", serialNumbers: "SAFE\nFAILME" };
      await assert.rejects(() => createInventoryOpening(client, 1n, failing));
      assert.equal(await client.stockLevel.count({ where: { warehouseId: 2n, productId: BigInt(createdProductId) } }), 0);
      assert.equal(await client.inventoryOpening.count({ where: { requestId: failing.requestId } }), 0);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: "SAFE" } }), 0);
    });

    await t.test("serial queries respect branch scope", async () => {
      await createInventoryOpening(client, 2n, { requestId: randomUUID(), productId: createdProductId, warehouseId: "2", quantity: "3", unitCost: "3", serialNumbers: "BRANCH2-A\nBRANCH2_B\nBRANCH2\\B" });
      const branch1 = await client.inventorySerial.findMany({ where: { opening: { warehouse: { branchId: 1n } } } });
      const branch2 = await client.inventorySerial.findMany({ where: { opening: { warehouse: { branchId: 2n } } } });
      assert.deepEqual(branch1.map((serial) => serial.serialKey).sort(), ["SN-1", "SN-2"]);
      assert.deepEqual(branch2.map((serial) => serial.serialKey).sort(), ["BRANCH2-A", "BRANCH2\\B", "BRANCH2_B"]);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: { contains: escapeLikeLiteral("SN-_") } } }), 0);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: { contains: escapeLikeLiteral("_") } } }), 1);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: { contains: escapeLikeLiteral("\\") } } }), 1);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: { contains: escapeLikeLiteral("%") } } }), 0);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: { contains: escapeLikeLiteral("SN-1") } } }), 1);
    });

    await t.test("rerunning the upgrade fails without changing saved stock or serials", async () => {
      const openings = await client.inventoryOpening.count();
      const serials = await client.inventorySerial.count();
      const levels = await client.stockLevel.count();
      await assert.rejects(() => pg!.exec(upgrade));
      assert.equal(await client.inventoryOpening.count(), openings);
      assert.equal(await client.inventorySerial.count(), serials);
      assert.equal(await client.stockLevel.count(), levels);
    });

    await t.test("concurrent requests cannot duplicate serials or openings", async () => {
      const race = { requestId: randomUUID(), productId: "1", warehouseId: "1", quantity: "1", unitCost: "10", serialNumbers: "RACE-1" };
      const other = { ...race, requestId: randomUUID(), warehouseId: "2" };
      const result = await Promise.allSettled([createInventoryOpening(client, 1n, race), createInventoryOpening(client, 2n, other)]);
      assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: "RACE-1" } }), 1);
      assert.equal(await client.stockLevel.count({ where: { productId: 1n } }), 1);
      const same = { requestId: randomUUID(), productId: "2", warehouseId: "1", quantity: "1", unitCost: "10", serialNumbers: "" };
      await Promise.allSettled([createInventoryOpening(client, 1n, same), createInventoryOpening(client, 1n, same)]);
      assert.equal(await client.inventoryOpening.count({ where: { requestId: same.requestId } }), 1);
      assert.equal(await client.stockLevel.count({ where: { productId: 2n, warehouseId: 1n } }), 1);
    });
  } finally {
    if (db) await db.$disconnect();
    if (pg) await pg.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

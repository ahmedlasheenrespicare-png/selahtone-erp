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
import type { ReceiptInputRaw } from "../src/lib/receiving-validation";

const root = process.cwd();
const baseline = readFileSync(path.join(root, "tests/fixtures/inventory-baseline.sql"), "utf8");
const openingUpgrade = readFileSync(path.join(root, "prisma/manual-inventory-upgrade.sql"), "utf8");
const receiptUpgrade = readFileSync(path.join(root, "prisma/manual-receiving-upgrade.sql"), "utf8");
const commerceUpgrade = readFileSync(path.join(root, "prisma/manual-commerce-upgrade.sql"), "utf8");

function request(overrides: Partial<ReceiptInputRaw> = {}): ReceiptInputRaw {
  return { requestId: randomUUID(), productId: "1", warehouseId: "1", quantity: "2", unitCost: "20", serialNumbers: "REC-A\nREC-B", sourceReference: "مرجع تجريبي", ...overrides };
}
async function expectProblem(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, (error: unknown) => error instanceof InventoryProblem && pattern.test(error.message));
}
async function seedOpening(pg: PGlite) {
  await pg.query(`INSERT INTO inventory_openings(request_id, request_hash, warehouse_id, product_id, quantity, unit_cost, created_by_id)
    VALUES ($1::uuid, $2, 1, 1, 1, 10, 1)`, [randomUUID(), "a".repeat(64)]);
  await pg.exec("INSERT INTO inventory_serials(opening_id, serial_number, serial_key) VALUES (1,'OPEN-1','OPEN-1')");
  await pg.exec("INSERT INTO stock_levels(warehouse_id, product_id, qty_on_hand, avg_cost) VALUES (1,1,1,10)");
}

test("isolated receipt migration and transactional stock receiving", { timeout: 120_000 }, async (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "selahtone-receiving-test-"));
  let pg: PGlite | undefined;
  let db: ClientType | undefined;
  try {
    symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
    const originalSchema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const testSchema = originalSchema.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"\n  engineType = "client"');
    assert.notEqual(testSchema, originalSchema);
    const schemaPath = path.join(tmp, "schema.prisma");
    writeFileSync(schemaPath, testSchema);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, HOME: tmp, TMPDIR: process.env.TMPDIR, NODE_ENV: "test",
      DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture",
      DIRECT_URL: "postgresql://fixture:fixture@127.0.0.1:5432/fixture",
      PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1",
    };
    if (process.env.PRISMA_SCHEMA_ENGINE_BINARY) env.PRISMA_SCHEMA_ENGINE_BINARY = process.env.PRISMA_SCHEMA_ENGINE_BINARY;
    if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) env.PRISMA_QUERY_ENGINE_LIBRARY = process.env.PRISMA_QUERY_ENGINE_LIBRARY;
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "generate", `--schema=${schemaPath}`], { cwd: root, env, stdio: "pipe" });
    const localRequire = createRequire(path.join(root, "package.json"));
    const { PrismaClient: TestClient } = localRequire(path.join(tmp, "client")) as { PrismaClient: typeof import("@prisma/client").PrismaClient };

    await t.test("upgrade collision rolls back changes and retains an existing opening serial", async () => {
      const other = new PGlite();
      try {
        await other.exec(baseline);
        await other.exec(openingUpgrade);
        await seedOpening(other);
        await other.exec("CREATE INDEX inventory_serials_receipt_id_idx ON inventory_serials(id)");
        await assert.rejects(() => other.exec(receiptUpgrade));
        const tables = await other.query<{ name: string | null }>("SELECT to_regclass('public.inventory_receipts') AS name");
        assert.equal(tables.rows[0].name, null);
        const columns = await other.query<{ column_name: string; is_nullable: string }>("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_serials' AND column_name IN ('opening_id','receipt_id') ORDER BY column_name");
        assert.deepEqual(columns.rows, [{ column_name: "opening_id", is_nullable: "NO" }]);
        const serial = await other.query<{ serial_key: string; opening_id: number }>("SELECT serial_key, opening_id FROM inventory_serials");
        assert.equal(serial.rows[0].serial_key, "OPEN-1");
        assert.equal(Number(serial.rows[0].opening_id), 1);
      } finally { await other.close(); }
    });

    pg = new PGlite();
    await pg.exec(baseline);
    await pg.exec(openingUpgrade);
    await seedOpening(pg);
    await pg.exec(receiptUpgrade);
    const oldSerial = await pg.query<{ opening_id: number; receipt_id: number | null; serial_key: string }>("SELECT opening_id,receipt_id,serial_key FROM inventory_serials WHERE id=1");
    assert.equal(Number(oldSerial.rows[0].opening_id), 1);
    assert.equal(oldSerial.rows[0].receipt_id, null);
    assert.equal(oldSerial.rows[0].serial_key, "OPEN-1");
    await assert.rejects(() => pg!.exec("INSERT INTO inventory_serials(opening_id,receipt_id,serial_number,serial_key) VALUES(NULL,NULL,'BAD','BAD')"));
    // The generated client also includes the draft sales serial-state column.
    await pg.exec(commerceUpgrade);
    db = new TestClient({ adapter: new PrismaPGlite(pg) as never });
    const client = db;

    await t.test("staff receipt updates stock and weighted cost atomically, retaining serial provenance", async () => {
      const receipt = request();
      const saved = await receiveInventoryStock(client, 3n, receipt);
      assert.equal(saved.replayed, false);
      const level = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      assert.equal(level.qtyOnHand.toFixed(2), "3.00");
      assert.equal(level.avgCost.toFixed(4), "16.6667");
      const record = await client.inventoryReceipt.findUniqueOrThrow({ where: { id: BigInt(saved.id) } });
      assert.equal(record.sourceReference, "مرجع تجريبي");
      assert.equal(record.createdById, 3n);
      assert.equal(await client.inventorySerial.count({ where: { receiptId: BigInt(saved.id) } }), 2);
      assert.equal(await client.inventorySerial.count({ where: { openingId: 1n } }), 1);
      assert.equal((await receiveInventoryStock(client, 3n, receipt)).replayed, true);
      await expectProblem(() => receiveInventoryStock(client, 3n, { ...receipt, unitCost: "21" }), /بيانات مختلفة/);
      assert.equal((await client.stockLevel.findUniqueOrThrow({ where: { id: level.id } })).qtyOnHand.toFixed(2), "3.00");
    });

    await t.test("serial listing includes both sources and does not leak other branches", async () => {
      const other = await receiveInventoryStock(client, 1n, request({ warehouseId: "2", quantity: "1", serialNumbers: "BRANCH-TWO" }));
      await assert.rejects(() => pg!.query("INSERT INTO inventory_serials(opening_id,receipt_id,serial_number,serial_key) VALUES(1,$1,'BOTH','BOTH')", [BigInt(other.id)]));
      const branchOne = await client.inventorySerial.findMany({
        where: { OR: [{ opening: { warehouse: { branchId: 1n } } }, { receipt: { warehouse: { branchId: 1n } } }] },
        include: { opening: true, receipt: true }, orderBy: { id: "asc" },
      });
      assert.deepEqual(branchOne.map((serial) => serial.serialKey), ["OPEN-1", "REC-A", "REC-B"]);
      assert.ok(branchOne[0].opening && !branchOne[0].receipt);
      assert.ok(branchOne[1].receipt && !branchOne[1].opening);
      const branchTwo = await client.inventorySerial.findMany({
        where: { OR: [{ opening: { warehouse: { branchId: 2n } } }, { receipt: { warehouse: { branchId: 2n } } }] },
      });
      assert.deepEqual(branchTwo.map((serial) => serial.serialKey), ["BRANCH-TWO"]);
    });

    await t.test("permissions, active warehouse, serial uniqueness and service checks are server-side", async () => {
      const count = await client.inventoryReceipt.count();
      await expectProblem(() => receiveInventoryStock(client, 2n, request()), /موظف الفرع فقط/);
      await expectProblem(() => receiveInventoryStock(client, 4n, request()), /موظف الفرع فقط/);
      await expectProblem(() => receiveInventoryStock(client, 3n, request({ warehouseId: "2" })), /مستودعات فرعه/);
      await expectProblem(() => receiveInventoryStock(client, 1n, request({ warehouseId: "3" })), /غير نشط/);
      await expectProblem(() => receiveInventoryStock(client, 1n, request({ productId: "3", serialNumbers: "" })), /لا يحتفظ بمخزون/);
      await expectProblem(() => receiveInventoryStock(client, 1n, request({ quantity: "1", serialNumbers: "open-1" })), /مسجّل بالفعل/);
      await expectProblem(() => receiveInventoryStock(client, 1n, request({ quantity: "1", serialNumbers: "rec-a" })), /مسجّل بالفعل/);
      assert.equal(await client.inventoryReceipt.count(), count);
    });

    await t.test("new nonserialized stock supports fractions and exact weighted averages", async () => {
      const first = request({ productId: "2", quantity: "1.25", unitCost: "4.1111", serialNumbers: "", sourceReference: "" });
      await receiveInventoryStock(client, 1n, first);
      let level = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 2n } } });
      assert.equal(level.qtyOnHand.toFixed(2), "1.25");
      assert.equal(level.avgCost.toFixed(4), "4.1111");
      await receiveInventoryStock(client, 3n, request({ productId: "2", quantity: "0.75", unitCost: "3", serialNumbers: "", sourceReference: "" }));
      level = await client.stockLevel.findUniqueOrThrow({ where: { id: level.id } });
      assert.equal(level.qtyOnHand.toFixed(2), "2.00");
      assert.equal(level.avgCost.toFixed(4), "3.6944");
    });

    await t.test("invalid or overflowing existing balances fail without altering receipts", async () => {
      await pg!.exec("UPDATE stock_levels SET qty_on_hand=9999999999.99, avg_cost=1 WHERE warehouse_id=1 AND product_id=5");
      const before = await client.inventoryReceipt.count();
      await expectProblem(() => receiveInventoryStock(client, 1n, request({ productId: "5", quantity: "1", serialNumbers: "" })), /تتجاوز الحد/);
      assert.equal(await client.inventoryReceipt.count(), before);
      assert.equal((await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 5n } } })).qtyOnHand.toFixed(2), "9999999999.99");
      await pg!.exec("UPDATE stock_levels SET qty_on_hand=0, avg_cost=-1 WHERE warehouse_id=1 AND product_id=5");
      await expectProblem(() => receiveInventoryStock(client, 1n, request({ productId: "5", quantity: "1", serialNumbers: "" })), /الرصيد الحالي غير صالح/);
      assert.equal(await client.inventoryReceipt.count(), before);
    });

    await t.test("a final serial-write failure rolls back both receipt and stock", async () => {
      await pg!.exec(`CREATE FUNCTION reject_demo_serial() RETURNS trigger AS $$ BEGIN
        IF NEW.serial_key = 'TRIGGER-FAIL' THEN RAISE EXCEPTION 'intentional test failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_demo_serial BEFORE INSERT ON inventory_serials FOR EACH ROW EXECUTE FUNCTION reject_demo_serial();`);
      const beforeReceipt = await client.inventoryReceipt.count();
      const beforeLevel = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      await assert.rejects(() => receiveInventoryStock(client, 1n, request({ quantity: "1", serialNumbers: "TRIGGER-FAIL" })));
      assert.equal(await client.inventoryReceipt.count(), beforeReceipt);
      const afterLevel = await client.stockLevel.findUniqueOrThrow({ where: { id: beforeLevel.id } });
      assert.equal(afterLevel.qtyOnHand.toFixed(2), beforeLevel.qtyOnHand.toFixed(2));
      assert.equal(afterLevel.avgCost.toFixed(4), beforeLevel.avgCost.toFixed(4));
      assert.equal(await client.inventorySerial.count({ where: { serialKey: "TRIGGER-FAIL" } }), 0);
    });

    await t.test("concurrent retry of one request changes the balance only once", async () => {
      const before = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 2n } } });
      const oneRequest = request({ productId: "2", quantity: "1", unitCost: "4", serialNumbers: "" });
      const result = await Promise.allSettled([receiveInventoryStock(client, 3n, oneRequest), receiveInventoryStock(client, 3n, oneRequest)]);
      assert.ok(result.some((entry) => entry.status === "fulfilled"));
      assert.equal(await client.inventoryReceipt.count({ where: { requestId: oneRequest.requestId } }), 1);
      const after = await client.stockLevel.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(Number(after.qtyOnHand.toFixed(2)) - Number(before.qtyOnHand.toFixed(2)), 1);
      const replay = await receiveInventoryStock(client, 3n, oneRequest);
      assert.equal(replay.replayed, true);
    });

    await t.test("concurrent receipts cannot duplicate serials or leave partial stock", async () => {
      const before = await client.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: 1n, productId: 1n } } });
      const left = request({ quantity: "1", serialNumbers: "RACE-SAME" });
      const right = request({ quantity: "1", serialNumbers: "RACE-SAME" });
      const result = await Promise.allSettled([receiveInventoryStock(client, 1n, left), receiveInventoryStock(client, 3n, right)]);
      assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(await client.inventorySerial.count({ where: { serialKey: "RACE-SAME" } }), 1);
      const after = await client.stockLevel.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(Number(after.qtyOnHand.toFixed(2)) - Number(before.qtyOnHand.toFixed(2)), 1);
    });
  } finally {
    if (db) await db.$disconnect();
    if (pg) await pg.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

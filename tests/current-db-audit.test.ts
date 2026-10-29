import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const sql = (name: string) => readFileSync(path.join(root, name), "utf8");
const baseline = sql("tests/fixtures/inventory-baseline.sql");
const inventory = sql("prisma/manual-inventory-upgrade.sql");
const currentAudit = sql("prisma/manual-current-db-audit.sql");
const existingVerification = sql("prisma/verify-manual-inventory.sql");
async function report(pg: PGlite) {
  const { rows } = await pg.query<{ result: string }>(currentAudit);
  return JSON.parse(rows[0].result);
}

test("current read-only audit embeds the maintained inventory verification", () => {
  const canonical = existingVerification.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim().replace(/;$/, "");
  assert.ok(currentAudit.includes(canonical), "inventory verification and combined audit have diverged");
});

test("current read-only audit separates existing, legacy and not-yet-created sales tables", { timeout: 60_000 }, async (t) => {
  const pg = new PGlite();
  try {
    await pg.exec(baseline); await pg.exec(inventory);
    await t.test("reports local data and can run inside a read-only transaction", async () => {
      await pg.exec("BEGIN READ ONLY");
      try {
        const result = await report(pg);
        assert.ok(result.current_tables_found.includes("inventory_serials"));
        assert.ok(result.current_tables_missing.includes("auth_sessions"));
        assert.ok(result.current_tables_missing.includes("expense_categories"));
        assert.deepEqual(result.sales_receiving_tables_already_present, []);
        assert.ok(result.sales_receiving_tables_not_yet_present.includes("commerce_sales"));
        assert.ok(result.sales_receiving_tables_not_yet_present.includes("inventory_receipts"));
        assert.ok(result.other_legacy_tables_missing_for_review.includes("invoices"));
        assert.deepEqual(result.inventory_integrity.missing_objects, []);
        assert.deepEqual(result.inventory_integrity.missing_constraints, []);
        assert.deepEqual(result.inventory_integrity.invalid_unique_indexes, []);
        assert.deepEqual(result.inventory_integrity.foreign_key_mismatches, []);
        assert.deepEqual(result.inventory_integrity.column_mismatches, []);
        assert.deepEqual(result.comparison_counts, { branches: 2, warehouses: 3, products: 5 });
      } finally { await pg.exec("ROLLBACK"); }
      const count = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM products");
      assert.equal(count.rows[0].count, 5);
    });
    await t.test("detects a broken serial index and an unexpected new sales table", async () => {
      await pg.exec(`DROP INDEX inventory_serials_serial_key_key;
        CREATE INDEX inventory_serials_serial_key_key ON inventory_serials(serial_key);
        CREATE TABLE commerce_sales(id bigint PRIMARY KEY);`);
      const result = await report(pg);
      assert.ok(result.sales_receiving_tables_already_present.includes("commerce_sales"));
      assert.ok(result.inventory_integrity.invalid_unique_indexes.includes("inventory_serials_serial_key_key"));
    });
  } finally { await pg.close(); }
});

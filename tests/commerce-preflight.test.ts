import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const baseline = readFileSync(path.join(root, "tests/fixtures/inventory-baseline.sql"), "utf8");
const inventory = readFileSync(path.join(root, "prisma/manual-inventory-upgrade.sql"), "utf8");
const receiving = readFileSync(path.join(root, "prisma/manual-receiving-upgrade.sql"), "utf8");
const commerce = readFileSync(path.join(root, "prisma/manual-commerce-upgrade.sql"), "utf8");
const metadataAudit = readFileSync(path.join(root, "prisma/manual-commerce-preflight.sql"), "utf8");
const dataAudit = readFileSync(path.join(root, "prisma/manual-commerce-data-audit.sql"), "utf8");

test("preflight lists every relation and serial alteration created by the draft migrations", () => {
  const declared = metadataAudit.match(/prospective_relations\(name\) AS \(VALUES([\s\S]*?)\), relation_collisions/);
  assert.ok(declared);
  const listed = new Set(Array.from(declared[1].matchAll(/\('([^']+)'\)/g), (match) => match[1]));
  const migrations = receiving + "\n" + commerce;
  for (const table of migrations.matchAll(/CREATE TABLE public\."([^"]+)"\s*\(([\s\S]*?)\n\);/g)) {
    assert.ok(listed.has(table[1]), `missing table ${table[1]}`);
    assert.ok(listed.has(`${table[1]}_pkey`), `missing primary index for ${table[1]}`);
    if (/"id"\s+BIGSERIAL\b/.test(table[2])) assert.ok(listed.has(`${table[1]}_id_seq`), `missing sequence for ${table[1]}`);
  }
  for (const index of migrations.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)) assert.ok(listed.has(index[1]), `missing index ${index[1]}`);
  for (const column of migrations.matchAll(/ALTER TABLE public\."inventory_serials" ADD COLUMN "([^"]+)"/g)) assert.ok(metadataAudit.includes(`'${column[1]}'`), `missing column ${column[1]}`);
  for (const constraint of migrations.matchAll(/ALTER TABLE public\."inventory_serials" ADD CONSTRAINT "([^"]+)"/g)) assert.ok(metadataAudit.includes(`'${constraint[1]}'`), `missing constraint ${constraint[1]}`);
});

async function report(pg: PGlite, sql: string): Promise<Record<string, any>> {
  const result = await pg.query<{ result: string }>(sql);
  return JSON.parse(result.rows[0].result);
}

test("commerce preflight is read-only and reports issues on isolated data", { timeout: 60_000 }, async (t) => {
  const pg = new PGlite();
  try {
    await pg.exec(baseline); await pg.exec(inventory);
    await pg.exec(`INSERT INTO inventory_openings(request_id,request_hash,warehouse_id,product_id,quantity,unit_cost,created_by_id)
      VALUES ('00000000-0000-4000-8000-000000000001',repeat('a',64),1,1,2,10,1);
      INSERT INTO inventory_serials(opening_id,serial_number,serial_key) VALUES (1,'FIX-A','FIX-A'),(1,'FIX-B','FIX-B');
      INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES (1,1,2,10);
      UPDATE tax_rates SET effective_from='2000-01-01' WHERE id=1;
      UPDATE products SET sale_price=10,tax_rate_id=1 WHERE id IN (1,2);`);

    await t.test("baseline metadata and matching serial stock can be audited inside a read-only transaction", async () => {
      await pg.exec("BEGIN READ ONLY");
      try {
        const meta = await report(pg, metadataAudit);
        assert.deepEqual(meta.required_column_mismatches, []);
        assert.deepEqual(meta.invalid_unique_indexes, []);
        assert.equal(meta.existing_serial_source_fk_valid, true);
        assert.deepEqual(meta.missing_enum_values, []);
        assert.deepEqual(meta.extra_enum_values, []);
        assert.deepEqual(meta.relation_collisions, []);
        assert.deepEqual(meta.serial_column_collisions, []);
        assert.deepEqual(meta.serial_constraint_collisions, []);
        const data = await report(pg, dataAudit);
        assert.equal(data.stage, "before_upgrades");
        assert.equal(data.serialized_stock_count_mismatches, 0);
        assert.equal(data.serialized_opening_count_mismatches, 0);
        assert.equal(data.tax_review_required, true);
        assert.equal(data.active_products_missing_tax, 2);
        assert.equal(data.active_products_zero_or_negative_price, 2);
      } finally { await pg.exec("ROLLBACK"); }
      const count = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM inventory_serials");
      assert.equal(count.rows[0].count, 2);
    });

    await t.test("data audit exposes count, stock, tax and price issues without item details", async () => {
      await pg.exec(`INSERT INTO inventory_serials(opening_id,serial_number,serial_key) VALUES(1,'FIX-C','FIX-C');
        UPDATE stock_levels SET qty_on_hand=2.5,avg_cost=-1 WHERE warehouse_id=1 AND product_id=1;
        UPDATE tax_rates SET kind='COMPOSITE' WHERE id=1;`);
      const data = await report(pg, dataAudit);
      assert.equal(data.serialized_stock_count_mismatches, 1);
      assert.equal(data.serialized_opening_count_mismatches, 1);
      assert.equal(data.fractional_serialized_stock_rows, 1);
      assert.equal(data.negative_stock_or_cost_rows, 1);
      assert.equal(data.active_products_unsupported_tax_kind, 2);
      assert.equal(data.active_products_missing_tax, 2);
      assert.equal(data.active_products_zero_or_negative_price, 2);
      assert.doesNotMatch(JSON.stringify(data), /FIX-A|FIX-B|FIX-C/);
    });

    await t.test("non-finite numeric stock, prices and tax rates are not silently accepted", async () => {
      await pg.exec(`UPDATE stock_levels SET qty_on_hand='NaN' WHERE warehouse_id=1 AND product_id=1;
        UPDATE products SET sale_price='NaN' WHERE id=1;
        UPDATE tax_rates SET rate='NaN' WHERE id=1;
        UPDATE products SET is_serialized=true WHERE id=3;`);
      const data = await report(pg, dataAudit);
      assert.equal(data.nonfinite_stock_or_cost_rows, 1);
      assert.equal(data.active_products_nonfinite_price, 1);
      assert.equal(data.active_products_invalid_tax_rate, 2);
      assert.equal(data.active_serialized_services, 1);
    });

    await t.test("metadata catches name collisions, wrong indexes and unexpected serial columns", async () => {
      await pg.exec(`CREATE TABLE public.commerce_settings(id INT PRIMARY KEY);
        ALTER TABLE public.inventory_serials ADD COLUMN receipt_id BIGINT;
        ALTER TABLE public.inventory_serials ADD CONSTRAINT inventory_serials_one_source_check CHECK (receipt_id IS NULL);
        DROP INDEX public.inventory_serials_serial_key_key;
        CREATE INDEX inventory_serials_serial_key_key ON public.inventory_serials(serial_key);`);
      const meta = await report(pg, metadataAudit);
      assert.ok(meta.relation_collisions.includes("commerce_settings"));
      assert.ok(meta.serial_column_collisions.includes("receipt_id"));
      assert.ok(meta.serial_constraint_collisions.includes("inventory_serials_one_source_check"));
      assert.ok(meta.invalid_unique_indexes.includes("inventory_serials_serial_key_key"));
      const data = await report(pg, dataAudit);
      assert.equal(data.stage, "not_before_upgrades");
      assert.equal(data.serialized_stock_count_mismatches, undefined);
    });
  } finally { await pg.close(); }
});

test("data audit refuses to interpret post-receiving stock as pre-upgrade data", { timeout: 60_000 }, async () => {
  const pg = new PGlite();
  try {
    await pg.exec(baseline); await pg.exec(inventory); await pg.exec(receiving);
    const data = await report(pg, dataAudit);
    assert.equal(data.stage, "not_before_upgrades");
    assert.equal(data.tax_review_required, undefined);
    const meta = await report(pg, metadataAudit);
    assert.ok(meta.serial_column_collisions.includes("receipt_id"));
    assert.ok(meta.relation_collisions.includes("inventory_receipts"));
  } finally { await pg.close(); }
});

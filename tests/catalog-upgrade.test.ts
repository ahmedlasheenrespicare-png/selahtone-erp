/**
 * Verifies the MANUAL catalog migration (prisma/manual-catalog-sales-upgrade.sql)
 * against the reviewed commerce schema on a disposable database: the new tables
 * and seed, the nullable warehouse, «الضريبة غير محددة» being NULL (never zero),
 * and that a catalog line can never touch stock. Never touches DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");

test("catalog upgrade installs the tree, frees the warehouse and keeps tax unknown", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    await pg.exec(read("tests/fixtures/inventory-baseline.sql"));
    await pg.exec(read("prisma/manual-inventory-upgrade.sql"));
    await pg.exec(read("prisma/manual-receiving-upgrade.sql"));
    await pg.exec(read("prisma/manual-commerce-upgrade.sql"));
    await pg.exec(read("prisma/manual-catalog-sales-upgrade.sql"));

    const report = (await pg.query<{ r: string }>(`SELECT jsonb_build_object(
      'categories', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relname='sales_item_categories'),
      'types', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relname='sales_item_types'),
      'fields', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relname='sales_item_fields'),
      'audit', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relname='sales_catalog_audit'),
      'catalog_column', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='commerce_sale_lines' AND column_name='catalog_type_id'),
      'details_column', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='commerce_sale_lines' AND column_name='details'),
      'warehouse_optional', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='commerce_sales' AND column_name='warehouse_id' AND is_nullable='YES'),
      'seed_categories', (SELECT count(*)::int FROM public."sales_item_categories"),
      'seed_types', (SELECT count(*)::int FROM public."sales_item_types"),
      'seed_fields', (SELECT count(*)::int FROM public."sales_item_fields")
    )::text AS r`)).rows[0].r;
    assert.deepEqual(JSON.parse(report), {
      categories: 1, types: 1, fields: 1, audit: 1,
      catalog_column: 1, details_column: 1, warehouse_optional: 1,
      seed_categories: 5, seed_types: 15, seed_fields: 4,
    });

    // إعادة التشغيل آمنة: نفس الأعداد بلا تكرار.
    await pg.exec(read("prisma/manual-catalog-sales-upgrade.sql"));
    const again = (await pg.query<{ c: number }>('SELECT count(*)::int AS c FROM public."sales_item_categories"')).rows[0].c;
    assert.equal(Number(again), 5);

    // فاتورة بلا مستودع وبضريبة غير محددة: مقبولة، والفراغ ليس صفرًا.
    await pg.exec(`INSERT INTO public."commerce_sales"(request_id,request_hash,branch_id,customer_name,customer_phone,subtotal,discount,total,created_by_id)
      VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'عميل','01000000000',300,0,300,1)`);
    const sale = (await pg.query<{ taxable: string | null; tax: string | null; warehouse: string | null }>(
      `SELECT taxable_base::text AS taxable, tax_total::text AS tax, warehouse_id::text AS warehouse FROM public."commerce_sales" WHERE id=1`)).rows[0];
    assert.equal(sale.taxable, null); assert.equal(sale.tax, null); assert.equal(sale.warehouse, null);

    // بند صنف فني: لا منتج ولا ضريبة ولا مخزون.
    await pg.exec(`INSERT INTO public."commerce_sale_lines"(sale_id,catalog_type_id,category_snapshot,type_snapshot,details,name_snapshot,quantity,unit_price,gross,discount,total,is_stock,is_serialized)
      VALUES (1,1,'بطاريات','مقاس 13','{"entries":[{"key":"device_type","label":"نوع السماعة","value":"X"}]}','بطاريات — مقاس 13',2,150,300,0,300,FALSE,FALSE)`);
    // حقل موقوف أو مخزون على بند فني مرفوض.
    await assert.rejects(() => pg.exec(`INSERT INTO public."commerce_sale_lines"(sale_id,catalog_type_id,name_snapshot,quantity,unit_price,gross,discount,total,is_stock,is_serialized)
      VALUES (1,1,'بند مخزون',1,10,10,0,10,TRUE,FALSE)`));
    // خلط الضريبة: النوع محدد والسعر فارغ مرفوض.
    await assert.rejects(() => pg.exec(`INSERT INTO public."commerce_sale_lines"(sale_id,name_snapshot,quantity,unit_price,tax_kind_snapshot,gross,discount,total,is_stock,is_serialized)
      VALUES (1,'بند نصف ضريبة',1,10,'VAT',10,0,10,FALSE,FALSE)`));

    // بند قديم بمنتج وضريبة كاملة ما زال مقبولًا: الترقية لا تكسر الفواتير القديمة.
    await pg.exec(`INSERT INTO public."commerce_sale_lines"(sale_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price,tax_rate_id,tax_code_snapshot,tax_kind_snapshot,tax_rate_snapshot,gross,discount,taxable_base,tax_amount,total,unit_cost,is_stock,is_serialized)
      VALUES (1,1,'P1','صنف قديم',1,100,1,'T5','VAT',5,100,0,95.24,4.76,100,50,TRUE,FALSE)`);
  } finally {
    await pg.close();
  }
});

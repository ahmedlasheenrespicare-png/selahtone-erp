import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("inventory filter result count and empty matches are announced", () => {
  const source = read("../src/app/(app)/inventory/inventory-products-view.tsx");
  assert.ok(source.includes('className="pill" role="status" aria-live="polite" aria-atomic="true"'));
  assert.ok(source.includes('<p role="status">لا توجد أصناف تطابق البحث أو التصفية المختارة.</p>'));
  assert.ok(source.includes('function resetFilters(): void'));
  assert.ok(source.includes('setCategoryFilter("ALL")'));
  assert.ok(source.includes('setStockFilter("ALL")'));
  assert.ok(source.includes('onClick={resetFilters}>مسح البحث والفلاتر</button>'));
  const table = read("../src/components/data-driven/data-table.tsx");
  assert.ok(source.includes('regionLabel="جدول الأصناف وأرصدة المستودعات"'));
  assert.ok(table.includes('role="region" aria-label={regionLabel} tabIndex={0}'));
});

test("invalid serial search is linked to its input and alert", () => {
  const source = read("../src/app/(app)/inventory/serials/page.tsx");
  assert.ok(source.includes('aria-invalid={invalidSearch} aria-describedby={invalidSearch ? "serial-search-error" : undefined}'));
  assert.ok(source.includes('id="serial-search-error" className="inv-alert inv-alert--error" role="alert"'));
});

test("inventory CSV export announces the filtered download", () => {
  const source = read("../src/app/(app)/inventory/inventory-products-view.tsx");
  assert.ok(source.includes('const [exportMessage, setExportMessage] = useState("")'));
  assert.ok(source.includes('setExportMessage(`تم بدء تنزيل ملف CSV ويضم ${filtered.length} صنف.`)'));
  assert.ok(source.includes('className="sr-only" role="status" aria-live="polite" aria-atomic="true">{exportMessage}</p>'));
  assert.ok(source.includes('disabled={filtered.length === 0}'));
});

test("product and receipt tables expose all column headers", () => {
  const products = read("../src/app/(app)/inventory/inventory-products-view.tsx");
  const metadata = read("../src/app/(app)/inventory/inventory-products-metadata.tsx");
  const table = read("../src/components/data-driven/data-table.tsx");
  const receipts = read("../src/app/(app)/inventory/receipts/page.tsx");
  const serials = read("../src/app/(app)/inventory/serials/page.tsx");
  const registers = read("../src/app/(app)/inventory/inventory-registers-metadata.tsx");
  assert.ok(products.includes("<DataTable"));
  for (const id of ["sku", "name", "category", "tax", "purchase-cost", "sale-price", "serial", "stock"]) {
    assert.ok(metadata.includes(`id: "${id}"`), id);
  }
  assert.ok(metadata.includes('...(canSeeCost ? [{'));
  assert.ok(table.includes('<th key={column.id} scope="col" aria-label={column.headerAriaLabel} className={column.headerClassName}>'));
  assert.ok(receipts.includes("columns={createInventoryReceiptColumns(showUnitCost)}"));
  assert.ok(receipts.includes('regionLabel="جدول التوريدات"'));
  assert.ok(registers.includes('...(showUnitCost ? [{'));
  assert.equal((registers.match(/^    \{ id: /gm) ?? []).length, 7);
  assert.ok(serials.includes("columns={inventorySerialColumns}"));
  assert.ok(serials.includes('regionLabel="جدول الأرقام التسلسلية"'));
  const serialMetadata = registers.split("export const inventorySerialColumns")[1];
  assert.deepEqual([...serialMetadata.matchAll(/\bid: "([^"]+)"/g)].map((match) => match[1]), ["serial", "product", "branch", "warehouse", "status", "created-at"]);
});

test("inventory filter touch targets remain scoped to mobile screens", () => {
  const css = read("../src/app/(app)/inventory/inventory.css");
  const mobile = css.match(/@media screen and \(max-width: 620px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const selector of [".inv-page .admin-filter-bar__search", ".inv-page .admin-filter-bar select"]) {
    assert.ok(mobile.includes(selector), selector);
  }
  assert.match(mobile, /min-height: 44px/);
  assert.equal(css.includes("@media print"), false);
});

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
  assert.ok(source.includes('role="region" aria-label="جدول الأصناف وأرصدة المستودعات" tabIndex={0}'));
});

test("invalid serial search is linked to its input and alert", () => {
  const source = read("../src/app/(app)/inventory/serials/page.tsx");
  assert.ok(source.includes('aria-invalid={invalidSearch} aria-describedby={invalidSearch ? "serial-search-error" : undefined}'));
  assert.ok(source.includes('id="serial-search-error" className="inv-alert inv-alert--error" role="alert"'));
});

test("product and receipt tables expose all column headers", () => {
  const products = read("../src/app/(app)/inventory/inventory-products-view.tsx");
  const receipts = read("../src/app/(app)/inventory/receipts/page.tsx");
  for (const [source, expected] of [[products, 8], [receipts, 9]]) {
    assert.equal((source.match(/<th(?: scope="col")?>/g) ?? []).length, expected);
    assert.equal((source.match(/<th scope="col">/g) ?? []).length, expected);
  }
  assert.ok(receipts.includes('{showUnitCost && <th scope="col">تكلفة الوحدة (ج.م)</th>}'));
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

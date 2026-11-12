import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const saleForms = [
  "../src/app/(app)/sales/new/sale-form.tsx",
  "../src/app/(app)/sales/new/catalog-sale-form.tsx",
].map(read);

test("sale submission announces pending state and links customer errors to their fields", () => {
  for (const source of saleForms) {
    assert.ok(source.includes('id="sale-form-errors"'));
    assert.ok(source.includes('className="inv-alert inv-alert--error" role="alert"'));
    assert.ok(source.includes('disabled={pending} aria-busy={pending}'));
    assert.ok(source.includes('aria-live="polite">{pending ?'));
    for (const field of ["customerPhone", "customerName"]) {
      assert.ok(source.includes(`aria-invalid={!!errors.${field}}`));
      assert.ok(source.includes(`aria-describedby={errors.${field} ? "sale-form-errors" : undefined}`));
    }
  }
});

test("serial lookup exposes loading, error and empty results through an associated live status", () => {
  const source = read("../src/app/(app)/sales/new/serial-selector.tsx");
  assert.ok(source.includes('aria-describedby={`sale-serial-status-${productId}`}'));
  assert.ok(source.includes('className="sale-serials" aria-busy={loading}'));
  assert.ok(source.includes('id={`sale-serial-status-${productId}`}'));
  assert.ok(source.includes('role={error && !loading ? "alert" : "status"}'));
  assert.ok(source.includes('aria-live="polite"'));
  assert.ok(source.includes('"جارٍ البحث…"'));
  assert.ok(source.includes('"لا توجد أرقام مطابقة متاحة."'));
});

test("invoice empty states are announced without changing their recovery actions", () => {
  for (const path of [
    "../src/app/(app)/sales/page.tsx",
    "../src/app/(app)/sales/today/page.tsx",
  ]) {
    assert.ok(read(path).includes('className="inv-panel inv-empty sales-empty-state" role="status"'));
  }
  const filters = read("../src/app/(app)/sales/sales-invoices-view.tsx");
  assert.ok(filters.includes('className="inv-panel sales-empty-filter" role="status"'));
  assert.ok(filters.includes("إعادة ضبط التصفية"));
});

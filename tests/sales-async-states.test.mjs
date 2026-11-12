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

test("invoice movements, returns and discount settings announce pending", () => {
  for (const path of [
    "../src/app/(app)/sales/[saleId]/movement-form.tsx",
    "../src/app/(app)/sales/[saleId]/return-form.tsx",
    "../src/app/(app)/sales/settings/setting-form.tsx",
  ]) {
    const source = read(path);
    assert.ok(source.includes('disabled={pending') && source.includes('aria-busy={pending}'), path);
    assert.ok(source.includes('<span aria-live="polite">{pending ? "جارٍ الحفظ…"'), path);
  }
  const movement = read("../src/app/(app)/sales/[saleId]/movement-form.tsx");
  assert.ok(movement.includes('disabled={pending || (needsWarning && !negativeAcknowledged)}'));
});

test("sales operation review and success transitions preserve focus", () => {
  const movement = read("../src/app/(app)/sales/[saleId]/movement-form.tsx");
  for (const part of ["review-title", "review-button", "success-title"]) {
    assert.ok(movement.includes(`id={\`${'${mode}'}-movement-${part}\`}`), part);
    assert.ok(movement.includes(`document.getElementById(\`${'${mode}'}-movement-${part}\`)?.focus()`), part);
  }
  for (const [path, prefix] of [
    ["../src/app/(app)/sales/[saleId]/return-form.tsx", "return"],
    ["../src/app/(app)/sales/settings/setting-form.tsx", "discount"],
  ]) {
    const source = read(path);
    for (const part of ["review-title", "review-button", "success-title"]) {
      assert.ok(source.includes(`id="${prefix}-${part}"`), `${prefix}-${part}`);
      assert.ok(source.includes(`document.getElementById("${prefix}-${part}")?.focus()`), `${prefix}-${part}`);
    }
  }
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

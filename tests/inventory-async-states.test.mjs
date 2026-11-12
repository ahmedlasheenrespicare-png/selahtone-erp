import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("inventory submission announces pending in product, opening and receipt forms", () => {
  const forms = [
    ["../src/app/(app)/inventory/new/product-form.tsx", "تأكيد وحفظ الصنف"],
    ["../src/app/(app)/inventory/opening/opening-form.tsx", "تأكيد وحفظ الرصيد"],
    ["../src/app/(app)/inventory/receipts/new/receipt-form.tsx", "تأكيد وحفظ التوريد"],
  ];
  for (const [path, confirmation] of forms) {
    const source = read(path);
    assert.ok(source.includes('disabled={pending} aria-busy={pending}'), path);
    assert.ok(source.includes(`<span aria-live="polite">{pending ? "جارٍ الحفظ…" : "${confirmation}"}</span>`), path);
    assert.ok(source.includes('aria-live="polite"'), path);
    assert.ok(source.includes('aria-describedby={errorId('), path);
  }
});

test("inventory prerequisite and empty states are announced", () => {
  for (const path of [
    "../src/app/(app)/inventory/serials/page.tsx",
    "../src/app/(app)/inventory/receipts/page.tsx",
    "../src/app/(app)/inventory/receipts/new/page.tsx",
    "../src/app/(app)/inventory/opening/page.tsx",
  ]) {
    assert.match(read(path), /className="[^"]*inv-empty" role="status"/, path);
  }
});

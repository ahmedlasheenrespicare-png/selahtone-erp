import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseReceiptInput, type ReceiptInputRaw } from "../src/lib/receiving-validation";

function input(): ReceiptInputRaw {
  return { requestId: randomUUID(), productId: "١", warehouseId: "٢", quantity: "٢", unitCost: "١٢٫٣٤٥٦", serialNumbers: "a-١\nB-2", sourceReference: "  فاتورة ١٢  " };
}

test("receipt accepts arabic digits, normalized serials, 4-place costs and optional reference", () => {
  const result = parseReceiptInput(input(), true);
  assert.ok(result.ok);
  assert.equal(result.value.productId, "1");
  assert.equal(result.value.warehouseId, "2");
  assert.equal(result.value.quantity, "2");
  assert.equal(result.value.unitCost, "12.3456");
  assert.equal(result.value.sourceReference, "فاتورة ١٢");
  assert.deepEqual(result.value.serials.map((serial) => serial.key), ["A-1", "B-2"]);
  const noReference = parseReceiptInput({ ...input(), sourceReference: " " }, true);
  assert.ok(noReference.ok);
  assert.equal(noReference.value.sourceReference, null);
});

test("receipt rejects invalid references, duplicate serials and incorrect counts", () => {
  const duplicate = parseReceiptInput({ ...input(), serialNumbers: "a-1\nA-١", sourceReference: "x\ny" }, true);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.match(duplicate.errors.serialNumbers, /مكرر/);
    assert.match(duplicate.errors.sourceReference, /رموز تحكم/);
  }
  assert.equal(parseReceiptInput({ ...input(), sourceReference: "x".repeat(181) }, true).ok, false);
  assert.equal(parseReceiptInput({ ...input(), quantity: "1", serialNumbers: "a\nb" }, true).ok, false);
  assert.equal(parseReceiptInput({ ...input(), quantity: "1.5", serialNumbers: "a" }, true).ok, false);
  assert.equal(parseReceiptInput({ ...input(), quantity: "2", serialNumbers: "" }, true).ok, false);
});

test("nonserialized receipt allows fractional quantities but refuses serials", () => {
  const good = parseReceiptInput({ ...input(), quantity: "1.25", serialNumbers: "" }, false);
  assert.ok(good.ok);
  assert.equal(good.value.quantity, "1.25");
  assert.equal(parseReceiptInput({ ...input(), quantity: "1", serialNumbers: "x" }, false).ok, false);
});

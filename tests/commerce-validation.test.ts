import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseDiscountSetting, parseMoneyMovement, parseReturnInput, parseSaleInput } from "../src/lib/commerce-validation";

function sale() {
  return { requestId: randomUUID(), warehouseId: "١", customerName: "  عميل تجريبي  ", customerPhone: "٠١٠٠٠٠٠٠٠٠٠", discount: "١٠", initialPayment: "٢٠٫٥", method: "CARD", lines: [
    { productId: "٢", quantity: "١", serialIds: [], expectedUnitPrice: "٢٠", expectedTaxRateId: "٣", expectedTaxKind: "EXEMPT", expectedTaxRate: "٠" },
    { productId: "١", quantity: "٢", serialIds: ["٣", "١"], expectedUnitPrice: "١٠٥", expectedTaxRateId: "١", expectedTaxKind: "VAT", expectedTaxRate: "٥" },
  ] };
}

test("sale input normalizes digits and canonicalizes lines and serials", () => {
  const result = parseSaleInput(sale());
  assert.ok(result.ok);
  assert.equal(result.value.customerName, "عميل تجريبي");
  assert.equal(result.value.customerPhone, "01000000000");
  assert.equal(result.value.initialPayment, "20.5");
  assert.deepEqual(result.value.lines.map((line) => line.productId), ["1", "2"]);
  assert.deepEqual(result.value.lines[0].serialIds, ["1", "3"]);
  assert.deepEqual(parseSaleInput(JSON.parse(JSON.stringify(result.value))), result);
});

test("sale rejects missing customer, initial payment, unsafe types and duplicate selections", () => {
  const input = sale();
  assert.equal(parseSaleInput({ ...input, customerName: "", customerPhone: "not a phone", initialPayment: "0", method: "OTHER" }).ok, false);
  assert.equal(parseSaleInput({ ...input, customerName: "A\u202eB" }).ok, false);
  assert.equal(parseSaleInput({ ...input, lines: [input.lines[0], input.lines[0]] }).ok, false);
  assert.equal(parseSaleInput({ ...input, lines: [{ ...input.lines[1], serialIds: ["1", "1"] }] }).ok, false);
  assert.equal(parseSaleInput({ ...input, lines: [{ ...input.lines[1], expectedTaxKind: "COMPOSITE" }] }).ok, false);
  assert.equal(parseSaleInput({ ...input, lines: [null] }).ok, false);
  assert.equal(parseSaleInput(null).ok, false);
});

test("return, paid refund and staff limit validation fail closed", () => {
  const requestId = randomUUID();
  assert.equal(parseReturnInput({ requestId, saleId: "1", cancel: true, accepted: true, lines: [] }).ok, true);
  assert.equal(parseReturnInput({ requestId, saleId: "1", cancel: true, accepted: false, lines: [] }).ok, false);
  assert.equal(parseReturnInput({ requestId, saleId: "1", cancel: false, accepted: true, lines: [] }).ok, false);
  assert.equal(parseReturnInput({ requestId, saleId: "1", cancel: true, accepted: true, lines: [{ saleLineId: "1", quantity: "1", serialIds: [] }] }).ok, false);
  assert.equal(parseMoneyMovement({ requestId, saleId: "1", amount: "10", method: "CASH", actuallyPaid: false }, true).ok, false);
  assert.equal(parseMoneyMovement({ requestId, saleId: "1", amount: "10", method: "WALLET", actuallyPaid: true }, true).ok, true);
  const limit = parseDiscountSetting({ requestId, percent: "٧٫٥" });
  assert.ok(limit.ok); assert.equal(limit.value.basisPoints, 750);
  assert.equal(parseDiscountSetting({ requestId, percent: "100.01" }).ok, false);
});

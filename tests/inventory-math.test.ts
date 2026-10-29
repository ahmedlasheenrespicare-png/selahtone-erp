import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInventoryDecimal, scaledInteger, stockValueScaled } from "../src/lib/inventory-math";

// Decimal(12,2) × Decimal(14,4) produces an exact integer at scale 6.
test("stock values are added exactly and rounded only for display", () => {
  const one = stockValueScaled("3.00", "0.1750");
  assert.equal(one, 525000n);
  assert.equal(formatInventoryDecimal(one, 6), "0.53");
  assert.equal(formatInventoryDecimal(one + one, 6), "1.05");
  assert.equal(formatInventoryDecimal(stockValueScaled("0.01", "0.0001"), 6), "0");
});

test("large values do not lose decimal precision", () => {
  const value = stockValueScaled("9999999999.99", "9999999999.9999");
  assert.equal(value, 99999999999899000000000001n);
  assert.equal(formatInventoryDecimal(value, 6), "99,999,999,999,899,000,000");
  assert.equal(formatInventoryDecimal(scaledInteger("999999999999.99", 2), 2), "999,999,999,999.99");
});

test("negative stock values round away from zero and tiny values do not show negative zero", () => {
  const minusHalfCent = stockValueScaled("-1.00", "0.0050");
  assert.equal(formatInventoryDecimal(minusHalfCent, 6).replace(/\u200e/g, ""), "-0.01");
  assert.equal(formatInventoryDecimal(stockValueScaled("-0.01", "0.0001"), 6), "0");
  assert.throws(() => scaledInteger("1.001", 2));
});

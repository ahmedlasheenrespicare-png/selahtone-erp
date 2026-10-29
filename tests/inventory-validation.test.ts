import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalString, escapeLikeLiteral, parseOpeningInput, parseProductInput, positiveDatabaseId, productSku, type OpeningInputRaw, type ProductInputRaw } from "../src/lib/inventory-validation";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const product: ProductInputRaw = {
  requestId, sku: " ha-١ ", nameAr: " سماعة تجريبية ", category: "HEARING_AID", brand: "", model: "",
  purchaseCost: "١٢٠٠٫٥٠", salePrice: "2000.00", taxRateId: "", isSerialized: false,
};
const opening: OpeningInputRaw = { requestId, productId: "1", warehouseId: "2", quantity: "٢", unitCost: "١٢٠٠٫٥٠٠٠", serialNumbers: "ab-١\nAB-2" };

test("decimal parsing is exact, supports Arabic numerals, and enforces column limits", () => {
  assert.equal(decimalString("٠٠١٢٫٣٤", 14, 2), "12.34");
  assert.equal(decimalString("999999999999.99", 14, 2), "999999999999.99");
  assert.equal(decimalString("1000000000000", 14, 2), null);
  assert.equal(decimalString("0.001", 14, 2), null);
  assert.equal(decimalString("-1", 14, 2), null);
  assert.equal(decimalString("1e3", 14, 2), null);
  assert.equal(decimalString("", 14, 2), null);
  assert.equal(decimalString("1,000", 14, 2), null);
});

test("IDs must be positive signed bigint values", () => {
  assert.equal(positiveDatabaseId("١٢"), "12");
  assert.equal(positiveDatabaseId("0"), null);
  assert.equal(positiveDatabaseId("-1"), null);
  assert.equal(positiveDatabaseId("9223372036854775807"), "9223372036854775807");
  assert.equal(positiveDatabaseId("9223372036854775808"), null);
});

test("hearing aids always require serials, and prices are normalized without floats", () => {
  const result = parseProductInput(product);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.sku, "HA-1");
    assert.equal(result.value.nameAr, "سماعة تجريبية");
    assert.equal(result.value.purchaseCost, "1200.5");
    assert.equal(result.value.salePrice, "2000");
    assert.equal(result.value.isSerialized, true);
    assert.equal(result.value.taxRateId, null);
  }
});

test("generated SKU is stable for review and SQL LIKE search treats special characters literally", () => {
  const result = parseProductInput({ ...product, sku: "" });
  assert.ok(result.ok);
  assert.equal(productSku(result.value), "ST-123E4567E89B42D3A456");
  assert.equal(escapeLikeLiteral(String.raw`A_B%\C`), String.raw`A\_B\%\\C`);
});

test("invalid names, prices, SKU, categories, tax and request IDs are rejected", () => {
  const result = parseProductInput({ ...product, requestId: "not-a-uuid", sku: "bad code", nameAr: " ", category: "OTHER", purchaseCost: "-1", salePrice: "1.999", taxRateId: "2147483648" });
  assert.equal(result.ok, false);
  if (!result.ok) for (const key of ["form", "sku", "nameAr", "category", "purchaseCost", "salePrice", "taxRateId"]) assert.ok(result.errors[key], key);
});

test("service products cannot be marked serialized", () => {
  const result = parseProductInput({ ...product, category: "SERVICE", isSerialized: true });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.isSerialized);
});

test("opening values require an exact serial per serialized item", () => {
  const result = parseOpeningInput(opening, true);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.quantity, "2");
    assert.equal(result.value.unitCost, "1200.5");
    assert.deepEqual(result.value.serials.map((serial) => serial.key), ["AB-1", "AB-2"]);
  }
  for (const change of [
    { quantity: "2.5" }, { quantity: "0" }, { quantity: "3" },
    { serialNumbers: "ab-١\nAB-1" }, { serialNumbers: "ab-1\nAB-1\u200b" },
    { quantity: "1001" }, { unitCost: "-1" },
  ]) {
    assert.equal(parseOpeningInput({ ...opening, ...change }, true).ok, false, JSON.stringify(change));
  }
});

test("unserialized items reject accidentally submitted serials", () => {
  assert.equal(parseOpeningInput(opening, false).ok, false);
  const result = parseOpeningInput({ ...opening, quantity: "1.25", serialNumbers: "" }, false);
  assert.equal(result.ok, true);
});
